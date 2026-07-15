import {
  importParsedFilesAtomic,
  markImportBatchesMaterializationFailed,
  markImportBatchesMaterialized,
  recordFailedImportAttempt,
  type ImportParsedFileInput,
  type ImportParsedFileResult,
} from "@/lib/server/import-service";
import { refreshMaterializedClosedTrades } from "@/lib/server/closed-trades-materialized";
import { refreshMaterializedExecutionAnalytics } from "@/lib/server/execution-analytics-materialized";
import { parseFlexStatementCsv } from "@/lib/import/ibkr-flex";
import type { ParsedImport } from "@/lib/import/ibkr-parser";

const DEFAULT_BASE = "https://gdcdyn.interactivebrokers.com/Universal/servlet";

interface FlexRunInput {
  token: string;
  queryId: string;
  baseUrl?: string;
}

interface FlexResponse {
  status?: string;
  referenceCode?: string;
  url?: string;
  errorCode?: string;
  errorMessage?: string;
}

function extractXmlTag(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1]?.trim();
}

function parseFlexResponse(xml: string): FlexResponse {
  return {
    status: extractXmlTag(xml, "Status"),
    referenceCode: extractXmlTag(xml, "ReferenceCode"),
    url: extractXmlTag(xml, "Url"),
    errorCode: extractXmlTag(xml, "ErrorCode"),
    errorMessage: extractXmlTag(xml, "ErrorMessage"),
  };
}

async function callFlex(baseUrl: string, endpoint: string, params: Record<string, string>) {
  const url = new URL(`${baseUrl}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url.toString(), { method: "GET", cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Flex request failed (${res.status})`);
  }

  return res.text();
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasRowsOrErrors(parsed: ParsedImport) {
  return parsed.rawRowCount > 0 || parsed.rowErrors.length > 0;
}

function emptyImportResult() {
  return {
    batchId: "",
    rowsSeen: 0,
    rowsImported: 0,
    rowsSkipped: 0,
    rowErrors: 0,
    durationMs: 0,
    rowsPerSecond: 0,
    positionSnapshotMode: null,
  };
}

export async function pullFlexStatementCsv(input: FlexRunInput) {
  const baseUrl = input.baseUrl ?? process.env.IBKR_FLEX_BASE_URL ?? DEFAULT_BASE;

  const requestXml = await callFlex(baseUrl, "FlexStatementService.SendRequest", {
    t: input.token,
    q: input.queryId,
    v: "3",
  });

  const requestMeta = parseFlexResponse(requestXml);
  if (!requestMeta.referenceCode) {
    throw new Error(requestMeta.errorMessage ?? "IBKR Flex did not return a reference code.");
  }

  const maxPolls = Number(process.env.IBKR_FLEX_MAX_POLLS ?? "20");
  const intervalMs = Number(process.env.IBKR_FLEX_POLL_MS ?? "3000");

  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const statement = await callFlex(baseUrl, "FlexStatementService.GetStatement", {
      t: input.token,
      q: requestMeta.referenceCode,
      v: "3",
    });

    if (statement.trim().startsWith("<")) {
      const meta = parseFlexResponse(statement);
      const waiting = (meta.status ?? "").toLowerCase() === "warn" || (meta.errorCode ?? "") === "1019";
      if (waiting) {
        await wait(intervalMs);
        continue;
      }
      throw new Error(meta.errorMessage ?? "IBKR Flex returned an unexpected XML response.");
    }

    return statement;
  }

  throw new Error("Timed out waiting for IBKR Flex statement generation.");
}

export async function runFlexImport(input?: Partial<FlexRunInput>) {
  const token = input?.token ?? process.env.IBKR_FLEX_TOKEN;
  const queryId = input?.queryId ?? process.env.IBKR_FLEX_QUERY_ID;

  if (!token || !queryId) {
    throw new Error("Missing IBKR_FLEX_TOKEN or IBKR_FLEX_QUERY_ID.");
  }

  const csv = await pullFlexStatementCsv({ token, queryId, baseUrl: input?.baseUrl });
  let parsed: ReturnType<typeof parseFlexStatementCsv>;
  try {
    parsed = parseFlexStatementCsv(csv);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Flex statement parsing failed.";
    await recordFailedImportAttempt({
      filename: `flex-statement-${new Date().toISOString()}.csv`,
      fileType: "flex",
      rawContent: csv,
      message,
    });
    throw error;
  }
  const batchIds: string[] = [];

  let tradesResult: ImportParsedFileResult = emptyImportResult();
  let positionsResult: ImportParsedFileResult = emptyImportResult();
  const importTimestamp = new Date().toISOString();
  const pendingImports: Array<{ kind: "trades" | "positions"; params: ImportParsedFileInput }> = [];

  if (hasRowsOrErrors(parsed.trades)) {
    pendingImports.push({
      kind: "trades",
      params: {
        filename: `flex-trades-${importTimestamp}.csv`,
        parsed: parsed.trades,
        fileType: "flex-trades",
        rawContent: csv,
      },
    });
  }

  if (hasRowsOrErrors(parsed.positions)) {
    pendingImports.push({
      kind: "positions",
      params: {
        filename: `flex-positions-${importTimestamp}.csv`,
        parsed: parsed.positions,
        fileType: "flex-positions",
        rawContent: csv,
        positionSnapshotMode: "partial",
      },
    });
  }

  if (pendingImports.length === 0) {
    await recordFailedImportAttempt({
      filename: `flex-empty-${new Date().toISOString()}.csv`,
      fileType: "flex",
      rawContent: csv,
      message: "No importable Flex trade or position rows were found.",
    });
    throw new Error("No importable Flex trade or position rows were found.");
  }

  const atomicResults = await importParsedFilesAtomic(pendingImports.map((item) => item.params));
  for (const [index, result] of atomicResults.entries()) {
    const pendingImport = pendingImports[index];
    batchIds.push(result.batchId);
    if (pendingImport.kind === "trades") {
      tradesResult = result;
    } else {
      positionsResult = result;
    }
  }

  try {
    await refreshMaterializedExecutionAnalytics();
    await refreshMaterializedClosedTrades();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Materialization refresh failed.";
    await markImportBatchesMaterializationFailed(batchIds, message);
    throw error;
  }

  await markImportBatchesMaterialized(batchIds);

  return {
    trades: tradesResult,
    positions: positionsResult,
    commissionsSeen: parsed.commissionsSeen,
  };
}

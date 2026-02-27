import { importParsedFile } from "@/lib/server/import-service";
import { parseFlexStatementCsv } from "@/lib/import/ibkr-flex";

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
  const parsed = parseFlexStatementCsv(csv);

  const tradesResult = await importParsedFile({
    filename: `flex-trades-${new Date().toISOString()}.csv`,
    parsed: parsed.trades,
    fileType: "flex-trades",
  });

  const positionsResult = await importParsedFile({
    filename: `flex-positions-${new Date().toISOString()}.csv`,
    parsed: parsed.positions,
    fileType: "flex-positions",
  });

  return {
    trades: tradesResult,
    positions: positionsResult,
    commissionsSeen: parsed.commissionsSeen,
  };
}

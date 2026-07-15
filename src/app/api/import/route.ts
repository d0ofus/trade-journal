import { NextRequest, NextResponse } from "next/server";
import { parse as parseSync } from "csv-parse/sync";
import { parseCsvWithMapping, previewCsv, type ParsedImport } from "@/lib/import/ibkr-parser";
import { filterOutIdealFxCommissionRows, parseFlexStatementCsv, splitFlexSections } from "@/lib/import/ibkr-flex";
import { importPreflightFailures } from "@/lib/import/import-preflight";
import { prisma } from "@/lib/prisma";
import { refreshMaterializedClosedTrades } from "@/lib/server/closed-trades-materialized";
import { refreshMaterializedExecutionAnalytics } from "@/lib/server/execution-analytics-materialized";
import { requireApiSession } from "@/lib/server/api-auth";
import { rejectE2eBlockedMutation } from "@/lib/server/e2e-demo-write-guard";
import {
  importParsedFilesAtomic,
  ImportRejectedError,
  markImportBatchesMaterializationFailed,
  markImportBatchesMaterialized,
  recordFailedImportAttempt,
  type PositionSnapshotImportMode,
} from "@/lib/server/import-service";

type ImportPreview = {
  filename: string;
  kind: "executions" | "positions" | "snapshots" | "unknown" | "commissions";
  headers: string[];
  mapping: Record<string, string | null>;
  rows: Record<string, string>[];
  errors: string[];
  totalRows?: number;
  positionSnapshotSafety?: PositionSnapshotSafety;
};

type PositionSnapshotSafety = {
  accounts: Array<{
    account: string;
    snapshotDates: string[];
    latestKnownSnapshotDate: string | null;
    missingReportDateRows: number;
    blockedFullSnapshot: boolean;
    blockReason: string | null;
  }>;
  blockedFullSnapshot: boolean;
};

async function readFiles(formData: FormData) {
  const files = formData.getAll("files").filter((value): value is File => value instanceof File);
  const loaded = await Promise.all(
    files.map(async (file) => ({
      filename: file.name,
      content: await file.text(),
    })),
  );

  return loaded;
}

function hasRowsOrErrors(parsed: ParsedImport) {
  return parsed.rawRowCount > 0 || parsed.rowErrors.length > 0;
}

function normalizeSnapshotDate(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function snapshotDateKey(date: Date) {
  return normalizeSnapshotDate(date).toISOString().slice(0, 10);
}

async function buildPositionSnapshotSafety(parsed: ParsedImport): Promise<PositionSnapshotSafety | undefined> {
  if (parsed.kind !== "positions" || parsed.positions.length === 0) return undefined;

  const byAccount = new Map<string, { snapshotDates: Set<string>; missingReportDateRows: number }>();
  for (const position of parsed.positions) {
    const current = byAccount.get(position.account) ?? { snapshotDates: new Set<string>(), missingReportDateRows: 0 };
    if (position.reportDate) {
      current.snapshotDates.add(snapshotDateKey(position.reportDate));
    } else {
      current.missingReportDateRows += 1;
    }
    byAccount.set(position.account, current);
  }

  const accountCodes = [...byAccount.keys()];
  const accounts = await prisma.account.findMany({
    where: { ibkrAccount: { in: accountCodes } },
    select: {
      ibkrAccount: true,
      positionSnapshots: {
        orderBy: { date: "desc" },
        take: 1,
        select: { date: true },
      },
    },
  });
  const latestByAccount = new Map(
    accounts.map((account) => [
      account.ibkrAccount,
      account.positionSnapshots[0]?.date ? snapshotDateKey(account.positionSnapshots[0].date) : null,
    ]),
  );

  const safetyAccounts = accountCodes.sort((left, right) => left.localeCompare(right)).map((account) => {
    const info = byAccount.get(account) ?? { snapshotDates: new Set<string>(), missingReportDateRows: 0 };
    const snapshotDates = [...info.snapshotDates].sort();
    const latestKnownSnapshotDate = latestByAccount.get(account) ?? null;
    let blockReason: string | null = null;
    if (info.missingReportDateRows > 0) {
      blockReason = `Full snapshot blocked: ${account} has ${info.missingReportDateRows} position row(s) without ReportDate.`;
    } else if (snapshotDates.length !== 1) {
      blockReason = `Full snapshot blocked: ${account} has mixed snapshot dates (${snapshotDates.join(", ") || "none"}).`;
    } else if (latestKnownSnapshotDate && snapshotDates[0] < latestKnownSnapshotDate) {
      blockReason = `Full snapshot blocked: ${account} snapshot date ${snapshotDates[0]} is older than latest known position date ${latestKnownSnapshotDate}.`;
    }
    return {
      account,
      snapshotDates,
      latestKnownSnapshotDate,
      missingReportDateRows: info.missingReportDateRows,
      blockedFullSnapshot: Boolean(blockReason),
      blockReason,
    };
  });

  return {
    accounts: safetyAccounts,
    blockedFullSnapshot: safetyAccounts.some((account) => account.blockedFullSnapshot),
  };
}

function parsePositionSnapshotMode(value: unknown): PositionSnapshotImportMode | null {
  if (value === "partial" || value === "PARTIAL") return "partial";
  if (value === "full" || value === "FULL") return "full";
  return null;
}

function parsePositionSnapshotModeByFile(raw: string) {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Position snapshot modes must be keyed by filename.");
  }

  const modes: Record<string, PositionSnapshotImportMode> = {};
  for (const [filename, value] of Object.entries(parsed)) {
    const mode = parsePositionSnapshotMode(value);
    if (!mode) {
      throw new Error(`Invalid position snapshot mode for ${filename}.`);
    }
    modes[filename] = mode;
  }
  return modes;
}

async function recordImportParseFailure(params: {
  filename: string;
  fileType: string;
  content: string;
  error: unknown;
}) {
  const message = params.error instanceof Error ? params.error.message : "Import parsing failed.";
  await recordFailedImportAttempt({
    filename: params.filename,
    fileType: params.fileType,
    rawContent: params.content,
    message,
  });
}

export async function POST(req: NextRequest) {
  const authError = await requireApiSession();
  if (authError) return authError;

  try {
    const formData = await req.formData();
    const action = String(formData.get("action") ?? "preview");
    if (action !== "preview") {
      const demoWriteError = rejectE2eBlockedMutation("import commits");
      if (demoWriteError) return demoWriteError;
    }
    const files = await readFiles(formData);

    if (!files.length) {
      return NextResponse.json({ error: "No files uploaded." }, { status: 400 });
    }

    if (action === "preview") {
      const previews: ImportPreview[] = [];
      for (const file of files) {
        const sections = splitFlexSections(file.content);
        if (sections.tradesCsv || sections.positionsCsv || sections.commissionsCsv) {
          const parsedFlex =
            sections.tradesCsv || sections.positionsCsv ? parseFlexStatementCsv(file.content) : null;

          if (sections.tradesCsv && parsedFlex) {
            const rows = parsedFlex.trades.executions.map((row) => ({
              account: row.account,
              executedAt: row.executedAt.toISOString(),
              symbol: row.symbol,
              exchange: row.exchange ?? "",
              assetType: row.assetType,
              side: row.side,
              quantity: String(row.quantity),
              price: String(row.price),
              commission: String(row.commission),
              fees: String(row.fees),
              currency: row.currency,
              orderId: row.orderId ?? "",
              strategy: row.strategy ?? "",
            }));
            previews.push({
              filename: `${file.filename} :: Trades`,
              kind: "executions",
              headers: [
                "account",
                "executedAt",
                "symbol",
                "exchange",
                "assetType",
                "side",
                "quantity",
                "price",
                "commission",
                "fees",
                "currency",
                "orderId",
                "strategy",
              ],
              mapping: {},
              rows,
              errors: [],
              totalRows: parsedFlex.trades.rawRowCount,
            });
          }

          if (sections.positionsCsv && parsedFlex) {
            const rows = parsedFlex.positions.positions.map((row) => ({
              account: row.account,
              symbol: row.symbol,
              exchange: row.exchange ?? "",
              assetType: row.assetType,
              reportDate: row.reportDate ? row.reportDate.toISOString().slice(0, 10) : "",
              quantity: String(row.quantity),
              avgCost: String(row.avgCost),
              unrealizedPnl: String(row.unrealizedPnl ?? 0),
              currency: row.currency,
            }));
            previews.push({
              filename: `${file.filename} :: Positions`,
              kind: "positions",
              headers: [
                "account",
                "symbol",
                "exchange",
                "assetType",
                "reportDate",
                "quantity",
                "avgCost",
                "unrealizedPnl",
                "currency",
              ],
              mapping: {},
              rows,
              errors: [],
              totalRows: parsedFlex.positions.rawRowCount,
              positionSnapshotSafety: await buildPositionSnapshotSafety(parsedFlex.positions),
            });
          }

          if (sections.commissionsCsv) {
            const rows = parseSync(sections.commissionsCsv, {
              columns: true,
              skip_empty_lines: true,
              trim: true,
              bom: true,
              relax_column_count: true,
            }) as Record<string, string>[];
            const filteredRows = filterOutIdealFxCommissionRows(rows);
            const normalizedRows = filteredRows.map((row) =>
              Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value ?? "")])),
            );
            const headers = normalizedRows.length > 0 ? Object.keys(normalizedRows[0]) : [];
            previews.push({
              filename: `${file.filename} :: Commissions`,
              kind: "commissions",
              headers,
              mapping: {},
              rows: normalizedRows,
              errors: [],
              totalRows: normalizedRows.length,
            });
          }

          continue;
        }

        const preview = previewCsv(file.filename, file.content);
        const positionSnapshotSafety =
          preview.kind === "positions" && preview.errors.length === 0
            ? await (async () => {
                try {
                  return buildPositionSnapshotSafety(parseCsvWithMapping("positions", file.content, preview.mapping));
                } catch {
                  return undefined;
                }
              })()
            : undefined;
        previews.push({ ...preview, positionSnapshotSafety });
      }
      return NextResponse.json({ previews });
    }

    if (action === "commit") {
      const commitStartedAtMs = Date.now();
      const mappingRaw = String(formData.get("mappingByFile") ?? "{}");
      const kindRaw = String(formData.get("kindByFile") ?? "{}");
      const positionSnapshotModeRaw = String(formData.get("positionSnapshotModeByFile") ?? "{}");
      const legacyGlobalFullSnapshot = String(formData.get("fullPositionSnapshot") ?? "false") === "true";
      const legacyFullSnapshotByFileRaw = formData.get("fullPositionSnapshotByFile");
      if (legacyGlobalFullSnapshot) {
        return NextResponse.json(
          { error: "Full position snapshots must be selected per position file with positionSnapshotModeByFile." },
          { status: 400 },
        );
      }
      if (legacyFullSnapshotByFileRaw) {
        try {
          const legacyModes = JSON.parse(String(legacyFullSnapshotByFileRaw)) as unknown;
          const hasLegacyFullMode =
            legacyModes &&
            typeof legacyModes === "object" &&
            !Array.isArray(legacyModes) &&
            Object.values(legacyModes).some((value) => value === true || value === "true");
          if (hasLegacyFullMode) {
            return NextResponse.json(
              { error: "Use positionSnapshotModeByFile with 'full' for explicit full position snapshots." },
              { status: 400 },
            );
          }
        } catch {
          return NextResponse.json({ error: "Invalid legacy full position snapshot payload." }, { status: 400 });
        }
      }

      let mappingByFile: Record<string, Record<string, string | null>> = {};
      let kindByFile: Record<string, "executions" | "positions" | "snapshots"> = {};
      let positionSnapshotModeByFile: Record<string, PositionSnapshotImportMode> = {};

      try {
        mappingByFile = JSON.parse(mappingRaw);
        kindByFile = JSON.parse(kindRaw);
        positionSnapshotModeByFile = parsePositionSnapshotModeByFile(positionSnapshotModeRaw);
      } catch {
        return NextResponse.json({ error: "Invalid import mapping or position snapshot mode payload." }, { status: 400 });
      }

      const modeForPositionFile = (filename: string, sectionFilename = filename): PositionSnapshotImportMode =>
        positionSnapshotModeByFile[sectionFilename] ?? positionSnapshotModeByFile[filename] ?? "partial";

      const results = [] as Array<{
        filename: string;
        batchId: string;
        rowsSeen: number;
        rowsImported: number;
        rowsSkipped: number;
        rowErrors: number;
        durationMs: number;
        rowsPerSecond: number;
        positionSnapshotMode: PositionSnapshotImportMode | null;
      }>;
      let shouldRefreshClosedTrades = false;
      const pendingImports = [] as Array<{
        filename: string;
        importFilename: string;
        parsed: ParsedImport;
        fileType: string;
        rawContent: string;
        positionSnapshotMode?: PositionSnapshotImportMode;
        refreshClosedTrades: boolean;
      }>;

      for (const file of files) {
        const sections = splitFlexSections(file.content);
        if (sections.tradesCsv || sections.positionsCsv) {
          let parsedFlex: ReturnType<typeof parseFlexStatementCsv>;
          try {
            parsedFlex = parseFlexStatementCsv(file.content);
          } catch (error) {
            await recordImportParseFailure({
              filename: file.filename,
              fileType: "flex",
              content: file.content,
              error,
            });
            throw error;
          }
          if (sections.tradesCsv && hasRowsOrErrors(parsedFlex.trades)) {
            pendingImports.push({
              filename: `${file.filename} :: Trades`,
              importFilename: `${file.filename}::trades`,
              parsed: parsedFlex.trades,
              fileType: "flex-trades",
              rawContent: file.content,
              refreshClosedTrades: true,
            });
          }
          if (sections.positionsCsv && hasRowsOrErrors(parsedFlex.positions)) {
            const sectionFilename = `${file.filename} :: Positions`;
            pendingImports.push({
              filename: sectionFilename,
              importFilename: `${file.filename}::positions`,
              parsed: parsedFlex.positions,
              fileType: "flex-positions",
              rawContent: file.content,
              positionSnapshotMode: modeForPositionFile(file.filename, sectionFilename),
              refreshClosedTrades: true,
            });
          }
          continue;
        }

        const kind = kindByFile[file.filename];
        if (!kind) continue;
        let parsed: ReturnType<typeof parseCsvWithMapping>;
        try {
          parsed = parseCsvWithMapping(kind, file.content, mappingByFile[file.filename]);
        } catch (error) {
          await recordImportParseFailure({
            filename: file.filename,
            fileType: kind,
            content: file.content,
            error,
          });
          throw error;
        }
        if (!hasRowsOrErrors(parsed)) continue;
        pendingImports.push({
          filename: file.filename,
          importFilename: file.filename,
          parsed,
          fileType: kind,
          rawContent: file.content,
          positionSnapshotMode: kind === "positions" ? modeForPositionFile(file.filename) : undefined,
          refreshClosedTrades: kind === "executions" || kind === "positions",
        });
      }

      if (pendingImports.length === 0) {
        return NextResponse.json({ error: "No importable trade, position, or snapshot rows were found." }, { status: 400 });
      }

      const invalidPendingImports = importPreflightFailures(pendingImports);
      if (invalidPendingImports.length > 0) {
        for (const failure of invalidPendingImports) {
          const item = pendingImports.find((candidate) => candidate.filename === failure.filename);
          if (!item) continue;
          await recordFailedImportAttempt({
            filename: item.importFilename,
            fileType: item.fileType,
            rawContent: item.rawContent,
            message: failure.message,
            rowErrors: item.parsed.rowErrors,
            rowsSeen: item.parsed.rawRowCount,
            positionSnapshotMode: item.positionSnapshotMode,
          });
        }
        throw new ImportRejectedError(
          `Import preflight failed before applying rows: ${invalidPendingImports
            .map((item) => `${item.filename}: ${item.message}`)
            .join(" ")}`,
        );
      }

      const atomicResults = await importParsedFilesAtomic(
        pendingImports.map((item) => ({
          filename: item.importFilename,
          parsed: item.parsed,
          fileType: item.fileType,
          rawContent: item.rawContent,
          positionSnapshotMode: item.positionSnapshotMode,
        })),
      );

      for (const [index, result] of atomicResults.entries()) {
        const item = pendingImports[index];
        results.push({ filename: item.filename, ...result });
        if (item.refreshClosedTrades) shouldRefreshClosedTrades = true;
      }

      if (shouldRefreshClosedTrades) {
        try {
          await refreshMaterializedExecutionAnalytics();
          await refreshMaterializedClosedTrades();
        } catch (error) {
          const message = error instanceof Error ? error.message : "Materialization refresh failed.";
          await markImportBatchesMaterializationFailed(results.map((result) => result.batchId), message);
          throw error;
        }
      }
      try {
        await markImportBatchesMaterialized(results.map((result) => result.batchId));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Import batches were written but could not be marked materialized.";
        await markImportBatchesMaterializationFailed(results.map((result) => result.batchId), message);
        throw error;
      }

      const totalDurationMs = Math.max(1, Date.now() - commitStartedAtMs);
      const totalRowsImported = results.reduce((sum, result) => sum + result.rowsImported, 0);
      const totalRowsSeen = results.reduce((sum, result) => sum + result.rowsSeen, 0);
      const totalRowsSkipped = results.reduce((sum, result) => sum + result.rowsSkipped, 0);
      const totalRowsPerSecond = Number(((totalRowsImported / totalDurationMs) * 1000).toFixed(2));

      return NextResponse.json({
        results,
        summary: {
          totalRowsSeen,
          totalRowsImported,
          totalRowsSkipped,
          totalDurationMs,
          totalRowsPerSecond,
        },
      });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Import request failed. If this is a large YTD file, split it into smaller CSVs and retry.";
    return NextResponse.json({ error: message }, { status: error instanceof ImportRejectedError ? 400 : 500 });
  }
}

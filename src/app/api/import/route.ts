import { NextRequest, NextResponse } from "next/server";
import { parse as parseSync } from "csv-parse/sync";
import { parseCsvWithMapping, previewCsv } from "@/lib/import/ibkr-parser";
import { filterOutIdealFxCommissionRows, parseFlexStatementCsv, splitFlexSections } from "@/lib/import/ibkr-flex";
import { importParsedFile } from "@/lib/server/import-service";

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

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const action = String(formData.get("action") ?? "preview");
    const files = await readFiles(formData);

    if (!files.length) {
      return NextResponse.json({ error: "No files uploaded." }, { status: 400 });
    }

    if (action === "preview") {
      const previews = files.flatMap((file) => {
        const sections = splitFlexSections(file.content);
        if (sections.tradesCsv || sections.positionsCsv || sections.commissionsCsv) {
          const parsedFlex = parseFlexStatementCsv(file.content);
          const out = [] as Array<{
            filename: string;
            kind: "executions" | "positions" | "snapshots" | "unknown" | "commissions";
            headers: string[];
            mapping: Record<string, string | null>;
            rows: Record<string, string>[];
            errors: string[];
            totalRows: number;
          }>;

          if (sections.tradesCsv) {
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
            out.push({
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
              totalRows: rows.length,
            });
          }

          if (sections.positionsCsv) {
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
            out.push({
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
              totalRows: rows.length,
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
            out.push({
              filename: `${file.filename} :: Commissions`,
              kind: "commissions",
              headers,
              mapping: {},
              rows: normalizedRows,
              errors: [],
              totalRows: normalizedRows.length,
            });
          }

          return out;
        }

        const preview = previewCsv(file.filename, file.content);
        return [{ ...preview, totalRows: preview.rows.length }];
      });
      return NextResponse.json({ previews });
    }

    if (action === "commit") {
      const mappingRaw = String(formData.get("mappingByFile") ?? "{}");
      const kindRaw = String(formData.get("kindByFile") ?? "{}");

      let mappingByFile: Record<string, Record<string, string | null>> = {};
      let kindByFile: Record<string, "executions" | "positions" | "snapshots"> = {};

      try {
        mappingByFile = JSON.parse(mappingRaw);
        kindByFile = JSON.parse(kindRaw);
      } catch {
        return NextResponse.json({ error: "Invalid mapping payload." }, { status: 400 });
      }

      const results = [] as Array<{ filename: string; rowsSeen: number; rowsImported: number; rowsSkipped: number }>;

      for (const file of files) {
        const sections = splitFlexSections(file.content);
        if (sections.tradesCsv || sections.positionsCsv) {
          const parsedFlex = parseFlexStatementCsv(file.content);
          const tradeResult = await importParsedFile({
            filename: `${file.filename}::trades`,
            parsed: parsedFlex.trades,
            fileType: "flex-trades",
          });
          const positionResult = await importParsedFile({
            filename: `${file.filename}::positions`,
            parsed: parsedFlex.positions,
            fileType: "flex-positions",
          });
          results.push({ filename: `${file.filename} :: Trades`, ...tradeResult });
          results.push({ filename: `${file.filename} :: Positions`, ...positionResult });
          continue;
        }

        const kind = kindByFile[file.filename];
        if (!kind) continue;
        const parsed = parseCsvWithMapping(kind, file.content, mappingByFile[file.filename]);
        const result = await importParsedFile({
          filename: file.filename,
          parsed,
          fileType: kind,
        });
        results.push({ filename: file.filename, ...result });
      }

      return NextResponse.json({ results });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Import request failed. If this is a large YTD file, split it into smaller CSVs and retry.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

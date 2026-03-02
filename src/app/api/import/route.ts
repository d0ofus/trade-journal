import { NextRequest, NextResponse } from "next/server";
import { parse as parseSync } from "csv-parse/sync";
import { parseCsvWithMapping, previewCsv } from "@/lib/import/ibkr-parser";
import { parseFlexStatementCsv, splitFlexSections } from "@/lib/import/ibkr-flex";
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
          const out = [] as Array<{
            filename: string;
            kind: "executions" | "positions" | "snapshots" | "unknown" | "commissions";
            headers: string[];
            mapping: Record<string, string | null>;
            rows: Record<string, string>[];
            errors: string[];
          }>;

          if (sections.tradesCsv) {
            out.push({
              ...previewCsv(`${file.filename} :: Trades`, sections.tradesCsv),
              kind: "executions",
            });
          }

          if (sections.positionsCsv) {
            out.push({
              ...previewCsv(`${file.filename} :: Positions`, sections.positionsCsv),
              kind: "positions",
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
            const normalizedRows = rows.map((row) =>
              Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value ?? "")])),
            );
            const headers = normalizedRows.length > 0 ? Object.keys(normalizedRows[0]) : [];
            out.push({
              filename: `${file.filename} :: Commissions`,
              kind: "commissions",
              headers,
              mapping: {},
              rows: normalizedRows.slice(0, 5),
              errors: [],
            });
          }

          return out;
        }

        return [previewCsv(file.filename, file.content)];
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

import { NextRequest, NextResponse } from "next/server";
import { parseCsvWithMapping, previewCsv } from "@/lib/import/ibkr-parser";
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
  const formData = await req.formData();
  const action = String(formData.get("action") ?? "preview");
  const files = await readFiles(formData);

  if (!files.length) {
    return NextResponse.json({ error: "No files uploaded." }, { status: 400 });
  }

  if (action === "preview") {
    const previews = files.map((file) => previewCsv(file.filename, file.content));
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
}

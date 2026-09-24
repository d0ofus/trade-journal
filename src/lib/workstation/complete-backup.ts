import { strToU8, zipSync } from "fflate";
import { downloadBlob } from "./export";
type DownloadFile = { name: string; bytes: number; sha256: string; url: string };
type DownloadPage = { manifest?: unknown; files: DownloadFile[]; next: number | null };
async function api<T>(path: string, method = "GET"): Promise<T> { const response = await fetch(path, { method, cache: "no-store" }), body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Complete backup failed"); return body; }
export async function downloadCompleteBackup(progress: (message: string) => void) {
  progress("Freezing database metadata and retaining required originals…");
  const created = await api<{ id: string; files: number; bytes: number }>("/api/admin/evidence-backup", "POST");
  let offset: number | null = 0, count = 0, part = 1, size = 0, files: Record<string, Uint8Array> = {}, manifest: Uint8Array | undefined;
  const flush = () => {
    if (!Object.keys(files).length || !manifest) return;
    files["manifest.json"] = manifest;
    downloadBlob(new Blob([zipSync(files, { level: 0 })], { type: "application/zip" }), `trade-journal-complete-${created.id}-part-${String(part++).padStart(3, "0")}.zip`);
    files = {}; size = 0;
  };
  while (offset !== null) {
    const pageUrl = `/api/admin/evidence-backup?${new URLSearchParams({ id: created.id, offset: String(offset) })}`;
    const page: DownloadPage = await api(pageUrl);
    if (page.manifest) manifest = strToU8(JSON.stringify(page.manifest, null, 2));
    for (const file of page.files) {
      progress(`Downloading and verifying original files: ${count + 1}/${created.files}. Keep all backup parts.`);
      if (size + file.bytes > 80_000_000) flush();
      let bytes: ArrayBuffer | undefined, url = file.url;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(url, { credentials: "omit", signal: AbortSignal.timeout(60_000) });
          if (!response.ok) throw new Error("Original download unavailable");
          bytes = await response.arrayBuffer(); break;
        } catch {
          if (attempt === 2) throw new Error("An original download failed after retries. Generate the complete backup again; incomplete parts must not be used for restoration.");
          progress(`Renewing access and retrying ${file.name} from the same frozen backup…`);
          const renewed = (await api<DownloadPage>(pageUrl)).files.find(item => item.name === file.name && item.sha256 === file.sha256 && item.bytes === file.bytes);
          if (!renewed) throw new Error("The frozen backup is unavailable. Generate a new complete backup.");
          url = renewed.url;
        }
      }
      if (!bytes) throw new Error("Original download did not complete.");
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
      if (bytes.byteLength !== file.bytes || hash !== file.sha256) throw new Error(`Backup checksum mismatch: ${file.name}. No complete backup was certified.`);
      files[file.name] = new Uint8Array(bytes); size += bytes.byteLength; count++;
    }
    offset = page.next;
  }
  flush();
  progress(`Downloaded and checksum-verified ${count} files across ${part - 1} backup part(s). Keep every part together. This is not a restore test; standalone external screenshots retain their existing backup requirements.`);
}

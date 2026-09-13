import { inspectInlineDataUrl } from "./backup-assets";
/** Images remain inside workstationJson; the manifest verifies them without a second binary copy. */
export function workstationEvidenceManifest(notes: { groupKey?: unknown; workstationJson?: unknown }[]) {
  const entries: { groupKey: string; index: number; id: string; bytes: number; sha256: string }[] = [];
  const invalid: string[] = [];
  for (const note of notes) {
    if (!note.workstationJson) continue;
    try {
      const document = JSON.parse(String(note.workstationJson));
      if (!Array.isArray(document.evidence)) continue; // Older journal-only documents remain recoverable.
      for (const [index, item] of document.evidence.entries()) {
        const parsed = typeof item?.image === "string" ? inspectInlineDataUrl(item.image) : null;
        if (!parsed) { invalid.push(`${String(note.groupKey)}:${index}`); continue; }
        entries.push({ groupKey: String(note.groupKey), index, id: String(item.id), bytes: parsed.bytes, sha256: parsed.sha256 });
      }
    } catch { invalid.push(String(note.groupKey)); }
  }
  return { entries, invalid };
}

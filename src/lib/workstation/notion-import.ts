import { strToU8, zipSync } from "fflate";
import { csvCell } from "./export";
import { beforeEntryBoundary } from "./before-entry";
import { firstExecution } from "./before-entry";
import { notionBlocks } from "./notion-export";
import { notionProperties, stopLossPercent } from "./notion-template";
import { assignedEvidenceIds, evidenceCaption, sectionEvidenceIds } from "./evidence";
import { escapeHtml, richPlain } from "./rich-text";
import type { Trade, TradeDocument } from "./types";
import type { MarketMetrics } from "./market-metrics";

export type NotionImportReview = { trade: Trade; doc: TradeDocument; url: string; metrics?: MarketMetrics };

export function notionImportCsv({ trade, doc, url }: NotionImportReview) {
  const review = doc.review;
  const columns = ["Name", "Trade ID", ...notionProperties.map(p => p.kind === "formula" ? `${p.label} (snapshot)` : p.label), "Planned entry", "Planned stop", "Review URL"];
  const values: (string | number)[] = [`${trade.symbol} · ${trade.direction} · ${new Date(trade.openTime * 1000).toISOString().slice(0, 10)}`, trade.id];
  for (const property of notionProperties) {
    const value = review.notion?.properties[property.key];
    if (property.kind === "date") {
      const first = firstExecution(trade);
      values.push(first && beforeEntryBoundary(trade, "5m") !== null ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(first.time * 1000)) : "");
    } else if (property.kind === "formula") values.push(stopLossPercent(review.notion) ?? "");
    else if (property.kind === "takeaways") values.push(richPlain(review.takeaway));
    else if (property.kind === "checkbox") values.push(value === true ? "TRUE" : value === false ? "FALSE" : "");
    else if (typeof value === "number") values.push(value);
    else if (Array.isArray(value)) values.push(value.join(", "));
    else values.push(typeof value === "string" ? richPlain(value) : "");
  }
  for (const key of ["plannedEntry", "plannedStop"] as const) { const value = review.notion?.properties[key]; values.push(typeof value === "number" ? value : ""); }
  values.push(url);
  return "\ufeff" + columns.map(csvCell).join(",") + "\r\n" + values.map(csvCell).join(",") + "\r\n";
}

/** A page-only import: including CSV or a second page format would create duplicate content. */
export function notionPageArchive({ trade, doc, url, metrics }: NotionImportReview) {
  const files: Record<string, Uint8Array> = {};
  const images = new Map<string, string>();
  const originals = new Map<string, string>();
  doc.evidence.forEach((evidence, index) => {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(evidence.image);
    if (!match) throw new Error(`Unable to include chart “${evidence.name}”. Download or replace the image before exporting.`);
    const identity = evidence.asset?.sha256 ?? evidence.image;
    const path = originals.get(identity) ?? `assets/chart-${index + 1}.${match[1] === "jpeg" ? "jpg" : match[1]}`;
    if (!originals.has(identity)) { files[path] = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0)); originals.set(identity, path); }
    images.set(evidence.id, `<figure><img src="${path}" alt="${escapeHtml(evidence.name)}"><figcaption>${escapeHtml(evidenceCaption(evidence))}</figcaption></figure>`);
  });
  const assigned = assignedEvidenceIds(doc.review.notion);
  const blocks = notionBlocks(trade, doc, metrics).map(block => {
    const figures = block.key ? sectionEvidenceIds(doc.review.notion, block.key).map(id => images.get(id) ?? "").join("") : "";
    return `<h${block.level}>${escapeHtml(block.title)}</h${block.level}>${block.html}${figures}`;
  }).join("");
  const unassigned = doc.evidence.filter(e => !assigned.has(e.id));
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(trade.symbol)} review</title></head><body><h1>${escapeHtml(trade.symbol)} · ${trade.direction}</h1>${blocks}${unassigned.length ? "<h2>Unassigned charts</h2>" + unassigned.map(e => images.get(e.id)).join("") : ""}<p>Trade ID: ${escapeHtml(trade.id)} · Revision ${doc.revision}</p><p>${escapeHtml(url)}</p></body></html>`;
  files["review.html"] = strToU8(html);
  return new Blob([zipSync(files) as BlobPart], { type: "application/zip" });
}

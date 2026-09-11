import { strToU8, zipSync } from "fflate";
import { Trade, TradeDocument } from "./types";

export const exportColumns = ["Name", "Trade ID", "Symbol", "Account", "Direction", "Trade date", "Opened UTC", "Closed UTC", "Entry price", "Exit price", "Quantity", "Open quantity", "Executions", "Realized P&L", "Fees", "Currency", "Review status", "Setup", "Execution review", "Takeaway", "Thesis", "Exit review", "Mistake", "Follow up", "Notes", "Tags", "Custom fields", "Review URL", "Attachments", "Revision"];
export const plainText = (value: string) => value.replace(/<\/(p|div|li|h[1-6])>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
export const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const filename = (trade: Trade) => `${new Date(trade.openTime * 1000).toISOString().slice(0, 10)}_${trade.symbol}_${trade.id.replace(/[^a-z0-9_-]/gi, "_").slice(0, 100)}`;
export function csvCell(value: string | number) { const text = typeof value === "number" ? String(value) : /^[\s]*[=+@-]/.test(value) ? `'${value}` : value; return `"${String(text).replace(/"/g, '""')}"`; }
export function reviewMarkdown(trade: Trade, doc: TradeDocument, url: string) {
  const r = doc.review;
  return `# ${trade.symbol} · ${trade.direction}\n\n${new Date(trade.openTime * 1000).toISOString()} · ${trade.account}\n\nTrade ID: ${trade.id}\nRealized P&L: ${trade.pnl.toFixed(2)} ${trade.currency} · Fees: ${trade.fees.toFixed(2)}\nStatus: ${r.status}\n\n` + [["Setup", r.setup], ["Execution", r.execution], ["Takeaway", r.takeaway], ["Thesis", r.thesis], ["Exit review", r.exit], ["Mistake", r.mistake], ["Follow up", r.followUp], ["Notes", plainText(r.notes)], ...Object.entries(r.custom)].filter(([, text]) => text).map(([title, text]) => `## ${title}\n\n${text}\n`).join("\n") + `\nTags: ${r.tags.join(", ")}\n\n${url}\n`;
}
export function reviewCsv(rows: { trade: Trade; doc: TradeDocument; url: string }[], columns = exportColumns, headers: Record<string, string> = {}) {
  const data = rows.map(({ trade: t, doc: d, url }) => {
    const r = d.review, iso = (time: number) => new Date(time * 1000).toISOString(), date = iso(t.openTime).slice(0, 10).split("-");
    const values: Record<string, string | number> = { Name: `${t.symbol} · ${t.direction} · ${date.join("-")}`, "Trade ID": t.id, Symbol: t.symbol, Account: t.account, Direction: t.direction, "Trade date": `${date[1]}/${date[2]}/${date[0]}`, "Opened UTC": iso(t.openTime), "Closed UTC": t.openQuantity ? "" : iso(t.closeTime), "Entry price": t.entry, "Exit price": t.exit, Quantity: t.quantity, "Open quantity": t.openQuantity, Executions: t.executions.length, "Realized P&L": t.pnl, Fees: t.fees, Currency: t.currency, "Review status": r.status, Setup: r.setup, "Execution review": r.execution, Takeaway: r.takeaway, Thesis: r.thesis, "Exit review": r.exit, Mistake: r.mistake, "Follow up": r.followUp, Notes: plainText(r.notes), Tags: r.tags.join(", "), "Custom fields": JSON.stringify(r.custom), "Review URL": url, Attachments: d.evidence.map(e => e.name).join("; "), Revision: d.revision };
    return columns.map(c => csvCell(values[c] ?? "")).join(",");
  });
  return "\ufeff" + columns.map(c => csvCell(headers[c] || c)).join(",") + "\r\n" + data.join("\r\n");
}
export function downloadBlob(blob: Blob, name: string) { const url = URL.createObjectURL(blob), anchor = document.createElement("a"); anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
export async function canvasBlob(canvas: HTMLCanvasElement) { return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PNG export failed")), "image/png")); }
export async function copyChart(canvas: HTMLCanvasElement, name: string): Promise<boolean> { const blob = await canvasBlob(canvas); try { if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("Image clipboard unavailable"); await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); return true; } catch { downloadBlob(blob, name); return false; } }
export function compositeCharts(images: HTMLCanvasElement[], light = false, positions: { x: number; y: number; width: number; height: number }[], scale = 2) {
  if (!images.length || positions.length !== images.length || positions.some(p => ![p.x, p.y, p.width, p.height].every(Number.isFinite) || p.width <= 0 || p.height <= 0)) throw new Error("Invalid chart layout for export.");
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(Math.max(...positions.map(p => p.x + p.width)) * scale);
  canvas.height = Math.ceil(Math.max(...positions.map(p => p.y + p.height)) * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = light ? "#edf0f5" : "#0b0f17"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  images.forEach((image, i) => { const p = positions[i]; ctx.drawImage(image, p.x * scale, p.y * scale, p.width * scale, p.height * scale); });
  return canvas;
}
export async function reviewArchive(rows: { trade: Trade; doc: TradeDocument; url: string }[], columns: string[], headers: Record<string, string>) {
  const files: Record<string, Uint8Array> = { "reviews.csv": strToU8(reviewCsv(rows, columns, headers)) };
  const manifest = { schema: 1, generatedAt: new Date().toISOString(), timezone: "UTC", format: "Execution Lab portable reviews", notion: "CSV imports add rows. Images must be attached or imported separately; Trade ID is not an automatic upsert key.", trades: [] as unknown[] };
  for (const row of rows) {
    const name = filename(row.trade), markdown = reviewMarkdown(row.trade, row.doc, row.url), attachments: string[] = [];
    for (const evidence of row.doc.evidence) { const path = `${name}/assets/${evidence.id.replace(/[^a-z0-9_-]/gi, "_")}.png`; const buffer = Uint8Array.from(atob(evidence.image.split(",")[1]), c => c.charCodeAt(0)); files[path] = buffer; attachments.push(path); }
    files[`${name}/review.md`] = strToU8(markdown + attachments.map(path => `\n![Chart](assets/${path.split("/").pop()})\n`).join(""));
    files[`${name}/review.html`] = strToU8(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(row.trade.symbol)} review</title></head><body><article>${markdown.split("\n\n").map(p => p.startsWith("## ") ? `<h2>${escapeHtml(p.slice(3))}</h2>` : p.startsWith("# ") ? `<h1>${escapeHtml(p.slice(2))}</h1>` : `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("")}${attachments.map(path => `<figure><img alt="Annotated trade chart" src="assets/${path.split("/").pop()}" style="max-width:100%"></figure>`).join("")}</article></body></html>`);
    files[`${name}/review.json`] = strToU8(JSON.stringify({ trade: row.trade, document: { ...row.doc, evidence: row.doc.evidence.map(e => ({ id: e.id, name: e.name, time: e.time, revision: e.revision, timeframe: e.timeframe })) } }, null, 2));
    manifest.trades.push({ id: row.trade.id, revision: row.doc.revision, folder: name, attachments });
  }
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  return new Blob([zipSync(files) as BlobPart], { type: "application/zip" });
}

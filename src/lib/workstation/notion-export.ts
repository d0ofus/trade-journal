import type { Trade, TradeDocument } from "./types";
import { chartSections, notionProperties, propertyText } from "./notion-template";
import { escapeHtml, richHtml, richMarkdown, richPlain } from "./rich-text";
import { metricEntries, unavailableMetrics, type MarketMetrics } from "./market-metrics";

export function notionBlocks(trade: Trade, doc: TradeDocument, metrics?: MarketMetrics) {
  const n = doc.review.notion;
  const blocks: { title: string; html: string; level: 1 | 2 | 3 }[] = [];
  blocks.push({ title: "Trade properties", level: 2, html: notionProperties.map(p => `<p><strong>${escapeHtml(p.label)}:</strong> ${escapeHtml(propertyText(p.key, trade, doc.review))}</p>`).join("") });
  const snapshot = metrics ?? unavailableMetrics(trade.symbol, trade.currency, "Metrics have not loaded");
  blocks.push({ title: "Pre-trade metrics", level: 2, html: `<p>As of ${escapeHtml(snapshot.asOf ?? "Unavailable")}</p>` + metricEntries(snapshot).map(([name, value]) => `<p><strong>${escapeHtml(name)}:</strong> ${escapeHtml(value)}</p>`).join("") });
  for (const [key, title] of chartSections) {
    const section = n?.sections[key];
    const evidence = (section?.evidenceIds ?? []).flatMap(id => doc.evidence.find(e => e.id === id) ?? []);
    blocks.push({ title, level: 2, html: richHtml(section?.html ?? "") + evidence.map(e => `<p>Chart: ${escapeHtml(e.name)}</p>`).join("") });
  }
  blocks.push({ title: "Setup Analysis", level: 1, html: "" }, { title: "Technicals", level: 2, html: "" },
    { title: "+ ve", level: 3, html: richHtml(n?.analysis.technicalPositive ?? "") }, { title: "− ve", level: 3, html: richHtml(n?.analysis.technicalNegative ?? "") },
    { title: "Ideal Execution", level: 2, html: richHtml(n?.analysis.idealExecution ?? "") }, { title: "Fundamentals", level: 2, html: richHtml(n?.analysis.fundamentals ?? "") },
    { title: "Noteworthy", level: 2, html: "" }, { title: "+ ve", level: 3, html: richHtml(n?.analysis.noteworthyPositive ?? "") }, { title: "− ve", level: 3, html: richHtml(n?.analysis.noteworthyNegative ?? "") },
    { title: "Takeaways", level: 2, html: richHtml(doc.review.takeaway) });
  const legacy = [["Setup", doc.review.setup], ["Execution", doc.review.execution], ["Thesis", doc.review.thesis], ["Exit review", doc.review.exit], ["Mistake", doc.review.mistake], ["Follow up", doc.review.followUp], ["Notes", doc.review.notes], ...Object.entries(doc.review.custom)].filter(([, text]) => richPlain(text));
  if (legacy.length) blocks.push({ title: "Previous review fields", level: 2, html: legacy.map(([name, text]) => `<h3>${escapeHtml(name)}</h3>${richHtml(text)}`).join("") });
  return blocks;
}
export function notionClipboard(trade: Trade, doc: TradeDocument, url: string, metrics?: MarketMetrics) {
  const blocks = notionBlocks(trade, doc, metrics);
  const html = `<article><h1>${escapeHtml(trade.symbol)}</h1>${blocks.map(b => `<h${b.level}>${escapeHtml(b.title)}</h${b.level}>${b.html}`).join("")}<p>${escapeHtml(url)}</p></article>`;
  const text = `# ${trade.symbol}\n\n` + blocks.map(b => `${"#".repeat(b.level)} ${b.title}\n\n${richMarkdown(b.html)}`).join("\n\n") + `\n\n${url}\n`;
  return { html, text };
}

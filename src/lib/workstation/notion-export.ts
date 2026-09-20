import type { Trade, TradeDocument } from "./types";
import { chartSections, notionProperties, propertyText, type ReviewSectionKey } from "./notion-template";
import { sectionEvidenceIds } from "./evidence";
import { escapeHtml, richHtml, richMarkdown, richPlain } from "./rich-text";
import { metricEntries, unavailableMetrics, type MarketMetrics } from "./market-metrics";
import { sectionText } from "./template-layout";

export function notionBlocks(trade: Trade, doc: TradeDocument, metrics?: MarketMetrics) {
  const n = doc.review.notion;
  const blocks: { key?: ReviewSectionKey; title: string; html: string; level: 1 | 2 | 3 }[] = [];
  blocks.push({ key: "properties", title: "Trade properties", level: 2, html: notionProperties.map(p => `<p><strong>${escapeHtml(p.label)}:</strong> ${escapeHtml(propertyText(p.key, trade, doc.review))}</p>`).join("") });
  const snapshot = metrics ?? unavailableMetrics(trade.symbol, trade.currency, "Metrics have not loaded");
  blocks.push({ title: "Pre-trade metrics", level: 2, html: `<p>As of ${escapeHtml(snapshot.asOf ?? "Unavailable")}</p>` + metricEntries(snapshot).map(([name, value]) => `<p><strong>${escapeHtml(name)}:</strong> ${escapeHtml(value)}</p>`).join("") });
  for (const [key, title] of chartSections) {
    const section = n?.sections[key];
    const evidence = (section?.evidenceIds ?? []).flatMap(id => doc.evidence.find(e => e.id === id) ?? []);
    blocks.push({ key, title, level: 2, html: richHtml(section?.html ?? "") + evidence.map(e => `<p>Chart: ${escapeHtml(e.name)}</p>`).join("") });
  }
  blocks.push({ title: "Setup Analysis", level: 1, html: "" }, { title: "Technicals", level: 2, html: "" },
    { key: "technicalPositive", title: "+ ve", level: 3, html: richHtml(n?.analysis.technicalPositive ?? "") }, { key: "technicalNegative", title: "− ve", level: 3, html: richHtml(n?.analysis.technicalNegative ?? "") },
    { key: "idealExecution", title: "Ideal Execution", level: 2, html: richHtml(n?.analysis.idealExecution ?? "") }, { key: "fundamentals", title: "Fundamentals", level: 2, html: richHtml(n?.analysis.fundamentals ?? "") },
    { title: "Noteworthy", level: 2, html: "" }, { key: "noteworthyPositive", title: "+ ve", level: 3, html: richHtml(n?.analysis.noteworthyPositive ?? "") }, { key: "noteworthyNegative", title: "− ve", level: 3, html: richHtml(n?.analysis.noteworthyNegative ?? "") },
    { key: "takeaways", title: "Takeaways", level: 2, html: richHtml(doc.review.takeaway) });
  if (n?.layout) {
    blocks.splice(2);
    let group = "";
    for (const section of n.layout.sections) {
      const next = section.groups.join(" · ");
      if (next && next !== group) blocks.push({ title: next, level: 1, html: "" });
      group = next;
      blocks.push({ key: section.key, title: section.label, level: 2, html: richHtml(sectionText(doc.review, section.key)) });
    }
    for (const section of n.layout.archived) if (sectionText(doc.review, section.key) || sectionEvidenceIds(n, section.key).length)
      blocks.push({ key: section.key, title: `${section.label} (archived)`, level: 2, html: richHtml(sectionText(doc.review, section.key)) });
  }
  const legacy = [["Setup", doc.review.setup], ["Execution", doc.review.execution], ["Thesis", doc.review.thesis], ["Exit review", doc.review.exit], ["Mistake", doc.review.mistake], ["Follow up", doc.review.followUp], ["Notes", doc.review.notes], ...Object.entries(doc.review.custom)].filter(([, text]) => richPlain(text));
  if (legacy.length || sectionEvidenceIds(n, "previousReview").length) blocks.push({ key: "previousReview", title: "Previous review fields", level: 2, html: legacy.map(([name, text]) => `<h3>${escapeHtml(name)}</h3>${richHtml(text)}`).join("") });
  return blocks;
}
export function notionClipboard(trade: Trade, doc: TradeDocument, url: string, metrics?: MarketMetrics) {
  const blocks = notionBlocks(trade, doc, metrics);
  const html = `<article><h1>${escapeHtml(trade.symbol)}</h1>${blocks.map(b => `<h${b.level}>${escapeHtml(b.title)}</h${b.level}>${b.html}`).join("")}<p>${escapeHtml(url)}</p></article>`;
  const text = `# ${trade.symbol}\n\n` + blocks.map(b => `${"#".repeat(b.level)} ${b.title}\n\n${richMarkdown(b.html)}`).join("\n\n") + `\n\n${url}\n`;
  return { html, text };
}

const tags = new Set(["p", "br", "strong", "b", "em", "i", "u", "s", "ul", "ol", "li", "h2", "h3", "blockquote"]);
export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
export const decodeText = (s: string) => s.replace(/&#(x[\da-f]+|\d+);/gi, (_, n: string) => { const cp = n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n); return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""; }).replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, "&");

/** Only structural editor tags survive. Attributes, embeds, links and active content never do. */
export function richHtml(value: string) {
  if (!value) return "";
  if (!/<\/?(?:p|strong|b|em|i|u|s|ul|ol|li|h2|h3|blockquote|br)(?:\s|\/?>)/i.test(value)) return `<p>${escapeHtml(value).replace(/\r?\n/g, "<br>")}</p>`;
  return value.replace(/<!--[^]*?-->/g, "").replace(/<(script|style|iframe|object)[^>]*>[^]*?<\/\1\s*>/gi, "")
    .replace(/<[^>]*>/g, token => { const m = /^<\s*(\/?)\s*([a-z\d]+)\b/i.exec(token); return m && tags.has(m[2].toLowerCase()) ? `<${m[1]}${m[2].toLowerCase()}>` : ""; });
}
export function richPlain(value: string) {
  return decodeText(richHtml(value).replace(/<br>/g, "\n").replace(/<\/(?:p|li|h2|h3|blockquote)>/g, "\n").replace(/<[^>]*>/g, "")).trim();
}
export function richMarkdown(value: string) {
  const lists: { ordered: boolean; count: number }[] = [];
  const result = richHtml(value).replace(/<[^>]*>/g, token => {
    const tag = token.replace(/[<>/]/g, ""), close = token.startsWith("</");
    if (["ul", "ol"].includes(tag)) { if (close) lists.pop(); else lists.push({ ordered: tag === "ol", count: 0 }); return "\n"; }
    if (tag === "li") { if (close) return "\n"; const list = lists.at(-1); return `${"  ".repeat(Math.max(0, lists.length - 1))}${list?.ordered ? `${++list.count}.` : "-"} `; }
    if (tag === "strong" || tag === "b") return "**";
    if (tag === "em" || tag === "i") return "*";
    if (tag === "u") return token;
    if (tag === "s") return "~~";
    if (tag === "h2" || tag === "h3") return close ? "\n\n" : `${tag === "h2" ? "##" : "###"} `;
    if (tag === "br") return "\n";
    if (tag === "p") return close ? "\n\n" : "";
    if (tag === "blockquote") return close ? "\n" : "> ";
    return "";
  });
  return decodeText(result).replace(/\n{3,}/g, "\n\n").trim();
}

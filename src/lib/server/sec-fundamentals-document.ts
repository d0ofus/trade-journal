import { load } from "cheerio";
import type { AccountingStandard } from "@/lib/workstation/fundamentals";
import { FUNDAMENTAL_TAGS, mergeFundamentalFacts, validSecFact, type FundamentalFacts, type SecFact } from "./sec-fundamentals-parser";

export type FilingContext = { accn: string; filed: string; form: string; document: string; currency?: string; standard?: AccountingStandard; fiscalYearEnd?: string };
const tidy = (s: string) => s.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const label = (s: string) => tidy(s).toLowerCase().replace(/[()\[\]:,.*†‡]/g, " ").replace(/[-–—]/g, " ").replace(/\s+/g, " ").trim();
const local = (s: string) => s.split(":").at(-1)!.toLowerCase();
const currencyCodes = new Set(Intl.supportedValuesOf("currency"));
function meaning(text: string): { tag: string; incomeBasis?: "owners" | "consolidated" } | null {
  const s = label(text);
  if (/adjusted|non gaap|per share|segment|non controlling/.test(s)) return null;
  if (/^(?:total )?(?:net )?(?:revenue|revenues|sales|sales revenue|revenue from contracts with customers)(?: net)?$/.test(s)) return { tag: /^(?:net )?(?:sales|sales revenue)/.test(s.replace(/^total /, "")) ? "SalesRevenueNet" : "Revenues" };
  if (/^(?:net )?(?:income|profit|earnings|loss)(?: loss| profit)? attributable to (?:the )?(?:company|parent|owners(?: of the parent)?|shareholders|stockholders|equity holders)(?: of .+)?$/.test(s)) return { tag: "NetIncomeLoss", incomeBasis: "owners" };
  if (/^(?:net (?:income|profit|loss|earnings)(?: loss| profit)?|profit loss|profit|loss)(?: after tax| for the (?:period|year|quarter))?$/.test(s)) return { tag: "ProfitLoss", incomeBasis: "consolidated" };
  return null;
}
function amount(text: string): number | null {
  const raw = tidy(text).replace(/[$€£¥\s]/g, "").replace(/^[−–—](?=\d)/, "-");
  if (raw.includes(",") && !/^\(?-?\d{1,3}(?:,\d{3})+(?:\.\d+)?\)?$/.test(raw)) return null;
  const s = raw.replaceAll(",", "");
  if (!/^\(?-?\d+(?:\.\d+)?\)?$/.test(s)) return null;
  return Number(s.replace(/[()]/g, "")) * (s.startsWith("(") ? -1 : 1);
}
function transformedAmount(text: string, format: string): number | null {
  if (format && !/^(?:num-?dot-?decimal(?:-in)?|num-?comma-?decimal|numdash|zerodash|fixed-zero)$/.test(format)) return null;
  const numeric = /comma-?decimal/.test(format) ? text.replace(/\./g, "").replace(",", ".") : /dot-?decimal/.test(format) ? text.replaceAll(",", "") : text;
  return format === "fixed-zero" || /^(?:numdash|zerodash)$/.test(format) && /^[-–—]$/.test(tidy(numeric)) ? 0 : amount(numeric);
}
function currencyIn(text: string, column = false): string | undefined {
  const s = text.toUpperCase();
  if (/NT\$|NEW TAIWAN DOLLARS|\bTWD\b/.test(s)) return "TWD";
  if (/\bEUR\b|\bEUROS?\b|€/.test(s)) return "EUR";
  if (/\bUSD\b|US\$|U\.?S\.? DOLLARS/.test(s)) return "USD";
  if (/\bGBP\b|POUNDS STERLING|£/.test(s)) return "GBP";
  if (/\bRMB\b/.test(s)) return "CNY";
  return [...text.matchAll(/\b([A-Z]{3})(?:m|k|bn)?\b/g)].map(m => m[1]).find(code => currencyCodes.has(code) && (column || new RegExp(`\\bin\\s+${code}\\b|${code}\\s*(?:in\\s+)?(?:millions?|thousands?|billions?|['’]000|m\\b|k\\b|bn\\b)`, "i").test(text)));
}
// Use the nearest statement unit, not a larger number mentioned in the press release.
const scaleIn = (s: string) => {
  const match = [...s.matchAll(/\b(billions?|millions?|thousands?)\b|['’](000(?:,?000)?)\b|\b(000s)\b|(?:\b(?:USD|EUR|TWD|GBP|CHF|CAD|AUD)|[$€£¥])\s*(bn|m|k)\b/gi)].at(-1);
  const unit = match?.[1]?.toLowerCase(), short = match?.[4]?.toLowerCase();
  return unit?.startsWith("billion") || short === "bn" ? 1e9 : unit?.startsWith("million") || short === "m" || match?.[2]?.replace(",", "").length === 6 ? 1e6 : unit?.startsWith("thousand") || short === "k" || match?.[2] || match?.[3] ? 1e3 : 1;
};
const months = "january february march april may june july august september october november december".split(" ");
function reportingPeriod(header: string, fiscalYearEnd?: string): { start: string; end: string } | null {
  const h = tidy(header).toLowerCase();
  const month = h.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(20\d{2})\b/);
  const reversed = h.match(/\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2})\b/);
  let end: string | undefined;
  if (month) end = `${month[3]}-${String(months.findIndex(m => m.startsWith(month[1].slice(0, 3))) + 1).padStart(2, "0")}-${month[2].padStart(2, "0")}`;
  else if (reversed) end = `${reversed[3]}-${String(months.indexOf(reversed[2]) + 1).padStart(2, "0")}-${reversed[1].padStart(2, "0")}`;
  else end = h.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0];
  const cumulativeQuarter = h.match(/\bq1\s*[-–—]\s*q([1-4])\s*(20\d{2})\b/);
  const q = cumulativeQuarter ?? h.match(/\bq([1-4])\s*(20\d{2})\b/) ?? h.match(/\b([1-4])q\s*(20\d{2})\b/);
  if (!end && q && fiscalYearEnd) end = new Date(Date.UTC(Number(q[2]), Number(fiscalYearEnd.slice(0, 2)) - 3 * (4 - Number(q[1])), 0)).toISOString().slice(0, 10);
  if (!end || !Number.isFinite(Date.parse(end))) return null;
  const weekCount = /thirteen|13\s+weeks/.test(h) ? 13 : /fourteen|14\s+weeks/.test(h) ? 14 : /fifty.two|52\s+weeks/.test(h) ? 52 : null;
  const count = cumulativeQuarter ? Number(cumulativeQuarter[1]) * 3 : /year.to.date/.test(h) && q ? Number(q[1]) * 3 : /nine|9\s+months/.test(h) ? 9 : /six|6\s+months|half.year/.test(h) ? 6 : /twelve|12\s+months|years? ended|full.year/.test(h) ? 12 : /three|3\s+months|quarter|\bq[1-4]\b|\b[1-4]q\b/.test(h) ? 3 : null;
  if (!count && !weekCount) return null;
  const date = new Date(`${end}T00:00:00Z`);
  const start = weekCount ? new Date(date.getTime() - (weekCount * 7 - 1) * 86400000).toISOString().slice(0, 10) : new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - count! + 1, 1)).toISOString().slice(0, 10);
  return { start, end };
}

/** Reads standard inline/instance facts before untagged consolidated statement tables. */
export function readFundamentalDocument(html: string, filing: FilingContext): { facts: FundamentalFacts; links: string[]; financial: boolean; ambiguous: boolean } {
  const $ = load(html), xml = load(/contextref\s*=/i.test(html) ? html : "", { xml: true }), facts: FundamentalFacts = {};
  const text = tidy($("body").text() || $.root().text());
  const documentIFRS = /IFRS\b|international financial reporting standards/i.test(text), documentGaap = /U\.?S\.? GAAP|accounting principles generally accepted in (?:the )?United States/i.test(text);
  const standard: AccountingStandard | undefined = documentIFRS && !documentGaap ? "ifrs-full" : documentGaap && !documentIFRS ? "us-gaap" : filing.standard;
  const declaredCurrency = xml("[name]").filter((_, e) => local(xml(e).attr("name") ?? "") === "documentreportingcurrencyisocode").first().text().trim().toUpperCase();
  const baseCurrency = /^[A-Z]{3}$/.test(declaredCurrency) ? declaredCurrency : filing.currency;
  const contexts = new Map<string, { start: string; end: string }>(), units = new Map<string, string>();
  xml("[id]").each((_, e) => {
    const node = xml(e), name = local(e.tagName);
    if (name === "context") {
      if (node.find("*").toArray().some(n => /^(explicitmember|typedmember|segment|scenario)$/.test(local(n.tagName)))) return;
      const start = node.find("*").filter((_, n) => local(n.tagName) === "startdate").text(), end = node.find("*").filter((_, n) => local(n.tagName) === "enddate").text();
      if (start && end) contexts.set(node.attr("id")!, { start, end });
    }
    if (name === "unit") { const match = node.text().match(/(?:iso4217:)?\b([A-Z]{3})\b/); if (match && !node.find("*").toArray().some(n => local(n.tagName) === "divide")) units.set(node.attr("id")!, match[1]); }
  });
  xml("[contextRef], [contextref]").each((_, e) => {
    const node = xml(e), concept = node.attr("name") ?? e.tagName, tag = concept.split(":").at(-1)!;
    if (!Object.values(FUNDAMENTAL_TAGS).flat().some(t => t === tag)) return;
    const prefix = concept.includes(":") ? concept.split(":")[0] : "";
    const namespace = node.parents().toArray().map(parent => xml(parent).attr(prefix ? `xmlns:${prefix}` : "xmlns")).find(Boolean) ?? "";
    const taxonomy: AccountingStandard | null = prefix === "ifrs-full" || /xbrl\.ifrs\.org\/taxonomy\//.test(namespace) ? "ifrs-full" : prefix === "us-gaap" || /fasb\.org\/us-gaap\//.test(namespace) ? "us-gaap" : null;
    if (!taxonomy) return;
    const period = contexts.get(node.attr("contextRef") ?? node.attr("contextref") ?? ""), currency = units.get(node.attr("unitRef") ?? node.attr("unitref") ?? "");
    if (!period || !currency || node.attr("xsi:nil") === "true") return;
    const format = local(node.attr("format") ?? "").toLowerCase();
    const value = transformedAmount(node.text(), format); if (value == null) return;
    const f: SecFact = { ...period, accn: filing.accn, filed: filing.filed, form: filing.form, val: (node.attr("sign") === "-" ? -Math.abs(value) : value) * 10 ** Number(node.attr("scale") ?? 0), currency, taxonomy,
      ...(Object.values(FUNDAMENTAL_TAGS.netIncome).some(t => t === tag) ? { incomeBasis: tag === "ProfitLoss" ? "consolidated" as const : "owners" as const } : {}),
      ...(baseCurrency ? { reportingCurrency: currency === baseCurrency } : {}), source: { filed: filing.filed, accession: filing.accn, form: filing.form, tag, taxonomy, kind: "xbrl", document: filing.document } };
    if (validSecFact(f)) (facts[tag] ??= []).push(f);
  });
  // Do not reinterpret rejected/locale-specific inline numbers as plain HTML amounts.
  $("[format], [contextref]").each((_, e) => {
    if (local(e.tagName) !== "nonfraction") return;
    const node = $(e), value = transformedAmount(node.text(), local(node.attr("format") ?? "").toLowerCase());
    node.text(value == null ? "Unavailable numeric transform" : String(node.attr("sign") === "-" ? -Math.abs(value) : value));
  });
  let financial = false, ambiguous = false;
  $("table").each((_, table) => {
    const rows: string[][] = [], spans = new Map<number, { text: string; left: number }>();
    $(table).find("tr").filter((_, tr) => $(tr).closest("table")[0] === table).each((_, tr) => {
      const row: string[] = []; let col = 0;
      const fill = () => { while (spans.has(col)) { const span = spans.get(col)!; row[col++] = span.text; if (--span.left === 0) spans.delete(col - 1); } };
      $(tr).children("td,th").each((_, td) => {
        fill(); const node = $(td), value = tidy(node.text()), width = Math.min(100, Number(node.attr("colspan") ?? 1)), height = Math.min(100, Number(node.attr("rowspan") ?? 1));
        for (let i = 0; i < width; i++) { row[col] = value; if (height > 1) spans.set(col, { text: value, left: height - 1 }); col++; }
      });
      fill(); rows.push(row);
    });
    const revenueIndex = rows.findIndex(row => row.some(cell => FUNDAMENTAL_TAGS.revenue.some(tag => tag === meaning(cell)?.tag)));
    if (revenueIndex < 0) return;
    const precedingText = (nodes: ReturnType<typeof $>) => {
      const pieces: string[] = []; let length = 0;
      for (const node of nodes.toArray()) { const text = tidy($(node).text()); pieces.unshift(text); length += text.length; if (length >= 1800) break; }
      return pieces.join(" ");
    };
    let preceding = precedingText($(table).prevAll());
    if (!preceding.trim()) preceding = precedingText($(table).parent().prevAll());
    const context = tidy(preceding).slice(-1800), heading = context + " " + rows.slice(0, revenueIndex).flat().join(" ");
    // Revenue alone in a segment, outlook or reconciliation table is insufficient.
    if (!/consolidated.{0,100}(?:operations|income|profit|earnings|financial results|statements)|(?:statements? of|income statement).{0,50}(?:operations|income|profit|loss)|(?:consolidated|comprehensive) income statements?/i.test(heading) || /(?:segment|guidance|outlook|reconciliation|non.gaap|adjusted)[^.!?]{0,100}$/i.test(context)) return;
    financial = true;
    const currency = currencyIn(heading) ?? baseCurrency;
    if (!currency || !standard) { ambiguous = true; return; }
    const scale = scaleIn(heading), headers = rows.slice(0, revenueIndex);
    for (const row of rows.slice(revenueIndex)) {
      const labelCol = row.findIndex(cell => meaning(cell)); if (labelCol < 0) continue;
      const semantic = meaning(row[labelCol])!;
      for (let c = labelCol + 1; c < row.length; c++) {
        const value = amount(row[c]); if (value == null) continue;
        const columnHeader = headers.map(header => header[c] ?? "").filter((v, i, a) => i === 0 || a[i - 1] !== v).join(" ");
        if (/%|percentage|per share|\bnotes?\b|non.?ifrs|non.?gaap|adjusted/i.test(columnHeader) || /%/.test(row[c + 1] ?? "")) continue;
        const durationHint = /year.to.date/i.test(context.slice(-250)) ? "Year-to-date " : "";
        const period = reportingPeriod(durationHint + columnHeader, filing.fiscalYearEnd);
        if (!period) { ambiguous = true; continue; }
        const signed = row[c + 1]?.trim() === ")" && value > 0 ? -value : value;
        const columnCurrency = currencyIn(columnHeader, true) ?? currencyIn(row[c - 1] ?? "", true) ?? currency;
        const f: SecFact = { ...period, accn: filing.accn, filed: filing.filed, form: filing.form, val: signed * scale, currency: columnCurrency, taxonomy: standard, reportingCurrency: columnCurrency === currency, fiscalAnnual: /year[s]? ended|full.year/i.test(columnHeader) && !/trailing/i.test(columnHeader), ...(semantic.incomeBasis ? { incomeBasis: semantic.incomeBasis } : {}),
          source: { filed: filing.filed, accession: filing.accn, form: filing.form, tag: `statement:${semantic.tag}`, kind: "statement", document: filing.document, label: row[labelCol].slice(0, 200) } };
        if (validSecFact(f)) (facts[semantic.tag] ??= []).push(f);
      }
    }
  });
  const links = [...new Set($("a[href]").toArray().map(e => $(e).attr("href")!).filter(href => /\.(?:html?|xml)(?:#.*)?$/i.test(href) && !/\.(?:xsd|jpg|png)/i.test(href)))];
  return { facts: mergeFundamentalFacts(facts), links, financial: financial || Object.values(facts).some(f => f.length), ambiguous };
}

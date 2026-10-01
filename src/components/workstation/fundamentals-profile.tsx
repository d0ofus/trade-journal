"use client";
import { fundamentalMoney, fundamentalPercent, fundamentalPeriod, fundamentalSources, type FundamentalQuarter, type FundamentalsSnapshot } from "@/lib/workstation/fundamentals";
import { allFundamentalsSeries, fundamentalsBarSeries, fundamentalsGrowthSeries, fundamentalsSeriesDomain, type FundamentalsSeries, type FundamentalsSeriesVisibility } from "@/lib/workstation/fundamentals-series";
import { useFundamentalsHover } from "./fundamentals-hover";

const colours = { revenue: "#5eead4", netIncome: "#fbbf24", revenueYoY: "#38bdf8", revenueQoQ: "#22c55e", netIncomeYoY: "#f472b6", netIncomeQoQ: "#fb923c" };
function domain(values: (number | null | undefined)[]) {
  const finite = values.filter((v): v is number => v != null && Number.isFinite(v));
  const min = Math.min(0, ...finite), max = Math.max(0, ...finite);
  const pad = (max - min || 1) * .12;
  return { min: min < 0 ? min - pad : 0, max: max + pad };
}
const scale = (v: number, d: { min: number; max: number }, top: number, height: number) => top + (d.max - v) / (d.max - d.min) * height;
const moneyAxis = (v: number) => fundamentalMoney(v);
type MetricName = "revenue" | "netIncome";
export function FundamentalsMini({ quarters, metric }: { quarters: FundamentalQuarter[]; metric: MetricName }) {
  const hover = useFundamentalsHover(quarters, metric);
  const latest = quarters.at(-1), values = quarters.map(q => q[metric]?.value), d = domain(values);
  const label = metric === "revenue" ? "Revenue" : "Net income", value = latest?.[metric === "revenue" ? "revenueYoY" : "netIncomeYoY"];
  const zero = scale(0, d, 3, 54), slot = 150 / Math.max(quarters.length, 1);
  return <div className="ws-fundamentals-mini"><div><span>{label}</span><strong>{fundamentalMoney(latest?.[metric]?.value)}</strong><small className={value == null ? "" : value >= 0 ? "positive" : "negative"}>{fundamentalPercent(value)} <span>YoY</span></small></div>
    <svg viewBox="0 0 150 60" role="group" aria-label={`${label}, last ${quarters.length} quarters`}>
      {hover.index != null && <rect data-fundamentals-highlight={hover.index} x={hover.index * slot} y={0} width={slot} height={60} fill="#b69cff" fillOpacity=".16" pointerEvents="none" />}
      <line x1="0" x2="150" y1={zero} y2={zero} stroke="#64748b" strokeOpacity=".35" />{quarters.map((q, i) => {
      const v = q[metric]?.value, y = scale(v ?? 0, d, 3, 54);
      return <rect key={q.periodEnd} x={i * slot + 1} y={v == null ? zero - 1 : Math.min(y, zero)} width={Math.max(1, slot - 3)} height={Math.max(2, Math.abs(y - zero))} fill={v == null ? "#64748b" : v < 0 ? "#fb7185" : colours[metric]}><title>{`${fundamentalPeriod(q)}: ${fundamentalMoney(v)}`}</title></rect>;
    })}{hover.hitArea(`${label} mini chart`, { x: 0, y: 0, width: 150, height: 60 })}</svg>{hover.tooltip}
  </div>;
}

/** Self-contained SVG: the exact same chart is shown in the dialog and captured. */
export function FundamentalsProfile({ data, demo = false, interactive = false, seriesVisibility = allFundamentalsSeries, onToggleSeries, disabled = false }: {
  data: FundamentalsSnapshot; demo?: boolean; interactive?: boolean; seriesVisibility?: FundamentalsSeriesVisibility; onToggleSeries?: (series: FundamentalsSeries) => void; disabled?: boolean;
}) {
  const hover = useFundamentalsHover(data.quarters, undefined, seriesVisibility);
  const rows = data.quarters, latest = rows.at(-1);
  const width = 1120, left = 78, right = 1040, plotWidth = right - left;
  const slot = plotWidth / Math.max(rows.length, 1), x = (i: number) => left + slot * (i + .5);
  const bars = fundamentalsBarSeries.filter(s => seriesVisibility[s]), growth = fundamentalsGrowthSeries.filter(s => seriesVisibility[s]);
  const money = fundamentalsSeriesDomain(rows, bars);
  const revenue = fundamentalsSeriesDomain(rows, growth.filter(s => s === "revenueYoY" || s === "revenueQoQ"));
  const income = fundamentalsSeriesDomain(rows, growth.filter(s => s === "netIncomeYoY" || s === "netIncomeQoQ"));
  const latestSources = latest ? fundamentalSources(latest) : [];
  const filed = latestSources.map(s => s.filed).sort().at(-1) ?? "—";
  const summary = [["LATEST QUARTER", latest ? fundamentalPeriod(latest) : "—"], ["REVENUE", fundamentalMoney(latest?.revenue?.value)], ["NET INCOME", fundamentalMoney(latest?.netIncome?.value)], ["SEC FILED", filed], ["SOURCE", [...new Set(latestSources.map(s => s.form))].join(" / ") || "—"]];
  function axes(d: { min: number; max: number }, top: number, height: number, format: (v: number) => string, side = "left", grid = side === "left") {
    return Array.from({ length: 4 }, (_, i) => {
      const v = d.min + (d.max - d.min) * i / 3, y = scale(v, d, top, height);
      return <g key={i}>{grid && <line x1={left} x2={right} y1={y} y2={y} stroke="#64748b" strokeOpacity=".22" />}<text x={side === "left" ? left - 10 : right + 10} y={y + 4} textAnchor={side === "left" ? "end" : "start"} fontSize="11" fill="#b0bdcf">{format(v)}</text></g>;
    });
  }
  function labels(y: number) { return rows.map((q, i) => <text key={q.periodEnd} x={x(i)} y={y} textAnchor="middle" fill="#cbd5e1" fontSize="12">{fundamentalPeriod(q)}</text>); }
  const series = ["revenueYoY", "revenueQoQ", "netIncomeYoY", "netIncomeQoQ"] as const;
  const seriesNames = ["Revenue YoY", "Revenue QoQ", "NI YoY", "NI QoQ"];
  function legend(metric: FundamentalsSeries, label: string, x: number, y: number) {
    const visible = seriesVisibility[metric], clickable = interactive && !!onToggleSeries;
    const toggle = () => { if (!disabled) onToggleSeries?.(metric); };
    return <g key={metric} data-fundamentals-legend={metric} data-visible={visible} className={clickable ? "ws-fundamentals-legend" : undefined}
      role={clickable ? "button" : undefined} tabIndex={clickable ? 0 : undefined} aria-label={clickable ? label : undefined}
      aria-pressed={clickable ? visible : undefined} aria-disabled={clickable ? disabled : undefined}
      onClick={clickable ? toggle : undefined} onKeyDown={clickable ? event => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); if (!event.repeat) toggle(); }
      } : undefined}>
      {clickable && <rect className="ws-fundamentals-legend-hit" x={x - 8} y={y - 22} width="120" height="42" rx="5" fill="transparent" />}
      <text x={x} y={y} fill={visible ? colours[metric] : "#7e8da3"} textDecoration={visible ? undefined : "line-through"} fontSize="11" pointerEvents="none">{metric === "revenue" || metric === "netIncome" ? "■" : "━"} {label}</text>
    </g>;
  }
  const empty = (chart: string, y: number, selected: number) => <text data-fundamentals-empty={chart} x={(left + right) / 2} y={y} textAnchor="middle" fill="#94a3b8" fontSize="14">{selected ? "No available data for selected metrics" : "Select a legend item to display data"}</text>;
  return <><svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${width} 820`} width={width} height="820" className="ws-fundamentals-profile" role={interactive ? "group" : "img"} aria-label={`${data.symbol} quarterly revenue, net income and growth`} style={{ fontFamily: "Arial, sans-serif" }}>
    <rect width={width} height="820" rx="18" fill="#101824" />
    <text x="24" y="28" fill="#94a3b8" fontSize="11" letterSpacing="2">{demo ? "DEMO FUNDAMENTALS · ILLUSTRATIVE" : "SEC FUNDAMENTALS"}</text>
    <text x="24" y="54" fill="#f1f5f9" fontSize="20" fontWeight="700">{data.symbol} · {(data.issuer?.name ?? "").slice(0, 65)}</text>
    <text x="24" y="78" fill="#cbd5e1" fontSize="12">{data.mode === "before-entry" ? `Before entry · filings before ${data.cutoff} (New York)` : "Latest available · includes filings after entry"}</text>
    <text x="24" y="99" fill={data.stale ? "#fbbf24" : "#94a3b8"} fontSize="11">{data.stale ? "Cached data · SEC unavailable · " : "Retrieved "}{data.fetchedAt?.replace("T", " ").slice(0, 19) ?? "—"} UTC</text>
    {summary.map(([label, value], i) => <g key={label}><rect x={24 + i * 216} y="116" width="207" height="56" rx="10" fill="#131e2d" stroke="#263344" /><text x={36 + i * 216} y="136" fill="#94a3b8" fontSize="9" letterSpacing="1">{label}</text><text x={36 + i * 216} y="157" fill="#f1f5f9" fontSize="14" fontWeight="600">{value}</text></g>)}
    <rect x="16" y="186" width="1088" height="287" rx="14" fill="none" stroke="#263344" />
    <text x="32" y="211" fill="#f1f5f9" fontSize="14" fontWeight="600">Quarterly Revenue + Net Income</text>
    <text x="32" y="232" fill="#94a3b8" fontSize="11">USD · {rows.length} fiscal quarters · gaps indicate unavailable values</text>
    {interactive && hover.index != null && [ { top: 256, height: 171, enabled: !!money }, { top: 556, height: 151, enabled: !!(revenue || income) } ].filter(plot => plot.enabled).map(plot => <g key={plot.top} data-fundamentals-highlight={hover.index} pointerEvents="none"><rect x={left + hover.index! * slot} y={plot.top} width={slot} height={plot.height} fill="#b69cff" fillOpacity=".09" /><line x1={x(hover.index!)} x2={x(hover.index!)} y1={plot.top} y2={plot.top + plot.height} stroke="#b69cff" strokeOpacity=".7" strokeDasharray="3 4" /></g>)}
    {money ? <g data-fundamentals-axis="bars">{axes(money, 256, 171, moneyAxis)}<line x1={left} x2={right} y1={scale(0, money, 256, 171)} y2={scale(0, money, 256, 171)} stroke="#64748b" strokeOpacity=".5" /></g> : empty("bars", 341, bars.length)}
    {money && rows.flatMap((q, i) => bars.map((metric, j) => {
      const v = q[metric]?.value; if (v == null || !Number.isFinite(v)) return null;
      const y = scale(v, money, 256, 171), zero = scale(0, money, 256, 171), barWidth = Math.min(40, slot * .35);
      return <rect data-fundamentals-series={metric} key={`${q.periodEnd}:${metric}`} x={x(i) + (bars.length === 1 ? -barWidth / 2 : j === 0 ? -barWidth - 2 : 2)} y={Math.min(y, zero)} width={barWidth} height={Math.max(1, Math.abs(y - zero))} rx="2" fill={colours[metric]}><title>{`${fundamentalPeriod(q)} ${metric === "revenue" ? "Revenue" : "Net income"}: ${fundamentalMoney(v)}${q[metric]?.derived ? " (derived Q4)" : ""}`}</title></rect>;
    }))}
    {labels(447)}
    {legend("revenue", "Revenue", 800, 212)}{legend("netIncome", "Net income", 925, 212)}
    <rect x="16" y="487" width="1088" height="292" rx="14" fill="none" stroke="#263344" />
    <text x="32" y="512" fill="#f1f5f9" fontSize="14" fontWeight="600">Growth: YoY + QoQ</text>
    {revenue && <g data-fundamentals-axis="revenue-growth"><text x={left} y="540" fill="#7dd3fc" fontSize="10">REVENUE</text>{axes(revenue, 556, 151, v => `${Math.round(v)}%`)}</g>}
    {income && <g data-fundamentals-axis="income-growth"><text x={right} y="540" fill="#f9a8d4" fontSize="10" textAnchor="end">NET INCOME</text>{axes(income, 556, 151, v => `${Math.round(v)}%`, "right", !revenue)}</g>}
    {!revenue && !income && empty("growth", 631, growth.length)}
    {series.map((metric, si) => {
      const d = si < 2 ? revenue : income;
      if (!seriesVisibility[metric] || !d) return null;
      const path = rows.map((q, i) => q[metric] == null ? "" : `${i && rows[i - 1][metric] != null ? "L" : "M"}${x(i)},${scale(q[metric]!, d, 556, 151)}`).join(" ");
      return <g data-fundamentals-series={metric} key={metric}><path d={path} fill="none" stroke={colours[metric]} strokeWidth="2" strokeDasharray={si < 2 ? "2 5" : undefined} />{rows.map((q, i) => q[metric] == null ? null : <circle key={q.periodEnd} cx={x(i)} cy={scale(q[metric]!, d, 556, 151)} r="3" fill={colours[metric]}><title>{`${fundamentalPeriod(q)} ${seriesNames[si]}: ${fundamentalPercent(q[metric])}`}</title></circle>)}</g>;
    })}
    {labels(729)}
    {series.map((s, i) => legend(s, seriesNames[i], 310 + i * 140, 759))}
    <text x="24" y="801" fill="#94a3b8" fontSize="10">Source: SEC Company Facts · Q4 may be derived from annual results less Q1–Q3 · Growth uses the absolute prior value</text>
    {interactive && <>{money && hover.hitArea("Quarterly revenue and net income chart", { x: left, y: 256, width: plotWidth, height: 198 })}{(revenue || income) && hover.hitArea("Growth chart", { x: left, y: 556, width: plotWidth, height: 180 })}</>}
  </svg>{interactive && hover.tooltip}</>;
}

export async function captureFundamentalsSvg(svg: SVGSVGElement): Promise<HTMLCanvasElement> {
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = 2240; canvas.height = 1640;
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally { URL.revokeObjectURL(url); }
}

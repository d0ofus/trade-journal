"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PeerChart, type PeerChartHandle } from "./peer-chart";
import type { PeerGroupSelection } from "./peer-groups";
import { PeerMemory, fetchPeerCandles, type PeerFetcher } from "@/lib/workstation/peer-memory";
import { peerContextSchema, peerEntryTime, peerMembers, peerSymbolIssue, peerVirtualWindow, peerWarmupRange, selectPeerGroup, type PeerCapture, type PeerCandleQuery, type PeerSeries, type PeerView } from "@/lib/workstation/peers";
import { intervals, seconds, type Trade, type WorkspacePreferences } from "@/lib/workstation/types";
import type { HistoryRange } from "@/lib/workstation/history";
import { compositeCharts } from "@/lib/workstation/export";

type Props = { trade: Trade; selection: PeerGroupSelection; initial: PeerView; preferences: WorkspacePreferences; mode: "demo" | "application"; readOnly: boolean; getWorkspaceView: () => PeerView; onSelectGroup: (id: string) => void; onCapture: (canvas: HTMLCanvasElement, metadata: PeerCapture) => Promise<void>; onClose: () => void };

const demoFetch: PeerFetcher = async (query, signal) => {
  signal.throwIfAborted();
  return { series: query.symbols.map(symbol => {
    const step = seconds[query.timeframe], candles = [], seed = [...symbol].reduce((s, c) => s + c.charCodeAt(0), 0);
    for (let time = Math.ceil(query.from / step) * step; time < query.to && candles.length < 10000; time += step) {
      const open = 70 + seed % 100 + Math.sin(time / (step * 30) + seed) * 8, close = open + Math.sin(time / step + seed);
      candles.push({ time, open, close, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, volume: 100000 + (time / step % 20) * 20000 });
    }
    return { symbol, candles, status: candles.length ? "ready" as const : "empty" as const, source: "Synthetic demo", identity: `demo:${query.timeframe}:${query.session}:${query.adjustment}`, range: { from: query.from, to: query.to }, adjustment: query.adjustment, feed: "demo" };
  }) };
};
export function PeerComparison(props: Props) {
  const [selection, setSelection] = useState(props.selection), [view, setView] = useState(props.initial), [linked, setLinked] = useState(true);
  const [independent, setIndependent] = useState<Record<string, HistoryRange>>({}), [search, setSearch] = useState(""), [membershipError, setMembershipError] = useState(""), [refresh, setRefresh] = useState(0), [membershipLoading, setMembershipLoading] = useState(props.mode !== "demo");
  const [scroll, setScroll] = useState({ top: 0, height: 600, columns: 2 });
  const [results, setResults] = useState<{ key: string; basis: string; values: Record<string, PeerSeries>; error: string }>({ key: "", basis: "", values: {}, error: "" });
  const [retry, setRetry] = useState(0), [captureError, setCaptureError] = useState(""), [capturing, setCapturing] = useState(false), [cooldown, setCooldown] = useState(0);
  const dialog = useRef<HTMLDivElement>(null), scroller = useRef<HTMLDivElement>(null), handles = useRef(new Map<string, PeerChartHandle>()), alive = useRef(true);
  const [membershipValid, setMembershipValid] = useState(props.mode === "demo");
  const selectionId = useRef(props.selection.group.id);
  useEffect(() => { selectionId.current = selection.group.id; }, [selection.group.id]);
  const [memory] = useState(() => new PeerMemory(props.mode === "demo" ? demoFetch : fetchPeerCandles));
  const members = useMemo(() => peerMembers(selection.group, props.trade.symbol, search), [selection.group, props.trade.symbol, search]);
  const window = peerVirtualWindow(members.length, scroll.columns, scroll.top, scroll.height);
  const visible = members.slice(window.start, window.end);
  const periods = Math.max(1, ...props.preferences.averages, props.preferences.volumeAverage.enabled ? props.preferences.volumeAverage.period : 1);
  const symbols = [props.trade.symbol, ...visible.filter(m => !peerSymbolIssue(m)).map(m => m.ticker)];
  const requested = symbols.map(symbol => {
    const ownView = { ...view, range: linked ? view.range : independent[symbol] ?? view.range };
    return { symbol, query: { ...peerWarmupRange(ownView, periods), timeframe: view.interval, session: view.session, adjustment: view.adjustment } };
  });
  const requestKey = JSON.stringify(requested);
  const basis = `${view.interval}:${view.session}:${view.adjustment}`;
  const entryTime = peerEntryTime(props.trade);
  const register = useCallback((symbol: string, handle: PeerChartHandle | null) => { if (handle) handles.current.set(symbol, handle); else handles.current.delete(symbol); }, []);
  const onRange = useCallback((symbol: string, range: HistoryRange) => {
    if (linked) setView(v => Math.abs(v.range.from - range.from) < 1 && Math.abs(v.range.to - range.to) < 1 ? v : { ...v, range });
    else setIndependent(v => v[symbol]?.from === range.from && v[symbol]?.to === range.to ? v : { ...v, [symbol]: range });
  }, [linked]);
  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const node = dialog.current?.parentElement;
    const restored = node?.parentElement ? Array.from(node.parentElement.children).filter((e): e is HTMLElement => e instanceof HTMLElement && e !== node).map(element => ({ element, inert: element.inert })) : [];
    restored.forEach(({ element }) => { element.inert = true; });
    return () => { alive.current = false; restored.forEach(({ element, inert }) => { element.inert = inert; }); previous?.focus(); memory.clear(); };
  }, [memory]);
  useEffect(() => {
    if (!scroller.current) return;
    const node = scroller.current;
    const observer = new ResizeObserver(([entry]) => setScroll(v => ({ ...v, height: entry.contentRect.height, columns: entry.contentRect.width < 760 ? 1 : 2 })));
    observer.observe(node); return () => observer.disconnect();
  }, []);
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 0; setScroll(v => ({ ...v, top: 0 })); }, [search, selection.group.id]);
  useEffect(() => {
    if (props.mode === "demo") return;
    const controller = new AbortController();
    setMembershipLoading(true); setMembershipError(""); setMembershipValid(false);
    void fetch(`/api/journal/market-context?${new URLSearchParams({ symbol: props.trade.symbol, membershipOnly: "1" })}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Could not refresh peer groups.");
      const context = peerContextSchema.parse(await response.json());
      if (!context.detail) throw new Error(context.errors?.join(" ") || "No matching peer group.");
      const next = selectPeerGroup(context.detail.groups, selectionId.current);
      if (!next.selected) throw new Error("No active matching peer group. Update your curation in Market Overview.");
      if (!controller.signal.aborted) { setSelection({ group: next.selected, groups: next.groups }); setMembershipValid(true); props.onSelectGroup(next.selected.id); if (next.changed) setMembershipError("The previous group is no longer active; the highest-priority group is shown."); }
    }).catch(e => { if (!controller.signal.aborted) setMembershipError(e instanceof Error ? e.message : "Peer groups unavailable."); }).finally(() => { if (!controller.signal.aborted) setMembershipLoading(false); });
    return () => controller.abort();
    // Refresh only on opening/retry, not on autosave-driven callback identity changes.
  }, [props.mode, props.trade.symbol, refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (membershipLoading || !membershipValid) return;
    const controller = new AbortController();
    const queries = JSON.parse(requestKey) as typeof requested;
    const batches = new Map<string, PeerCandleQuery>();
    for (const { symbol, query } of queries) { const key = JSON.stringify(query); const batch = batches.get(key) ?? { ...query, symbols: [] }; batch.symbols.push(symbol); batches.set(key, batch); }
    const timer = setTimeout(() => {
      const values: Record<string, PeerSeries> = {};
      for (const query of batches.values()) for (const symbol of query.symbols) { const cached = memory.get(query, symbol); if (cached) values[symbol] = cached; }
      setResults({ key: requestKey, basis, values, error: "" });
      void Promise.all([...batches.values()].map(query => memory.load(query, controller.signal))).then(rows => {
        if (controller.signal.aborted) return;
        const all = rows.flat();
        setResults({ key: requestKey, basis, values: Object.fromEntries(all.map(s => [s.symbol, s])), error: "" });
        const wait = Math.max(0, ...all.map(s => s.retryAfter ?? 0));
        if (wait) setCooldown(wait);
      }).catch(e => { if (!controller.signal.aborted) setResults({ key: requestKey, basis, values, error: e instanceof Error ? e.message : "Peer charts unavailable." }); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [requestKey, basis, memory, retry, membershipLoading, membershipValid, selection.group.id]);
  useEffect(() => { if (!cooldown) return; const timer = setTimeout(() => setCooldown(v => Math.max(0, v - 1)), 1000); return () => clearTimeout(timer); }, [cooldown]);
  const match = () => { setView(props.getWorkspaceView()); setIndependent({}); };
  const capture = async (symbol: string, paired: boolean) => {
    if (capturing || props.readOnly) return;
    setCapturing(true); setCaptureError("");
    try {
      const chosen = paired && symbol !== props.trade.symbol ? [props.trade.symbol, symbol] : [symbol];
      const charts = chosen.map(ticker => { const handle = handles.current.get(ticker); if (!handle || !results.values[ticker]?.candles.length || results.key !== requestKey) throw new Error("Wait for the selected charts to finish loading."); return { ticker, canvas: handle.capture(), range: handle.range() ?? view.range }; });
      const scale = globalThis.devicePixelRatio || 1;
      let left = 0;
      const positions = charts.map(({ canvas }) => { const result = { x: left, y: 0, width: canvas.width / scale, height: canvas.height / scale }; left += result.width + 12; return result; });
      const canvas = paired ? compositeCharts(charts.map(c => c.canvas), props.preferences.theme === "light", positions, scale) : charts[0].canvas;
      await props.onCapture(canvas, { source: "peer-comparison", symbols: chosen, groupId: selection.group.id, groupName: selection.group.name, interval: view.interval, session: view.session, adjustment: view.adjustment, ranges: Object.fromEntries(charts.map(c => [c.ticker, c.range])), capturedAt: new Date().toISOString(), beforeEntry: view.beforeEntry, entryTime });
    } catch (e) { if (alive.current) setCaptureError(e instanceof Error ? e.message : "Chart capture failed."); }
    finally { if (alive.current) setCapturing(false); }
  };
  const card = (symbol: string, primary = false, exchange?: string | null) => {
    const issue = peerSymbolIssue({ ticker: symbol, exchange }) ?? (view.beforeEntry && entryTime === null ? "Before entry is unavailable until the execution timestamp is resolved." : null);
    const series = issue || results.basis !== basis ? undefined : results.values[symbol], current = results.key === requestKey, range = linked ? view.range : independent[symbol] ?? view.range;
    return <article className={`ws-peer-card${primary ? " ws-peer-primary" : ""}`} data-peer-symbol={symbol} key={symbol}>
      <header><strong>{symbol}</strong><span>{primary ? "Traded ticker" : exchange ?? "Peer"}</span></header>
      {series?.status === "ready" ? <PeerChart symbol={symbol} trade={props.trade} view={{ ...view, range }} series={series} preferences={props.preferences} onRange={onRange} register={register} /> : <div className="ws-peer-chart ws-peer-placeholder" role="status">{issue ?? (series?.status === "error" ? series.error : series?.status === "empty" ? "No eligible history in this range." : results.error || "Loading chart…")}</div>}
      <footer><button type="button" disabled={props.readOnly || capturing || !current || series?.status !== "ready"} onClick={() => void capture(symbol, false)}>Attach current chart</button>{!primary && <button type="button" disabled={props.readOnly || capturing || !current || series?.status !== "ready" || results.values[props.trade.symbol]?.status !== "ready"} onClick={() => void capture(symbol, true)}>Attach comparison</button>}</footer>
    </article>;
  };
  return <div className="ws-peer-backdrop"><div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Peer comparison" className="ws-peer-dialog" onKeyDown={e => {
    e.stopPropagation();
    if (e.key === "Escape" && !capturing) props.onClose();
    if (e.key === "Tab") { const elements = [...dialog.current!.querySelectorAll<HTMLElement>('button:not([disabled]),select,input,a[href]')]; const first = elements[0], last = elements.at(-1); if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } }
  }}>
    <header className="ws-peer-heading"><div><h2>Peer comparison · {props.trade.symbol}</h2><span>{props.mode === "demo" ? "Synthetic demo · " : ""}Entry: {entryTime === null ? "timestamp unresolved" : new Date(entryTime * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC"} · {view.adjustment} prices</span></div><button type="button" onClick={props.onClose} aria-label="Close peer comparison">✕</button></header>
    <div className="ws-peer-controls">
      <select aria-label="Comparison peer group" value={selection.group.id} onChange={e => { const group = selection.groups.find(g => g.id === e.target.value)!; setSelection(v => ({ ...v, group })); props.onSelectGroup(group.id); setIndependent({}); }}>{selection.groups.map(g => <option value={g.id} key={g.id}>{g.name}</option>)}</select>
      <select aria-label="Peer timeframe" value={view.interval} onChange={e => { setView(v => ({ ...v, interval: e.target.value as PeerView["interval"] })); setIndependent({}); }}>{intervals.map(interval => <option key={interval}>{interval}</option>)}</select>
      <button type="button" aria-pressed={linked} onClick={() => { if (linked) setIndependent(Object.fromEntries([...handles.current].flatMap(([symbol, handle]) => { const range = handle.range(); return range ? [[symbol, range]] : []; }))); else { const range = handles.current.get(props.trade.symbol)?.range(); if (range) setView(v => ({ ...v, range })); setIndependent({}); } setLinked(v => !v); }}>Link dates {linked ? "on" : "off"}</button>
      <button type="button" onClick={match}>Match workspace</button>
      <button type="button" disabled={entryTime === null} onClick={() => { const width = view.range.to - view.range.from; setView(v => ({ ...v, range: { from: Math.max(1, Math.floor(entryTime! - width * .8)), to: Math.ceil(entryTime! + width * .2) } })); setIndependent({}); }}>Jump to entry</button>
      <button type="button" disabled={entryTime === null} aria-pressed={view.beforeEntry} onClick={() => setView(v => ({ ...v, beforeEntry: !v.beforeEntry }))}>Before entry {view.beforeEntry ? "on" : "off"}</button>
      <input aria-label="Search peers" placeholder="Find a peer…" value={search} onChange={e => setSearch(e.target.value)} />
      <button type="button" disabled={cooldown > 0} onClick={() => { memory.clear(); setRetry(v => v + 1); }}>{cooldown ? `Retry in ${cooldown}s` : "Retry charts"}</button>
    </div>
    {(membershipLoading || membershipError) && <div className="ws-peer-message" role="status">{membershipLoading ? "Refreshing curated memberships…" : membershipError} {!membershipLoading && <button type="button" onClick={() => setRefresh(v => v + 1)}>Retry groups</button>}</div>}
    {captureError && <div className="ws-peer-message" role="alert">{captureError}</div>}
    {capturing && <div className="ws-peer-message" role="status">Saving chart to Peers…</div>}
    <div className="ws-peer-body" hidden={!membershipValid}>{membershipValid && card(props.trade.symbol, true)}<div className="ws-peer-scroll" ref={scroller} onScroll={e => { const top = e.currentTarget.scrollTop; setScroll(v => ({ ...v, top })); }}>
      {!members.length ? <p className="ws-help">No peers match this selection.</p> : <div className="ws-peer-virtual" style={{ height: window.height }}><div className="ws-peer-grid" style={{ transform: `translateY(${window.top}px)`, gridTemplateColumns: `repeat(${scroll.columns}, minmax(0, 1fr))` }}>{membershipValid && visible.map(member => card(member.ticker, false, member.exchange))}</div></div>}
    </div></div>
    <footer className="ws-peer-footnote"><span>{members.length} peers · {view.session} session · history held in memory only</span><a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView Lightweight Charts</a></footer>
  </div></div>;
}

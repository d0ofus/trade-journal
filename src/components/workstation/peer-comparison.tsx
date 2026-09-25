"use client";
import { DrawingTextControls } from "./drawing-text-controls";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CaptureQualityContext, CaptureQualityControls } from "./capture-quality";
import { captureResolution } from "@/lib/workstation/capture-resolution";
import { PeerChart, type PeerChartHandle } from "./peer-chart";
import type { PeerGroupSelection } from "./peer-groups";
import { PeerMemory, fetchPeerCandles, type PeerFetcher } from "@/lib/workstation/peer-memory";
import { peerContextSchema, peerEntryTime, peerMembers, peerSymbolIssue, peerVirtualWindow, peerWarmupRange, selectPeerGroup, type PeerCapture, type PeerCandleQuery, type PeerSeries, type PeerView } from "@/lib/workstation/peers";
import { drawingTools, intervals, seconds, type Drawing, type Tool, type Trade, type WorkspacePreferences } from "@/lib/workstation/types";
import type { HistoryRange } from "@/lib/workstation/history";
import { compositeCharts } from "@/lib/workstation/export";
import { peerReplayRange } from "@/lib/workstation/peers";
import { arrangePeers, emptyPeerComparison, movePeer, type PeerComparisonState, type PeerArrangement } from "@/lib/workstation/peer-arrangement";
import type { SplitAdjustment } from "@/lib/workstation/split-adjustment";
import { assertCaptureSize } from "@/lib/workstation/capture-resolution";

type Props = { comparison?: PeerComparisonState; onComparisonChange: (state: PeerComparisonState) => void; hiddenIds?: ReadonlySet<string>; onHideDrawings: (ids: ReadonlySet<string> | undefined) => void; trade: Trade; selection: PeerGroupSelection; initial: PeerView; preferences: WorkspacePreferences; mode: "demo" | "application"; readOnly: boolean; getWorkspaceView: () => PeerView; onSelectGroup: (id: string) => void; onCapture: (canvas: HTMLCanvasElement, metadata: PeerCapture) => Promise<void>; onClose: () => void };

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
  const captureSetting = useContext(CaptureQualityContext);
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
  const [comparison, setComparison] = useState(props.comparison ?? emptyPeerComparison), comparisonRef = useRef(comparison);
  const [activeSymbol, setActiveSymbol] = useState(props.trade.symbol), [tool, setTool] = useState<Tool>("cursor"), [selectedDrawing, setSelectedDrawing] = useState<string | null>(null);
  const [popover, setPopover] = useState<"drawings" | "arrange" | "capture" | null>(null);
  const hiddenDrawings = props.hiddenIds ?? new Set<string>();
  const [magnet, setMagnet] = useState(props.preferences.magnet), [keepTool, setKeepTool] = useState(props.preferences.keepTool);
  const peerPreferences = useMemo(() => ({ ...props.preferences, magnet, keepTool }), [props.preferences, magnet, keepTool]);
  const [splits, setSplits] = useState<Record<string, { adjustment?: SplitAdjustment; error?: string }>>({});
  const history = useRef<{ past: PeerComparisonState["drawings"][]; future: PeerComparisonState["drawings"][] }>({ past: [], future: [] });
  const allMembers = useMemo(() => peerMembers(selection.group, props.trade.symbol), [selection.group, props.trade.symbol]);
  const arrangement = comparison.arrangements[selection.group.id];
  const members = useMemo(() => arrangePeers(allMembers, arrangement).filter(member => `${member.ticker} ${member.name ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())), [allMembers, arrangement, search]);
  const saveComparison = (next: PeerComparisonState) => { if (props.readOnly) return; comparisonRef.current = next; setComparison(next); props.onComparisonChange(next); };
  const changeDrawings = (next: PeerComparisonState["drawings"], record = true) => {
    if (props.readOnly) return;
    if (record) { history.current.past.push(comparisonRef.current.drawings); if (history.current.past.length > 50) history.current.past.shift(); history.current.future = []; }
    saveComparison({ ...comparisonRef.current, drawings: next });
  };
  const updateDrawing = (symbol: string, drawing: Drawing) => { const current = comparisonRef.current.drawings; changeDrawings({ ...current, [symbol]: [...(current[symbol] ?? []).filter(d => d.id !== drawing.id), { ...drawing, panel: null }] }); };
  const undo = (redo = false) => { const source = redo ? history.current.future : history.current.past, target = redo ? history.current.past : history.current.future, next = source.pop(); if (next && !props.readOnly) { target.push(comparisonRef.current.drawings); changeDrawings(next, false); } };
  const changeArrangement = (next: PeerArrangement | null) => { const arrangements = { ...comparisonRef.current.arrangements }; if (next) arrangements[selection.group.id] = next; else delete arrangements[selection.group.id]; saveComparison({ ...comparisonRef.current, arrangements }); };
  const arrangedOrder = arrangePeers(allMembers, { order: arrangement?.order ?? [], hidden: [] }).map(m => m.ticker);
  const move = (symbol: string, target: string) => { if (!search.trim()) changeArrangement({ hidden: arrangement?.hidden ?? [], order: movePeer(arrangedOrder, symbol, target) }); };
  const selected = (comparison.drawings[activeSymbol] ?? []).find(d => d.id === selectedDrawing);
  const window = peerVirtualWindow(members.length, scroll.columns, scroll.top, scroll.height);
  const visible = members.slice(window.start, window.end);
  const splitSymbols = [props.trade.symbol, ...visible.map(m => m.ticker)].filter(symbol => view.adjustment === "split" && (symbol === activeSymbol || comparison.drawings[symbol]?.length) && !splits[symbol]?.adjustment);
  const splitKey = JSON.stringify(splitSymbols);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => { for (const symbol of JSON.parse(splitKey) as string[]) {
      try {
        const adjustment = props.mode === "demo" ? { version: 1 as const, asOf: new Date().toISOString().slice(0, 10), splits: [] } : await fetch(`/api/workstation/peer-candles?${new URLSearchParams({ metadataOnly: "1", symbol })}`, { signal: controller.signal, priority: "low" }).then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Split adjustment unavailable"); if (body.symbol !== symbol || body.splitAdjustment?.version !== 1 || !Array.isArray(body.splitAdjustment.splits)) throw new Error("Invalid split adjustment metadata"); return body.splitAdjustment as SplitAdjustment; });
        if (!controller.signal.aborted) setSplits(current => ({ ...current, [symbol]: { adjustment } }));
      } catch (error) { if (!controller.signal.aborted) setSplits(current => ({ ...current, [symbol]: { error: error instanceof Error ? error.message : "Split adjustment unavailable" } })); }
    } })();
    return () => controller.abort();
  }, [splitKey, props.mode, retry]);
  const periods = Math.max(1, ...props.preferences.averages, props.preferences.volumeAverage.enabled ? props.preferences.volumeAverage.period : 1);
  const symbols = [props.trade.symbol, ...visible.filter(m => !peerSymbolIssue(m)).map(m => m.ticker)];
  const requested = symbols.map(symbol => {
    const ownView = { ...view, range: linked ? view.range : independent[symbol] ?? view.range };
    return { symbol, query: { ...peerWarmupRange(ownView, periods), timeframe: view.interval, session: view.session, adjustment: view.adjustment } };
  });
  const requestKey = JSON.stringify(requested);
  const captureIdentity = `${props.trade.id}:${selection.group.id}:${requestKey}`;
  const identity = useRef(captureIdentity);
  useEffect(() => { identity.current = captureIdentity; }, [captureIdentity]);
  const basis = `${view.interval}:${view.session}:${view.adjustment}`;
  const entryTime = peerEntryTime(props.trade);
  const register = useCallback((symbol: string, handle: PeerChartHandle | null) => { if (handle) handles.current.set(symbol, handle); else handles.current.delete(symbol); }, []);
  const onRange = useCallback((symbol: string, range: HistoryRange) => {
    range = peerReplayRange(range, props.initial.replayAt);
    if (linked) setView(v => Math.abs(v.range.from - range.from) < 1 && Math.abs(v.range.to - range.to) < 1 ? v : { ...v, range });
    else setIndependent(v => v[symbol]?.from === range.from && v[symbol]?.to === range.to ? v : { ...v, [symbol]: range });
  }, [linked, props.initial.replayAt]);
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
  const annotationsReady = (symbol: string) => view.adjustment === "raw" || !comparison.drawings[symbol]?.length || !!splits[symbol]?.adjustment;
  const visibleCapture = () => {
    const viewport = scroller.current?.getBoundingClientRect(), main = handles.current.get(props.trade.symbol), charts: { symbol: string; handle: PeerChartHandle; bounds: DOMRect }[] = [], excluded: string[] = [];
    if (!membershipValid) return { charts, excluded: ["Curated memberships are not ready."] };
    if (main && results.key === requestKey && results.values[props.trade.symbol]?.status === "ready" && annotationsReady(props.trade.symbol)) charts.push({ symbol: props.trade.symbol, handle: main, bounds: main.bounds() });
    else excluded.push(`${props.trade.symbol}: chart or annotation adjustments not ready`);
    for (const member of members) {
      const handle = handles.current.get(member.ticker), bounds = handle?.bounds();
      if (!bounds || !viewport || bounds.top < viewport.top - .5 || bounds.bottom > viewport.bottom + .5 || bounds.left < viewport.left - .5 || bounds.right > viewport.right + .5) { excluded.push(`${member.ticker}: not fully visible`); continue; }
      if (results.key !== requestKey || results.values[member.ticker]?.status !== "ready") { excluded.push(`${member.ticker}: not ready`); continue; }
      if (!annotationsReady(member.ticker)) { excluded.push(`${member.ticker}: annotation split adjustments not verified`); continue; }
      charts.push({ symbol: member.ticker, handle: handle!, bounds });
    }
    return { charts, excluded };
  };
  const captureAll = async () => {
    if (capturing || props.readOnly) return;
    setCapturing(true); setCaptureError("");
    try {
      const { charts } = visibleCapture();
      if (charts.length < 2 || charts[0].symbol !== props.trade.symbol) throw new Error("Keep the primary chart and at least one ready peer plot fully visible.");
      const left = Math.min(...charts.map(c => c.bounds.left)), top = Math.min(...charts.map(c => c.bounds.top));
      const positions = charts.map(c => ({ symbol: c.symbol, x: c.bounds.left - left, y: c.bounds.top - top, width: c.bounds.width, height: c.bounds.height }));
      const width = Math.max(...positions.map(p => p.x + p.width)), height = Math.max(...positions.map(p => p.y + p.height));
      const resolution = captureResolution({ width, height: height + 28 }, captureSetting.quality, globalThis.devicePixelRatio), capturedAt = new Date().toISOString();
      const ranges = Object.fromEntries(charts.map(c => [c.symbol, c.handle.range() ?? view.range]));
      // All handles freeze their own frames synchronously before Promise.all yields.
      const canvases = await Promise.all(charts.map(c => c.handle.capture(resolution.scale, true)));
      if (!alive.current || identity.current !== captureIdentity) throw new Error("Capture cancelled because the comparison changed.");
      const plots = compositeCharts(canvases, props.preferences.theme === "light", positions, resolution.scale), output = document.createElement("canvas");
      output.width = plots.width; output.height = plots.height + Math.ceil(28 * resolution.scale); assertCaptureSize(output.width, output.height);
      const ctx = output.getContext("2d")!; ctx.fillStyle = props.preferences.theme === "light" ? "#f8fafc" : "#101722"; ctx.fillRect(0, 0, output.width, output.height); ctx.drawImage(plots, 0, 0); ctx.fillStyle = props.preferences.theme === "light" ? "#334155" : "#cbd5e1"; ctx.font = `${10 * resolution.scale}px system-ui`;
      ctx.fillText(`${selection.group.name} · ${view.interval} · ${view.session} · ${view.adjustment}${view.beforeEntry ? " · Before entry" : ""}${view.replayAt === undefined ? "" : ` · REPLAY ${new Date(view.replayAt * 1000).toISOString()}`} · TradingView Lightweight Charts`, 10 * resolution.scale, output.height - 9 * resolution.scale, output.width - 20 * resolution.scale);
      const bytes = await new Promise<number>((resolve, reject) => output.toBlob(blob => blob ? resolve(blob.size) : reject(new Error("PNG encoding failed")), "image/png"));
      if (bytes > 20_000_000) throw new Error(`${output.width} × ${output.height} PNG is ${(bytes / 1_000_000).toFixed(2)} MB, above the 20 MB image limit. Use Standard or show fewer charts; quality has not been reduced.`);
      await props.onCapture(output, { source: "peer-comparison", symbols: charts.map(c => c.symbol), arrangement: positions, groupId: selection.group.id, groupName: selection.group.name, interval: view.interval, session: view.session, adjustment: view.adjustment, ranges, capturedAt, beforeEntry: view.beforeEntry, entryTime, replayAt: view.replayAt });
      setCaptureError(`Attached ${output.width} × ${output.height} PNG · ${(bytes / 1_000_000).toFixed(2)} MB`); setPopover(null);
    } catch (error) { if (alive.current) setCaptureError(error instanceof Error ? error.message : "Visible capture failed."); }
    finally { if (alive.current) setCapturing(false); }
  };
  const capture = async (symbol: string, paired: boolean) => {
    if (capturing || props.readOnly) return;
    setCapturing(true); setCaptureError("");
    try {
      const chosen = paired && symbol !== props.trade.symbol ? [props.trade.symbol, symbol] : [symbol];
      if (!membershipValid || chosen.some(ticker => !annotationsReady(ticker))) throw new Error("Wait for curated memberships and ticker-specific annotation adjustments before capturing.");
      const capturedAt = new Date().toISOString();
      const charts = chosen.map(ticker => { const handle = handles.current.get(ticker); if (!handle || !results.values[ticker]?.candles.length || results.key !== requestKey) throw new Error("Wait for the selected charts to finish loading."); return { ticker, handle, frame: handle.frame(), range: handle.range() ?? view.range }; });
      const scale = captureResolution({ width: charts.reduce((sum, c) => sum + c.frame.width, 0) + (charts.length - 1) * 12, height: Math.max(...charts.map(c => c.frame.height)) }, captureSetting.quality, globalThis.devicePixelRatio).scale;
      const canvases = await Promise.all(charts.map(c => c.handle.capture(scale)));
      if (!alive.current || identity.current !== captureIdentity) throw new Error("Capture cancelled because the comparison changed.");
      let left = 0;
      const positions = canvases.map(canvas => { const result = { x: left, y: 0, width: canvas.width / scale, height: canvas.height / scale }; left += result.width + 12; return result; });
      const canvas = paired ? compositeCharts(canvases, props.preferences.theme === "light", positions, scale) : canvases[0];
      await props.onCapture(canvas, { replayAt: view.replayAt, source: "peer-comparison", symbols: chosen, groupId: selection.group.id, groupName: selection.group.name, interval: view.interval, session: view.session, adjustment: view.adjustment, ranges: Object.fromEntries(charts.map(c => [c.ticker, c.range])), capturedAt, beforeEntry: view.beforeEntry, entryTime });
    } catch (e) { if (alive.current) setCaptureError(e instanceof Error ? e.message : "Chart capture failed."); }
    finally { if (alive.current) setCapturing(false); }
  };
  const card = (symbol: string, primary = false, exchange?: string | null) => {
    const issue = peerSymbolIssue({ ticker: symbol, exchange }) ?? (view.beforeEntry && entryTime === null ? "Before entry is unavailable until the execution timestamp is resolved." : null);
    const series = issue || results.basis !== basis ? undefined : results.values[symbol], current = results.key === requestKey, range = linked ? view.range : independent[symbol] ?? view.range;
    return <article className={`ws-peer-card${primary ? " ws-peer-primary" : ""}${activeSymbol === symbol ? " ws-peer-selected" : ""}`} data-peer-symbol={symbol} key={symbol} onDragOver={event => { if (!primary && !search.trim()) event.preventDefault(); }} onDrop={event => { event.preventDefault(); if (!primary) move(event.dataTransfer.getData("text/x-peer-symbol"), symbol); }}>
      <header><strong>{symbol}<small className="ws-peer-role">{primary ? "Traded ticker" : exchange ?? "Peer"}</small></strong><span><CaptureQualityControls dimensionsOnly label="PNG" frame={() => handles.current.get(symbol)?.frame() ?? null} />{!primary && <CaptureQualityControls dimensionsOnly label="Pair" frame={() => { const own = handles.current.get(symbol)?.frame(), main = handles.current.get(props.trade.symbol)?.frame(); return own && main ? { width: own.width + main.width + 12, height: Math.max(own.height, main.height) } : null; }} />}</span></header>
      {!primary && <button className="ws-peer-drag-handle" type="button" draggable={!search.trim() && !props.readOnly} aria-label={`Arrange ${symbol}`} title={`Drag to rearrange ${symbol}; click for accessible controls`} onClick={() => setPopover("arrange")} onDragStart={event => event.dataTransfer.setData("text/x-peer-symbol", symbol)}>⠿</button>}
      {series?.status === "ready" ? <PeerChart symbol={symbol} trade={props.trade} view={{ ...view, range }} series={series} preferences={peerPreferences} onRange={onRange} register={register} drawingControls={{ active: activeSymbol === symbol, tool, selected: selectedDrawing, drawings: comparison.drawings[symbol] ?? [], hidden: hiddenDrawings, readOnly: props.readOnly, adjustment: splits[symbol]?.adjustment, adjustmentReady: view.adjustment === "raw" || !!splits[symbol]?.adjustment, context: `${selection.group.id}:${view.interval}:${view.session}:${view.adjustment}:${view.beforeEntry}:${view.replayAt}`, activate: () => setActiveSymbol(symbol), select: setSelectedDrawing, commit: drawing => updateDrawing(symbol, drawing), edit: id => { setActiveSymbol(symbol); setSelectedDrawing(id); setPopover("drawings"); requestAnimationFrame(() => dialog.current?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Annotation"]')?.focus()); }, done: () => setTool("cursor") }} /> : <div className="ws-peer-chart ws-peer-placeholder" role="status">{issue ?? (series?.status === "error" ? series.error : series?.status === "empty" ? "No eligible history in this range." : results.error || "Loading chart…")}</div>}
      <footer><button type="button" disabled={props.readOnly || capturing || !current || !annotationsReady(symbol) || series?.status !== "ready"} onClick={() => void capture(symbol, false)}>Attach current chart</button>{!primary && <button type="button" disabled={props.readOnly || capturing || !current || !annotationsReady(symbol) || series?.status !== "ready" || !annotationsReady(props.trade.symbol) || results.values[props.trade.symbol]?.status !== "ready"} onClick={() => void capture(symbol, true)}>Attach comparison</button>}</footer>
      {series?.status === "ready" && !annotationsReady(symbol) && <span className="ws-peer-adjustment-warning" role="status">{splits[symbol]?.error ? "Annotations unavailable: split verification failed. Retry in Drawings." : "Verifying ticker-specific split adjustments for annotations…"}</span>}
    </article>;
  };
  return <div className="ws-peer-backdrop"><div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Peer comparison" className="ws-peer-dialog" onKeyDown={e => {
    e.stopPropagation();
    if (e.key === "Escape" && !capturing) { if (popover) setPopover(null); else props.onClose(); }
    const typing = (e.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]');
    if (!typing && !props.readOnly && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(e.shiftKey); }
    if (!typing && !props.readOnly && (e.key === "Delete" || e.key === "Backspace") && selected && !selected.locked) { e.preventDefault(); changeDrawings({ ...comparison.drawings, [activeSymbol]: comparison.drawings[activeSymbol].filter(d => d.id !== selected.id) }); setSelectedDrawing(null); }
    if (e.key === "Tab") { const elements = [...dialog.current!.querySelectorAll<HTMLElement>('button:not([disabled]),select:not([disabled]),input:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]')].filter(node => node.getClientRects().length && !node.closest('[hidden],[inert]')); const first = elements[0], last = elements.at(-1); if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } }
  }}>
    <header className="ws-peer-heading"><div><h2>Peer comparison · {props.trade.symbol}</h2><span>{props.mode === "demo" ? "Synthetic demo · " : ""}Entry: {entryTime === null ? "timestamp unresolved" : new Date(entryTime * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC"} · {view.adjustment} prices</span></div><button type="button" onClick={props.onClose} aria-label="Close peer comparison">✕</button></header>
    <div className="ws-peer-extra-controls"><button type="button" aria-expanded={popover === "drawings"} onClick={() => setPopover(v => v === "drawings" ? null : "drawings")}>Drawings</button><button type="button" aria-expanded={popover === "arrange"} onClick={() => setPopover(v => v === "arrange" ? null : "arrange")}>Arrange</button><button type="button" disabled={capturing || props.readOnly} onClick={() => setPopover(v => v === "capture" ? null : "capture")}>Attach visible charts</button></div>
    {popover && <aside className="ws-peer-popover" aria-label={popover === "drawings" ? "Comparison drawing controls" : popover === "arrange" ? "Peer arrangement" : "Visible capture preview"}>
      <button className="ws-peer-popover-close" aria-label="Close comparison controls" onClick={() => setPopover(null)}>×</button>
      {popover === "drawings" && <>
        <h3>{activeSymbol} · Comparison drawings</h3><p className="ws-help">Select a chart, then a tool. Comparison annotations are separate from workspace drawings.</p>
        {view.adjustment === "split" && !splits[activeSymbol]?.adjustment && <p role="status">{splits[activeSymbol]?.error ?? "Verifying this ticker's split adjustments before enabling annotations…"}<button onClick={() => setRetry(v => v + 1)}>Retry verification</button></p>}
        <div className="ws-peer-tools">{drawingTools.map(value => <button type="button" key={value} aria-pressed={tool === value} disabled={props.readOnly || view.adjustment === "split" && !splits[activeSymbol]?.adjustment} onClick={() => { setTool(value); handles.current.forEach(h => h.cancelDrawing()); }}>{value}</button>)}</div>
        <div className="ws-peer-tools"><button type="button" disabled={props.readOnly || !history.current.past.length} onClick={() => undo()}>Undo</button><button type="button" disabled={props.readOnly || !history.current.future.length} onClick={() => undo(true)}>Redo</button><button type="button" onClick={() => props.onHideDrawings(props.hiddenIds ? undefined : new Set(Object.values(comparison.drawings).flat().map(d => d.id)))}>{props.hiddenIds ? "Show all drawings" : "Hide all drawings"}</button><button type="button" aria-pressed={magnet} onClick={() => setMagnet(value => !value)}>Snap to OHLC</button><button type="button" aria-pressed={keepTool} onClick={() => setKeepTool(value => !value)}>Keep tool selected</button></div>
        {props.hiddenIds && <p>Existing drawings hidden; new drawings remain visible.</p>}
        <div className="ws-peer-drawing-list">{(comparison.drawings[activeSymbol] ?? []).map(d => <button key={d.id} type="button" aria-pressed={selectedDrawing === d.id} onClick={() => { setSelectedDrawing(d.id); setTool("cursor"); }}>{d.tool} · {d.text || d.points[0]?.price.toFixed(2)}{d.hidden || hiddenDrawings.has(d.id) ? " · Hidden" : ""}{d.locked ? " · Locked" : ""}</button>)}</div>
        {selected && <fieldset disabled={props.readOnly} className="ws-peer-properties"><legend>Drawing properties</legend>
          <label>Annotation<textarea aria-label="Annotation" placeholder="Add a note…" value={selected.text} maxLength={500} disabled={selected.locked} onChange={e => updateDrawing(activeSymbol, { ...selected, text: e.target.value })} /></label>
          <DrawingTextControls tool={selected.tool} value={selected} disabled={selected.locked || props.readOnly} onChange={patch => updateDrawing(activeSymbol, { ...selected, ...patch })} />
          <label>Colour<input type="color" value={selected.color} disabled={selected.locked} onChange={e => updateDrawing(activeSymbol, { ...selected, color: e.target.value })} /></label>
          <label>Width<input type="number" min={.5} max={4} step={.5} value={selected.width} disabled={selected.locked} onChange={e => { const width = Number(e.target.value); if (width >= .5 && width <= 4) updateDrawing(activeSymbol, { ...selected, width }); }} /></label>
          {([['dashed', 'Dashed'], ['locked', 'Locked'], ['hidden', 'Hidden']] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={selected[key]} disabled={selected.locked && key === "dashed"} onChange={e => updateDrawing(activeSymbol, { ...selected, [key]: e.target.checked })} />{label}</label>)}
          {selected.tool === "measure" && ([['extendLeft', 'Extend left', false], ['extendRight', 'Extend right', false], ['showValues', 'Values', true], ['showPercent', 'Percent', true], ['showInterval', 'Interval', true], ['showBars', 'Number of bars', true]] as const).map(([key, label, fallback]) => <label key={key}><input type="checkbox" disabled={selected.locked} checked={selected[key] ?? fallback} onChange={e => updateDrawing(activeSymbol, { ...selected, [key]: e.target.checked })} />{label}</label>)}
          {["entry", "exit", "ray"].includes(selected.tool) && <label><input type="checkbox" disabled={selected.locked} checked={(selected.tool === "ray" ? selected.showDefaultLabel : selected.showPrice) !== false} onChange={e => updateDrawing(activeSymbol, { ...selected, [selected.tool === "ray" ? "showDefaultLabel" : "showPrice"]: e.target.checked })} />Show price</label>}
          <button type="button" onClick={() => { const id = crypto.randomUUID(); updateDrawing(activeSymbol, { ...selected, id, locked: false, hidden: false }); setSelectedDrawing(id); }}>Duplicate</button><button type="button" disabled={selected.locked} onClick={() => { changeDrawings({ ...comparison.drawings, [activeSymbol]: comparison.drawings[activeSymbol].filter(d => d.id !== selected.id) }); setSelectedDrawing(null); }}>Delete</button>
        </fieldset>}
      </>}
      {popover === "arrange" && <><h3>Peer arrangement</h3><p>Primary ticker stays pinned. Hide empty charts to reclaim their grid slots.</p>{search.trim() && <p>Clear search to rearrange peers.</p>}
        <button type="button" disabled={props.readOnly || !arrangement?.hidden.length} onClick={() => changeArrangement({ order: arrangedOrder, hidden: [] })}>Restore hidden peers</button><button type="button" disabled={props.readOnly} onClick={() => changeArrangement(null)}>Reset arrangement</button>
        <ol className="ws-peer-arrangement-list">{arrangedOrder.map((symbol, index) => <li key={symbol}><strong>{symbol}</strong><button type="button" disabled={props.readOnly || !!search.trim() || index === 0} aria-label={`Move ${symbol} up`} onClick={() => move(symbol, arrangedOrder[index - 1])}>↑</button><button type="button" disabled={props.readOnly || !!search.trim() || index === arrangedOrder.length - 1} aria-label={`Move ${symbol} down`} onClick={() => move(symbol, arrangedOrder[index + 1])}>↓</button><button type="button" disabled={props.readOnly} onClick={() => changeArrangement({ order: arrangedOrder, hidden: arrangement?.hidden.includes(symbol) ? arrangement.hidden.filter(s => s !== symbol) : [...arrangement?.hidden ?? [], symbol] })}>{arrangement?.hidden.includes(symbol) ? "Restore" : "Hide"}</button></li>)}</ol>
      </>}
      {popover === "capture" && (() => { const { charts, excluded } = visibleCapture(); const bounds = charts.map(c => c.bounds); const frame = bounds.length ? { width: Math.max(...bounds.map(b => b.right)) - Math.min(...bounds.map(b => b.left)), height: Math.max(...bounds.map(b => b.bottom)) - Math.min(...bounds.map(b => b.top)) + 28 } : null; return <><h3>Attach visible charts</h3><p>Included: {charts.map(c => c.symbol).join(", ") || "None ready"}</p><CaptureQualityControls label="Complete image quality" frame={() => frame} /><p>Only fully visible, ready plots are included. Headers, controls and drawing handles are excluded.</p><details><summary>Excluded ({excluded.length})</summary>{excluded.map(value => <div key={value}>{value}</div>)}</details><button type="button" disabled={capturing || charts.length < 2 || charts[0]?.symbol !== props.trade.symbol || props.readOnly} onClick={() => void captureAll()}>Confirm attachment to Peers</button></>; })()}
    </aside>}
    <div className="ws-peer-controls">
      <CaptureQualityControls label="Peer capture quality" frame={() => handles.current.get(props.trade.symbol)?.frame() ?? null} />
      <select aria-label="Comparison peer group" value={selection.group.id} onChange={e => { const group = selection.groups.find(g => g.id === e.target.value)!; setSelection(v => ({ ...v, group })); props.onSelectGroup(group.id); setIndependent({}); }}>{selection.groups.map(g => <option value={g.id} key={g.id}>{g.name}</option>)}</select>
      <select aria-label="Peer timeframe" value={view.interval} onChange={e => { setView(v => ({ ...v, interval: e.target.value as PeerView["interval"] })); setIndependent({}); }}>{intervals.map(interval => <option key={interval}>{interval}</option>)}</select>
      <button type="button" aria-pressed={linked} onClick={() => { if (linked) setIndependent(Object.fromEntries([...handles.current].flatMap(([symbol, handle]) => { const range = handle.range(); return range ? [[symbol, range]] : []; }))); else { const range = handles.current.get(props.trade.symbol)?.range(); if (range) setView(v => ({ ...v, range })); setIndependent({}); } setLinked(v => !v); }}>Link dates {linked ? "on" : "off"}</button>
      <button type="button" onClick={match}>Match workspace</button>
      <button type="button" disabled={entryTime === null || view.replayAt !== undefined && entryTime > view.replayAt} onClick={() => { const width = view.range.to - view.range.from; setView(v => ({ ...v, range: peerReplayRange({ from: Math.max(1, Math.floor(entryTime! - width * .8)), to: Math.ceil(entryTime! + width * .2) }, v.replayAt) })); setIndependent({}); }}>Jump to entry</button>
      <button type="button" disabled={entryTime === null} aria-pressed={view.beforeEntry} onClick={() => setView(v => ({ ...v, beforeEntry: !v.beforeEntry }))}>Before entry {view.beforeEntry ? "on" : "off"}</button>
      <input aria-label="Search peers" placeholder="Find a peer…" value={search} onChange={e => setSearch(e.target.value)} />
      <button type="button" disabled={cooldown > 0} onClick={() => { memory.clear(); setRetry(v => v + 1); }}>{cooldown ? `Retry in ${cooldown}s` : "Retry charts"}</button>
    </div>
    {(membershipLoading || membershipError) && <div className="ws-peer-message" role="status">{membershipLoading ? "Refreshing curated memberships…" : membershipError} {!membershipLoading && <button type="button" onClick={() => setRefresh(v => v + 1)}>Retry groups</button>}</div>}
    {view.replayAt !== undefined && <div className="ws-peer-message" role="note">Replay paused · completed candles through {new Date(view.replayAt * 1000).toISOString()}</div>}
    {captureError && <div className="ws-peer-message" role="alert">{captureError}</div>}
    {capturing && <div className="ws-peer-message" role="status">Saving chart to Peers…</div>}
    <div className="ws-peer-body" hidden={!membershipValid}>{membershipValid && card(props.trade.symbol, true)}<div className="ws-peer-scroll" ref={scroller} onScroll={e => { const top = e.currentTarget.scrollTop; setScroll(v => ({ ...v, top })); }}>
      {!members.length ? <p className="ws-help">No peers match this selection.</p> : <div className="ws-peer-virtual" style={{ height: window.height }}><div className="ws-peer-grid" style={{ transform: `translateY(${window.top}px)`, gridTemplateColumns: `repeat(${scroll.columns}, minmax(0, 1fr))` }}>{membershipValid && visible.map(member => card(member.ticker, false, member.exchange))}</div></div>}
    </div></div>
    <footer className="ws-peer-footnote"><span>{members.length} peers · {view.session} session · history held in memory only</span><a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView Lightweight Charts</a></footer>
  </div></div>;
}

"use client";
import { executionColors, benchmarkColor } from "@/lib/workstation/comparison";
import { attachEvidence, removeEvidence } from "@/lib/workstation/evidence";
import { reviewSections, emptyNotionReview, type ReviewSectionKey } from "@/lib/workstation/notion-template";
import { newestTradesFirst } from "@/lib/workstation/trade-order";
import type { PeerCapture, PeerView } from "@/lib/workstation/peers";
import type { PeerGroupSelection } from "./peer-groups";
import dynamic from "next/dynamic";
import { notionImportCsv, notionPageArchive } from "@/lib/workstation/notion-import";
import { initialHistoryRange } from "@/lib/workstation/history";
import { chartLabelMode, restoreChartLabels, type ChartSlot, type LabelMode } from "@/lib/workstation/chart-labels";
import { splitAdjustedDrawing, type SplitAdjustment } from "@/lib/workstation/split-adjustment";
import { tradeChartSession } from "@/lib/workstation/chart-session";
import { restoreChartDisplay, restoreChartPanels, restoreMovingAveragePeriods } from "@/lib/workstation/chart-preferences";
import { MovingAverageSettings } from "./moving-average-settings";
import { drawingStyle, drawingStyleFor, restoreDrawingStyles } from "@/lib/workstation/drawing-style";
import { executionTimeResolved, executionTimezoneLabel } from "@/lib/workstation/execution-time-provenance";
import { formatPeakPositionCost, peakCostDescription, peakPositionCost } from "@/lib/workstation/peak-position-cost";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DockviewReact } from "dockview-react";
import {
  DockviewApi,
  DockviewReadyEvent,
  IDockviewPanelProps,
  IDockviewHeaderActionsProps,
  SerializedDockview,
  themeDark,
  themeLight,
} from "dockview";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  CalendarDays,
  Minimize2,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Copy,
  Crosshair,
  Download,
  Eye,
  EyeOff,
  Flag,
  Grid2X2,
  ImageIcon,
  ListFilter,
  LockKeyhole,
  Magnet,
  Maximize2,
  Minus,
  MousePointer2,
  MoveUpRight,
  PanelLeftClose,
  Pause,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Ruler,
  Search,
  Settings2,
  Square,
  Star,
  Target,
  Trash2,
  TrendingUp,
  Triangle,
  Type,
  Undo2,
  UnlockKeyhole,
  X,
} from "lucide-react";
import {
  Drawing,
  DrawingStyle,
  DrawingStyles,
  Interval,
  Tool,
  Trade,
  WorkstationAdapter,
  WorkspacePreferences,
  defaultPreferences,
  intervals,
  seconds,
} from "@/lib/workstation/types";
import {
  canvasBlob,
  compositeCharts,
  copyChart,
  downloadBlob,
  exportColumns,
  filename,
  reviewArchive,
  reviewCsv,
  reviewMarkdown,
} from "@/lib/workstation/export";
import { measureText, riskReward } from "@/lib/workstation/math";
import { useTradeDocument } from "./use-trade-document";
import { useTradeView } from "./use-trade-view";
import { viewPreferences, type TradeView } from "@/lib/workstation/trade-view";
import { ChartHandle, TradeChart } from "./trade-chart";
import { TradeMarketMetrics } from "./market-metrics-strip";
import type { MarketMetrics } from "@/lib/workstation/market-metrics";
import { metricIdentity } from "@/lib/workstation/share-eligibility";
import { ConnectedReviewEditor, ConnectedSaveStatus } from "./review-editor";
import { DrawingCoordinates } from "./drawing-coordinates";
import { applyWorkspaceVisibility, reviewPanelIds } from "./workspace-layout";
import { ChartDateTarget, restoredDateLink } from "@/lib/workstation/date-link";
import Image from "next/image";
import { commands, defaultShortcuts, matchCommand, shortcutLabel, typingTarget } from "@/lib/workstation/shortcuts";
import { ShortcutSettings, useShortcutPreferences } from "./shortcut-settings";
import { useAppearance } from "@/lib/workstation/appearance";
import { useApplicationShell } from "@/components/application-shell";
import { WorkstationFilterControls } from "./trade-filter-controls";
import { normalizeWorkstationFilters, tradeFilterError, type TradeFilterControls, type WorkstationTradeFilters } from "@/lib/workstation/trade-filters";
import "dockview/dist/styles/dockview.css";
import "./workstation.css";
import "./peer-comparison.css";
import { ResizableChartGrid } from "./resizable-chart-grid";
import { defaultChartSizing, restoreChartSizing } from "@/lib/workstation/chart-sizing";

const PeerComparison = dynamic(() => import("./peer-comparison").then(m => m.PeerComparison), { ssr: false });
const tools: { id: Tool; label: string; icon: typeof Crosshair }[] = [
  { id: "cursor", label: "Select / pan", icon: MousePointer2 },
  { id: "horizontal", label: "Horizontal line", icon: Minus },
  { id: "ray", label: "Horizontal ray", icon: ArrowRight },
  { id: "trend", label: "Trend line", icon: TrendingUp },
  { id: "arrow", label: "Arrow", icon: MoveUpRight },
  { id: "zone", label: "Price zone", icon: Square },
  { id: "text", label: "Text note", icon: Type },
  { id: "price-note", label: "Price note", icon: Flag },
  { id: "measure", label: "Price & time measurement", icon: Ruler },
  { id: "long", label: "Long risk / reward", icon: ArrowUpRight },
  { id: "short", label: "Short risk / reward", icon: ArrowDownRight },
  { id: "entry", label: "Planned entry", icon: Triangle },
  { id: "stop", label: "Planned stop", icon: Minus },
  { id: "target", label: "Planned target", icon: Target },
  { id: "exit", label: "Planned exit", icon: Triangle },
];
function DrawingStyleSettings({ initialTool, styles, onChange }: {
  initialTool: Drawing["tool"];
  styles: DrawingStyles;
  onChange: (tool: Drawing["tool"], style: DrawingStyle) => void;
}) {
  const [selectedTool, setSelectedTool] = useState(initialTool);
  const style = drawingStyleFor(selectedTool, styles);
  return <>
    <label>
      <span>Drawing tool defaults</span>
      <select aria-label="Drawing tool defaults" value={selectedTool} onChange={event => setSelectedTool(event.target.value as Drawing["tool"])}>
        {tools.filter(tool => tool.id !== "cursor").map(tool => <option key={tool.id} value={tool.id}>{tool.label}</option>)}
      </select>
    </label>
    <label>
      <span>Default drawing color</span>
      <input type="color" aria-label="Default drawing color" value={style.color}
        onChange={event => onChange(selectedTool, { ...style, color: event.target.value })} />
    </label>
    {selectedTool === "measure" && (["extendLeft", "extendRight"] as const).map(flag => <label key={flag}>
      <span>{flag === "extendLeft" ? "Extend left" : "Extend right"}</span>
      <input type="checkbox" checked={style[flag] === true} onChange={event => onChange(selectedTool, { ...style, [flag]: event.target.checked })} />
    </label>)}
    {(selectedTool === "entry" || selectedTool === "exit") && <label>
      <span>Show price</span>
      <input type="checkbox" checked={style.showPrice !== false} onChange={event => onChange(selectedTool, { ...style, showPrice: event.target.checked })} />
    </label>}
  </>;
}
const names = {
  charts: "Charts",
  journal: "Journal",
  executions: "Executions",
  evidence: "Evidence",
  drawings: "Drawings",
};
const PanelContent = createContext<Record<string, ReactNode>>({});
function DockPanel(p: IDockviewPanelProps) {
  const content = useContext(PanelContent);
  return <>{content[p.api.id]}</>;
}
const dockComponents = { panel: DockPanel };
const DockControls = createContext({
  collapseTools: () => {},
  collapseJournal: () => {},
});
function DockHeaderActions(p: IDockviewHeaderActionsProps) {
  const controls = useContext(DockControls);
  const ids = p.group.panels.map((panel) => panel.id);
  if (
    ids.length &&
    ids.every((id) => reviewPanelIds.some((tool) => tool === id))
  )
    return (
      <button
        className="ws-dock-collapse"
        aria-label="Collapse review panels"
        title="Collapse executions, evidence and drawings"
        onClick={controls.collapseTools}
      >
        <ChevronDown size={14} />
      </button>
    );
  if (ids.length === 1 && ids[0] === "journal")
    return (
      <button
        className="ws-dock-collapse"
        aria-label="Collapse journal"
        title="Collapse journal"
        onClick={controls.collapseJournal}
      >
        <ChevronRight size={14} />
      </button>
    );
  return null;
}
const money = (value: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 2,
  }).format(value);
const time = (value: number) =>
  new Date(value * 1000).toISOString().slice(11, 19);
const date = (value: number) =>
  new Date(value * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    (ref.current?.querySelector<HTMLElement>("[data-autofocus]") ?? ref.current)?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); onClose(); }
      if (e.key === "Tab") {
        const nodes = ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea,[tabindex="0"]',
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          last.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      before?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="ws-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="ws-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <div className="ws-modal-heading">
          <h2>{title}</h2>
          <button aria-label="Close dialog" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function TradesWorkstation({
  trades: inputTrades,
  adapter,
  initialId,
  journalView = false,
  filterControls,
}: {
  trades: Trade[];
  adapter: WorkstationAdapter;
  initialId?: string | null;
  journalView?: boolean;
  filterControls?: TradeFilterControls;
}) {
  const trades = useMemo(() => newestTradesFirst(inputTrades), [inputTrades]);
  const [peerComparison, setPeerComparison] = useState<{ tradeId: string; selection: PeerGroupSelection; initial: PeerView } | null>(null);
  const peerCaptureGeneration = useRef(0);
  const appearance = useAppearance(adapter.mode);
  const setAppearance = appearance.setTheme;
  const { registerSave, setFocused } = useApplicationShell();
  const shortcuts = useShortcutPreferences(adapter.mode);
  const root = useRef<HTMLDivElement>(null);
  const [fullscreenChart, setFullscreenChart] = useState<string | null>(null);
  useEffect(() => {
    if (!fullscreenChart || !root.current) return;
    const restored: { element: HTMLElement; inert: boolean }[] = [];
    let child: HTMLElement | null = root.current.querySelector(`[data-chart-id="${fullscreenChart}"]`);
    while (child && child !== root.current && child.parentElement) {
      for (const sibling of Array.from(child.parentElement.children)) {
        if (sibling !== child && sibling instanceof HTMLElement && !sibling.matches(".ws-modal-backdrop,.ws-drawing-toolbar,.ws-drawing-properties")) {
          restored.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
      child = child.parentElement;
    }
    return () => restored.forEach(({ element, inert }) => { element.inert = inert; });
  }, [fullscreenChart]);
  const [selectedId, setSelectedId] = useState(
    initialId && trades.some((t) => t.id === initialId)
      ? initialId
      : (trades[0]?.id ?? ""),
  );
  const selectedTrade = trades.find((t) => t.id === selectedId) ?? trades[0];
  const [savedPreferences, setPreferences] = useState(defaultPreferences),
    [loadedPreferences, setLoadedPreferences] = useState(false);
  const preferences = useMemo(() => ({ ...savedPreferences, theme: appearance.theme }), [savedPreferences, appearance.theme]);
  const trade = selectedTrade;
  const marketMetrics = useRef<{ key: string; value?: MarketMetrics }>({ key: "" });
  const metricKey = trade ? metricIdentity(trade) : "";
  const receiveMetrics = useCallback((key: string, value: MarketMetrics | undefined) => { marketMetrics.current = { key, value }; }, []);
  const getMarketMetrics = useCallback(() => marketMetrics.current.key === metricKey ? marketMetrics.current.value : undefined, [metricKey]);
  const prefRef = useRef(preferences);
  prefRef.current = preferences;
  const [targetDate, setTargetDate] = useState(() =>
    new Date((trade?.openTime ?? Date.now() / 1000) * 1000)
      .toISOString()
      .slice(0, 16),
  );
  const [activeChart, setActiveChart] = useState("chart-1"),
    [tool, setTool] = useState<Tool>("cursor"),
    [selectedDrawing, setSelectedDrawing] = useState<string | null>(null),
    [selectedExecution, setSelectedExecution] = useState<string | null>(null);
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("All trades"),
    [checked, setChecked] = useState<string[]>([]);
  const appliedFilterKey = JSON.stringify(filterControls?.applied ?? {});
  const [filterDraft, setFilterDraft] = useState<WorkstationTradeFilters>(filterControls?.applied ?? {});
  const [filterError, setFilterError] = useState("");
  const [filterBusy, setFilterBusy] = useState(false);
  const [listDrawer, setListDrawer] = useState(false);
  const tradeListRef = useRef<HTMLElement>(null);
  useEffect(() => { setFilterDraft(JSON.parse(appliedFilterKey)); setFilterError(tradeFilterError(JSON.parse(appliedFilterKey))); }, [appliedFilterKey]);
  const [modal, setModal] = useState<
      "export" | "notion" | "attach" | "workspace" | "settings" | "help" | "reset" | "shortcuts" | "date" | null
    >(null),
    [notice, setNotice] = useState("");
  const [replay, setReplay] = useState<number | null>(null),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1);
  useEffect(() => { setPlaying(false); setReplay(null); }, [selectedTrade?.id, selectedTrade?.timeInterpretationVersion]);
  const [undo, setUndo] = useState<Drawing[][]>([]),
    [redo, setRedo] = useState<Drawing[][]>([]);
  const [layoutName, setLayoutName] = useState(""),
    [lockedLayout, setLockedLayout] = useState(true),
    [mobileTab, setMobileTab] = useState(journalView ? "Journal" : "Charts"),
    [isSmall, setIsSmall] = useState(false);
  const [exportScope, setExportScope] = useState("current"),
    [exportLight, setExportLight] = useState(false),
    [exportScale, setExportScale] = useState(2),
    [exportFormat, setExportFormat] = useState("package"),
    [exportHeaders, setExportHeaders] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState("");
  const [columns, setColumns] = useState(exportColumns),
    [exported, setExported] = useState<Record<string, number>>({});
  const handles = useRef(new Map<string, ChartHandle>()),
    dock = useRef<DockviewApi | null>(null),
    dockDispose = useRef<(() => void) | null>(null);
  const [notionPackage, setNotionPackage] = useState<{ csv: Blob; zip: Blob; name: string; revision: number } | null>(null);
  const operation = useRef(false);
  const reviewContext = useRef({ id: trade?.id, timeVersion: trade?.timeInterpretationVersion, generation: 0 });
  if (reviewContext.current.id !== trade?.id || reviewContext.current.timeVersion !== trade?.timeInterpretationVersion) reviewContext.current = { id: trade?.id, timeVersion: trade?.timeInterpretationVersion, generation: reviewContext.current.generation + 1 };
  useEffect(() => { peerCaptureGeneration.current++; setPeerComparison(null); }, [trade?.id, trade?.timeInterpretationVersion, replay]);
  useEffect(() => { setNotionPackage(null); setModal(value => value === "notion" || value === "attach" ? null : value); }, [trade?.id]);
  useEffect(() => () => { reviewContext.current.generation++; }, []);
  const pendingDate = useRef<{ tradeId: string; time: number; panel: string | null } | null>(null);
  const persistence = useTradeDocument(adapter, trade?.id ?? ""),
    documentState = persistence.document;
  const notify = useCallback((message: string) => setNotice(message), []),
    closeModal = useCallback(() => setModal(null), []);
  const changePreferences = useCallback(
    (patch: Partial<WorkspacePreferences>) => {
      if (patch.theme && !setAppearance(patch.theme)) setNotice("Appearance could not be saved on this device.");
      setPreferences((value) => ({ ...value, ...patch }));
    },
    [setAppearance],
  );
  const viewRanges = useRef<{ id: string; panels: TradeView["panels"] }>({ id: "", panels: [] });
  if (viewRanges.current.id !== (trade?.id ?? "")) viewRanges.current = { id: trade?.id ?? "", panels: [] };
  const restoreView = useCallback((view: TradeView) => {
    viewRanges.current.panels = view.panels;
    setPreferences(value => ({ ...value, ...viewPreferences(view) }));
  }, []);
  const viewState = useTradeView(adapter, trade?.id ?? "", loadedPreferences, restoreView);
  const normalView = useRef<{ tradeId: string; preferences: Partial<WorkspacePreferences>; panels: TradeView["panels"] } | null>(null);
  useEffect(() => {
    if (replay !== null && !normalView.current) normalView.current = { tradeId: trade?.id ?? "", preferences: { panels: prefRef.current.panels, chartArrangement: prefRef.current.chartArrangement, chartSizing: prefRef.current.chartSizing }, panels: structuredClone(viewRanges.current.panels) };
    if (replay === null && normalView.current) {
      const normal = normalView.current; normalView.current = null;
      if (normal.tradeId === trade?.id) { viewRanges.current.panels = normal.panels; setPreferences(value => ({ ...value, ...normal.preferences })); }
    }
  }, [replay, trade?.id]);
  const saveView = () => {
    if (!trade || replay !== null || !viewState.ready) return;
    const pref = prefRef.current;
    viewState.change({ version: 1, arrangement: pref.chartArrangement, sizing: restoreChartSizing(pref.chartSizing), panels: pref.panels.map(panel => ({ ...panel, session: panel.session ?? "auto", range: viewRanges.current.panels.find(p => p.id === panel.id && p.interval === panel.interval)?.range ?? null })) });
  };
  const viewConfiguration = JSON.stringify([preferences.panels, preferences.chartArrangement, preferences.chartSizing]);
  useEffect(() => { if (viewState.ready && replay === null) saveView(); }, [viewConfiguration, viewState.ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const register = useCallback((id: string, handle: ChartHandle | null) => {
    if (handle) handles.current.set(id, handle);
    else handles.current.delete(id);
  }, []);
  const peakCosts = useMemo(() => new Map(trades.map(t => {
    const cost = peakPositionCost(t);
    return [t.id, { ...cost, formatted: cost.value === null ? "—" : formatPeakPositionCost(cost.value, t.currency) }];
  })), [trades]);
  const filtered = useMemo(
    () =>
      trades.filter(
        (t) =>
          `${t.symbol} ${t.name} ${t.account}`
            .toLowerCase()
            .includes(query.toLowerCase()) &&
          (filter === "All trades" || (filter === "Unexported" && !exported[t.id])),
      ),
    [trades, query, filter, exported],
  );
  const prefetched = useRef(new Set<string>());
  const prefetchNext = (tradeId: string) => {
    if (pendingDate.current?.tradeId === tradeId) {
      const request = pendingDate.current; pendingDate.current = null;
      handles.current.forEach((handle, id) => { if (!request.panel || id === request.panel) handle.reveal({ time: request.time }); });
    }
    if (!adapter.cachedCandles || tradeId !== trade?.id) return;
    const index = filtered.findIndex(t => t.id === tradeId);
    for (const next of filtered.slice(index + 1, index + 3)) for (const panel of preferences.panels) {
      const candidate = { ...next, chartSession: tradeChartSession(next, panel.session) };
      const key = `${candidate.id}:${panel.interval}:${candidate.chartSession}:${candidate.timeInterpretationVersion}`;
      if (prefetched.current.has(key)) continue;
      if (prefetched.current.size >= 100) prefetched.current.delete(prefetched.current.values().next().value!);
      prefetched.current.add(key);
      void adapter.cachedCandles(candidate, panel.interval, undefined, initialHistoryRange(candidate, panel.interval)).catch(() => prefetched.current.delete(key));
    }
  };
  const preferenceKey = `execution-lab:workstation:preferences:${adapter.mode}:v1`;
  const flushReview = persistence.flush, flushView = viewState.flush;
  useEffect(() => registerSave(async () => { const saved = await flushReview(); if (saved) await flushView(); return saved; }), [registerSave, flushReview, flushView]);
  useEffect(() => { setFocused(!!trade && (preferences.focusMode || !!fullscreenChart)); return () => setFocused(false); }, [setFocused, preferences.focusMode, fullscreenChart, trade]);
  useEffect(() => {
    setSelectedId(current => initialId && trades.some(t => t.id === initialId) ? initialId : trades.some(t => t.id === current) ? current : trades[0]?.id ?? "");
  }, [trades, initialId]);
  useEffect(() => {
    // A filtered-out deep link must not keep naming the previous review in the URL.
    if (!initialId || trades.some(t => t.id === initialId)) return;
    const url = new URL(window.location.href);
    if (!url.pathname.endsWith("/trades")) return;
    if (trade) url.searchParams.set("groupKey", trade.id); else url.searchParams.delete("groupKey");
    window.history.replaceState({}, "", url);
  }, [trades, initialId, trade]);
  useEffect(() => {
    setSelectedExecution(null); setSelectedDrawing(null); setUndo([]); setRedo([]); setReplay(null); setPlaying(false); setFullscreenChart(null); setTool("cursor");
  }, [trade?.id]);
  useEffect(() => {
    if (!listDrawer || !tradeListRef.current) return;
    const previous = document.activeElement as HTMLElement | null;
    const list = tradeListRef.current;
    const restored: { element: HTMLElement; inert: boolean }[] = [];
    let child: HTMLElement | null = list;
    while (child?.parentElement && !child.classList.contains("application-shell")) {
      for (const sibling of Array.from(child.parentElement.children)) if (sibling !== child && sibling instanceof HTMLElement && !sibling.classList.contains("ws-list-backdrop")) { restored.push({ element: sibling, inert: sibling.inert }); sibling.inert = true; }
      child = child.parentElement;
    }
    list.querySelector<HTMLElement>("button,input")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setListDrawer(false); }
      if (event.key === "Tab") {
        const items = Array.from(list.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),select:not(:disabled)")).filter(el => el.getClientRects().length);
        const index = items.indexOf(document.activeElement as HTMLElement);
        if (items.length && ((event.shiftKey && index <= 0) || (!event.shiftKey && index === items.length - 1))) { event.preventDefault(); items[event.shiftKey ? items.length - 1 : 0].focus(); }
      }
    };
    document.addEventListener("keydown", key);
    return () => { restored.forEach(({ element, inert }) => { element.inert = inert; }); document.removeEventListener("keydown", key); previous?.focus(); };
  }, [listDrawer]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(preferenceKey);
      if (raw) {
        const { style: legacyStyle, ...parsed } = JSON.parse(raw);
        setPreferences({
          ...defaultPreferences(),
          ...parsed,
          drawingStyles: restoreDrawingStyles(parsed.drawingStyles, legacyStyle),
          chartLabels: restoreChartLabels(parsed.chartLabels, parsed.labels),
          dateLink: restoredDateLink(parsed.dateLink),
          chartSizing: restoreChartSizing(parsed.chartSizing),
          panels: restoreChartPanels(parsed.panels, parsed.chartSession),
          averages: restoreMovingAveragePeriods(parsed.averages),
          ...restoreChartDisplay(parsed),
        });
        if (parsed.exportColumns?.length) setColumns(parsed.exportColumns);
      }
      const ledger = localStorage.getItem(preferenceKey + ":exports");
      if (ledger) setExported(JSON.parse(ledger));
      const headers = localStorage.getItem(preferenceKey + ":headers");
      if (headers) setExportHeaders(JSON.parse(headers));
    } catch {
      notify(
        "Saved workspace settings could not be read. Defaults are in use.",
      );
    }
    setLoadedPreferences(true);
    const media = window.matchMedia("(max-width: 900px)");
    const update = () => setIsSmall(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [preferenceKey, notify]);
  useEffect(() => {
    if (loadedPreferences) {
      try {
        localStorage.setItem(preferenceKey, JSON.stringify(preferences));
      } catch {
        notify(
          "Workspace settings could not be saved: device storage is full.",
        );
      }
    }
  }, [preferences, loadedPreferences, preferenceKey, notify]);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 6500);
    return () => clearTimeout(timeout);
  }, [notice]);
  useEffect(() => () => dockDispose.current?.(), []);
  useEffect(() => {
    if (!playing || replay === null || !trade) return;
    const timer = setInterval(
      () =>
        setReplay((value) => {
          const next = (value ?? trade.openTime) + 300;
          if (next > trade.closeTime + 7200) {
            setPlaying(false);
            return trade.closeTime + 7200;
          }
          return next;
        }),
      1200 / speed,
    );
    return () => clearInterval(timer);
  }, [playing, replay, speed, trade]);
  const selectTrade = async (id: string) => {
    if (id === selectedId || busy) return;
    if (!(await persistence.flush())) {
      notify(
        "Resolve the save issue before switching trades. Your draft is preserved.",
      );
      return;
    }
    setFullscreenChart(null);
    await viewState.flush();
    setSelectedId(id);
    setListDrawer(false);
    const next = trades.find((candidate) => candidate.id === id);
    if (next)
      setTargetDate(new Date(next.openTime * 1000).toISOString().slice(0, 16));
    setSelectedDrawing(null);
    setSelectedExecution(null);
    setTool("cursor");
    setUndo([]);
    setRedo([]);
    setReplay(null);
    setPlaying(false);
    const url = new URL(window.location.href);
    url.searchParams.set("groupKey", id);
    window.history.replaceState({}, "", url);
  };
  const nextTrade = async () => {
    if (!(await persistence.flush())) return;
    const index = filtered.findIndex((t) => t.id === selectedId);
    if (index + 1 < filtered.length) await selectTrade(filtered[index + 1].id);
    else notify("Saved. You’ve reached the last trade in this view.");
  };
  const setDrawings = (drawings: Drawing[], history = true) => {
    if (!documentState || trade.stale) return;
    if (history) {
      setUndo((stack) => [...stack.slice(-49), documentState.drawings]);
      setRedo([]);
    }
    persistence.change((d) => ({ ...d, drawings }));
  };
  const saveDrawing = (drawing: Drawing) => {
    if (!documentState) return;
    setDrawings(
      documentState.drawings.some((d) => d.id === drawing.id)
        ? documentState.drawings.map((d) => (d.id === drawing.id ? drawing : d))
        : [...documentState.drawings, drawing],
    );
  };
  const undoDrawings = () => {
    if (!undo.length || !documentState) return;
    setRedo((stack) => [...stack, documentState.drawings]);
    setDrawings(undo[undo.length - 1], false);
    setUndo((stack) => stack.slice(0, -1));
    setSelectedDrawing(null);
  };
  const redoDrawings = () => {
    if (!redo.length || !documentState) return;
    setUndo((stack) => [...stack, documentState.drawings]);
    setDrawings(redo[redo.length - 1], false);
    setRedo((stack) => stack.slice(0, -1));
  };
  const focusExecution = (id: string) => {
    setSelectedExecution(id);
    handles.current.get(activeChart)?.inspect(id);
    const fill = trade.executions.find((e) => e.id === id);
    if (fill) {
      setTargetDate(new Date(fill.time * 1000).toISOString().slice(0, 16));
      handles.current.forEach((handle) => handle.reveal({ time: fill.time }));
    }
  };
  const executionStep = (offset: number) => {
    const visible = trade.executions.filter(
      (e) => replay === null || e.time <= replay,
    );
    if (!visible.length) return;
    const index = visible.findIndex((e) => e.id === selectedExecution);
    focusExecution(
      visible[Math.max(0, Math.min(visible.length - 1, index + offset))].id,
    );
  };
  const [chartAdjustments, setChartAdjustments] = useState<Record<string, SplitAdjustment | undefined>>({});
  const titleFor = (id: string, label: string) => {
    const binding = shortcuts.value.bindings[id];
    return `${label}${binding ? ` (${shortcutLabel(binding)})` : ""}`;
  };
  const runCommand = (id: string, chartId = activeChart) => {
    const command = commands.find(c => c.id === id);
    if (command?.tool) {
      handles.current.forEach(handle => handle.cancel());
      setTool(command.tool);
      handles.current.get(chartId)?.focus();
    } else if (id === "chart.fullscreen") {
      setActiveChart(chartId);
      setFullscreenChart(current => current === chartId ? null : chartId);
      handles.current.get(chartId)?.focus();
    } else if (id === "workspace.focus") {
      setFullscreenChart(null);
      changePreferences({ focusMode: !preferences.focusMode });
      handles.current.get(chartId)?.focus();
    } else if (id === "chart.beforeTrade" || id === "chart.fit" || id === "chart.session" || id === "chart.comparison" || id === "chart.labels") {
      const handle = handles.current.get(chartId);
      if (id === "chart.beforeTrade") handle?.beforeTrade();
      else if (id === "chart.fit") handle?.fit();
      else if (id === "chart.comparison") handle?.toggleComparison();
      else if (id === "chart.labels") handle?.toggleLabels();
      else handle?.toggleSession();
      handle?.focus();
    } else if (id === "chart.date") setModal("date");
    else if (id === "shortcuts.help") setModal("shortcuts");
    else if (id === "drawing.undo") undoDrawings();
    else if (id === "drawing.redo") redoDrawings();
    else if (id === "drawing.delete" && selectedDrawing) {
      const drawing = documentState?.drawings.find(d => d.id === selectedDrawing);
      if (drawing && !drawing.locked) {
        setDrawings(documentState!.drawings.filter(d => d.id !== selectedDrawing));
        setSelectedDrawing(null);
      }
    } else if (id === "review.next") void nextTrade();
    else if (id === "trade.next" || id === "trade.previous") {
      const index = filtered.findIndex(t => t.id === selectedId) + (id === "trade.next" ? 1 : -1);
      if (filtered[index]) void selectTrade(filtered[index].id);
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.repeat || e.getModifierState("AltGraph") || modal) return;
      const target = e.target instanceof Element ? e.target : null;
      if (!target || !root.current?.contains(target)) return;
      if (e.key === "Tab" && fullscreenChart) {
        const chart = root.current.querySelector<HTMLElement>(`[data-chart-id="${fullscreenChart}"]`);
        const areas = [chart, root.current.querySelector(".ws-drawing-toolbar"), root.current.querySelector(".ws-drawing-properties")].filter((area): area is HTMLElement => area instanceof HTMLElement);
        const nodes = chart ? [chart, ...areas.flatMap(area => Array.from(area.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled),a[href],[tabindex="0"]')))].filter(node => node.getClientRects().length && !node.closest("[inert]")) : [];
        const index = nodes.indexOf(document.activeElement as HTMLElement);
        if (nodes.length && ((e.shiftKey && index <= 0) || (!e.shiftKey && index === nodes.length - 1))) {
          e.preventDefault(); nodes[e.shiftKey ? nodes.length - 1 : 0].focus();
        }
        return;
      }
      if (e.key === "Escape") {
        const dateMenu = root.current.querySelector(".ws-date-control[open]");
        if (dateMenu) { dateMenu.removeAttribute("open"); handles.current.get(activeChart)?.focus(); }
        else if (root.current.querySelector(".ws-history-popover")) return;
        else if (typingTarget(target)) return;
        else if (tool !== "cursor" || selectedDrawing) {
          handles.current.forEach(handle => handle.cancel());
          setTool("cursor"); setSelectedDrawing(null);
        } else if (fullscreenChart) setFullscreenChart(null);
        else if (preferences.focusMode) changePreferences({ focusMode: false });
        e.preventDefault();
        return;
      }
      if (typingTarget(target) || target.closest('[role="dialog"],.ws-date-control[open],.ws-history-popover')) return;
      const chart = target.closest<HTMLElement>("[data-chart-id]");
      const command = matchCommand(e, shortcuts.value, chart ? "chart" : "workstation");
      if (!command) return;
      e.preventDefault();
      runCommand(command.id, chart?.dataset.chartId ?? activeChart);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const buildDock = useCallback((api: DockviewApi) => {
    api.clear();
    const charts = api.addPanel({
      id: "charts",
      component: "panel",
      title: "CHART WORKSPACE",
      minimumWidth: 320,
      minimumHeight: 260,
    });
    api.addPanel({
      id: "journal",
      component: "panel",
      title: "JOURNAL",
      position: { referencePanel: charts.id, direction: "right" },
      initialWidth: 322,
      minimumWidth: 270,
    });
    const executions = api.addPanel({
      id: "executions",
      component: "panel",
      title: "EXECUTIONS",
      position: { referencePanel: charts.id, direction: "below" },
      initialHeight: 174,
      minimumHeight: 100,
    });
    api.addPanel({
      id: "evidence",
      component: "panel",
      title: "EVIDENCE",
      position: { referencePanel: executions.id, direction: "within" },
    });
    api.addPanel({
      id: "drawings",
      component: "panel",
      title: "DRAWINGS",
      position: { referencePanel: executions.id, direction: "within" },
    });
    executions.api.setActive();
    charts.api.setActive();
    applyWorkspaceVisibility(api, prefRef.current);
  }, []);
  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      dockDispose.current?.();
      dock.current = event.api;
      try {
        if (prefRef.current.dock)
          event.api.fromJSON(prefRef.current.dock as SerializedDockview);
        else buildDock(event.api);
      } catch {
        buildDock(event.api);
      }
      applyWorkspaceVisibility(event.api, prefRef.current);
      const sub = event.api.onDidLayoutChange(() =>
        changePreferences({ dock: event.api.toJSON() }),
      );
      dockDispose.current = () => sub.dispose();
    },
    [buildDock, changePreferences],
  );
  useEffect(() => {
    if (dock.current && !isSmall)
      applyWorkspaceVisibility(dock.current, preferences);
  }, [preferences, isSmall]);
  const showPanel = (id: keyof typeof names) => {
    if (id === "journal")
      changePreferences({ journal: true, focusMode: false });
    if (reviewPanelIds.some((tool) => tool === id))
      changePreferences({ bottomCollapsed: false, focusMode: false });
    const api = dock.current;
    if (!api) {
      setMobileTab(names[id]);
      return;
    }
    let panel = api.getPanel(id);
    if (!panel)
      panel = api.addPanel({
        id,
        component: "panel",
        title: names[id].toUpperCase(),
        position: api.getPanel("charts")
          ? {
              referencePanel: "charts",
              direction: id === "journal" ? "right" : "below",
            }
          : undefined,
        initialWidth: id === "journal" ? 322 : undefined,
        initialHeight: id === "journal" ? undefined : 174,
      });
    panel.group.api.setVisible(true);
    panel.api.setActive();
  };
  const syncClickedDate = (source: string, target: ChartDateTarget) => {
    const mode = prefRef.current.dateLink;
    if (mode === "independent") return;
    setTargetDate(new Date(target.time * 1000).toISOString().slice(0, 16));
    handles.current.forEach((handle, id) => {
      if (id !== source) handle.reveal(target);
    });
  };
  const goToDate = () => {
    const target = Date.parse(`${targetDate}Z`) / 1000;
    if (!Number.isFinite(target)) return;
    if (!viewState.ready || !handles.current.size) { pendingDate.current = { tradeId: trade.id, time: target, panel: preferences.dateLink === "independent" ? activeChart : null }; return; }
    handles.current.forEach((handle, id) => {
      if (preferences.dateLink !== "independent" || id === activeChart)
        handle.reveal({ time: target });
    });
  };
  const fitAllCharts = () => {
    handles.current.forEach((handle) => handle.fit());
    setTargetDate(
      new Date((trade.openTime + trade.closeTime) * 500)
        .toISOString()
        .slice(0, 16),
    );
  };
  const setPanelCount = (count: number) => {
    changePreferences({
      panels: Array.from(
        { length: count },
        (_, i) =>
          preferences.panels[i] ?? {
            id: `chart-${i + 1}`,
            interval: (["5m", "1h", "1d", "1wk"] as Interval[])[i],
            session: "auto",
          },
      ),
    });
    if (!preferences.panels.slice(0, count).some((p) => p.id === activeChart))
      setActiveChart("chart-1");
  };
  const capture = async (kind: "active" | "layout" | "copy" | "attach", destination?: ReviewSectionKey) => {
    if (busy || operation.current) return;
    if (kind === "attach" && !destination) { setModal("attach"); return; }
    if (kind === "attach" && (trade.stale || replay !== null || !documentState)) { notify("Open an editable review before attaching a chart."); return; }
    const generation = reviewContext.current.generation;
    const assertCurrent = () => { if (reviewContext.current.generation !== generation) throw new Error("Chart capture cancelled because the selected trade changed."); };
    operation.current = true;
    setBusy("Preparing chart export…");
    try {
      if (kind === "attach" && !(await persistence.flush()))
        throw new Error("Save the review before attaching a chart.");
      assertCurrent();
      const selected =
        handles.current.get(activeChart) ??
        (handles.current.values().next().value as ChartHandle | undefined);
      if (!selected) throw new Error("Open a chart before exporting.");
      const layoutNodes = preferences.panels.map(p => root.current?.querySelector<HTMLElement>(`[data-chart-id="${p.id}"]`));
      const bounds = layoutNodes.map(node => {
        if (!node) throw new Error("A chart is not ready.");
        return { x: Number.parseFloat(node.style.left), y: Number.parseFloat(node.style.top), width: Number.parseFloat(node.style.width), height: Number.parseFloat(node.style.height) };
      });
      if (kind === "layout" && fullscreenChart) throw new Error("Restore the chart to export the complete layout. Active chart export is available in fullscreen.");
      const canvas = kind === "layout" ? compositeCharts(await Promise.all(preferences.panels.map((p, i) => {
        const handle = handles.current.get(p.id);
        if (!handle) throw new Error("A chart is not ready.");
        return handle.capture(exportLight || preferences.theme === "light", exportScale, bounds[i]);
      })), exportLight || preferences.theme === "light", bounds, exportScale)
        : await selected.capture(exportLight || preferences.theme === "light", exportScale);
      assertCurrent();
      const interval =
          preferences.panels.find((p) => p.id === activeChart)?.interval ??
          "5m",
        name = `${filename(trade)}_${kind === "layout" ? "layout" : interval}.png`;
      if (kind === "copy")
        notify(
          (await copyChart(canvas, name))
            ? "Chart copied. Paste it into Notion."
            : "Image clipboard unavailable. Your PNG has been downloaded.",
        );
      else if (kind === "attach") {
        const evidence = {
          id: crypto.randomUUID(),
          name: `${reviewSections.find(([key]) => key === destination)?.[1]} · ${name}`,
          image: canvas.toDataURL("image/png"),
          time: replay ?? Date.now() / 1000,
          revision: persistence.getDocument()?.revision ?? 0,
          timeframe: interval,
          timeInterpretationVersion: trade.timeInterpretationVersion ?? "original",
        };
        persistence.change(d => attachEvidence(d, evidence, destination!));
        if (await persistence.flush()) {
          assertCurrent();
          setModal(null);
          showPanel("evidence");
          notify("Annotated chart attached to this trade’s journal.");
        }
      } else {
        downloadBlob(await canvasBlob(canvas), name);
        notify("Annotated chart exported as PNG.");
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : "Chart export failed");
    } finally {
      operation.current = false;
      setBusy("");
    }
  };
  const getPeerWorkspaceView = (): PeerView => {
    const panel = preferences.panels.find(p => p.id === activeChart) ?? preferences.panels[0];
    const range = handles.current.get(panel.id)?.view() ?? initialHistoryRange(trade, panel.interval);
    return { range, interval: panel.interval, session: tradeChartSession(trade, panel.session), adjustment: chartAdjustments[panel.id] ? "split" : "raw", beforeEntry: panel.beforeEntry ?? false };
  };
  const selectPeerGroup = (peerGroupId: string) => {
    if (!trade.stale && replay === null && persistence.getDocument()?.review.notion?.peerGroupId !== peerGroupId) persistence.change(d => ({ ...d, review: { ...d.review, notion: { ...d.review.notion ?? emptyNotionReview(), peerGroupId } } }));
  };
  const openPeers = (selection: PeerGroupSelection) => {
    peerCaptureGeneration.current++;
    selectPeerGroup(selection.group.id);
    setPeerComparison({ tradeId: trade.id, selection, initial: getPeerWorkspaceView() });
  };
  const closePeers = () => { peerCaptureGeneration.current++; setPeerComparison(null); };
  const capturePeer = async (canvas: HTMLCanvasElement, metadata: PeerCapture) => {
    if (operation.current || trade.stale || replay !== null) throw new Error("Open an editable review and finish the current save before attaching.");
    const generation = reviewContext.current.generation, peerGeneration = peerCaptureGeneration.current;
    const assertCurrent = () => { if (generation !== reviewContext.current.generation || peerGeneration !== peerCaptureGeneration.current) throw new Error("Capture cancelled because the comparison or selected trade changed."); };
    operation.current = true;
    try {
      if (!(await persistence.flush())) throw new Error("Save the review before attaching a comparison.");
      assertCurrent();
      const evidence = { id: crypto.randomUUID(), name: `${metadata.symbols.join(" + ")} · ${metadata.interval} · ${metadata.groupName}`.slice(0, 240), image: canvas.toDataURL("image/png"), time: Date.now() / 1000, revision: persistence.getDocument()?.revision ?? 0, timeframe: metadata.interval, timeInterpretationVersion: trade.timeInterpretationVersion ?? "original", peerCapture: metadata };
      persistence.change(d => attachEvidence(d, evidence, "peers"));
      if (!(await persistence.flush())) throw new Error("The chart remains in your recovery draft. Retry saving the review.");
      assertCurrent(); notify("Comparison chart attached to Peers.");
    } finally { operation.current = false; }
  };
  const prepareNotionExport = async () => {
    if (busy || operation.current || replay !== null || !documentState) return;
    operation.current = true; setBusy("Preparing Notion export…");
    const generation = reviewContext.current.generation;
    try {
      if (!(await persistence.flush())) throw new Error("Save or recover the review before exporting to Notion.");
      if (generation !== reviewContext.current.generation) return;
      const doc = persistence.getDocument();
      if (!doc) throw new Error("Wait for the review to load.");
      const row = structuredClone({ trade, doc, url: window.location.href, metrics: getMarketMetrics() });
      setNotionPackage({ csv: new Blob([notionImportCsv(row)], { type: "text/csv;charset=utf-8" }), zip: notionPageArchive(row), name: filename(trade), revision: doc.revision });
      setModal("notion");
    } catch (e) { notify(e instanceof Error ? e.message : "Notion export failed."); }
    finally { operation.current = false; setBusy(""); }
  };
  const exportReviews = async () => {
    if (busy || replay !== null) return;
    setBusy("Preparing review export…");
    try {
      if (!(await persistence.flush()))
        throw new Error(
          "Save or recover your review before exporting the saved package.",
        );
      const chosen =
        exportScope === "filtered"
          ? filtered
          : exportScope === "selected"
            ? filtered.filter((t) => checked.includes(t.id))
            : [trade];
      if (!chosen.length) throw new Error("Select at least one trade.");
      const rows = await Promise.all(
        chosen.map(async (t) => ({
          trade: t,
          doc: await adapter.load(t.id),
          metrics: t.id === trade.id ? getMarketMetrics() : await adapter.metrics?.(t, new AbortController().signal).catch(() => undefined),
          url: `${window.location.origin}${adapter.mode === "demo" ? "/preview/trades" : "/trades"}?groupKey=${encodeURIComponent(t.id)}`,
        })),
      );
      if (exportFormat === "csv")
        downloadBlob(
          new Blob([reviewCsv(rows, columns, exportHeaders)], {
            type: "text/csv;charset=utf-8",
          }),
          "trade-reviews.csv",
        );
      else if (exportFormat === "markdown" && rows.length === 1)
        downloadBlob(
          new Blob([reviewMarkdown(rows[0].trade, rows[0].doc, rows[0].url, rows[0].metrics)], {
            type: "text/markdown;charset=utf-8",
          }),
          `${filename(rows[0].trade)}.md`,
        );
      else
        downloadBlob(
          await reviewArchive(rows, columns, exportHeaders),
          "trade-reviews.zip",
        );
      const ledger = { ...exported };
      rows.forEach((row) => {
        ledger[row.trade.id] = row.doc.revision;
      });
      setExported(ledger);
      localStorage.setItem(preferenceKey + ":exports", JSON.stringify(ledger));
      localStorage.setItem(
        preferenceKey + ":headers",
        JSON.stringify(exportHeaders),
      );
      changePreferences({ exportColumns: columns });
      notify(
        `${rows.length} review${rows.length === 1 ? "" : "s"} exported. Notion CSV imports add new rows.`,
      );
    } catch (e) {
      notify(e instanceof Error ? e.message : "Review export failed");
    } finally {
      setBusy("");
    }
  };
  const applyTradeFilters = async (draft: WorkstationTradeFilters, clear = false) => {
    if (filterBusy || filterControls?.pending) return;
    const next = normalizeWorkstationFilters(draft);
    const error = tradeFilterError(next);
    setFilterError(error);
    if (error) { changePreferences({ filtersExpanded: true }); return; }
    setFilterBusy(true);
    try {
      if (!(await persistence.flush())) { setFilterError("Resolve the review save issue before applying filters. Your draft is preserved."); return; }
      await viewState.flush();
      if (clear) { setQuery(""); setFilter("All trades"); }
      setFilterDraft(next);
      filterControls?.apply(next, trade?.id ?? "");
    } finally { setFilterBusy(false); }
  };
  const renderFilters = () => <WorkstationFilterControls applied={filterControls?.applied ?? {}} draft={filterDraft} onDraft={setFilterDraft} expanded={!!preferences.filtersExpanded} onExpanded={value => changePreferences({ filtersExpanded: value })} pending={filterBusy || !!filterControls?.pending} error={filterError} onApply={value => void applyTradeFilters(value)} onClear={() => void applyTradeFilters({}, true)} view={filter} onView={setFilter} count={filtered.length} />;
  if (!trade) return <div ref={root} className={`workstation ws-${preferences.theme} ws-empty-workstation`}>
    <div className="ws-app"><div className="ws-empty-topbar"><Activity size={16} /><span>Trade workspace</span></div><div className="ws-work-area">
      <aside className="ws-trade-list ws-empty-trade-list" ref={tradeListRef}><div className="ws-list-heading"><span>YOUR TRADES</span></div>{renderFilters()}<div className="ws-trades-scroll"><div className="ws-empty">No matching trades.</div></div></aside>
      <div className="ws-empty-results"><ListFilter size={28} /><h2>No trades match these filters</h2><p>Adjust your filters to find a trade to review.</p><button className="ws-primary" disabled={filterBusy || filterControls?.pending} onClick={() => void applyTradeFilters({}, true)}>Clear all filters</button></div>
    </div></div>
  </div>;
  const chosenDrawing = documentState?.drawings.find(
    (d) => d.id === selectedDrawing,
  );
  const currentPanel =
    preferences.panels.find((p) => p.id === activeChart) ??
    preferences.panels[0];
  const dayPnl = filtered.reduce((sum, t) => sum + t.pnl, 0);
  const activeLabels = chartLabelMode(preferences, currentPanel.id);
  const setChartLabels = (id: string, mode: LabelMode) => setPreferences(value => ({
    ...value, chartLabels: { ...restoreChartLabels(value.chartLabels, value.labels), [id as ChartSlot]: mode },
  }));
  const toggleLabels = (id = currentPanel.id) => setChartLabels(id, chartLabelMode(preferences, id) === "labels" ? "compact" : "labels");
  const chartContent = (
    <div className="ws-chart-workspace">
      {adapter.metrics && <TradeMarketMetrics adapter={adapter} trade={trade} onValue={receiveMetrics} />}
      <div className="ws-chart-toolbar">
        <div className="ws-timeframes">
          {intervals.map((interval) => (
            <button
              key={interval}
              className={currentPanel.interval === interval ? "active" : ""}
              onClick={() =>
                changePreferences({
                  panels: preferences.panels.map((p) =>
                    p.id === currentPanel.id ? { ...p, interval } : p,
                  ),
                })
              }
            >
              {interval}
            </button>
          ))}
        </div>
        <span className="ws-toolbar-divider" />
        <button
          className={`ws-tool-button ${preferences.linked ? "active" : ""}`}
          title="Link time crosshairs across charts"
          aria-label="Link chart crosshairs"
          onClick={() => changePreferences({ linked: !preferences.linked })}
        >
          <Crosshair size={14} />
          <span>Crosshair</span>
        </button>
        <button
          className="ws-tool-button"
          onClick={fitAllCharts}
          aria-label="Fit all charts to trade"
        >
          <Maximize2 size={13} />
          <span>Fit trade</span>
        </button>
        <button className={`ws-tool-button ${activeLabels === "labels" ? "active" : ""}`} aria-label={activeLabels === "labels" ? "Hide execution labels" : "Show execution labels"} aria-pressed={activeLabels === "labels"} title={titleFor("chart.labels", `Toggle labels on active chart (${currentPanel.id}); markers remain visible`)} onClick={() => toggleLabels()}>{activeLabels === "labels" ? <Eye size={14} /> : <EyeOff size={14} />}<span>Labels</span></button>
        <button className="ws-session-apply" aria-label="Apply active chart’s session to all charts" title={`Apply ${currentPanel.session ?? "auto"} from ${currentPanel.id} to all charts`} onClick={() => changePreferences({ panels: preferences.panels.map(panel => ({ ...panel, session: currentPanel.session ?? "auto" })) })}>Apply session to all</button>
        <span className="ws-flex-spacer" />
        <details className="ws-date-control">
          <summary
            aria-label="Date synchronization"
            title="Link dates and go to a target date"
          >
            <CalendarDays size={14} />
            <span>
              {preferences.dateLink === "target"
                ? "Click to sync"
                : "Independent"}
            </span>
          </summary>
          <div className="ws-date-popover">
            <label>
              Date linking
              <select
                aria-label="Date linking"
                value={preferences.dateLink}
                onChange={(e) => {
                  const dateLink = e.target
                    .value as WorkspacePreferences["dateLink"];
                  changePreferences({ dateLink });
                }}
              >
                <option value="independent">Independent windows</option>
                <option value="target">Link clicked date</option>
              </select>
            </label>
            <label>
              Target date · UTC
              <input
                type="datetime-local"
                aria-label="Target date UTC"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
              />
            </label>
            <button className="ws-primary" onClick={goToDate}>
              Go to date
            </button>
            <p>
              {preferences.dateLink === "target"
                ? "Click a candle to show its date in the other charts. Charts already showing it stay put. Each chart keeps its own zoom; panning and zooming never move the others."
                : "Chart clicks and date navigation affect only the active chart. Panning and zooming remain independent."}
            </p>
          </div>
        </details>
        <button
          className={`ws-tool-button ${preferences.focusMode ? "active" : ""}`}
          aria-label={
            preferences.focusMode ? "Exit chart focus" : "Chart focus"
          }
          title={titleFor("workspace.focus", preferences.focusMode ? "Restore workspace panels" : "Maximize all charts")}
          onClick={() => runCommand("workspace.focus")}
        >
          {preferences.focusMode ? (
            <Minimize2 size={15} />
          ) : (
            <Maximize2 size={15} />
          )}
          <span>{preferences.focusMode ? "Restore" : "Focus"}</span>
        </button>
        <button
          className="ws-tool-button"
          aria-label="Chart settings"
          onClick={() => setModal("settings")}
        >
          <Settings2 size={14} />
        </button>
        <select
          className="ws-layout-select"
          aria-label="Number of charts"
          value={preferences.panels.length}
          onChange={(e) => setPanelCount(Number(e.target.value))}
        >
          {[1, 2, 3, 4].map((n) => (
            <option value={n} key={n}>
              {n} chart{n > 1 ? "s" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="ws-chart-body">
        <div
          className="ws-drawing-toolbar"
          role="toolbar"
          aria-label="Drawing tools"
        >
          {tools.map((t) => (
            <button
              key={t.id}
              className={tool === t.id ? "active" : ""}
              title={titleFor(`tool.${t.id}`, t.label)}
              aria-label={t.label}
              aria-pressed={tool === t.id}
              onClick={() => runCommand(`tool.${t.id}`)}
            >
              <t.icon size={17} style={t.id === "exit" ? { transform: "rotate(180deg)" } : undefined} />
              {preferences.favorites.includes(t.id) && <i />}
            </button>
          ))}
          <span />
          <button
            title="Magnet to OHLC"
            aria-label="Magnet to OHLC"
            className={preferences.magnet ? "active" : ""}
            onClick={() => changePreferences({ magnet: !preferences.magnet })}
          >
            <Magnet size={16} />
          </button>
          <button
            aria-label="Undo drawing"
            title={titleFor("drawing.undo", "Undo drawing")}
            disabled={!undo.length}
            onClick={() => runCommand("drawing.undo")}
          >
            <Undo2 size={16} />
          </button>
          <button
            aria-label="Redo drawing"
            title={titleFor("drawing.redo", "Redo drawing")}
            disabled={!redo.length}
            onClick={() => runCommand("drawing.redo")}
          >
            <Redo2 size={16} />
          </button>
        </div>
        <ResizableChartGrid count={preferences.panels.length} arrangement={preferences.chartArrangement} sizing={preferences.chartSizing} onChange={chartSizing => changePreferences({ chartSizing })}>
          {styles => viewState.ready ? preferences.panels.map((panel, index) => (
            <TradeChart
              key={`${trade.id}:${panel.id}:${viewState.generation}`}
              initialRange={viewRanges.current.panels.find(p => p.id === panel.id && p.interval === panel.interval)?.range}
              onViewChange={range => {
                if (replay !== null) return;
                const next = { ...panel, session: panel.session ?? "auto" as const, range };
                viewRanges.current.panels = [...viewRanges.current.panels.filter(p => p.id !== panel.id), next];
                saveView();
              }}
              style={styles[index]}
              onToggleLabels={() => toggleLabels(panel.id)}
              onPriceAdjustment={adjustment => setChartAdjustments(current => current[panel.id] === adjustment ? current : { ...current, [panel.id]: adjustment })}
              labelMode={chartLabelMode(preferences, panel.id)}
              onHistoryReady={prefetchNext}
              panel={panel}
              trade={trade}
              adapter={adapter}
              preferences={preferences}
              drawings={documentState?.drawings ?? []}
              selected={selectedDrawing}
              selectedExecution={selectedExecution}
              tool={tool}
              replay={replay}
              active={activeChart === panel.id}
              fullscreen={fullscreenChart === panel.id}
              onFullscreen={() => runCommand("chart.fullscreen", panel.id)}
              fullscreenTitle={titleFor("chart.fullscreen", fullscreenChart === panel.id ? "Restore chart" : "Fullscreen chart")}
              beforeTradeTitle={titleFor("chart.beforeTrade", "Before Trade — exclude the first execution candle and all later candles")}
              fitTitle={titleFor("chart.fit", "Fit trade")}
              labelsTitle={titleFor("chart.labels", "Toggle execution labels; markers remain visible")}
              comparisonTitle={titleFor("chart.comparison", "Toggle index comparison")}
              sessionTitle={titleFor("chart.session", "Toggle Regular / Extended hours")}
              onActive={() => setActiveChart(panel.id)}
              onDateClick={(target) => syncClickedDate(panel.id, target)}
              onPanel={patch => changePreferences({ panels: preferences.panels.map(p => p.id === panel.id ? { ...p, ...patch } : p) })}
              onInterval={(interval) =>
                changePreferences({
                  panels: preferences.panels.map((p) =>
                    p.id === panel.id ? { ...p, interval } : p,
                  ),
                })
              }
              onDrawing={saveDrawing}
              onSelect={setSelectedDrawing}
              onExecution={focusExecution}
              onToolDone={() => setTool("cursor")}
              register={register}
              onDownload={() => {
                setActiveChart(panel.id);
                setModal("export");
              }}
            />
          )) : <div role="status">Restoring chart views…</div>}
        </ResizableChartGrid>
      </div>
      {viewState.error && <div role="status" className="ws-history-warning">{viewState.error} <button onClick={viewState.useSaved}>Use saved chart view</button></div>}
      {chosenDrawing && (
        <div className="ws-drawing-properties">
          <span>{tools.find((t) => t.id === chosenDrawing.tool)?.label}</span>
          <DrawingCoordinates drawing={splitAdjustedDrawing(chosenDrawing, chartAdjustments[activeChart])} onChange={drawing => saveDrawing(splitAdjustedDrawing(drawing, chartAdjustments[activeChart], true))} />
          <input
            key={chosenDrawing.id}
            autoFocus={chosenDrawing.tool === "text"}
            aria-label="Annotation text"
            value={chosenDrawing.text}
            placeholder="Add a note or label…"
            maxLength={500}
            disabled={chosenDrawing.locked}
            onChange={(e) =>
              saveDrawing({ ...chosenDrawing, text: e.target.value })
            }
          />
          <input
            type="color"
            aria-label="Annotation color"
            value={chosenDrawing.color}
            disabled={chosenDrawing.locked}
            onChange={(e) =>
              saveDrawing({ ...chosenDrawing, color: e.target.value })
            }
          />
          {chosenDrawing.tool === "ray" && (
            <label className="ws-drawing-label-toggle">
              <input type="checkbox" checked={chosenDrawing.showDefaultLabel !== false} disabled={chosenDrawing.locked}
                onChange={event => saveDrawing({ ...chosenDrawing, showDefaultLabel: event.target.checked })} />
              Show automatic label
            </label>
          )}
          {chosenDrawing.tool === "measure" && (["extendLeft", "extendRight"] as const).map(flag => (
            <label key={flag} className="ws-drawing-label-toggle">
              <input type="checkbox" checked={chosenDrawing[flag] === true} disabled={chosenDrawing.locked}
                onChange={event => saveDrawing({ ...chosenDrawing, [flag]: event.target.checked })} />
              {flag === "extendLeft" ? "Extend left" : "Extend right"}
            </label>
          ))}
          {(chosenDrawing.tool === "entry" || chosenDrawing.tool === "exit") && (
            <label className="ws-drawing-label-toggle">
              <input type="checkbox" checked={chosenDrawing.showPrice !== false} disabled={chosenDrawing.locked}
                onChange={event => saveDrawing({ ...chosenDrawing, showPrice: event.target.checked })} />
              Show price
            </label>
          )}
          <select
            aria-label="Annotation width"
            value={chosenDrawing.width}
            disabled={chosenDrawing.locked}
            onChange={(e) =>
              saveDrawing({ ...chosenDrawing, width: Number(e.target.value) })
            }
          >
            {[1, 1.5, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}px
              </option>
            ))}
          </select>
          <select
            aria-label="Annotation visibility"
            value={chosenDrawing.panel ?? "all"}
            disabled={chosenDrawing.locked}
            onChange={(e) =>
              saveDrawing({
                ...chosenDrawing,
                panel: e.target.value === "all" ? null : e.target.value,
              })
            }
          >
            <option value="all">All trade charts</option>
            {preferences.panels.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id} · {p.interval}
              </option>
            ))}
          </select>
          <button
            title="Toggle dashed line"
            onClick={() =>
              saveDrawing({ ...chosenDrawing, dashed: !chosenDrawing.dashed })
            }
            disabled={chosenDrawing.locked}
          >
            ┄
          </button>
          <button
            title={`Save drawing style as default for ${tools.find(t => t.id === chosenDrawing.tool)?.label}`}
            onClick={() => {
              changePreferences({
                drawingStyles: {
                  ...preferences.drawingStyles,
                  [chosenDrawing.tool]: drawingStyle(chosenDrawing.tool, chosenDrawing),
                },
                favorites: [
                  ...new Set([...preferences.favorites, chosenDrawing.tool]),
                ],
              });
              notify(`${tools.find(t => t.id === chosenDrawing.tool)?.label} default style saved.`);
            }}
          >
            <Star size={14} />
          </button>
          <button
            title="Duplicate drawing"
            onClick={() => {
              const duplicate = {
                ...chosenDrawing,
                id: crypto.randomUUID(),
                locked: false,
                points: chosenDrawing.points.map((p) => ({
                  ...p,
                  time: p.time + seconds[currentPanel.interval],
                })),
              };
              saveDrawing(duplicate);
              setSelectedDrawing(duplicate.id);
            }}
          >
            <Copy size={14} />
          </button>
          <button
            title={chosenDrawing.locked ? "Unlock drawing" : "Lock drawing"}
            onClick={() =>
              saveDrawing({ ...chosenDrawing, locked: !chosenDrawing.locked })
            }
          >
            {chosenDrawing.locked ? (
              <LockKeyhole size={14} />
            ) : (
              <UnlockKeyhole size={14} />
            )}
          </button>
          <button
            title="Delete drawing"
            disabled={chosenDrawing.locked}
            onClick={() => {
              setDrawings(
                documentState!.drawings.filter(
                  (d) => d.id !== chosenDrawing.id,
                ),
              );
              setSelectedDrawing(null);
            }}
          >
            <Trash2 size={14} />
          </button>
          <button
            aria-label="Close annotation properties"
            onClick={() => { setSelectedDrawing(null); handles.current.get(activeChart)?.focus(); }}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div className="ws-replay-bar">
        <button
          className={replay !== null ? "active" : ""}
          onClick={() => {
            setPlaying(false);
            setReplay(
              replay === null
                ? Math.floor((trade.openTime - 1800) / 300) * 300
                : null,
            );
            setTool("cursor");
          }}
        >
          {replay === null ? <Play size={13} /> : <X size={13} />}
          {replay === null ? "Replay trade" : "Exit replay"}
        </button>
        {replay !== null ? (
          <>
            <button
              aria-label={playing ? "Pause replay" : "Play replay"}
              onClick={() => setPlaying((v) => !v)}
            >
              {playing ? <Pause size={13} /> : <Play size={13} />}
            </button>
            <button
              aria-label="Next replay candle"
              onClick={() =>
                setReplay((v) =>
                  Math.min(trade.closeTime + 7200, (v ?? trade.openTime) + 300),
                )
              }
            >
              <ChevronRight size={15} />
            </button>
            <input
              aria-label="Replay time"
              type="range"
              min={trade.openTime - 1800}
              max={trade.closeTime + 7200}
              step={300}
              value={replay}
              onChange={(e) => {
                setPlaying(false);
                setReplay(Number(e.target.value));
              }}
            />
            <span>{time(replay)} UTC</span>
            <select
              aria-label="Replay speed"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            >
              {[1, 2, 4, 8].map((n) => (
                <option key={n} value={n}>
                  {n}×
                </option>
              ))}
            </select>
          </>
        ) : (
          <>
            <span className="ws-tool-hint">
              {tool === "cursor"
                ? "Scroll to zoom · drag to pan · select a drawing to edit"
                : `${tools.find((t) => t.id === tool)?.label} · ${["trend", "arrow", "zone", "measure", "long", "short"].includes(tool) ? "click a start and end point" : "click to place"} · Esc to cancel`}
            </span>
            <span className="ws-flex-spacer" />
            <span>UTC</span>

          </>
        )}
      </div>
    </div>
  );
  const journalContent = documentState ? (
    <ConnectedReviewEditor
      getMetrics={getMarketMetrics}
      key={trade.id}
      trade={trade}
      persistence={persistence}
      onChange={(update) => {
        if (!trade.stale) persistence.change((d) => ({ ...d, review: update(d.review) }));
      }}
      retry={() => void persistence.retry()}
      reload={() => void persistence.reload()}
      onSaveNext={() => runCommand("review.next")}
      saveNextShortcut={shortcutLabel(shortcuts.value.bindings["review.next"])}
      onEvidence={section => void capture("attach", section)}
      onComparePeers={openPeers}
      onNotionExport={() => void prepareNotionExport()}
      preferences={preferences}
      onPreferences={changePreferences}
      replay={replay}
      mode={adapter.mode}
      notify={notify}
    />
  ) : (
    <div className="ws-empty">
      {persistence.error || "Loading review…"}
      {persistence.error && (
        <button onClick={() => void persistence.reload()}>Retry</button>
      )}
    </div>
  );
  const executionsContent = (
    <div className="ws-executions">
      <div className="ws-executions-toolbar">
        <span>
          {
            trade.executions.filter((e) => replay === null || e.time <= replay)
              .length
          }{" "}
          fills <b>·</b> Workstation times in UTC
        </span>
        <div>
          <button
            title="First execution"
            onClick={() => {
              if (
                trade.executions[0] &&
                (replay === null || trade.executions[0].time <= replay)
              )
                focusExecution(trade.executions[0].id);
            }}
          >
            First
          </button>
          <button
            aria-label="Previous execution"
            onClick={() => executionStep(-1)}
          >
            <ChevronLeft size={14} />
          </button>
          <button aria-label="Next execution" onClick={() => executionStep(1)}>
            <ChevronRight size={14} />
          </button>
          <select
            aria-label="Execution label mode for active chart"
            title={`Execution labels for ${currentPanel.id}`}
            value={activeLabels}
            onChange={(e) =>
              setChartLabels(currentPanel.id, e.target.value as LabelMode)
            }
          >
            <option value="labels">Labels on chart</option>
            <option value="compact">Compact markers</option>
            <option value="hidden">Hide markers</option>
          </select>
        </div>
      </div>
      <div className="ws-table-scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Time (UTC)</th>
              <th>Side</th>
              <th>Quantity</th>
              <th>Price</th>
              <th>Value</th>
              <th>Fees</th>
              <th>Execution</th>
            </tr>
          </thead>
          <tbody>
            {trade.executions
              .filter((e) => replay === null || e.time <= replay)
              .map((e, i) => (
                <tr
                  key={e.id}
                  className={selectedExecution === e.id ? "active" : ""}
                  onClick={() => focusExecution(e.id)}
                >
                  <td>
                    <button
                      aria-label={`Focus execution ${i + 1}`}
                      onClick={() => focusExecution(e.id)}
                    >
                      {i + 1}
                    </button>
                  </td>
                  <td title={executionTimezoneLabel(e)}>{new Date(e.time * 1000).toISOString().slice(0, 19).replace("T", " ")}{!executionTimeResolved(e) && <span className="ws-diagnostic-warning"> *</span>}</td>
                  <td>
                    <span className={`ws-side ${e.side.toLowerCase()}`}>
                      {e.side === "BUY" ? "↗ Buy" : "↘ Sell"}
                    </span>
                  </td>
                  <td>{e.quantity}</td>
                  <td>{money(e.price, trade.currency)}</td>
                  <td>{money(e.quantity * e.price, trade.currency)}</td>
                  <td>{money(e.commission + e.fees, trade.currency)}</td>
                  <td className="ws-muted">{e.id}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
  const evidenceContent = (
    <div className="ws-evidence">
      <div className="ws-executions-toolbar">
        <span>Charts saved with this review</span>
        <button onClick={() => void capture("attach")}>
          <Camera size={14} /> Capture chart
        </button>
      </div>
      {!documentState?.evidence.length ? (
        <div className="ws-empty">
          <ImageIcon size={23} />
          <p>Keep the chart behind the decision.</p>
          <span>
            Attach an annotated snapshot, then include it in your Notion export.
          </span>
        </div>
      ) : (
        <div className="ws-evidence-grid">
          {documentState.evidence
            .filter((e) => replay === null || e.time <= replay)
            .map((e) => (
              <div key={e.id}>
                <a href={e.image} download={e.name}>
                  <Image
                    unoptimized
                    width={160}
                    height={85}
                    src={e.image}
                    alt={`Annotated ${trade.symbol} ${e.timeframe} chart`}
                  />
                </a>
                <span>
                  {e.timeframe} · r{e.revision}
                  {e.timeInterpretationVersion !== (trade.timeInterpretationVersion ?? "original") && (e.timeInterpretationVersion || trade.executions.some(fill => fill.provenance?.interpretationStatus === "applied")) && <small>Earlier timestamp basis</small>}
                  <button
                    title="Download chart"
                    onClick={() => {
                      const a = window.document.createElement("a");
                      a.href = e.image;
                      a.download = e.name;
                      a.click();
                    }}
                  >
                    <Download size={12} />
                  </button>
                  <button
                    title="Remove attachment"
                    onClick={() =>
                      persistence.change(d => removeEvidence(d, e.id))
                    }
                  >
                    <Trash2 size={12} />
                  </button>
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
  const drawingsContent = (
    <div className="ws-object-list">
      {documentState?.drawings
        .filter((d) => replay === null || d.createdAt <= replay)
        .map((d) => {
          const shown = splitAdjustedDrawing(d, chartAdjustments[d.panel ?? activeChart]);
          return (
          <div key={d.id} className={d.id === selectedDrawing ? "active" : ""}>
            <button
              onClick={() => {
                setSelectedDrawing(d.id);
                setTool("cursor");
                if (d.panel) setActiveChart(d.panel);
              }}
            >
              <i style={{ background: d.color }} />
              <span>
                {d.text || tools.find((t) => t.id === d.tool)?.label}
                <small>
                  {d.tool === "measure" && d.points[1]
                    ? measureText(shown.points[0], shown.points[1])
                    : d.tool === "long" || d.tool === "short"
                      ? `${riskReward(shown)?.ratio?.toFixed(2) ?? "—"}R`
                      : `${shown.points[0]?.price.toFixed(2)} · ${d.panel ?? "All trade charts"}`}
                </small>
              </span>
            </button>
            <button
              aria-label={d.hidden ? "Show drawing" : "Hide drawing"}
              onClick={() => saveDrawing({ ...d, hidden: !d.hidden })}
            >
              {d.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button
              aria-label={d.locked ? "Unlock drawing" : "Lock drawing"}
              onClick={() => saveDrawing({ ...d, locked: !d.locked })}
            >
              {d.locked ? (
                <LockKeyhole size={14} />
              ) : (
                <UnlockKeyhole size={14} />
              )}
            </button>
            <button
              aria-label="Delete drawing"
              disabled={d.locked}
              onClick={() =>
                setDrawings(
                  documentState!.drawings.filter((item) => item.id !== d.id),
                )
              }
            >
              <Trash2 size={14} />
            </button>
          </div>
        ); })}
      {!documentState?.drawings.length && (
        <div className="ws-empty">Add a drawing from the chart toolbar.</div>
      )}
    </div>
  );
  const content = {
    charts: chartContent,
    journal: journalContent,
    executions: executionsContent,
    evidence: evidenceContent,
    drawings: drawingsContent,
  };
  return (
    <div
      ref={root}
      className={`workstation ws-${preferences.theme} ${fullscreenChart ? "ws-has-fullscreen" : ""} ${!preferences.heading ? "ws-heading-collapsed" : ""} ${preferences.focusMode ? "ws-focus" : ""} ${adapter.mode === "application" ? "ws-embedded" : ""}`}
    >
      <div className="ws-app">
        <header className="ws-topbar">
          <div className="ws-breadcrumb">
            <span>Execution Lab</span>
            <ChevronRight size={12} />
            <strong>Trade workspace</strong>
          </div>
          <div className="ws-topbar-right">
            <button title="Help & shortcuts" aria-label="Help & shortcuts" onClick={() => setModal("help")}><CircleHelp size={15} /></button>
            <button
              aria-label={
                preferences.heading ? "Hide page title" : "Show page title"
              }
              title={
                preferences.heading ? "Hide page title" : "Show page title"
              }
              aria-expanded={preferences.heading}
              onClick={() =>
                changePreferences({ heading: !preferences.heading })
              }
            >
              {preferences.heading ? (
                <ChevronUp size={14} />
              ) : (
                <ChevronDown size={14} />
              )}
            </button>
            {adapter.mode === "demo" && (
              <span className="ws-demo-badge">
                <span /> Demo data
              </span>
            )}
            <span className="ws-timezone">UTC</span>
            <button onClick={() => setModal("workspace")}>
              <Grid2X2 size={14} /> My workspace <ChevronDown size={12} />
            </button>
            {!preferences.heading && (
              <>
                <button
                  aria-label={lockedLayout ? "Customize layout" : "Lock layout"}
                  title={lockedLayout ? "Customize layout" : "Lock layout"}
                  onClick={() => setLockedLayout((v) => !v)}
                >
                  {lockedLayout ? (
                    <LockKeyhole size={14} />
                  ) : (
                    <UnlockKeyhole size={14} />
                  )}
                </button>
                <button
                  className="ws-compact-export"
                  onClick={() => setModal("export")}
                >
                  <Download size={14} />
                  <span>Export</span>
                </button>
              </>
            )}
          </div>
        </header>
        <div className="ws-page-heading" hidden={!preferences.heading}>
          <div>
            <div className="ws-title-row">
              <h1>
                Trades<span>.</span>
              </h1>
              <span className="ws-count">{trades.length}</span>
            </div>
            <p>See the execution. Understand the decision.</p>
          </div>
          <div className="ws-heading-actions">
            <button
              className="ws-secondary"
              onClick={() => {
                setLockedLayout((v) => !v);
                notify(
                  lockedLayout
                    ? "Layout unlocked. Drag panel tabs and resize dividers."
                    : "Panel dragging locked.",
                );
              }}
            >
              {lockedLayout ? (
                <LockKeyhole size={14} />
              ) : (
                <UnlockKeyhole size={14} />
              )}
              <span>{lockedLayout ? "Customize" : "Lock layout"}</span>
            </button>
            <button className="ws-primary" onClick={() => setModal("export")}>
              <Download size={14} /> Export <ChevronDown size={13} />
            </button>
          </div>
        </div>
        <div className="ws-work-area">
          {listDrawer && <div className="ws-list-backdrop" onClick={() => setListDrawer(false)} />}
          {(preferences.list || listDrawer) && (
            <aside ref={tradeListRef} className={`ws-trade-list ${listDrawer ? "ws-list-open" : ""}`} role={listDrawer ? "dialog" : undefined} aria-modal={listDrawer || undefined} aria-label={listDrawer ? "Your trades" : undefined}>
              <div className="ws-list-heading">
                <span>YOUR TRADES</span>
                <button
                  title="Collapse trade list"
                  onClick={() => { changePreferences({ list: false }); setListDrawer(false); }}
                >
                  <PanelLeftClose size={14} />
                </button>
              </div>
              <div className="ws-search">
                <Search size={14} />
                <input
                  aria-label="Search trades"
                  placeholder="Search symbol or account"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <kbd>⌕</kbd>
              </div>
              {renderFilters()}
              <div className="ws-list-summary">
                <span>Realized P&L</span>
                <b className={dayPnl >= 0 ? "positive" : "negative"}>
                  {replay !== null ? "Hidden in replay" : money(dayPnl)}
                </b>
              </div>
              <div className="ws-trades-scroll">
                {filtered.map((t, i) => (
                  <div key={t.id}>
                    <div className="ws-list-date">
                      {i === 0 ||
                      date(filtered[i - 1].openTime) !== date(t.openTime)
                        ? date(t.openTime)
                        : null}
                    </div>
                    <div
                      className={`ws-trade-card ${t.id === trade.id ? "active" : ""}`}
                    >
                      <input
                        className="ws-trade-checkbox"
                        type="checkbox"
                        aria-label={`Select ${t.symbol} for export`}
                        checked={checked.includes(t.id)}
                        onChange={(e) =>
                          setChecked((ids) =>
                            e.target.checked
                              ? [...ids, t.id]
                              : ids.filter((id) => id !== t.id),
                          )
                        }
                      />
                      <button
                        className="ws-trade-card-main"
                        onClick={() => void selectTrade(t.id)}
                      >
                        <div>
                          <strong>{t.symbol}</strong>
                          <span
                            className={
                              t.direction === "LONG" ? "ws-long" : "ws-short"
                            }
                          >
                            {t.direction === "LONG" ? "↗" : "↘"}{" "}
                            {t.direction === "LONG" ? "Long" : "Short"}
                          </span>
                        </div>
                        <div>
                          <span>
                            {time(t.openTime).slice(0, 5)} →{" "}
                            {t.openQuantity
                              ? "Open"
                              : time(t.closeTime).slice(0, 5)}
                          </span>
                          <b className={t.pnl >= 0 ? "positive" : "negative"}>
                            {replay !== null
                              ? "—"
                              : `${t.pnl >= 0 ? "+" : ""}${money(t.pnl, t.currency)}`}
                          </b>
                        </div>
                        <div className="ws-trade-card-bottom">
                          <span className="ws-trade-size">
                            <span>{t.executions.length} fills · </span>
                            <span>{t.quantity} shares · <span className="ws-peak-cost" title={replay !== null ? "Max notional is hidden during replay." : peakCosts.get(t.id)?.reason ?? [peakCostDescription, peakCosts.get(t.id)?.basis].filter(Boolean).join(" ")} aria-label={replay !== null ? "Max notional hidden during replay" : `${peakCostDescription} ${peakCosts.get(t.id)?.basis ?? ""} ${peakCosts.get(t.id)?.reason ?? peakCosts.get(t.id)?.formatted}`}>
                              Max notional {replay !== null ? "—" : peakCosts.get(t.id)?.formatted}
                            </span></span>
                          </span>
                          <i
                            className={
                              t.id === selectedId &&
                              documentState?.review.status === "Reviewed"
                                ? "reviewed"
                                : ""
                            }
                          />
                        </div>
                      </button>
                    </div>
                  </div>
                ))}
                {!filtered.length && (
                  <div className="ws-empty">No matching trades.</div>
                )}
              </div>
              <div className="ws-list-bottom">
                <span>
                  {checked.length
                    ? `${checked.length} selected for export`
                    : "Review with intention."}
                </span>
                <button
                  title="Open export options"
                  onClick={() => {
                    setExportScope(checked.length ? "selected" : "filtered");
                    setModal("export");
                  }}
                >
                  <ArrowUpRight size={14} />
                </button>
              </div>
            </aside>
          )}
          <main className="ws-main">
            <div className="ws-trade-heading">
              <button className={`ws-icon-button ws-show-trades ${preferences.list ? "ws-desktop-list-visible" : ""}`} title="Show trade list" aria-label="Show trade list" onClick={() => { changePreferences({ list: true }); if (window.matchMedia("(max-width: 1150px)").matches) setListDrawer(true); }}><ListFilter size={16} /></button>
              <select
                className="ws-trade-picker"
                aria-label="Choose trade"
                value={trade.id}
                onChange={(e) => void selectTrade(e.target.value)}
              >
                {trades.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.symbol} · {date(t.openTime)}
                  </option>
                ))}
              </select>
              <div className="ws-symbol-avatar">{trade.symbol.slice(0, 1)}</div>
              <div className="ws-trade-title">
                <h2>
                  {trade.symbol}
                  <span
                    className={
                      trade.direction === "LONG" ? "ws-long" : "ws-short"
                    }
                  >
                    {trade.direction === "LONG" ? "↗ Long" : "↘ Short"}
                  </span>
                  <span className="ws-closed">
                    {trade.openQuantity ? "Partially open" : "Closed"}
                  </span>
                </h2>
                <p>
                  {trade.name || trade.symbol}
                  <span>·</span>
                  {date(trade.openTime)}
                  <span>·</span>
                  {trade.account}
                </p>
              </div>
              <div className="ws-trade-metrics">
                <div>
                  <span>REALIZED P&L</span>
                  <b className={trade.pnl >= 0 ? "positive" : "negative"}>
                    {replay !== null
                      ? "—"
                      : `${trade.pnl >= 0 ? "+" : ""}${money(trade.pnl, trade.currency)}`}
                  </b>
                </div>
                <div>
                  <span>AVG ENTRY</span>
                  <b>
                    {replay !== null ? "—" : money(trade.entry, trade.currency)}
                  </b>
                </div>
                <div>
                  <span>AVG EXIT</span>
                  <b>
                    {replay !== null ? "—" : money(trade.exit, trade.currency)}
                  </b>
                </div>
                <div>
                  <span>QUANTITY</span>
                  <b>{replay !== null ? "—" : trade.quantity}</b>
                </div>
              </div>
            </div>
            {trade.stale && (
              <div className="ws-stale">
                This trade is stale. The saved review is available for
                reference; editing is disabled.
              </div>
            )}
            {isSmall ? (
              <>
                <div className="ws-mobile-tabs">
                  {Object.entries(names).map(([id, name]) => (
                    <button
                      className={mobileTab === name ? "active" : ""}
                      key={id}
                      onClick={() => setMobileTab(name)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
                <div className="ws-mobile-panel">
                  {
                    content[
                      (Object.keys(names).find(
                        (k) => names[k as keyof typeof names] === mobileTab,
                      ) ?? "charts") as keyof typeof content
                    ]
                  }
                </div>
              </>
            ) : (
              <div className="ws-dock">
                <DockControls.Provider
                  value={{
                    collapseTools: () =>
                      changePreferences({ bottomCollapsed: true }),
                    collapseJournal: () =>
                      changePreferences({ journal: false }),
                  }}
                >
                  <PanelContent.Provider value={content}>
                    {loadedPreferences && (
                      <DockviewReact
                        components={dockComponents}
                        onReady={onReady}
                        theme={
                          preferences.theme === "dark" ? themeDark : themeLight
                        }
                        disableDnd={lockedLayout}
                        rightHeaderActionsComponent={DockHeaderActions}
                      />
                    )}
                  </PanelContent.Provider>
                </DockControls.Provider>
              </div>
            )}
            {!isSmall && !preferences.focusMode && (
              <div className="ws-panel-shelf" aria-label="Workspace panels">
                {reviewPanelIds.map((id) => (
                  <button
                    key={id}
                    aria-label={`Show ${names[id]}`}
                    aria-expanded={!preferences.bottomCollapsed}
                    onClick={() => showPanel(id)}
                  >
                    {id === "executions" ? (
                      <ListFilter size={13} />
                    ) : id === "evidence" ? (
                      <ImageIcon size={13} />
                    ) : (
                      <Ruler size={13} />
                    )}
                    {names[id]}
                    {id === "executions" && (
                      <small>
                        {
                          trade.executions.filter(
                            (e) => replay === null || e.time <= replay,
                          ).length
                        }
                      </small>
                    )}
                  </button>
                ))}
                {!preferences.bottomCollapsed && (
                  <button
                    aria-label="Collapse review panels"
                    title="Collapse review panels"
                    onClick={() => changePreferences({ bottomCollapsed: true })}
                  >
                    <ChevronDown size={14} />
                  </button>
                )}
                <span className="ws-flex-spacer" />
                {!preferences.list && (
                  <button
                    aria-label="Show trade list"
                    onClick={() => changePreferences({ list: true })}
                  >
                    Trades
                  </button>
                )}
                <button
                  aria-label={
                    preferences.journal ? "Collapse journal" : "Show journal"
                  }
                  aria-expanded={preferences.journal}
                  onClick={() =>
                    preferences.journal
                      ? changePreferences({ journal: false })
                      : showPanel("journal")
                  }
                >
                  <BookOpen size={13} />
                  Journal
                  {preferences.journal ? (
                    <ChevronRight size={13} />
                  ) : (
                    <ChevronLeft size={13} />
                  )}
                </button>
              </div>
            )}
          </main>
        </div>
        <footer className="ws-app-footer">
          <span>
            <span className="ws-feed-dot" />
            {adapter.mode === "demo"
              ? "Local preview · synthetic market data"
              : "Trade review workspace"}
          </span>
          <span>{busy || <ConnectedSaveStatus persistence={persistence} mode={adapter.mode} />}</span>
          <span>
            Built for better decisions <Activity size={12} />
          </span>
        </footer>
      </div>
      {notice && (
        <div className="ws-toast" role="status">
          <Check size={16} />
          <span>{notice}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {peerComparison?.tradeId === trade.id && replay === null && <PeerComparison key={`${trade.id}:${trade.timeInterpretationVersion}`} trade={trade} selection={peerComparison.selection} initial={peerComparison.initial} preferences={preferences} mode={adapter.mode} readOnly={!!trade.stale} getWorkspaceView={getPeerWorkspaceView} onSelectGroup={selectPeerGroup} onCapture={capturePeer} onClose={closePeers} />}
      {modal === "attach" && <Modal title="Attach current chart" onClose={closeModal}>
        <p>Choose the review section for the active chart.</p>
        <div className="ws-export-actions">{reviewSections.map(([key, label]) => <button key={key} disabled={!!busy} onClick={() => void capture("attach", key)}>{label}</button>)}</div>
        {busy && <p role="status">{busy}</p>}
      </Modal>}
      {modal === "notion" && notionPackage && <Modal title="Export review for Notion" onClose={closeModal}>
        <p>Both downloads contain saved review revision {notionPackage.revision}.</p>
        <div className="ws-export-actions">
          <button onClick={() => downloadBlob(notionPackage.csv, `${notionPackage.name}_notion.csv`)}><Download size={14} /> Database CSV</button>
          <button onClick={() => downloadBlob(notionPackage.zip, `${notionPackage.name}_notion-page.zip`)}><Download size={14} /> Review page ZIP</button>
        </div>
        <ol className="ws-notion-import-steps">
          <li>In your Notion database, choose <strong>Merge with CSV</strong>. Match column names to the existing template properties; map Name to the title property. Imports add new rows and do not update existing trades.</li>
          <li>Map relation columns to existing relations where supported; verify the related pages after import. The S/L % snapshot is a Number in percentage points, not a formula. Keep your existing formula and use Planned entry/stop as inputs if appropriate.</li>
          <li>Import the page ZIP using <strong>Settings → Import → ZIP</strong>. Open the imported review and move its blocks into the corresponding database page. The ZIP preserves section headings and chart images; CSV does not attach this page body automatically.</li>
        </ol>
        <p className="ws-help">Dates use MM/DD/YYYY in New York time, checkboxes TRUE/FALSE, and numbers have no display units. Unresolved dates are blank. Unmatched relations can be imported as Text and linked manually.</p>
        <a href="https://www.notion.com/help/import-data-into-notion" target="_blank" rel="noreferrer">Notion import instructions</a>
      </Modal>}
      {modal === "export" && (
        <Modal title="Take your review with you" onClose={closeModal}>
          <p className="ws-modal-description">
            Annotated charts and portable reviews, ready for your Notion
            workflow.
          </p>
          <div className="ws-export-section">
            <h3>
              <Camera size={16} /> Chart snapshots
            </h3>
            <div className="ws-export-options">
              <label>
                <input
                  type="checkbox"
                  checked={exportLight}
                  onChange={(e) => setExportLight(e.target.checked)}
                />{" "}
                Light background
              </label>
              <select
                aria-label="Export resolution"
                value={exportScale}
                onChange={(e) => setExportScale(Number(e.target.value))}
              >
                <option value={1}>Standard resolution</option>
                <option value={2}>High resolution · 2×</option>
              </select>
            </div>
            <div className="ws-export-buttons">
              <button disabled={!!busy} onClick={() => void capture("active")}>
                <Download size={15} /> Active chart PNG
              </button>
              <button disabled={!!busy} onClick={() => void capture("layout")}>
                <Grid2X2 size={15} /> All charts PNG
              </button>
              <button disabled={!!busy} onClick={() => void capture("copy")}>
                <Copy size={15} /> Copy image
              </button>
              <button disabled={!!busy} onClick={() => void capture("attach")}>
                <Plus size={15} /> Add to journal
              </button>
            </div>
            <p className="ws-help">
              Captures the visible range, executions, and annotations. Local
              downloads include current unsaved drawings.
            </p>
          </div>
          <div className="ws-export-section">
            <h3>
              <BookOpen size={16} /> Journal data
            </h3>
            <div className="ws-export-options">
              <select
                aria-label="Export trade selection"
                value={exportScope}
                onChange={(e) => setExportScope(e.target.value)}
              >
                <option value="current">Current trade · 1 review</option>
                <option value="selected">
                  Selected trades ·{" "}
                  {filtered.filter((t) => checked.includes(t.id)).length}{" "}
                  reviews
                </option>
                <option value="filtered">
                  All filtered trades · {filtered.length} reviews
                </option>
              </select>
              <select
                aria-label="Review export format"
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value)}
              >
                <option value="package">Complete review package · ZIP</option>
                <option value="csv">Notion properties · CSV</option>
                <option value="markdown">Markdown review</option>
              </select>
            </div>
            <details className="ws-export-fields">
              <summary>Customize CSV columns & Notion property names</summary>
              <div>
                {exportColumns.map((name) => (
                  <label key={name}>
                    <input
                      type="checkbox"
                      checked={columns.includes(name)}
                      onChange={(e) =>
                        setColumns((values) =>
                          e.target.checked
                            ? [...values, name]
                            : values.filter((v) => v !== name),
                        )
                      }
                    />
                    <span>{name}</span>
                    <input
                      aria-label={`Notion property for ${name}`}
                      placeholder={name}
                      value={exportHeaders[name] ?? ""}
                      onChange={(e) =>
                        setExportHeaders((v) => ({
                          ...v,
                          [name]: e.target.value,
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
            </details>
            <p className="ws-help">
              ZIP includes CSV, Markdown, HTML, saved chart attachments, and a
              versioned JSON manifest. Markdown exports multiple trades as a
              ZIP.
            </p>
            <div className="ws-notion-note">
              <BookOpen size={17} />
              <p>
                Notion CSV imports <strong>add rows</strong>; they don’t update
                existing reviews. Trade ID helps you identify duplicates. Paste
                chart images separately into an existing Notion page.
              </p>
            </div>
            <button
              className="ws-primary ws-wide"
              disabled={!!busy || !columns.length || replay !== null}
              onClick={() => void exportReviews()}
            >
              <Download size={15} />
              {busy || "Export review"}
            </button>
            {replay !== null && (
              <p className="ws-help">Exit replay to export the saved review.</p>
            )}
          </div>
        </Modal>
      )}
      {modal === "shortcuts" && (
        <Modal title="Keyboard shortcuts" onClose={closeModal}>
          <ShortcutSettings value={shortcuts.value} onChange={shortcuts.save} error={shortcuts.error} />
        </Modal>
      )}
      {modal === "date" && (
        <Modal title="Jump to date" onClose={closeModal}>
          <form className="ws-date-dialog" onSubmit={event => { event.preventDefault(); goToDate(); closeModal(); }}>
            <label>Target date · UTC<input data-autofocus required type="datetime-local" aria-label="Jump target date UTC" value={targetDate} onChange={e => setTargetDate(e.target.value)} /></label>
            <p>{preferences.dateLink === "target" ? "Linked charts move only when this date is outside their visible range. Each chart keeps its own zoom." : "Only the active chart moves, and only when this date is outside its visible range."}</p>
            <button className="ws-primary" type="submit">Go to date</button>
          </form>
        </Modal>
      )}
      {modal === "settings" && (
        <Modal title="Chart settings" onClose={closeModal}>
          <button className="ws-key-entry" onClick={() => setModal("shortcuts")}>Keyboard shortcuts <kbd>?</kbd></button>
          <div className="ws-settings">
            <label>
              Three-chart arrangement
              <select
                aria-label="Chart arrangement"
                value={preferences.chartArrangement}
                onChange={(e) =>
                  changePreferences({
                    chartArrangement: e.target
                      .value as WorkspacePreferences["chartArrangement"],
                  })
                }
              >
                <option value="left">Main left · two right</option>
                <option value="top">Main above · two below</option>
              </select>
            </label>
            <label>
              <span>Appearance</span>
              <select
                value={preferences.theme}
                onChange={(e) =>
                  changePreferences({
                    theme: e.target.value as "dark" | "light",
                  })
                }
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </label>
            <label>
              <span>Execution markers — active chart ({currentPanel.id})</span>
              <select
                value={activeLabels}
                onChange={(e) =>
                  setChartLabels(currentPanel.id, e.target.value as LabelMode)
                }
              >
                <option value="labels">Full labels</option>
                <option value="compact">Compact</option>
                <option value="hidden">Hidden</option>
              </select>
            </label>
            <div className="ws-marker-colors">
              {(["buy", "sell"] as const).map(side => <label key={side}><span>{side === "buy" ? "Buy colour" : "Sell colour"}</span><input type="color" aria-label={side === "buy" ? "Buy colour" : "Sell colour"} value={executionColors(preferences.executionColors)[side]} onChange={e => changePreferences({ executionColors: { ...executionColors(preferences.executionColors), [side]: e.target.value } })} /></label>)}
              <button onClick={() => changePreferences({ executionColors: executionColors() })}>Reset marker colours</button>
            </div>
            <div className="ws-marker-colors">
              <label><span>Index comparison colour</span><input type="color" aria-label="Index comparison colour" value={benchmarkColor(preferences.theme === "light", preferences.benchmarkColor)} onChange={e => changePreferences({ benchmarkColor: e.target.value })} /></label>
              <button onClick={() => changePreferences({ benchmarkColor: undefined })}>Reset comparison colour</button>
            </div>
            <label>
              <span>Volume</span>
              <input
                type="checkbox"
                checked={preferences.volume}
                onChange={(e) =>
                  changePreferences({ volume: e.target.checked })
                }
              />
            </label>
            <label>
              <span>Volume average</span>
              <input type="checkbox" checked={preferences.volumeAverage.enabled} onChange={e => changePreferences({ volumeAverage: { ...preferences.volumeAverage, enabled: e.target.checked } })} />
            </label>
            <label>
              <span>Volume average period (bars)</span>
              <input type="number" min={1} max={500} step={1} value={preferences.volumeAverage.period} onChange={e => {
                const period = e.target.valueAsNumber;
                if (Number.isInteger(period) && period >= 1 && period <= 500) changePreferences({ volumeAverage: { ...preferences.volumeAverage, period } });
              }} />
            </label>
            <label>
              <span>Horizontal gridlines</span>
              <input type="checkbox" checked={preferences.gridlines.horizontal} onChange={e => changePreferences({ gridlines: { ...preferences.gridlines, horizontal: e.target.checked } })} />
            </label>
            <label>
              <span>Vertical gridlines</span>
              <input type="checkbox" checked={preferences.gridlines.vertical} onChange={e => changePreferences({ gridlines: { ...preferences.gridlines, vertical: e.target.checked } })} />
            </label>
            <label>
              <span>Linked time crosshairs</span>
              <input
                type="checkbox"
                checked={preferences.linked}
                onChange={(e) =>
                  changePreferences({ linked: e.target.checked })
                }
              />
            </label>
            <label>
              <span>Snap drawings to candle OHLC</span>
              <input
                type="checkbox"
                checked={preferences.magnet}
                onChange={(e) =>
                  changePreferences({ magnet: e.target.checked })
                }
              />
            </label>
            <label>
              <span>Keep drawing tool active</span>
              <input
                type="checkbox"
                checked={preferences.keepTool}
                onChange={(e) =>
                  changePreferences({ keepTool: e.target.checked })
                }
              />
            </label>
            <MovingAverageSettings periods={preferences.averages} onChange={averages => changePreferences({ averages })} />
            <DrawingStyleSettings
              initialTool={chosenDrawing?.tool ?? (tool === "cursor" ? "ray" : tool)}
              styles={preferences.drawingStyles}
              onChange={(drawingTool, style) => setPreferences(value => ({ ...value,
                drawingStyles: { ...value.drawingStyles, [drawingTool]: style },
              }))}
            />
            <label>
              <span>Change all chart intervals</span>
              <select
                aria-label="Change all chart intervals"
                value=""
                onChange={(e) =>
                  changePreferences({
                    panels: preferences.panels.map((p) => ({
                      ...p,
                      interval: e.target.value as Interval,
                    })),
                  })
                }
              >
                <option value="">Choose interval…</option>
                {intervals.map((i) => (
                  <option key={i}>{i}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="ws-help">
            Settings apply to this workspace and are remembered on this device.
          </p>
        </Modal>
      )}
      {modal === "workspace" && (
        <Modal title="Your workspace, your process" onClose={closeModal}>
          <p className="ws-modal-description">
            Drag tabs to dock panels. Resize dividers to make room for what
            matters.
          </p>
          <div className="ws-preset-buttons">
            <button
              onClick={() => {
                setPanelCount(1);
                if (dock.current) buildDock(dock.current);
              }}
            >
              Single chart
            </button>
            <button
              onClick={() => {
                setPanelCount(2);
                if (dock.current) buildDock(dock.current);
              }}
            >
              Execution + context
            </button>
            <button
              onClick={() => {
                setPanelCount(3);
                if (dock.current) buildDock(dock.current);
              }}
            >
              Multi-timeframe
            </button>
            <button
              onClick={() => {
                setPanelCount(4);
                if (dock.current) buildDock(dock.current);
              }}
            >
              Four charts
            </button>
          </div>
          <div className="ws-panel-manager">
            {Object.entries(names).map(([id, name]) => (
              <div key={id}>
                <span>{name}</span>
                <button onClick={() => showPanel(id as keyof typeof names)}>
                  Show
                </button>
                <button onClick={() => dock.current?.getPanel(id)?.api.close()}>
                  Hide
                </button>
                <button
                  onClick={() => {
                    const panel = dock.current?.getPanel(id);
                    if (panel)
                      dock.current?.addFloatingGroup(panel, {
                        width: 600,
                        height: 420,
                        x: 80,
                        y: 80,
                      });
                  }}
                >
                  Float
                </button>
                <select
                  aria-label={`Move ${name} panel`}
                  value=""
                  onChange={(e) => {
                    const api = dock.current,
                      panel = api?.getPanel(id),
                      target = api?.getPanel(
                        id === "charts" ? "journal" : "charts",
                      );
                    if (panel && target)
                      panel.api.moveTo({
                        group: target.group,
                        position: e.target.value as
                          | "left"
                          | "right"
                          | "top"
                          | "bottom",
                      });
                  }}
                >
                  <option value="">Move…</option>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                  <option value="top">Above</option>
                  <option value="bottom">Below</option>
                </select>
              </div>
            ))}
          </div>
          <button className="ws-tool-button" onClick={() => changePreferences({ chartSizing: defaultChartSizing() })}><RotateCcw size={14} /> Reset chart sizes</button>
          <div className="ws-inline-add">
            <input
              placeholder="Name this workspace"
              aria-label="Workspace name"
              value={layoutName}
              onChange={(e) => setLayoutName(e.target.value)}
            />
            <button
              disabled={!layoutName.trim()}
              onClick={() => {
                changePreferences({
                  presets: {
                    ...preferences.presets,
                    [layoutName.trim()]: {
                      dock: dock.current?.toJSON() ?? null,
                      panels: preferences.panels,
                      list: preferences.list,
                      chartArrangement: preferences.chartArrangement,
                      chartSizing: restoreChartSizing(preferences.chartSizing),
                    },
                  },
                });
                setLayoutName("");
                notify("Workspace preset saved.");
              }}
            >
              Save preset
            </button>
          </div>
          {Object.entries(preferences.presets).map(([name, preset]) => (
            <div className="ws-saved-preset" key={name}>
              <button
                onClick={() => {
                  const value = preset as Pick<
                    WorkspacePreferences,
                    "dock" | "panels" | "list" | "chartSizing" | "chartArrangement"
                  >;
                  changePreferences({ ...value, panels: restoreChartPanels(value.panels, preferences.chartSession), chartSizing: restoreChartSizing(value.chartSizing) });
                  if (value.dock && dock.current) {
                    try {
                      dock.current.fromJSON(value.dock as SerializedDockview);
                    } catch {
                      buildDock(dock.current);
                    }
                  }
                }}
              >
                {name}
                <ArrowUpRight size={13} />
              </button>
              <button
                aria-label={`Delete preset ${name}`}
                onClick={() => {
                  const presets = { ...preferences.presets };
                  delete presets[name];
                  changePreferences({ presets });
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {adapter.mode === "demo" && (
            <button className="ws-reset" onClick={() => setModal("reset")}>
              <RotateCcw size={14} /> Reset demo data & layout
            </button>
          )}
        </Modal>
      )}
      {modal === "help" && (
        <Modal
          title="A better trade review, in four steps"
          onClose={closeModal}
        >
          <ol className="ws-help-steps">
            <li>
              <b>Find your fills.</b> Select an execution to center it on every
              chart. Stored timestamps and source-timezone status are in the execution details.
            </li>
            <li>
              <b>Add context.</b> Click a timeframe or choose up to four charts.
              Sync links crosshairs in time, keeping each price scale
              independent.
            </li>
            <li>
              <b>Mark the decision.</b> Choose a drawing tool, click the chart,
              and edit its properties. Measurements use the starting price, not
              trade P&L.
            </li>
            <li>
              <b>Keep the lesson.</b> Write your review, attach an annotated
              chart, and export to your Notion workflow.
            </li>
          </ol>
          <button className="ws-primary" onClick={() => setModal("shortcuts")}>Keyboard shortcuts & customization</button>
          <p className="ws-help">Charts powered by <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView Lightweight Charts</a>.</p>
          <p className="ws-help">
            Demo candles are synthetic. Replay uses completed candles only;
            coarser charts may have no new completed candle yet. Drawing
            coordinates are editable in the Drawings panel.
          </p>
        </Modal>
      )}
      {modal === "reset" && (
        <Modal title="Reset this demo?" onClose={closeModal}>
          <p className="ws-modal-description">
            This removes local demo reviews, drawings, snapshots, and workspace
            settings. Export anything you want to keep first.
          </p>
          <div className="ws-export-buttons">
            <button onClick={closeModal}>Keep my work</button>
            <button
              className="ws-primary"
              onClick={() => {
                adapter.reset?.();
                localStorage.removeItem("execution-lab:appearance:demo:v1");
                localStorage.removeItem("execution-lab:navigation:demo:expanded:v1");
                shortcuts.save(defaultShortcuts());
                for (const key of Object.keys(localStorage))
                  if (key.startsWith(preferenceKey))
                    localStorage.removeItem(key);
                window.location.reload();
              }}
            >
              Reset demo
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type HistogramData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  ArrowDownToLine,
  CandlestickChart,
  Columns2,
  Crosshair,
  Eraser,
  GitCompare,
  Grid2X2,
  LayoutPanelLeft,
  LineChart,
  Minus,
  Rows2,
  Save,
  StickyNote,
  Target,
  Type,
  Undo2,
} from "lucide-react";
import { alignExecutionToBarTime, inferBarIntervalSeconds, inferExecutionOffsetSeconds } from "@/lib/charts/execution-marker-alignment";
import { cn, formatCurrency } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Candle = { time: number; open: number; high: number; low: number; close: number; volume?: number };
type Execution = {
  id: string;
  executedAt: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  commission: number;
  fees: number;
};

export type ClosedTradeChartWorkspaceTrade = {
  groupKey: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  openTime: string;
  closeTime: string;
  avgEntryPrice: number;
  avgExitPrice: number;
  realizedPnl: number;
  executions: Execution[];
};

type LayoutMode = "single" | "two-vertical" | "two-horizontal" | "three-vertical" | "three-horizontal" | "one-plus-two";
type ChartTimeframe = "5m" | "10m" | "15m" | "1h" | "1d" | "1wk";
type RangePreset = "post" | "trade" | "1m" | "3m" | "1y" | "ytd" | "all";
type AnnotationScope = "TRADE" | "SYMBOL" | "GLOBAL_SYMBOL";
type Tool =
  | "cursor"
  | "horizontal"
  | "ray"
  | "trend"
  | "text"
  | "price-note"
  | "entry"
  | "exit"
  | "stop"
  | "target";

type ChartPanelState = {
  id: string;
  symbol: string;
  timeframe: ChartTimeframe;
  compareSymbol?: string | null;
  rangePreset: RangePreset;
  visibleFrom?: number | null;
  visibleTo?: number | null;
};

type AnnotationPoint = { time: number; price: number };
type ChartAnnotation = {
  id: string;
  panelId?: string | null;
  symbol: string;
  timeframe?: string | null;
  scope: AnnotationScope;
  type: Tool | "execution-line";
  points: AnnotationPoint[];
  price?: number | null;
  text?: string | null;
  style?: Record<string, unknown>;
};

type CandleResponse = {
  symbol?: string;
  timeframe?: string;
  candles?: Candle[];
  source?: string | null;
  compare?: { symbol?: string; candles?: Candle[]; source?: string | null } | null;
  compareError?: string | null;
  error?: string;
};

type PendingTrend = { panelId: string; time: number; price: number } | null;
type ExecutionOverlay = {
  key: string;
  label: string;
  detail: string;
  side: "BUY" | "SELL";
  x: number;
  y: number;
  laneX: number;
  laneY: number;
  price: number;
};

const LAYOUT_OPTIONS: Array<{ value: LayoutMode; label: string; icon: ComponentType<{ className?: string }> }> = [
  { value: "single", label: "1", icon: CandlestickChart },
  { value: "two-vertical", label: "2V", icon: Columns2 },
  { value: "two-horizontal", label: "2H", icon: Rows2 },
  { value: "three-vertical", label: "3V", icon: Grid2X2 },
  { value: "three-horizontal", label: "3H", icon: Rows2 },
  { value: "one-plus-two", label: "1+2", icon: LayoutPanelLeft },
];

const TOOL_OPTIONS: Array<{ value: Tool; label: string; icon: ComponentType<{ className?: string }> }> = [
  { value: "cursor", label: "Cursor", icon: Crosshair },
  { value: "horizontal", label: "Horizontal", icon: Minus },
  { value: "ray", label: "Ray", icon: ArrowDownToLine },
  { value: "trend", label: "Trend", icon: LineChart },
  { value: "text", label: "Text", icon: Type },
  { value: "price-note", label: "Price note", icon: StickyNote },
  { value: "entry", label: "Entry", icon: Target },
  { value: "exit", label: "Exit", icon: Target },
  { value: "stop", label: "Stop", icon: Target },
  { value: "target", label: "Target", icon: Target },
];

const RANGE_PRESETS: Array<{ value: RangePreset; label: string }> = [
  { value: "post", label: "Post-close" },
  { value: "trade", label: "Trade" },
  { value: "1m", label: "1M" },
  { value: "3m", label: "3M" },
  { value: "1y", label: "1Y" },
  { value: "ytd", label: "YTD" },
  { value: "all", label: "All" },
];

const SMA_CONFIG = [
  { period: 10, color: "#0284c7" },
  { period: 20, color: "#7c3aed" },
  { period: 50, color: "#d97706" },
  { period: 200, color: "#475569" },
] as const;

function panelCountForLayout(layout: LayoutMode) {
  if (layout === "single") return 1;
  if (layout === "two-vertical" || layout === "two-horizontal") return 2;
  return 3;
}

function normalizeTimeframe(value: string): ChartTimeframe {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "");
  if (normalized === "5M" || normalized === "5MIN") return "5m";
  if (normalized === "10M" || normalized === "10MIN") return "10m";
  if (normalized === "15M" || normalized === "15MIN") return "15m";
  if (normalized === "1H" || normalized === "60M") return "1h";
  if (normalized === "1W" || normalized === "W") return "1wk";
  return "1d";
}

function timeframeCommand(timeframe: ChartTimeframe) {
  if (timeframe === "1wk") return "1W";
  return timeframe.toUpperCase();
}

function fallbackPanel(trade: ClosedTradeChartWorkspaceTrade, index: number): ChartPanelState {
  const timeframes: ChartTimeframe[] = ["1d", "5m", "1h"];
  return {
    id: `panel-${index + 1}`,
    symbol: trade.symbol,
    timeframe: timeframes[index] ?? "1d",
    compareSymbol: null,
    rangePreset: index === 1 ? "trade" : "post",
  };
}

function normalizePanels(trade: ClosedTradeChartWorkspaceTrade, panels: ChartPanelState[], layout: LayoutMode) {
  const count = panelCountForLayout(layout);
  const next = panels.slice(0, count);
  while (next.length < count) next.push(fallbackPanel(trade, next.length));
  return next.map((panel, index) => {
    const normalized = {
      ...fallbackPanel(trade, index),
      ...panel,
      id: panel.id || `panel-${index + 1}`,
      symbol: (panel.symbol || trade.symbol).trim().toUpperCase(),
      timeframe: normalizeTimeframe(panel.timeframe),
      compareSymbol: null,
    };
    if (layout !== "single" && panel.compareSymbol && index > 0 && panel.symbol === trade.symbol) {
      normalized.symbol = panel.compareSymbol.trim().toUpperCase();
    }
    return normalized;
  });
}

function rangeForPreset(trade: ClosedTradeChartWorkspaceTrade, timeframe: ChartTimeframe, preset: RangePreset) {
  if (preset === "all") return null;
  const now = Math.floor(Date.now() / 1000);
  const open = Math.floor(new Date(trade.openTime).getTime() / 1000);
  const close = Math.floor(new Date(trade.closeTime).getTime() / 1000);
  const contextSeconds: Record<ChartTimeframe, number> = {
    "5m": 2 * 24 * 60 * 60,
    "10m": 3 * 24 * 60 * 60,
    "15m": 5 * 24 * 60 * 60,
    "1h": 14 * 24 * 60 * 60,
    "1d": 180 * 24 * 60 * 60,
    "1wk": 365 * 24 * 60 * 60,
  };

  if (preset === "trade") {
    return {
      from: Math.max(0, open - contextSeconds[timeframe]),
      to: Math.max(close + contextSeconds[timeframe], close + 60),
    };
  }
  if (preset === "1m") return { from: now - 31 * 24 * 60 * 60, to: now };
  if (preset === "3m") return { from: now - 93 * 24 * 60 * 60, to: now };
  if (preset === "1y") return { from: now - 365 * 24 * 60 * 60, to: now };
  if (preset === "ytd") {
    const start = new Date(new Date().getUTCFullYear(), 0, 1);
    return { from: Math.floor(start.getTime() / 1000), to: now };
  }

  return {
    from: Math.max(0, open - contextSeconds[timeframe]),
    to: now,
  };
}

function buildSma(candles: Candle[], period: number) {
  const points: Array<{ time: UTCTimestamp; value: number }> = [];
  let sum = 0;
  for (let index = 0; index < candles.length; index += 1) {
    sum += candles[index].close;
    if (index >= period) sum -= candles[index - period].close;
    if (index >= period - 1) points.push({ time: candles[index].time as UTCTimestamp, value: sum / period });
  }
  return points;
}

function toUnixSeconds(time?: Time): number | null {
  if (typeof time === "number") return time;
  if (!time) return null;
  if (typeof time === "string") {
    const parsed = Date.parse(time);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
  }
  return Math.floor(Date.UTC(time.year, time.month - 1, time.day) / 1000);
}

function annotationColor(annotation: ChartAnnotation) {
  if (typeof annotation.style?.color === "string") return annotation.style.color;
  if (annotation.type === "entry") return "#16a34a";
  if (annotation.type === "exit") return "#ea580c";
  if (annotation.type === "stop") return "#dc2626";
  if (annotation.type === "target") return "#2563eb";
  if (annotation.type === "trend") return "#f59e0b";
  if (annotation.type === "text" || annotation.type === "price-note") return "#0f172a";
  return "#2563eb";
}

function markerShape(annotation: ChartAnnotation): SeriesMarker<Time>["shape"] {
  if (annotation.type === "entry") return "arrowUp";
  if (annotation.type === "exit" || annotation.type === "stop") return "arrowDown";
  if (annotation.type === "target") return "circle";
  return "square";
}

function annotationMatchesPanel(annotation: ChartAnnotation, panel: ChartPanelState) {
  if (annotation.scope === "GLOBAL_SYMBOL") return annotation.symbol === panel.symbol;
  if (annotation.scope === "SYMBOL") {
    return annotation.symbol === panel.symbol && (!annotation.timeframe || annotation.timeframe === panel.timeframe);
  }
  if (annotation.panelId) return annotation.panelId === panel.id;
  return annotation.symbol === panel.symbol && (!annotation.timeframe || annotation.timeframe === panel.timeframe);
}

function serializeForApi(annotation: ChartAnnotation) {
  return {
    id: annotation.id,
    panelId: annotation.panelId ?? null,
    symbol: annotation.symbol,
    timeframe: annotation.timeframe ?? null,
    scope: annotation.scope,
    type: annotation.type,
    points: annotation.points,
    price: annotation.price ?? null,
    text: annotation.text ?? null,
    style: annotation.style ?? {},
  };
}

export function ClosedTradeChartWorkspace({ trade }: { trade: ClosedTradeChartWorkspaceTrade }) {
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("single");
  const [panels, setPanels] = useState<ChartPanelState[]>(() => [fallbackPanel(trade, 0)]);
  const [annotations, setAnnotations] = useState<ChartAnnotation[]>([]);
  const [undoStack, setUndoStack] = useState<ChartAnnotation[][]>([]);
  const [tool, setTool] = useState<Tool>("cursor");
  const [scope, setScope] = useState<AnnotationScope>("TRADE");
  const [pendingTrend, setPendingTrend] = useState<PendingTrend>(null);
  const [layoutLoaded, setLayoutLoaded] = useState(false);
  const [annotationsLoaded, setAnnotationsLoaded] = useState(false);
  const [layoutStatus, setLayoutStatus] = useState("");
  const [annotationStatus, setAnnotationStatus] = useState("");
  const normalizedPanels = useMemo(() => normalizePanels(trade, panels, layoutMode), [layoutMode, panels, trade]);
  const groupPath = encodeURIComponent(trade.groupKey);

  useEffect(() => {
    setLayoutLoaded(false);
    setAnnotationsLoaded(false);
    setLayoutMode("single");
    setPanels([fallbackPanel(trade, 0)]);
    setAnnotations([]);
    setUndoStack([]);
    setPendingTrend(null);

    let cancelled = false;
    Promise.all([
      fetch(`/api/closed-trades/${groupPath}/chart-layout`).then((res) => (res.ok ? res.json() : { layout: null })),
      fetch(`/api/closed-trades/${groupPath}/annotations`).then((res) => (res.ok ? res.json() : { annotations: [] })),
    ]).then(([layoutPayload, annotationPayload]) => {
      if (cancelled) return;
      if (layoutPayload.layout?.layoutMode && Array.isArray(layoutPayload.layout.panels)) {
        const nextLayout = layoutPayload.layout.layoutMode as LayoutMode;
        setLayoutMode(nextLayout);
        setPanels(normalizePanels(trade, layoutPayload.layout.panels as ChartPanelState[], nextLayout));
      }
      if (Array.isArray(annotationPayload.annotations)) {
        setAnnotations(annotationPayload.annotations as ChartAnnotation[]);
      }
      setLayoutLoaded(true);
      setAnnotationsLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, [groupPath, trade]);

  useEffect(() => {
    if (!layoutLoaded) return;
    const timeout = window.setTimeout(() => {
      setLayoutStatus("Saving layout...");
      fetch(`/api/closed-trades/${groupPath}/chart-layout`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layoutMode, panels: normalizedPanels }),
      }).then((res) => {
        setLayoutStatus(res.ok ? "Layout saved." : "Layout save failed.");
      });
    }, 650);
    return () => window.clearTimeout(timeout);
  }, [groupPath, layoutLoaded, layoutMode, normalizedPanels]);

  useEffect(() => {
    if (!annotationsLoaded) return;
    const timeout = window.setTimeout(() => {
      setAnnotationStatus("Saving drawings...");
      fetch(`/api/closed-trades/${groupPath}/annotations`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ annotations: annotations.map(serializeForApi) }),
      }).then((res) => {
        setAnnotationStatus(res.ok ? "Drawings saved." : "Drawing save failed.");
      });
    }, 700);
    return () => window.clearTimeout(timeout);
  }, [annotations, annotationsLoaded, groupPath]);

  const commitAnnotations = useCallback((next: ChartAnnotation[]) => {
    setUndoStack((current) => [...current.slice(-24), annotations]);
    setAnnotations(next);
  }, [annotations]);

  const updatePanel = useCallback((panelId: string, patch: Partial<ChartPanelState>) => {
    setPanels((current) => current.map((panel) => (panel.id === panelId ? { ...panel, ...patch } : panel)));
  }, []);

  function selectLayout(nextLayout: LayoutMode) {
    setLayoutMode(nextLayout);
    setPanels((current) => normalizePanels(trade, current, nextLayout));
  }

  function undo() {
    setUndoStack((current) => {
      const previous = current.at(-1);
      if (!previous) return current;
      setAnnotations(previous);
      return current.slice(0, -1);
    });
  }

  function clearDrawings() {
    commitAnnotations([]);
    setPendingTrend(null);
  }

  function addExecutionPriceAnnotations() {
    const existingKeys = new Set(annotations.map((annotation) => `${annotation.type}:${annotation.price}:${annotation.text}`));
    const next = [...annotations];
    for (const [index, execution] of trade.executions.entries()) {
      const type = "horizontal" as const;
      const text = `${execution.side} ${index + 1} ${execution.quantity} @ ${execution.price.toFixed(2)}`;
      const key = `${type}:${execution.price}:${text}`;
      if (existingKeys.has(key)) continue;
      next.push({
        id: crypto.randomUUID(),
        panelId: null,
        symbol: trade.symbol,
        timeframe: null,
        scope: "SYMBOL",
        type,
        points: [],
        price: execution.price,
        text,
        style: { color: execution.side === "BUY" ? "#16a34a" : "#dc2626" },
      });
    }
    commitAnnotations(next);
  }

  const toolIcon = TOOL_OPTIONS.find((option) => option.value === tool)?.icon ?? Crosshair;
  const ToolIcon = toolIcon;

  return (
    <div className="h-full bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-3">
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
          {LAYOUT_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                className={cn(
                  "inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-semibold text-slate-600",
                  layoutMode === option.value && "bg-slate-950 text-white",
                )}
                onClick={() => selectLayout(option.value)}
                title={option.label}
              >
                <Icon className="h-3.5 w-3.5" />
                {option.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {TOOL_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600",
                  tool === option.value && "bg-slate-950 text-white",
                )}
                onClick={() => {
                  setTool(option.value);
                  setPendingTrend(null);
                }}
                title={option.label}
              >
                <Icon className="h-4 w-4" />
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 text-xs font-semibold">
          {(["TRADE", "SYMBOL"] as AnnotationScope[]).map((option) => (
            <button
              key={option}
              type="button"
              className={cn("h-8 rounded-md px-2 text-slate-600", scope === option && "bg-sky-50 text-sky-700")}
              onClick={() => setScope(option)}
            >
              {option === "TRADE" ? "Trade" : "Share"}
            </button>
          ))}
        </div>

        <Button size="sm" variant="outline" onClick={undo} disabled={undoStack.length === 0} title="Undo">
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="outline" onClick={clearDrawings} title="Clear drawings">
          <Eraser className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="outline" onClick={addExecutionPriceAnnotations} title="Store execution lines">
          <GitCompare className="h-4 w-4" />
          Snap
        </Button>

        <div className="ml-auto flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1">
            <ToolIcon className="h-3.5 w-3.5" />
            {pendingTrend ? "Select second trend point" : TOOL_OPTIONS.find((option) => option.value === tool)?.label}
          </span>
          <span className="hidden md:inline">|</span>
          <span>{annotationStatus || layoutStatus || "Workspace ready."}</span>
          <Save className="h-3.5 w-3.5 text-slate-400" />
        </div>
      </div>

      {layoutMode === "one-plus-two" ? (
        <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.9fr)]">
          <ClosedTradeChartPanel
            annotations={annotations}
            commitAnnotations={commitAnnotations}
            panel={normalizedPanels[0]}
            pendingTrend={pendingTrend}
            scope={scope}
            setPendingTrend={setPendingTrend}
            tool={tool}
            trade={trade}
            updatePanel={updatePanel}
          />
          <div className="grid gap-3">
            {normalizedPanels.slice(1).map((panel) => (
              <ClosedTradeChartPanel
                key={panel.id}
                annotations={annotations}
                commitAnnotations={commitAnnotations}
                compact
                panel={panel}
                pendingTrend={pendingTrend}
                scope={scope}
                setPendingTrend={setPendingTrend}
                tool={tool}
                trade={trade}
                updatePanel={updatePanel}
              />
            ))}
          </div>
        </div>
      ) : (
        <div
          className={cn(
            "grid gap-3 p-3",
            layoutMode === "two-vertical" && "xl:grid-cols-2",
            layoutMode === "three-vertical" && "xl:grid-cols-3",
          )}
        >
          {normalizedPanels.map((panel) => (
            <ClosedTradeChartPanel
              key={panel.id}
              annotations={annotations}
              commitAnnotations={commitAnnotations}
              compact={layoutMode === "three-horizontal" || layoutMode === "three-vertical"}
              panel={panel}
              pendingTrend={pendingTrend}
              scope={scope}
              setPendingTrend={setPendingTrend}
              tool={tool}
              trade={trade}
              updatePanel={updatePanel}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ClosedTradeChartPanel({
  annotations,
  commitAnnotations,
  compact = false,
  panel,
  pendingTrend,
  scope,
  setPendingTrend,
  tool,
  trade,
  updatePanel,
}: {
  annotations: ChartAnnotation[];
  commitAnnotations: (annotations: ChartAnnotation[]) => void;
  compact?: boolean;
  panel: ChartPanelState;
  pendingTrend: PendingTrend;
  scope: AnnotationScope;
  setPendingTrend: (trend: PendingTrend) => void;
  tool: Tool;
  trade: ClosedTradeChartWorkspaceTrade;
  updatePanel: (panelId: string, patch: Partial<ChartPanelState>) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markerPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const smaRefs = useRef<Array<ISeriesApi<"Line">>>([]);
  const annotationLineRefs = useRef<IPriceLine[]>([]);
  const annotationSeriesRefs = useRef<Array<ISeriesApi<"Line">>>([]);
  const executionLineRefs = useRef<IPriceLine[]>([]);
  const updateExecutionOverlayPositionsRef = useRef<() => void>(() => undefined);
  const toolRef = useRef<Tool>(tool);
  const annotationsRef = useRef<ChartAnnotation[]>(annotations);
  const pendingTrendRef = useRef<PendingTrend>(pendingTrend);
  const panelRef = useRef<ChartPanelState>(panel);
  const scopeRef = useRef<AnnotationScope>(scope);
  const commitRef = useRef(commitAnnotations);
  const setPendingTrendRef = useRef(setPendingTrend);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [source, setSource] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [symbolInput, setSymbolInput] = useState(panel.symbol);
  const [timeframeInput, setTimeframeInput] = useState(timeframeCommand(panel.timeframe));
  const [executionOverlays, setExecutionOverlays] = useState<ExecutionOverlay[]>([]);
  const panelAnnotations = useMemo(
    () => annotations.filter((annotation) => annotationMatchesPanel(annotation, panel)),
    [annotations, panel],
  );
  const height = compact ? 360 : 560;

  useEffect(() => {
    toolRef.current = tool;
    annotationsRef.current = annotations;
    pendingTrendRef.current = pendingTrend;
    panelRef.current = panel;
    scopeRef.current = scope;
    commitRef.current = commitAnnotations;
    setPendingTrendRef.current = setPendingTrend;
  }, [annotations, commitAnnotations, panel, pendingTrend, scope, setPendingTrend, tool]);

  useEffect(() => setSymbolInput(panel.symbol), [panel.symbol]);
  useEffect(() => setTimeframeInput(timeframeCommand(panel.timeframe)), [panel.timeframe]);

  useEffect(() => {
    const controller = new AbortController();
    const url = new URL("/api/market/candles", window.location.origin);
    url.searchParams.set("symbol", panel.symbol);
    url.searchParams.set("timeframe", panel.timeframe);
    url.searchParams.set("limit", "30000");
    const range = rangeForPreset(trade, panel.timeframe, panel.rangePreset);
    if (range) {
      url.searchParams.set("from", String(range.from));
      url.searchParams.set("to", String(range.to));
    }

    setStatus("Loading bars...");
    fetch(url.toString(), { signal: controller.signal })
      .then(async (res) => {
        const payload = (await res.json().catch(() => ({}))) as CandleResponse;
        if (!res.ok) throw new Error(payload.error || "Unable to load candles.");
        return payload;
      })
      .then((payload) => {
        setCandles((payload.candles ?? []).filter((candle) => [candle.time, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)));
        setSource(payload.source ?? null);
        setStatus("");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setCandles([]);
        setSource(null);
        setStatus(error instanceof Error ? error.message : "Unable to load candles.");
      });

    return () => controller.abort();
  }, [panel.rangePreset, panel.symbol, panel.timeframe, trade]);

  const updateExecutionOverlayPositions = useCallback(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const container = containerRef.current;
    if (!chart || !series || !container || candles.length === 0) {
      setExecutionOverlays([]);
      return;
    }

    const offsetSeconds = inferExecutionOffsetSeconds(
      trade.executions.map((execution) => ({ executedAt: execution.executedAt, price: execution.price })),
      candles,
    );
    const width = container.clientWidth;
    const laneX = Math.max(48, width - 128);
    const raw = trade.executions.flatMap((execution, index): ExecutionOverlay[] => {
      const markerTime = alignExecutionToBarTime(execution.executedAt, candles, offsetSeconds);
      if (markerTime === null) return [];
      const x = chart.timeScale().timeToCoordinate(markerTime as UTCTimestamp);
      const y = series.priceToCoordinate(execution.price);
      if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) return [];
      return [{
        key: execution.id,
        label: `${execution.side} ${index + 1}`,
        detail: `${execution.quantity} @ ${execution.price.toFixed(2)}`,
        side: execution.side,
        x,
        y,
        laneX,
        laneY: y,
        price: execution.price,
      }];
    });

    const sorted = raw.sort((left, right) => left.y - right.y);
    const minGap = 42;
    let lastY = 24;
    for (const item of sorted) {
      item.laneY = Math.max(item.y, lastY + minGap);
      lastY = item.laneY;
    }
    const maxY = height - 30;
    for (let index = sorted.length - 1; index >= 0; index -= 1) {
      const item = sorted[index];
      item.laneY = Math.min(item.laneY, maxY - (sorted.length - 1 - index) * minGap);
    }
    for (let index = 1; index < sorted.length; index += 1) {
      sorted[index].laneY = Math.max(sorted[index].laneY, sorted[index - 1].laneY + minGap);
    }
    setExecutionOverlays(sorted);
  }, [candles, height, trade.executions]);

  useEffect(() => {
    updateExecutionOverlayPositionsRef.current = updateExecutionOverlayPositions;
  }, [updateExecutionOverlayPositions]);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#334155",
      },
      width: containerRef.current.clientWidth,
      height,
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#94a3b8", style: 3, labelBackgroundColor: "#0f172a" },
        horzLine: { color: "#94a3b8", style: 3, labelBackgroundColor: "#0f172a" },
      },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.10)" },
        horzLines: { color: "rgba(148, 163, 184, 0.12)" },
      },
      rightPriceScale: {
        borderColor: "#cbd5e1",
        scaleMargins: { top: 0.08, bottom: 0.18 },
      },
      timeScale: {
        borderColor: "#cbd5e1",
        rightOffset: 18,
        barSpacing: 8,
        minBarSpacing: 0.5,
        timeVisible: panel.timeframe !== "1d" && panel.timeframe !== "1wk",
        secondsVisible: false,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#ef4444",
      borderUpColor: "#059669",
      borderDownColor: "#dc2626",
      wickUpColor: "#059669",
      wickDownColor: "#dc2626",
      priceLineVisible: true,
      lastValueVisible: true,
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
      priceLineVisible: false,
      lastValueVisible: false,
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
    const smaSeries = SMA_CONFIG.map((config) =>
      chart.addSeries(LineSeries, {
        color: config.color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      }),
    );

    chartRef.current = chart;
    seriesRef.current = candleSeries;
    volumeRef.current = volumeSeries;
    smaRefs.current = smaSeries;
    markerPluginRef.current = createSeriesMarkers(candleSeries);

    const clickHandler = (param: MouseEventParams<Time>) => {
      const activeTool = toolRef.current;
      const activePanel = panelRef.current;
      if (activeTool === "cursor" || !seriesRef.current || !param.point) return;
      const time = toUnixSeconds(param.time);
      if (!time) return;
      const price = seriesRef.current.coordinateToPrice(param.point.y);
      if (typeof price !== "number" || !Number.isFinite(price)) return;

      const base = {
        id: crypto.randomUUID(),
        panelId: activePanel.id,
        symbol: activePanel.symbol,
        timeframe: activePanel.timeframe,
        scope: scopeRef.current,
        points: [{ time, price }],
      };

      if (activeTool === "horizontal") {
        commitRef.current([...annotationsRef.current, { ...base, type: "horizontal", price, style: { color: "#2563eb" } }]);
        return;
      }
      if (activeTool === "ray") {
        commitRef.current([...annotationsRef.current, { ...base, type: "ray", price, style: { color: "#2563eb" } }]);
        return;
      }
      if (activeTool === "trend") {
        const pending = pendingTrendRef.current;
        if (!pending || pending.panelId !== activePanel.id) {
          setPendingTrendRef.current({ panelId: activePanel.id, time, price });
          return;
        }
        commitRef.current([
          ...annotationsRef.current,
          {
            ...base,
            type: "trend",
            points: [
              { time: pending.time, price: pending.price },
              { time, price },
            ],
            style: { color: "#f59e0b" },
          },
        ]);
        setPendingTrendRef.current(null);
        return;
      }

      const text =
        activeTool === "text" || activeTool === "price-note"
          ? window.prompt("Annotation text", activeTool === "price-note" ? price.toFixed(2) : "")?.trim()
          : activeTool.toUpperCase();
      if (activeTool === "text" || activeTool === "price-note") {
        if (!text) return;
      }
      commitRef.current([
        ...annotationsRef.current,
        {
          ...base,
          type: activeTool,
          price,
          text: text || activeTool.toUpperCase(),
          style: { color: annotationColor({ ...base, type: activeTool, price, text } as ChartAnnotation) },
        },
      ]);
    };

    chart.subscribeClick(clickHandler);
    const resizeObserver = new ResizeObserver(() => {
      if (!containerRef.current) return;
      chart.applyOptions({ width: containerRef.current.clientWidth });
      updateExecutionOverlayPositionsRef.current();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.unsubscribeClick(clickHandler);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeRef.current = null;
      smaRefs.current = [];
      markerPluginRef.current = null;
    };
  }, [height, panel.timeframe]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    updateExecutionOverlayPositions();
    chart.timeScale().subscribeVisibleLogicalRangeChange(updateExecutionOverlayPositions);
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(updateExecutionOverlayPositions);
  }, [updateExecutionOverlayPositions]);

  useEffect(() => {
    if (!seriesRef.current) return;
    seriesRef.current.setData(candles.map((candle) => ({ ...candle, time: candle.time as UTCTimestamp })));
    volumeRef.current?.setData(
      candles.map((candle, index): HistogramData<Time> => {
        const previous = candles[index - 1];
        const positive = previous ? candle.close >= previous.close : candle.close >= candle.open;
        return {
          time: candle.time as UTCTimestamp,
          value: candle.volume ?? 0,
          color: positive ? "rgba(16, 185, 129, 0.42)" : "rgba(239, 68, 68, 0.38)",
        };
      }),
    );
    SMA_CONFIG.forEach((config, index) => {
      smaRefs.current[index]?.setData(buildSma(candles, config.period));
    });
    chartRef.current?.timeScale().fitContent();
    updateExecutionOverlayPositions();
  }, [candles, updateExecutionOverlayPositions]);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;

    for (const line of annotationLineRefs.current) series.removePriceLine(line);
    for (const line of executionLineRefs.current) series.removePriceLine(line);
    for (const annotationSeries of annotationSeriesRefs.current) chart.removeSeries(annotationSeries);
    annotationLineRefs.current = [];
    executionLineRefs.current = [];
    annotationSeriesRefs.current = [];

    for (const [index, execution] of trade.executions.entries()) {
      executionLineRefs.current.push(series.createPriceLine({
        price: execution.price,
        color: execution.side === "BUY" ? "#16a34a" : "#dc2626",
        lineStyle: 2,
        lineWidth: 2,
        axisLabelVisible: true,
        title: `${execution.side === "BUY" ? "B" : "S"}${index + 1}`,
      }));
    }

    const lastTime = candles.at(-1)?.time ?? Math.floor(Date.now() / 1000);
    const firstTime = candles[0]?.time ?? lastTime - 86400;
    const intervalSeconds = candles.length > 1 ? inferBarIntervalSeconds(candles) : 86400;
    for (const annotation of panelAnnotations) {
      const color = annotationColor(annotation);
      if (annotation.type === "horizontal" && typeof annotation.price === "number") {
        annotationLineRefs.current.push(series.createPriceLine({
          price: annotation.price,
          color,
          lineStyle: 2,
          lineWidth: 2,
          axisLabelVisible: true,
          title: annotation.text ?? "Line",
        }));
      }
      if (annotation.type === "ray" && annotation.points[0]) {
        const ray = chart.addSeries(LineSeries, { color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
        ray.setData([
          { time: annotation.points[0].time as UTCTimestamp, value: annotation.points[0].price },
          { time: Math.max(lastTime + intervalSeconds * 30, annotation.points[0].time + intervalSeconds * 30) as UTCTimestamp, value: annotation.points[0].price },
        ]);
        annotationSeriesRefs.current.push(ray);
      }
      if (annotation.type === "trend" && annotation.points.length >= 2) {
        const trend = chart.addSeries(LineSeries, { color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
        trend.setData([
          { time: Math.max(firstTime, annotation.points[0].time) as UTCTimestamp, value: annotation.points[0].price },
          { time: annotation.points[1].time as UTCTimestamp, value: annotation.points[1].price },
        ]);
        annotationSeriesRefs.current.push(trend);
      }
    }

    markerPluginRef.current?.setMarkers(
      panelAnnotations
        .filter((annotation) => !["horizontal", "ray", "trend"].includes(annotation.type))
        .flatMap((annotation): Array<SeriesMarker<Time>> => {
          const point = annotation.points[0];
          if (!point) return [];
          return [{
            time: point.time as UTCTimestamp,
            position: "atPriceMiddle",
            price: point.price,
            color: annotationColor(annotation),
            shape: markerShape(annotation),
            text: annotation.text ?? annotation.type.toUpperCase(),
          } as SeriesMarker<Time>];
        }),
    );
  }, [candles, panelAnnotations, trade.executions]);

  function commitSymbol() {
    const next = symbolInput.trim().toUpperCase();
    if (next) updatePanel(panel.id, { symbol: next });
  }

  function commitTimeframe() {
    updatePanel(panel.id, { timeframe: normalizeTimeframe(timeframeInput) });
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/70 px-3 py-2">
        <Input
          className="h-8 w-24 rounded-lg px-2 text-xs font-semibold"
          value={symbolInput}
          onBlur={commitSymbol}
          onChange={(event) => setSymbolInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          aria-label="Symbol"
        />
        <Input
          className="h-8 w-20 rounded-lg px-2 text-xs font-semibold"
          value={timeframeInput}
          onBlur={commitTimeframe}
          onChange={(event) => setTimeframeInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          aria-label="Timeframe"
        />
        <div className="flex items-center gap-1 overflow-x-auto">
          {RANGE_PRESETS.map((preset) => (
            <button
              key={preset.value}
              className={cn(
                "h-8 rounded-md px-2 text-xs font-semibold text-slate-600",
                panel.rangePreset === preset.value && "bg-slate-950 text-white",
              )}
              onClick={() => updatePanel(panel.id, { rangePreset: preset.value })}
              type="button"
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          <Badge variant={trade.realizedPnl >= 0 ? "success" : "danger"} className="tracking-normal">
            {formatCurrency(trade.realizedPnl)}
          </Badge>
          <span>{source ? source.toUpperCase() : "DATA"}</span>
          <span>{candles.length.toLocaleString()} bars</span>
        </div>
      </div>
      <div className="relative bg-white">
        <div ref={containerRef} className="w-full" style={{ height }} />
        <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full">
          {executionOverlays.map((item) => (
            <line
              key={`${item.key}-line`}
              x1={item.x}
              x2={item.laneX}
              y1={item.y}
              y2={item.laneY}
              stroke={item.side === "BUY" ? "#16a34a" : "#dc2626"}
              strokeDasharray="3 3"
              strokeWidth="1.5"
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 z-20">
          {executionOverlays.map((item) => (
            <div
              key={item.key}
              className={cn(
                "absolute flex h-9 min-w-[7rem] flex-col items-center justify-center rounded-md border px-2 text-[10px] font-bold leading-tight text-white shadow-sm",
                item.side === "BUY" ? "border-emerald-700 bg-emerald-600" : "border-red-700 bg-red-600",
              )}
              style={{ left: item.laneX, top: item.laneY - 18 }}
              title={`${item.label} @ ${item.price.toFixed(2)}`}
            >
              <span>{item.label}</span>
              <span className="font-medium opacity-90">{item.detail}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-3 py-2 text-xs text-slate-500">
        <div className="flex flex-wrap gap-2">
          {SMA_CONFIG.map((config) => (
            <span key={config.period} className="font-medium" style={{ color: config.color }}>
              SMA {config.period}
            </span>
          ))}
        </div>
        <span>{status || `${panel.symbol} ${timeframeCommand(panel.timeframe)}`}</span>
      </div>
    </section>
  );
}

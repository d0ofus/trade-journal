"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
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
  Maximize2,
  Minus,
  RefreshCw,
  RotateCcw,
  Rows2,
  Save,
  StickyNote,
  Target,
  Type,
  Undo2,
} from "lucide-react";
import { alignExecutionToBarTime, inferBarIntervalSeconds, inferExecutionOffsetSeconds } from "@/lib/charts/execution-marker-alignment";
import { prepareChartSeriesData } from "@/lib/charts/chart-series-data";
import { isReusableCandleResponse } from "@/lib/charts/candle-response-cache";
import {
  formatExecutionCandleDiagnosticWarning,
  getExecutionCandleDiagnostics,
} from "@/lib/charts/execution-candle-diagnostics";
import { buildPercentChangeSeries } from "@/lib/charts/relative-strength";
import { nextPendingSaveAfterSuccess, reconcileDesiredSave } from "@/lib/charts/save-queue-reconciliation";
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
  isStale?: boolean;
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

type SaveState = "clean" | "queued" | "saving" | "error" | "conflict";

export type ChartWorkspaceSaveActivity = {
  blocking: boolean;
  message: string;
  layoutSaveState: SaveState;
  annotationSaveState: SaveState;
};

type LayoutSaveJob = {
  epoch: number;
  groupKey: string;
  signature: string;
  structureSignature: string;
  layoutMode: LayoutMode;
  panels: ChartPanelState[];
};

type AnnotationSaveJob = {
  epoch: number;
  groupKey: string;
  signature: string;
  annotations: ChartAnnotation[];
};

type CandleResponse = {
  symbol?: string;
  timeframe?: string;
  candles?: Candle[];
  source?: string | null;
  metadata?: {
    requestedRange?: { from: number; to: number } | null;
    returnedRange?: { from: number; to: number } | null;
    barIntervalSeconds?: number | null;
    limit?: number;
    truncated?: boolean;
    warnings?: string[];
  } | null;
  compare?: {
    symbol?: string;
    candles?: Candle[];
    source?: string | null;
    metadata?: {
      warnings?: string[];
    } | null;
  } | null;
  compareError?: string | null;
  error?: string;
};

const DEFAULT_LAYOUT_MODE: LayoutMode = "one-plus-two";
const candleRequestInflight = new Map<string, Promise<CandleResponse>>();
const candleResponseCache = new Map<string, { expiresAt: number; payload: CandleResponse }>();
const CANDLE_RESPONSE_CACHE_TTL_MS = 5 * 60 * 1000;
const CANDLE_RESPONSE_CACHE_MAX_ENTRIES = 48;

function cachedCandleResponse(url: string) {
  const cached = candleResponseCache.get(url);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    candleResponseCache.delete(url);
    return null;
  }
  candleResponseCache.delete(url);
  candleResponseCache.set(url, cached);
  return cached.payload;
}

function rememberCandleResponse(url: string, payload: CandleResponse) {
  candleResponseCache.set(url, { expiresAt: Date.now() + CANDLE_RESPONSE_CACHE_TTL_MS, payload });
  while (candleResponseCache.size > CANDLE_RESPONSE_CACHE_MAX_ENTRIES) {
    const oldestKey = candleResponseCache.keys().next().value;
    if (!oldestKey) break;
    candleResponseCache.delete(oldestKey);
  }
}

function loadCandleResponse(url: string) {
  const cached = cachedCandleResponse(url);
  if (cached) return Promise.resolve(cached);

  const existing = candleRequestInflight.get(url);
  if (existing) return existing;

  const request = fetch(url).then(async (res) => {
    const payload = (await res.json().catch(() => ({}))) as CandleResponse;
    if (!res.ok) throw new Error(payload.error || "Unable to load candles.");
    const requiresComparison = new URLSearchParams(url.split("?", 2)[1] ?? "").has("compare");
    if (isReusableCandleResponse(payload, { requiresComparison })) rememberCandleResponse(url, payload);
    return payload;
  });
  candleRequestInflight.set(url, request);
  void request.then(
    () => candleRequestInflight.delete(url),
    () => candleRequestInflight.delete(url),
  );
  return request;
}

function candleRequestPath(
  panel: Pick<ChartPanelState, "symbol" | "timeframe" | "compareSymbol" | "rangePreset">,
  trade: Pick<ClosedTradeChartWorkspaceTrade, "openTime" | "closeTime">,
) {
  const params = new URLSearchParams();
  params.set("symbol", panel.symbol);
  params.set("timeframe", panel.timeframe);
  params.set("limit", String(candleLimitForPanel(panel.timeframe, panel.rangePreset)));
  if (panel.compareSymbol) params.set("compare", panel.compareSymbol);
  const range = rangeForPreset({ openTime: trade.openTime, closeTime: trade.closeTime }, panel.timeframe, panel.rangePreset);
  if (range) {
    params.set("from", String(range.from));
    params.set("to", String(range.to));
  }
  return `/api/market/candles?${params.toString()}`;
}

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
type ExecutionOverlayAnchor = {
  key: string;
  label: string;
  detail: string;
  side: "BUY" | "SELL";
  markerTime: number;
  markerIndex: number | null;
  price: number;
};
type PriceRange = { min: number; max: number } | null;
type ExecutionAnchorSnapshot = {
  anchors: ExecutionOverlayAnchor[];
  intervalSeconds: number;
  priceRange: PriceRange;
  symbol: string;
  timeframe: ChartTimeframe;
  rangePreset: RangePreset;
};
type StoredExecutionAnchorSnapshot = ExecutionAnchorSnapshot & { signature: string };

type ExecutionSignatureRow = [string, string, "BUY" | "SELL", number, number];

function executionAnchorsCoverExecutions(snapshot: ExecutionAnchorSnapshot | null | undefined, executions: Execution[]) {
  if (!snapshot || executions.length === 0) return false;
  const anchoredIds = new Set(snapshot.anchors.map((anchor) => anchor.key));
  return executions.every((execution) => anchoredIds.has(execution.id));
}

type VisibleRangeDraft = {
  visibleFrom: number;
  visibleTo: number;
};
type RestoreVisibleRangeOptions = {
  skipDuringInteraction?: boolean;
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

const TIMEFRAME_OPTIONS: Array<{ value: ChartTimeframe; label: string }> = [
  { value: "5m", label: "5M" },
  { value: "15m", label: "15M" },
  { value: "1h", label: "1H" },
  { value: "1d", label: "1D" },
  { value: "1wk", label: "1W" },
];

const SMA_CONFIG = [
  { period: 10, color: "#0284c7" },
  { period: 20, color: "#7c3aed" },
  { period: 50, color: "#d97706" },
  { period: 200, color: "#475569" },
] as const;
const SMA_PERIODS = SMA_CONFIG.map((config) => config.period);
const EXECUTION_LABEL_WIDTH = 136;
const EXECUTION_LABEL_HEIGHT = 36;
const EXECUTION_LABEL_MIN_GAP = 48;
const EXECUTION_LABEL_PANEL_PADDING = 8;
const EXECUTION_PRICE_AXIS_RESERVE = 56;
const EXECUTION_LINE_FORWARD_BARS = 8;
const VISIBLE_RANGE_DRAG_THRESHOLD_PX = 6;

const SYMBOL_PATTERN = /^[A-Z0-9.^=_-]{1,20}$/;

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

function secondsForTimeframe(timeframe: ChartTimeframe) {
  if (timeframe === "5m") return 5 * 60;
  if (timeframe === "10m") return 10 * 60;
  if (timeframe === "15m") return 15 * 60;
  if (timeframe === "1h") return 60 * 60;
  if (timeframe === "1wk") return 7 * 24 * 60 * 60;
  return 24 * 60 * 60;
}

function fallbackPanel(trade: Pick<ClosedTradeChartWorkspaceTrade, "symbol">, index: number): ChartPanelState {
  const timeframes: ChartTimeframe[] = ["5m", "1h", "1d"];
  return {
    id: `panel-${index + 1}`,
    symbol: trade.symbol,
    timeframe: timeframes[index] ?? "1d",
    compareSymbol: null,
    rangePreset: index === 0 || index === 2 ? "trade" : "post",
  };
}

function normalizePanels(trade: Pick<ClosedTradeChartWorkspaceTrade, "symbol">, panels: ChartPanelState[], layout: LayoutMode) {
  const count = panelCountForLayout(layout);
  const next = panels.slice(0, count);
  while (next.length < count) next.push(fallbackPanel(trade, next.length));
  return next.map((panel, index) => {
    const compareSymbol = panel.compareSymbol?.trim().toUpperCase() || null;
    const normalized = {
      ...fallbackPanel(trade, index),
      ...panel,
      id: panel.id || `panel-${index + 1}`,
      symbol: (panel.symbol || trade.symbol).trim().toUpperCase(),
      timeframe: normalizeTimeframe(panel.timeframe),
      compareSymbol: compareSymbol && SYMBOL_PATTERN.test(compareSymbol) ? compareSymbol : null,
    };
    if (normalized.compareSymbol === normalized.symbol) {
      normalized.compareSymbol = null;
    }
    return normalized;
  });
}

function rangeForPreset(trade: Pick<ClosedTradeChartWorkspaceTrade, "openTime" | "closeTime">, timeframe: ChartTimeframe, preset: RangePreset) {
  if (preset === "all") return null;
  const open = Math.floor(new Date(trade.openTime).getTime() / 1000);
  const close = Math.floor(new Date(trade.closeTime).getTime() / 1000);
  const reviewTo = Math.max(close + secondsForTimeframe(timeframe), close + 60);
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
  if (preset === "1m") return { from: Math.max(0, reviewTo - 31 * 24 * 60 * 60), to: reviewTo };
  if (preset === "3m") return { from: Math.max(0, reviewTo - 93 * 24 * 60 * 60), to: reviewTo };
  if (preset === "1y") return { from: Math.max(0, reviewTo - 365 * 24 * 60 * 60), to: reviewTo };
  if (preset === "ytd") {
    const closeDate = new Date(close * 1000);
    const start = Date.UTC(closeDate.getUTCFullYear(), 0, 1) / 1000;
    return { from: Math.floor(start), to: reviewTo };
  }

  return {
    from: Math.max(0, close - contextSeconds[timeframe]),
    to: Math.max(close + contextSeconds[timeframe], close + 60),
  };
}

function candleLimitForPanel(timeframe: ChartTimeframe, preset: RangePreset) {
  if (preset === "all") {
    return timeframe === "1d" || timeframe === "1wk" ? 10_000 : 30_000;
  }

  if (timeframe === "5m" || timeframe === "10m" || timeframe === "15m") {
    if (preset === "1y" || preset === "ytd") return 20_000;
    if (preset === "3m") return 12_000;
    if (preset === "1m") return 6_000;
    return 2_500;
  }

  if (timeframe === "1h") {
    if (preset === "1y" || preset === "ytd") return 4_000;
    if (preset === "3m") return 2_500;
    return 1_200;
  }

  return timeframe === "1wk" ? 750 : 1_500;
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

function annotationStyleString(annotation: ChartAnnotation, key: string) {
  const value = annotation.style?.[key];
  return typeof value === "string" ? value : "";
}

function annotationDedupKeys(annotation: ChartAnnotation) {
  const sourceExecutionId = annotationStyleString(annotation, "sourceExecutionId");
  const sourceKind = annotationStyleString(annotation, "sourceKind");
  const panelKey = `${annotation.panelId ?? ""}:${annotation.symbol}:${annotation.timeframe ?? ""}`;
  const keys = new Set<string>();
  if (sourceExecutionId) {
    keys.add(`${panelKey}:${annotation.type}:${sourceKind}:${sourceExecutionId}`);
  }
  keys.add(`${panelKey}:${annotation.type}:${annotation.price ?? ""}:${annotation.text ?? ""}`);
  keys.add(`${panelKey}:${annotation.type}:${annotation.points[0]?.time ?? ""}:${annotation.price ?? ""}:${annotation.text ?? ""}`);
  return keys;
}

function executionAnchorSnapshotSignature(snapshot: ExecutionAnchorSnapshot) {
  return JSON.stringify({
    intervalSeconds: snapshot.intervalSeconds,
    priceRange: snapshot.priceRange,
    symbol: snapshot.symbol,
    timeframe: snapshot.timeframe,
    rangePreset: snapshot.rangePreset,
    anchors: snapshot.anchors.map((anchor) => [
      anchor.key,
      anchor.side,
      anchor.markerTime,
      anchor.markerIndex,
      anchor.price,
      anchor.label,
      anchor.detail,
    ]),
  });
}

function executionLinePoints(anchor: ExecutionOverlayAnchor, snapshot: ExecutionAnchorSnapshot): [AnnotationPoint, AnnotationPoint] {
  const intervalSeconds = Math.max(60, snapshot.intervalSeconds || 0);
  const price = anchor.price;
  const range = snapshot.priceRange;
  const priceSpan = range ? Math.max(range.max - range.min, Math.abs(price) * 0.02, 0.01) : Math.max(Math.abs(price) * 0.02, 0.01);
  const priceDelta = priceSpan * 0.035;
  const sideDirection = anchor.side === "BUY" ? 1 : -1;
  return [
    { time: anchor.markerTime, price },
    { time: anchor.markerTime + intervalSeconds * EXECUTION_LINE_FORWARD_BARS, price: price + priceDelta * sideDirection },
  ];
}

function fallbackExecutionX(markerIndex: number | null, candleCount: number, width: number, priceAxisReserve: number) {
  if (markerIndex === null || markerIndex < 0 || candleCount === 0) return null;
  const leftPadding = 16;
  const plotWidth = Math.max(1, width - priceAxisReserve - leftPadding * 2);
  if (candleCount === 1) return leftPadding + plotWidth / 2;
  return leftPadding + (markerIndex / (candleCount - 1)) * plotWidth;
}

function fallbackExecutionY(price: number, priceRange: PriceRange, height: number) {
  if (!priceRange) return null;
  const min = priceRange.min;
  const max = priceRange.max;
  const range = max - min || Math.max(Math.abs(max), 1) * 0.02;
  const padding = range * 0.12;
  const top = max + padding;
  const bottom = min - padding;
  const drawableHeight = Math.max(1, height - 48);
  return 24 + ((top - price) / (top - bottom || 1)) * drawableHeight;
}

function annotationMatchesPanel(annotation: ChartAnnotation, panel: Pick<ChartPanelState, "id" | "symbol" | "timeframe">) {
  if (annotation.scope === "GLOBAL_SYMBOL") return annotation.symbol === panel.symbol;
  if (annotation.scope === "SYMBOL") {
    return annotation.symbol === panel.symbol && (!annotation.timeframe || annotation.timeframe === panel.timeframe);
  }
  if (annotation.panelId) {
    return annotation.panelId === panel.id && annotation.symbol === panel.symbol && (!annotation.timeframe || annotation.timeframe === panel.timeframe);
  }
  return annotation.symbol === panel.symbol && (!annotation.timeframe || annotation.timeframe === panel.timeframe);
}

function executionSnapshotMatchesPanel(snapshot: ExecutionAnchorSnapshot | null | undefined, panel: Pick<ChartPanelState, "symbol" | "timeframe" | "rangePreset">) {
  return Boolean(
    snapshot &&
      snapshot.symbol === panel.symbol &&
      snapshot.timeframe === panel.timeframe &&
      snapshot.rangePreset === panel.rangePreset,
  );
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

function layoutSignature(layoutMode: LayoutMode, panels: ChartPanelState[]) {
  return JSON.stringify({ layoutMode, panels });
}

function layoutStructureSignature(layoutMode: LayoutMode, panels: ChartPanelState[]) {
  return JSON.stringify({
    layoutMode,
    panels: panels.map((panel) => ({
      id: panel.id,
      symbol: panel.symbol,
      timeframe: panel.timeframe,
      compareSymbol: panel.compareSymbol,
      rangePreset: panel.rangePreset,
    })),
  });
}

function annotationSignature(annotations: ChartAnnotation[]) {
  return JSON.stringify(annotations.map(serializeForApi));
}

function annotationsFromSignature(signature: string): ChartAnnotation[] {
  return JSON.parse(signature) as ChartAnnotation[];
}

function executionOverlayIdentitySignature(overlays: ExecutionOverlay[]) {
  return overlays
    .map((item) => [
      item.key,
      item.label,
      item.detail,
      item.side,
      item.price,
    ].join(":"))
    .join("|");
}

function executionOverlayTransform(item: ExecutionOverlay) {
  return `translate3d(${item.laneX}px, ${item.laneY - EXECUTION_LABEL_HEIGHT / 2}px, 0)`;
}

function executionListSignature(executions: Execution[]) {
  return JSON.stringify(
    executions.map(
      (execution): ExecutionSignatureRow => [execution.id, execution.executedAt, execution.side, execution.quantity, execution.price],
    ),
  );
}

function executionsFromSignature(signature: string): Execution[] {
  const rows = JSON.parse(signature) as ExecutionSignatureRow[];
  return rows.map(([id, executedAt, side, quantity, price]) => ({
    id,
    executedAt,
    side,
    quantity,
    price,
    commission: 0,
    fees: 0,
  }));
}

export function ClosedTradeChartWorkspace({
  onSaveActivityChange,
  overlayRightReserve = 0,
  trade,
}: {
  onSaveActivityChange?: (activity: ChartWorkspaceSaveActivity) => void;
  overlayRightReserve?: number;
  trade: ClosedTradeChartWorkspaceTrade;
}) {
  const [writeLockReason, setWriteLockReason] = useState("");
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(DEFAULT_LAYOUT_MODE);
  const [panels, setPanels] = useState<ChartPanelState[]>(() => normalizePanels(trade, [], DEFAULT_LAYOUT_MODE));
  const [activePanelId, setActivePanelId] = useState("panel-1");
  const [focusedPanelId, setFocusedPanelId] = useState<string | null>(null);
  const [resetRequests, setResetRequests] = useState<Record<string, number>>({});
  const [annotations, setAnnotations] = useState<ChartAnnotation[]>([]);
  const [undoStack, setUndoStack] = useState<ChartAnnotation[][]>([]);
  const [tool, setTool] = useState<Tool>("cursor");
  const [scope, setScope] = useState<AnnotationScope>("TRADE");
  const [pendingTrend, setPendingTrend] = useState<PendingTrend>(null);
  const [layoutLoaded, setLayoutLoaded] = useState(false);
  const [annotationsLoaded, setAnnotationsLoaded] = useState(false);
  const [layoutStateGroupKey, setLayoutStateGroupKey] = useState(trade.groupKey);
  const [annotationStateGroupKey, setAnnotationStateGroupKey] = useState(trade.groupKey);
  const [deferSecondaryCandles, setDeferSecondaryCandles] = useState(true);
  const [layoutLoadError, setLayoutLoadError] = useState("");
  const [annotationLoadError, setAnnotationLoadError] = useState("");
  const [layoutStatus, setLayoutStatus] = useState("");
  const [annotationStatus, setAnnotationStatus] = useState("");
  const [layoutSaveState, setLayoutSaveState] = useState<SaveState>("clean");
  const [annotationSaveState, setAnnotationSaveState] = useState<SaveState>("clean");
  const [userEditedWorkspace, setUserEditedWorkspace] = useState(false);
  const [pendingVisibleRangePanelIds, setPendingVisibleRangePanelIds] = useState<string[]>([]);
  const [executionAnchorSnapshots, setExecutionAnchorSnapshots] = useState<Record<string, StoredExecutionAnchorSnapshot>>({});
  const [recoverableConflict, setRecoverableConflict] = useState(false);
  const [conflictReloading, setConflictReloading] = useState(false);
  const [layoutVersion, setLayoutVersion] = useState<number | null>(null);
  const [annotationVersion, setAnnotationVersion] = useState<number | null>(null);
  const layoutSaveStateRef = useRef<SaveState>("clean");
  const annotationSaveStateRef = useRef<SaveState>("clean");
  const layoutVersionRef = useRef<number | null>(null);
  const annotationVersionRef = useRef<number | null>(null);
  const onSaveActivityChangeRef = useRef(onSaveActivityChange);
  const workspaceEpochRef = useRef(0);
  const readOnlyRef = useRef(false);
  const layoutSaveTimerRef = useRef<number | null>(null);
  const annotationSaveTimerRef = useRef<number | null>(null);
  const layoutSaveInFlightRef = useRef(false);
  const annotationSaveInFlightRef = useRef(false);
  const pendingLayoutSaveRef = useRef<LayoutSaveJob | null>(null);
  const pendingAnnotationSaveRef = useRef<AnnotationSaveJob | null>(null);
  const visibleRangeFlushersRef = useRef(new Map<string, () => boolean>());
  const skipNextLayoutSaveRef = useRef(false);
  const skipNextAnnotationSaveRef = useRef(false);
  const lastSavedLayoutSignatureRef = useRef("");
  const lastSavedLayoutStructureSignatureRef = useRef("");
  const lastQueuedLayoutSignatureRef = useRef("");
  const lastSavedAnnotationSignatureRef = useRef("");
  const lastQueuedAnnotationSignatureRef = useRef("");
  const tradeGroupKey = trade.groupKey;
  const tradeSymbol = trade.symbol;
  const tradeIsStale = Boolean(trade.isStale);
  const tradeSymbolRef = useRef(tradeSymbol);
  const tradeIsStaleRef = useRef(tradeIsStale);
  const normalizedPanels = useMemo(() => normalizePanels({ symbol: tradeSymbol }, panels, layoutMode), [layoutMode, panels, tradeSymbol]);
  const currentLayoutStructureSignature = useMemo(
    () => layoutStructureSignature(layoutMode, normalizedPanels),
    [layoutMode, normalizedPanels],
  );
  const focusedPanel = focusedPanelId ? (normalizedPanels.find((panel) => panel.id === focusedPanelId) ?? null) : null;
  const groupPath = encodeURIComponent(tradeGroupKey);
  const loadFailureReason =
    layoutLoadError || annotationLoadError ? "Saved chart workspace failed to load. Retry before editing." : "";
  const loadingReason = !layoutLoaded || !annotationsLoaded ? "Loading saved chart workspace..." : "";
  const readOnlyReason = writeLockReason || loadFailureReason || loadingReason || (tradeIsStale ? "Stale trade: review workspace is read-only." : "");
  const readOnly = Boolean(readOnlyReason);
  const layoutStructureSaveBlocking =
    layoutSaveState !== "clean" && currentLayoutStructureSignature !== lastSavedLayoutStructureSignatureRef.current;
  const layoutOrDrawingSaveBlocking = layoutStructureSaveBlocking || annotationSaveState !== "clean";
  const markWorkspaceEdited = useCallback(() => {
    setUserEditedWorkspace(true);
  }, []);
  const handlePendingVisibleRangeChange = useCallback((panelId: string, pending: boolean) => {
    if (pending) {
      onSaveActivityChangeRef.current?.({
        blocking: true,
        message: "Chart range save pending.",
        layoutSaveState: layoutSaveStateRef.current,
        annotationSaveState: annotationSaveStateRef.current,
      });
    }
    setPendingVisibleRangePanelIds((current) => {
      const hasPanel = current.includes(panelId);
      if (pending) return hasPanel ? current : [...current, panelId];
      return hasPanel ? current.filter((id) => id !== panelId) : current;
    });
  }, []);
  const handleExecutionAnchorsChange = useCallback((panelId: string, snapshot: ExecutionAnchorSnapshot | null) => {
    setExecutionAnchorSnapshots((current) => {
      if (!snapshot) {
        if (!current[panelId]) return current;
        const next = { ...current };
        delete next[panelId];
        return next;
      }

      const signature = executionAnchorSnapshotSignature(snapshot);
      if (current[panelId]?.signature === signature) return current;
      return { ...current, [panelId]: { ...snapshot, signature } };
    });
  }, []);
  const handleRegisterVisibleRangeFlusher = useCallback((panelId: string, flusher: (() => boolean) | null) => {
    if (flusher) {
      visibleRangeFlushersRef.current.set(panelId, flusher);
    } else {
      visibleRangeFlushersRef.current.delete(panelId);
    }
  }, []);
  const flushPendingVisibleRanges = useCallback(() => {
    for (const flusher of visibleRangeFlushersRef.current.values()) flusher();
  }, []);
  const saveActivity = useMemo<ChartWorkspaceSaveActivity>(() => {
    const visibleRangePending = pendingVisibleRangePanelIds.length > 0;
    const saveBusy = layoutSaveState !== "clean" || annotationSaveState !== "clean" || visibleRangePending;
    const blocking = saveBusy;
    const message = [
      visibleRangePending ? "Chart range save pending." : "",
      layoutStatus,
      annotationStatus,
    ]
      .filter((status) => status && !status.toLowerCase().includes("ready"))
      .join(" ");

    return {
      blocking,
      message: message || "Chart workspace is still saving. Wait for layout and drawings to finish before switching trades.",
      layoutSaveState,
      annotationSaveState,
    };
  }, [
    annotationSaveState,
    annotationStatus,
    layoutSaveState,
    layoutStatus,
    pendingVisibleRangePanelIds.length,
  ]);

  useEffect(() => {
    if (layoutSaveState === "clean" || pendingVisibleRangePanelIds.length === 0) return;
    setPendingVisibleRangePanelIds([]);
  }, [layoutSaveState, pendingVisibleRangePanelIds.length]);

  useEffect(() => {
    const layoutDirty = layoutSignature(layoutMode, normalizedPanels) !== lastSavedLayoutSignatureRef.current;
    const annotationDirty = annotationSignature(annotations) !== lastSavedAnnotationSignatureRef.current;
    if (userEditedWorkspace && layoutSaveState === "clean" && annotationSaveState === "clean" && !layoutDirty && !annotationDirty) {
      setUserEditedWorkspace(false);
    }
  }, [annotationSaveState, annotations, layoutMode, layoutSaveState, normalizedPanels, userEditedWorkspace]);

  useEffect(() => {
    layoutVersionRef.current = layoutVersion;
  }, [layoutVersion]);

  useEffect(() => {
    annotationVersionRef.current = annotationVersion;
  }, [annotationVersion]);

  useLayoutEffect(() => {
    layoutSaveStateRef.current = layoutSaveState;
  }, [layoutSaveState]);

  useLayoutEffect(() => {
    annotationSaveStateRef.current = annotationSaveState;
  }, [annotationSaveState]);

  useLayoutEffect(() => {
    onSaveActivityChangeRef.current = onSaveActivityChange;
  }, [onSaveActivityChange]);

  useEffect(() => {
    tradeSymbolRef.current = tradeSymbol;
    tradeIsStaleRef.current = tradeIsStale;
  }, [tradeIsStale, tradeSymbol]);

  useEffect(() => {
    readOnlyRef.current = readOnly;
  }, [readOnly]);

  useEffect(() => {
    setExecutionAnchorSnapshots({});
  }, [tradeGroupKey]);

  useEffect(() => {
    setExecutionAnchorSnapshots((current) => {
      let changed = false;
      const next = { ...current };
      const panelById = new Map(normalizedPanels.map((panel) => [panel.id, panel]));
      for (const [panelId, snapshot] of Object.entries(current)) {
        const panel = panelById.get(panelId);
        if (!panel || !executionSnapshotMatchesPanel(snapshot, panel)) {
          delete next[panelId];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [normalizedPanels]);

  useLayoutEffect(() => {
    onSaveActivityChange?.(saveActivity);
  }, [onSaveActivityChange, saveActivity]);

  useEffect(() => {
    return () => {
      onSaveActivityChange?.({
        blocking: false,
        message: "",
        layoutSaveState: "clean",
        annotationSaveState: "clean",
      });
    };
  }, [onSaveActivityChange]);

  const clearLayoutSaveTimer = useCallback(() => {
    if (layoutSaveTimerRef.current != null) {
      window.clearTimeout(layoutSaveTimerRef.current);
      layoutSaveTimerRef.current = null;
    }
  }, []);

  const clearAnnotationSaveTimer = useCallback(() => {
    if (annotationSaveTimerRef.current != null) {
      window.clearTimeout(annotationSaveTimerRef.current);
      annotationSaveTimerRef.current = null;
    }
  }, []);

  const clearPendingWorkspaceSaves = useCallback(() => {
    clearLayoutSaveTimer();
    clearAnnotationSaveTimer();
    pendingLayoutSaveRef.current = null;
    pendingAnnotationSaveRef.current = null;
    lastQueuedLayoutSignatureRef.current = "";
    lastQueuedAnnotationSignatureRef.current = "";
    setPendingVisibleRangePanelIds([]);
  }, [clearAnnotationSaveTimer, clearLayoutSaveTimer]);

  const loadLayoutResource = useCallback(async (epoch = workspaceEpochRef.current) => {
    setLayoutLoadError("");
    setLayoutStatus("Loading layout...");

    try {
      const response = await fetch(`/api/closed-trades/${groupPath}/chart-layout`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : "Chart layout failed to load.");
      }
      if (epoch !== workspaceEpochRef.current) return false;

      const currentTradeSymbol = tradeSymbolRef.current;
      const currentTradeIsStale = tradeIsStaleRef.current;
      let nextLayoutMode = DEFAULT_LAYOUT_MODE;
      let nextPanels = normalizePanels({ symbol: currentTradeSymbol }, [], DEFAULT_LAYOUT_MODE);
      if (payload.layout?.layoutMode && Array.isArray(payload.layout.panels)) {
        nextLayoutMode = payload.layout.layoutMode as LayoutMode;
        nextPanels = normalizePanels({ symbol: currentTradeSymbol }, payload.layout.panels as ChartPanelState[], nextLayoutMode);
        setLayoutMode(nextLayoutMode);
        setPanels(nextPanels);
        const nextVersion = typeof payload.layout.version === "number" ? payload.layout.version : 1;
        layoutVersionRef.current = nextVersion;
        setLayoutVersion(nextVersion);
      } else {
        setLayoutMode(nextLayoutMode);
        setPanels(nextPanels);
        layoutVersionRef.current = 1;
        setLayoutVersion(1);
      }

      setLayoutStateGroupKey(tradeGroupKey);
      lastSavedLayoutSignatureRef.current = layoutSignature(nextLayoutMode, nextPanels);
      lastSavedLayoutStructureSignatureRef.current = layoutStructureSignature(nextLayoutMode, nextPanels);
      lastQueuedLayoutSignatureRef.current = "";
      skipNextLayoutSaveRef.current = true;
      setLayoutSaveState("clean");
      setLayoutLoaded(true);
      setLayoutStatus(currentTradeIsStale ? "Stale trade: layout read-only." : "Layout ready.");
      return true;
    } catch (error) {
      if (epoch !== workspaceEpochRef.current) return false;
      const message = error instanceof Error && error.message ? error.message : "Chart layout failed to load.";
      setLayoutLoaded(false);
      setLayoutLoadError(message);
      setLayoutStatus(message);
      return false;
    }
  }, [groupPath, tradeGroupKey]);

  const loadAnnotationResource = useCallback(async (epoch = workspaceEpochRef.current) => {
    setAnnotationLoadError("");
    setAnnotationStatus("Loading drawings...");

    try {
      const response = await fetch(`/api/closed-trades/${groupPath}/annotations`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : "Chart drawings failed to load.");
      }
      if (epoch !== workspaceEpochRef.current) return false;

      const nextAnnotations = Array.isArray(payload.annotations) ? (payload.annotations as ChartAnnotation[]) : [];
      const currentTradeIsStale = tradeIsStaleRef.current;
      setAnnotations(nextAnnotations);
      setAnnotationStateGroupKey(tradeGroupKey);
      lastSavedAnnotationSignatureRef.current = annotationSignature(nextAnnotations);
      lastQueuedAnnotationSignatureRef.current = "";
      const nextVersion = typeof payload.version === "number" ? payload.version : 1;
      annotationVersionRef.current = nextVersion;
      setAnnotationVersion(nextVersion);
      skipNextAnnotationSaveRef.current = true;
      setAnnotationSaveState("clean");
      setAnnotationsLoaded(true);
      setAnnotationStatus(currentTradeIsStale ? "Stale trade: drawings read-only." : "Drawings ready.");
      return true;
    } catch (error) {
      if (epoch !== workspaceEpochRef.current) return false;
      const message = error instanceof Error && error.message ? error.message : "Chart drawings failed to load.";
      setAnnotationsLoaded(false);
      setAnnotationLoadError(message);
      setAnnotationStatus(message);
      return false;
    }
  }, [groupPath, tradeGroupKey]);

  const retryLayoutLoad = useCallback(() => {
    void loadLayoutResource(workspaceEpochRef.current);
  }, [loadLayoutResource]);

  const retryAnnotationLoad = useCallback(() => {
    void loadAnnotationResource(workspaceEpochRef.current);
  }, [loadAnnotationResource]);

  const flushLayoutSaveQueue = useCallback(async () => {
    clearLayoutSaveTimer();
    if (layoutSaveInFlightRef.current || readOnlyRef.current) return;

    const job = pendingLayoutSaveRef.current;
    if (!job || job.epoch !== workspaceEpochRef.current) {
      pendingLayoutSaveRef.current = null;
      return;
    }

    pendingLayoutSaveRef.current = null;
    layoutSaveInFlightRef.current = true;
    setLayoutSaveState("saving");
    setLayoutStatus("Saving layout...");

    let shouldFlushNext = false;
    try {
      const response = await fetch(`/api/closed-trades/${encodeURIComponent(job.groupKey)}/chart-layout`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layoutMode: job.layoutMode, panels: job.panels, version: layoutVersionRef.current ?? undefined }),
      });
      const payload = await response.json().catch(() => ({}));
      if (job.epoch !== workspaceEpochRef.current) return;

      if (response.ok) {
        const nextVersion = typeof payload.layout?.version === "number" ? payload.layout.version : layoutVersionRef.current;
        layoutVersionRef.current = nextVersion;
        setLayoutVersion(nextVersion);
        lastSavedLayoutSignatureRef.current = job.signature;
        lastSavedLayoutStructureSignatureRef.current = job.structureSignature;
        pendingLayoutSaveRef.current = nextPendingSaveAfterSuccess<LayoutSaveJob>(
          job.signature,
          pendingLayoutSaveRef.current,
        );
        const hasQueuedLayoutSave = Boolean(pendingLayoutSaveRef.current);
        if (!hasQueuedLayoutSave) lastQueuedLayoutSignatureRef.current = "";
        setLayoutSaveState(hasQueuedLayoutSave ? "queued" : "clean");
        setLayoutStatus(hasQueuedLayoutSave ? "Layout save queued." : "Layout saved.");
        shouldFlushNext = hasQueuedLayoutSave;
      } else if (response.status === 409) {
        const message = typeof payload.error === "string" ? payload.error : "Layout changed in another tab. Refresh to continue.";
        const nextMessage = message.toLowerCase().includes("stale") ? "Stale trade: layout read-only." : message;
        const isStaleConflict = nextMessage.toLowerCase().includes("stale");
        clearPendingWorkspaceSaves();
        setLayoutSaveState("conflict");
        setRecoverableConflict(!isStaleConflict);
        setWriteLockReason(isStaleConflict ? nextMessage : `${nextMessage} Reload latest to discard local chart changes.`);
        setLayoutStatus(nextMessage);
        onSaveActivityChange?.({
          blocking: true,
          message: nextMessage,
          layoutSaveState: "conflict",
          annotationSaveState: annotationSaveStateRef.current,
        });
      } else {
        if (!pendingLayoutSaveRef.current) pendingLayoutSaveRef.current = job;
        setLayoutSaveState("error");
        setLayoutStatus("Layout save failed. Retry.");
        onSaveActivityChange?.({
          blocking: true,
          message: "Layout save failed. Retry.",
          layoutSaveState: "error",
          annotationSaveState: annotationSaveStateRef.current,
        });
      }
    } catch {
      if (job.epoch !== workspaceEpochRef.current) return;
      if (!pendingLayoutSaveRef.current) pendingLayoutSaveRef.current = job;
      setLayoutSaveState("error");
      setLayoutStatus("Layout save failed. Retry.");
      onSaveActivityChange?.({
        blocking: true,
        message: "Layout save failed. Retry.",
        layoutSaveState: "error",
        annotationSaveState: annotationSaveStateRef.current,
      });
    } finally {
      if (job.epoch === workspaceEpochRef.current) {
        layoutSaveInFlightRef.current = false;
        if (shouldFlushNext && !readOnlyRef.current) {
          void flushLayoutSaveQueue();
        }
      }
    }
  }, [clearLayoutSaveTimer, clearPendingWorkspaceSaves, onSaveActivityChange]);

  const flushAnnotationSaveQueue = useCallback(async () => {
    clearAnnotationSaveTimer();
    if (annotationSaveInFlightRef.current || readOnlyRef.current) return;

    const job = pendingAnnotationSaveRef.current;
    if (!job || job.epoch !== workspaceEpochRef.current) {
      pendingAnnotationSaveRef.current = null;
      return;
    }

    pendingAnnotationSaveRef.current = null;
    annotationSaveInFlightRef.current = true;
    setAnnotationSaveState("saving");
    setAnnotationStatus("Saving drawings...");

    let shouldFlushNext = false;
    try {
      const response = await fetch(`/api/closed-trades/${encodeURIComponent(job.groupKey)}/annotations`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ annotations: job.annotations.map(serializeForApi), version: annotationVersionRef.current ?? undefined }),
      });
      const payload = await response.json().catch(() => ({}));
      if (job.epoch !== workspaceEpochRef.current) return;

      if (response.ok) {
        const nextVersion = typeof payload.version === "number" ? payload.version : annotationVersionRef.current;
        annotationVersionRef.current = nextVersion;
        setAnnotationVersion(nextVersion);
        lastSavedAnnotationSignatureRef.current = job.signature;
        pendingAnnotationSaveRef.current = nextPendingSaveAfterSuccess<AnnotationSaveJob>(
          job.signature,
          pendingAnnotationSaveRef.current,
        );
        const hasQueuedAnnotationSave = Boolean(pendingAnnotationSaveRef.current);
        if (!hasQueuedAnnotationSave) lastQueuedAnnotationSignatureRef.current = "";
        setAnnotationSaveState(hasQueuedAnnotationSave ? "queued" : "clean");
        setAnnotationStatus(hasQueuedAnnotationSave ? "Drawing save queued." : "Drawings saved.");
        shouldFlushNext = hasQueuedAnnotationSave;
      } else if (response.status === 409) {
        const message = typeof payload.error === "string" ? payload.error : "Drawings changed in another tab. Refresh to continue.";
        const nextMessage = message.toLowerCase().includes("stale") ? "Stale trade: drawings read-only." : message;
        const isStaleConflict = nextMessage.toLowerCase().includes("stale");
        clearPendingWorkspaceSaves();
        setAnnotationSaveState("conflict");
        setRecoverableConflict(!isStaleConflict);
        setWriteLockReason(isStaleConflict ? nextMessage : `${nextMessage} Reload latest to discard local chart changes.`);
        setAnnotationStatus(nextMessage);
        onSaveActivityChange?.({
          blocking: true,
          message: nextMessage,
          layoutSaveState: layoutSaveStateRef.current,
          annotationSaveState: "conflict",
        });
      } else {
        if (!pendingAnnotationSaveRef.current) pendingAnnotationSaveRef.current = job;
        setAnnotationSaveState("error");
        setAnnotationStatus("Drawing save failed. Retry.");
        onSaveActivityChange?.({
          blocking: true,
          message: "Drawing save failed. Retry.",
          layoutSaveState: layoutSaveStateRef.current,
          annotationSaveState: "error",
        });
      }
    } catch {
      if (job.epoch !== workspaceEpochRef.current) return;
      if (!pendingAnnotationSaveRef.current) pendingAnnotationSaveRef.current = job;
      setAnnotationSaveState("error");
      setAnnotationStatus("Drawing save failed. Retry.");
      onSaveActivityChange?.({
        blocking: true,
        message: "Drawing save failed. Retry.",
        layoutSaveState: layoutSaveStateRef.current,
        annotationSaveState: "error",
      });
    } finally {
      if (job.epoch === workspaceEpochRef.current) {
        annotationSaveInFlightRef.current = false;
        if (shouldFlushNext && !readOnlyRef.current) {
          void flushAnnotationSaveQueue();
        }
      }
    }
  }, [clearAnnotationSaveTimer, clearPendingWorkspaceSaves, onSaveActivityChange]);

  const queueLayoutSave = useCallback((job: LayoutSaveJob) => {
    pendingLayoutSaveRef.current = job;
    lastQueuedLayoutSignatureRef.current = job.signature;
    const message = layoutSaveInFlightRef.current ? "Layout save queued." : "Layout save pending.";
    onSaveActivityChange?.({
      blocking: true,
      message,
      layoutSaveState: "queued",
      annotationSaveState,
    });
    setLayoutSaveState("queued");
    setLayoutStatus(message);

    clearLayoutSaveTimer();
    if (!layoutSaveInFlightRef.current) {
      layoutSaveTimerRef.current = window.setTimeout(() => {
        void flushLayoutSaveQueue();
      }, 650);
    }
  }, [annotationSaveState, clearLayoutSaveTimer, flushLayoutSaveQueue, onSaveActivityChange]);

  const queueAnnotationSave = useCallback((job: AnnotationSaveJob) => {
    pendingAnnotationSaveRef.current = job;
    lastQueuedAnnotationSignatureRef.current = job.signature;
    const message = annotationSaveInFlightRef.current ? "Drawing save queued." : "Drawing save pending.";
    onSaveActivityChange?.({
      blocking: true,
      message,
      layoutSaveState,
      annotationSaveState: "queued",
    });
    setAnnotationSaveState("queued");
    setAnnotationStatus(message);

    clearAnnotationSaveTimer();
    if (!annotationSaveInFlightRef.current) {
      annotationSaveTimerRef.current = window.setTimeout(() => {
        void flushAnnotationSaveQueue();
      }, 700);
    }
  }, [clearAnnotationSaveTimer, flushAnnotationSaveQueue, layoutSaveState, onSaveActivityChange]);

  const retryLayoutSave = useCallback(() => {
    void flushLayoutSaveQueue();
  }, [flushLayoutSaveQueue]);

  const retryAnnotationSave = useCallback(() => {
    void flushAnnotationSaveQueue();
  }, [flushAnnotationSaveQueue]);

  useEffect(() => {
    if (!saveActivity.blocking) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [saveActivity.blocking]);

  useEffect(() => {
    if (!layoutLoaded) {
      setDeferSecondaryCandles(true);
      return;
    }

    setDeferSecondaryCandles(true);
    const timeoutId = window.setTimeout(() => {
      setDeferSecondaryCandles(false);
    }, 220);

    return () => window.clearTimeout(timeoutId);
  }, [layoutLoaded, layoutMode, tradeGroupKey]);

  useEffect(() => {
    const flushPendingSaves = () => {
      if (pendingLayoutSaveRef.current && !layoutSaveInFlightRef.current) void flushLayoutSaveQueue();
      if (pendingAnnotationSaveRef.current && !annotationSaveInFlightRef.current) void flushAnnotationSaveQueue();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushPendingSaves();
    };

    window.addEventListener("pagehide", flushPendingSaves);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flushPendingSaves);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [flushAnnotationSaveQueue, flushLayoutSaveQueue]);

  const reloadLatestWorkspace = useCallback(async () => {
    if (!recoverableConflict || conflictReloading) return;

    setConflictReloading(true);
    clearPendingWorkspaceSaves();
    setPendingTrend(null);
    setUndoStack([]);
    setLayoutStatus("Reloading latest layout...");
    setAnnotationStatus("Reloading latest drawings...");

    const [layoutOk, annotationsOk] = await Promise.all([
      loadLayoutResource(workspaceEpochRef.current),
      loadAnnotationResource(workspaceEpochRef.current),
    ]);

    setConflictReloading(false);

    if (layoutOk && annotationsOk) {
      const currentTradeIsStale = tradeIsStaleRef.current;
      clearPendingWorkspaceSaves();
      setRecoverableConflict(false);
      setWriteLockReason("");
      setLayoutStatus(currentTradeIsStale ? "Stale trade: layout read-only." : "Latest layout loaded.");
      setAnnotationStatus(currentTradeIsStale ? "Stale trade: drawings read-only." : "Latest drawings loaded.");
    } else {
      setWriteLockReason("Saved chart workspace failed to reload. Retry before editing.");
    }
  }, [
    clearPendingWorkspaceSaves,
    conflictReloading,
    loadAnnotationResource,
    loadLayoutResource,
    recoverableConflict,
  ]);

  useEffect(() => {
    const currentTradeSymbol = tradeSymbolRef.current;
    const currentTradeIsStale = tradeIsStaleRef.current;
    const epoch = workspaceEpochRef.current + 1;
    workspaceEpochRef.current = epoch;
    clearLayoutSaveTimer();
    clearAnnotationSaveTimer();
    pendingLayoutSaveRef.current = null;
    pendingAnnotationSaveRef.current = null;
    layoutSaveInFlightRef.current = false;
    annotationSaveInFlightRef.current = false;
    setLayoutLoaded(false);
    setAnnotationsLoaded(false);
    setLayoutStateGroupKey(tradeGroupKey);
    setAnnotationStateGroupKey(tradeGroupKey);
    setLayoutLoadError("");
    setAnnotationLoadError("");
    setLayoutSaveState("clean");
    setAnnotationSaveState("clean");
    setRecoverableConflict(false);
    setConflictReloading(false);
    setLayoutMode(DEFAULT_LAYOUT_MODE);
    setPanels(normalizePanels({ symbol: currentTradeSymbol }, [], DEFAULT_LAYOUT_MODE));
    setActivePanelId("panel-1");
    setFocusedPanelId(null);
    setResetRequests({});
    setAnnotations([]);
    setUndoStack([]);
    setPendingTrend(null);
    setLayoutVersion(null);
    setAnnotationVersion(null);
    layoutVersionRef.current = null;
    annotationVersionRef.current = null;
    setWriteLockReason("");
    setLayoutStatus(currentTradeIsStale ? "Stale trade: layout read-only." : "");
    setAnnotationStatus(currentTradeIsStale ? "Stale trade: drawings read-only." : "");
    lastSavedLayoutSignatureRef.current = "";
    lastSavedLayoutStructureSignatureRef.current = "";
    lastQueuedLayoutSignatureRef.current = "";
    lastSavedAnnotationSignatureRef.current = "";

    void loadLayoutResource(epoch);
    void loadAnnotationResource(epoch);

    return () => {
      if (pendingLayoutSaveRef.current && !layoutSaveInFlightRef.current) void flushLayoutSaveQueue();
      if (pendingAnnotationSaveRef.current && !annotationSaveInFlightRef.current) void flushAnnotationSaveQueue();
      clearLayoutSaveTimer();
      clearAnnotationSaveTimer();
    };
  }, [
    clearAnnotationSaveTimer,
    clearLayoutSaveTimer,
    flushAnnotationSaveQueue,
    flushLayoutSaveQueue,
    loadAnnotationResource,
    loadLayoutResource,
    tradeGroupKey,
  ]);

  useEffect(() => {
    if (layoutLoaded && layoutSaveState === "clean" && !layoutLoadError) {
      setLayoutStatus(tradeIsStale ? "Stale trade: layout read-only." : "Layout ready.");
    }
    if (annotationsLoaded && annotationSaveState === "clean" && !annotationLoadError) {
      setAnnotationStatus(tradeIsStale ? "Stale trade: drawings read-only." : "Drawings ready.");
    }
  }, [
    annotationLoadError,
    annotationSaveState,
    annotationsLoaded,
    layoutLoadError,
    layoutLoaded,
    layoutSaveState,
    tradeIsStale,
  ]);

  useEffect(() => {
    if (!layoutLoaded || readOnly || layoutStateGroupKey !== tradeGroupKey) return;
    if (skipNextLayoutSaveRef.current) {
      skipNextLayoutSaveRef.current = false;
      return;
    }
    const signature = layoutSignature(layoutMode, normalizedPanels);
    const structureSignature = currentLayoutStructureSignature;
    const action = reconcileDesiredSave({
      desiredSignature: signature,
      inFlight: layoutSaveInFlightRef.current,
      queuedSignature: lastQueuedLayoutSignatureRef.current,
      savedSignature: lastSavedLayoutSignatureRef.current,
    });
    if (action === "cancel") {
      pendingLayoutSaveRef.current = null;
      lastQueuedLayoutSignatureRef.current = "";
      clearLayoutSaveTimer();
      setLayoutSaveState("clean");
      setLayoutStatus(tradeIsStale ? "Stale trade: layout read-only." : "Layout ready.");
      return;
    }
    if (action === "ignore") return;
    queueLayoutSave({
      epoch: workspaceEpochRef.current,
      groupKey: tradeGroupKey,
      signature,
      structureSignature,
      layoutMode,
      panels: normalizedPanels,
    });
  }, [
    clearLayoutSaveTimer,
    currentLayoutStructureSignature,
    layoutLoaded,
    layoutMode,
    layoutStateGroupKey,
    normalizedPanels,
    queueLayoutSave,
    readOnly,
    tradeGroupKey,
    tradeIsStale,
  ]);

  useEffect(() => {
    if (!annotationsLoaded || readOnly || annotationStateGroupKey !== tradeGroupKey) return;
    if (skipNextAnnotationSaveRef.current) {
      skipNextAnnotationSaveRef.current = false;
      return;
    }
    const signature = annotationSignature(annotations);
    const action = reconcileDesiredSave({
      desiredSignature: signature,
      inFlight: annotationSaveInFlightRef.current,
      queuedSignature: lastQueuedAnnotationSignatureRef.current,
      savedSignature: lastSavedAnnotationSignatureRef.current,
    });
    if (action === "cancel") {
      pendingAnnotationSaveRef.current = null;
      lastQueuedAnnotationSignatureRef.current = "";
      clearAnnotationSaveTimer();
      setAnnotationSaveState("clean");
      setAnnotationStatus(tradeIsStale ? "Stale trade: drawings read-only." : "Drawings ready.");
      return;
    }
    if (action === "ignore") return;
    queueAnnotationSave({
      epoch: workspaceEpochRef.current,
      groupKey: tradeGroupKey,
      signature,
      annotations,
    });
  }, [
    annotationStateGroupKey,
    annotations,
    annotationsLoaded,
    clearAnnotationSaveTimer,
    queueAnnotationSave,
    readOnly,
    tradeGroupKey,
    tradeIsStale,
  ]);

  const commitAnnotations = useCallback((next: ChartAnnotation[]) => {
    if (readOnly) return;
    if (annotationSignature(next) === annotationSignature(annotations)) return;
    markWorkspaceEdited();
    setUndoStack((current) => [...current.slice(-24), annotations]);
    setAnnotations(next);
  }, [annotations, markWorkspaceEdited, readOnly]);

  const updatePanel = useCallback((panelId: string, patch: Partial<ChartPanelState>, options?: { userEdit?: boolean }) => {
    if (readOnly) return;
    const currentPanel = panels.find((panel) => panel.id === panelId);
    const changed = currentPanel ? Object.entries(patch).some(([key, value]) => currentPanel[key as keyof ChartPanelState] !== value) : true;
    if (!changed) return;
    if (options?.userEdit) markWorkspaceEdited();
    setPanels((current) => {
      let updated = false;
      const nextPanels = current.map((panel) => {
        if (panel.id !== panelId) return panel;
        const next = { ...panel, ...patch };
        const unchanged = (Object.keys(next) as Array<keyof ChartPanelState>).every((key) => next[key] === panel[key]);
        if (!unchanged) updated = true;
        return unchanged ? panel : next;
      });
      return updated ? nextPanels : current;
    });
  }, [markWorkspaceEdited, panels, readOnly]);

  const resetActivePanelView = useCallback(() => {
    if (readOnly) return;
    markWorkspaceEdited();
    const targetPanelId = normalizedPanels.some((panel) => panel.id === activePanelId)
      ? activePanelId
      : (normalizedPanels[0]?.id ?? "panel-1");
    setActivePanelId(targetPanelId);
    setPanels((current) => {
      let changed = false;
      const nextPanels = current.map((panel) => {
        if (panel.id !== targetPanelId) return panel;
        if (panel.visibleFrom == null && panel.visibleTo == null) return panel;
        changed = true;
        return { ...panel, visibleFrom: null, visibleTo: null };
      });
      return changed ? nextPanels : current;
    });
    setResetRequests((current) => ({
      ...current,
      [targetPanelId]: (current[targetPanelId] ?? 0) + 1,
    }));
  }, [activePanelId, markWorkspaceEdited, normalizedPanels, readOnly]);

  useEffect(() => {
    const activeStillVisible = normalizedPanels.some((panel) => panel.id === activePanelId);
    if (!activeStillVisible && normalizedPanels[0]) {
      setActivePanelId(normalizedPanels[0].id);
    }
  }, [activePanelId, normalizedPanels]);

  useEffect(() => {
    if (!focusedPanelId) return;
    if (!normalizedPanels.some((panel) => panel.id === focusedPanelId)) {
      setFocusedPanelId(null);
    }
  }, [focusedPanelId, normalizedPanels]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.key.toLowerCase() !== "r") {
        return;
      }
      event.preventDefault();
      resetActivePanelView();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [resetActivePanelView]);

  function selectLayout(nextLayout: LayoutMode) {
    if (readOnly) return;
    if (nextLayout !== layoutMode) {
      flushPendingVisibleRanges();
      markWorkspaceEdited();
    }
    setFocusedPanelId(null);
    setLayoutMode(nextLayout);
    setPanels((current) => normalizePanels({ symbol: tradeSymbol }, current, nextLayout));
  }

  function toggleFocusedPanel() {
    if (readOnly || layoutStructureSaveBlocking || annotationSaveStateRef.current !== "clean") return;
    if (focusedPanelId) {
      setFocusedPanelId(null);
      return;
    }
    const targetPanelId = normalizedPanels.some((panel) => panel.id === activePanelId)
      ? activePanelId
      : (normalizedPanels[0]?.id ?? null);
    if (!targetPanelId) return;
    setActivePanelId(targetPanelId);
    setFocusedPanelId(targetPanelId);
  }

  function undo() {
    if (readOnly) return;
    if (undoStack.length === 0) return;
    markWorkspaceEdited();
    setUndoStack((current) => {
      const previous = current.at(-1);
      if (!previous) return current;
      setAnnotations(previous);
      return current.slice(0, -1);
    });
  }

  function clearDrawings() {
    if (readOnly) return;
    commitAnnotations([]);
    setPendingTrend(null);
  }

  function addExecutionMarkerAnnotations() {
    if (readOnly) return;
    const targetPanel = normalizedPanels.find((panel) => panel.id === activePanelId) ?? normalizedPanels[0];
    if (!targetPanel || targetPanel.symbol !== trade.symbol) return;

    const activeSnapshot = executionAnchorSnapshots[targetPanel.id];
    if (
      !activeSnapshot ||
      !executionSnapshotMatchesPanel(activeSnapshot, targetPanel) ||
      !executionAnchorsCoverExecutions(activeSnapshot, trade.executions)
    ) {
      setAnnotationStatus("Execution markers need matching candles for every fill.");
      return;
    }
    const anchorsByExecutionId = new Map(activeSnapshot?.anchors.map((anchor) => [anchor.key, anchor]) ?? []);
    const existingKeys = new Set<string>();
    for (const annotation of annotations) {
      for (const key of annotationDedupKeys(annotation)) {
        existingKeys.add(key);
      }
    }
    const next = [...annotations];
    for (const [index, execution] of trade.executions.entries()) {
      const type = execution.side === "BUY" ? "entry" : "exit";
      const anchor = anchorsByExecutionId.get(execution.id);
      if (!anchor) {
        setAnnotationStatus("Execution markers need matching candles for every fill.");
        return;
      }
      const text = `${execution.side} ${index + 1} ${execution.quantity} @ ${execution.price.toFixed(2)}`;
      const color = execution.side === "BUY" ? "#16a34a" : "#dc2626";
      const markerAnnotation: ChartAnnotation = {
        id: crypto.randomUUID(),
        panelId: targetPanel.id,
        symbol: trade.symbol,
        timeframe: targetPanel.timeframe,
        scope: "TRADE",
        type,
        points: [{ time: anchor.markerTime, price: execution.price }],
        price: execution.price,
        text,
        style: { color, sourceExecutionId: execution.id, sourceKind: "marker" },
      };
      if (![...annotationDedupKeys(markerAnnotation)].some((key) => existingKeys.has(key))) {
        next.push(markerAnnotation);
        for (const key of annotationDedupKeys(markerAnnotation)) existingKeys.add(key);
      }

      const lineAnnotation: ChartAnnotation = {
        id: crypto.randomUUID(),
        panelId: targetPanel.id,
        symbol: trade.symbol,
        timeframe: targetPanel.timeframe,
        scope: "TRADE",
        type: "execution-line",
        points: executionLinePoints(anchor, activeSnapshot),
        price: execution.price,
        text,
        style: { color, sourceExecutionId: execution.id, sourceKind: "line", side: execution.side },
      };
      if (![...annotationDedupKeys(lineAnnotation)].some((key) => existingKeys.has(key))) {
        next.push(lineAnnotation);
        for (const key of annotationDedupKeys(lineAnnotation)) existingKeys.add(key);
      }
    }
    commitAnnotations(next);
  }

  const toolIcon = TOOL_OPTIONS.find((option) => option.value === tool)?.icon ?? Crosshair;
  const ToolIcon = toolIcon;
  const shouldRenderChartPanels = layoutLoaded || Boolean(layoutLoadError);
  const visibleRangeStatus = pendingVisibleRangePanelIds.length > 0 ? "Chart range save pending." : "";
  const focusButtonDisabled = readOnly || layoutOrDrawingSaveBlocking || normalizedPanels.length <= 1;
  const activePanelForMarkers = normalizedPanels.find((panel) => panel.id === activePanelId) ?? normalizedPanels[0];
  const markerSnapshot = activePanelForMarkers ? executionAnchorSnapshots[activePanelForMarkers.id] : null;
  const markersReady = Boolean(
    activePanelForMarkers &&
      markerSnapshot &&
      activePanelForMarkers.symbol === trade.symbol &&
      executionSnapshotMatchesPanel(markerSnapshot, activePanelForMarkers) &&
      executionAnchorsCoverExecutions(markerSnapshot, trade.executions),
  );
  const markersDisabled = readOnly || !markersReady;
  const markersDisabledTitle = readOnly
    ? "Chart workspace is read-only"
    : "Wait for matching candles on every fill before storing execution markers";
  const renderPanelSlot = (panel: ChartPanelState, index: number) => {
    const isFocusedPanel = focusedPanel?.id === panel.id;
    const hiddenByFocus = Boolean(focusedPanel) && !isFocusedPanel;
    const featured = focusedPanel ? isFocusedPanel : layoutMode === "one-plus-two" && index === 0;
    const compact = !focusedPanel && (
      layoutMode === "three-horizontal"
      || layoutMode === "three-vertical"
      || (layoutMode === "one-plus-two" && index > 0)
    );

    return (
      <div
        key={panel.id}
        aria-hidden={hiddenByFocus || undefined}
        className={hiddenByFocus ? "hidden" : "contents"}
        data-chart-panel-slot={panel.id}
      >
        <ClosedTradeChartPanel
          annotations={annotations}
          commitAnnotations={commitAnnotations}
          active={isFocusedPanel || panel.id === activePanelId}
          compact={compact}
          deferCandles={!layoutLoaded || (deferSecondaryCandles && panel.id !== activePanelId)}
          featured={featured}
          overlayRightReserve={overlayRightReserve}
          panel={panel}
          pendingTrend={pendingTrend}
          onExecutionAnchorsChange={handleExecutionAnchorsChange}
          onPendingVisibleRangeChange={handlePendingVisibleRangeChange}
          onRegisterVisibleRangeFlusher={handleRegisterVisibleRangeFlusher}
          resetSignal={resetRequests[panel.id] ?? 0}
          scope={scope}
          setPendingTrend={setPendingTrend}
          tool={tool}
          trade={trade}
          onActivate={setActivePanelId}
          readOnly={readOnly}
          updatePanel={updatePanel}
        />
      </div>
    );
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-white"
      data-annotation-save-state={annotationSaveState}
      data-layout-save-state={layoutSaveState}
      data-save-blocking={saveActivity.blocking ? "true" : "false"}
      data-testid="closed-trade-chart-workspace"
    >
      <div className="shrink-0 flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-3">
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
          {LAYOUT_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <button
              key={option.value}
              type="button"
              disabled={readOnly}
              aria-pressed={layoutMode === option.value}
              className={cn(
                "inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-semibold text-slate-600",
                layoutMode === option.value && "bg-slate-950 text-white",
                readOnly && "cursor-not-allowed opacity-50",
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

        <Button
          size="sm"
          variant={focusedPanel ? "default" : "outline"}
          onClick={toggleFocusedPanel}
          disabled={focusButtonDisabled}
          title={focusedPanel ? "Show all chart panels" : "Focus active chart panel"}
          data-testid="chart-panel-focus-toggle"
        >
          <Maximize2 className="h-4 w-4" />
          {focusedPanel ? "Show all" : "Focus"}
        </Button>

        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {TOOL_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <button
              key={option.value}
              type="button"
              disabled={readOnly}
              aria-pressed={tool === option.value}
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600",
                tool === option.value && "bg-slate-950 text-white",
                readOnly && "cursor-not-allowed opacity-50",
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
              disabled={readOnly}
              aria-pressed={scope === option}
              className={cn("h-8 rounded-md px-2 text-slate-600", scope === option && "bg-sky-50 text-sky-700")}
              onClick={() => setScope(option)}
            >
              {option === "TRADE" ? "Trade" : "Share"}
            </button>
          ))}
        </div>

        <Button size="sm" variant="outline" onClick={undo} disabled={readOnly || undoStack.length === 0} title="Undo">
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="outline" onClick={resetActivePanelView} disabled={readOnly} title="Reset active chart view (Alt+R)">
          <RotateCcw className="h-4 w-4" />
          Reset
        </Button>
        <Button size="sm" variant="outline" onClick={clearDrawings} disabled={readOnly} title="Clear drawings">
          <Eraser className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={addExecutionMarkerAnnotations}
          disabled={markersDisabled}
          title={markersDisabled ? markersDisabledTitle : "Store execution markers"}
        >
          <GitCompare className="h-4 w-4" />
          Markers
        </Button>

        <div className="ml-auto flex flex-wrap items-center gap-2 text-xs text-slate-500">
          {recoverableConflict ? (
            <Button
              size="sm"
              variant="outline"
              onClick={reloadLatestWorkspace}
              disabled={conflictReloading || layoutSaveState === "saving" || annotationSaveState === "saving"}
              className="h-7 gap-1 px-2 text-xs"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Reload latest
            </Button>
          ) : null}
          {layoutLoadError ? (
            <Button size="sm" variant="outline" onClick={retryLayoutLoad} className="h-7 px-2 text-xs">
              Retry chart layout
            </Button>
          ) : null}
          {layoutSaveState === "error" ? (
            <Button size="sm" variant="outline" onClick={retryLayoutSave} className="h-7 px-2 text-xs">
              Retry layout save
            </Button>
          ) : null}
          {annotationLoadError ? (
            <Button size="sm" variant="outline" onClick={retryAnnotationLoad} className="h-7 px-2 text-xs">
              Retry drawings
            </Button>
          ) : null}
          {annotationSaveState === "error" ? (
            <Button size="sm" variant="outline" onClick={retryAnnotationSave} className="h-7 px-2 text-xs">
              Retry drawing save
            </Button>
          ) : null}
          {readOnly ? (
            <>
              <Badge variant="outline" className="tracking-normal text-amber-700">
                Read-only
              </Badge>
              {readOnlyReason ? <span className="max-w-[24rem] truncate text-amber-700">{readOnlyReason}</span> : null}
              <span className="hidden md:inline">|</span>
            </>
          ) : null}
          <span className="inline-flex items-center gap-1">
            <ToolIcon className="h-3.5 w-3.5" />
            {pendingTrend ? "Select second trend point" : TOOL_OPTIONS.find((option) => option.value === tool)?.label}
          </span>
          <span className="hidden md:inline">|</span>
          <span>{visibleRangeStatus || layoutStatus || "Layout ready."}</span>
          <span className="hidden md:inline">|</span>
          <span>{annotationStatus || "Drawings ready."}</span>
          <Save className="h-3.5 w-3.5 text-slate-400" />
        </div>
      </div>

      {!shouldRenderChartPanels ? (
        <ChartWorkspaceLoadingShell layoutMode={layoutMode} />
      ) : (
        <div
          className={cn(
            "grid min-h-0 flex-1 gap-3 p-3",
            !focusedPanel && layoutMode === "one-plus-two" && "xl:grid-cols-[minmax(0,1.7fr)_minmax(18rem,0.9fr)] xl:items-stretch",
            !focusedPanel && layoutMode === "two-vertical" && "xl:grid-cols-2",
            !focusedPanel && layoutMode === "three-vertical" && "xl:grid-cols-3",
          )}
          data-testid={focusedPanel ? "focused-chart-panel-view" : "chart-panel-grid"}
        >
          {renderPanelSlot(normalizedPanels[0], 0)}
          <div
            className={cn(
              !focusedPanel && layoutMode === "one-plus-two"
                ? "grid min-h-0 gap-3 xl:h-full xl:grid-rows-2"
                : "contents",
            )}
          >
            {normalizedPanels.slice(1).map((panel, index) => renderPanelSlot(panel, index + 1))}
          </div>
        </div>
      )}
    </div>
  );
}

function ChartWorkspaceLoadingShell({ layoutMode }: { layoutMode: LayoutMode }) {
  const count = panelCountForLayout(layoutMode);
  const skeleton = (key: string, compact = false) => (
    <section
      key={key}
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-lg border border-slate-200 bg-slate-100",
        compact ? "min-h-[300px]" : "min-h-[520px]",
      )}
    />
  );

  if (layoutMode === "one-plus-two") {
    return (
      <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]" data-testid="chart-layout-loading">
        {skeleton("main")}
        <div className="grid gap-3">
          {skeleton("side-1", true)}
          {skeleton("side-2", true)}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid gap-3 p-3",
        layoutMode === "two-vertical" && "xl:grid-cols-2",
        layoutMode === "three-vertical" && "xl:grid-cols-3",
      )}
      data-testid="chart-layout-loading"
    >
      {Array.from({ length: count }, (_, index) =>
        skeleton(`panel-${index}`, layoutMode === "three-horizontal" || layoutMode === "three-vertical"),
      )}
    </div>
  );
}

function ClosedTradeChartPanel({
  annotations,
  commitAnnotations,
  active,
  compact = false,
  deferCandles,
  featured = false,
  onActivate,
  onExecutionAnchorsChange,
  onPendingVisibleRangeChange,
  onRegisterVisibleRangeFlusher,
  overlayRightReserve = 0,
  panel,
  pendingTrend,
  readOnly,
  resetSignal,
  scope,
  setPendingTrend,
  tool,
  trade,
  updatePanel,
}: {
  annotations: ChartAnnotation[];
  commitAnnotations: (annotations: ChartAnnotation[]) => void;
  active: boolean;
  compact?: boolean;
  deferCandles: boolean;
  featured?: boolean;
  onActivate: (panelId: string) => void;
  onExecutionAnchorsChange: (panelId: string, snapshot: ExecutionAnchorSnapshot | null) => void;
  onPendingVisibleRangeChange: (panelId: string, pending: boolean) => void;
  onRegisterVisibleRangeFlusher: (panelId: string, flusher: (() => boolean) | null) => void;
  overlayRightReserve?: number;
  panel: ChartPanelState;
  pendingTrend: PendingTrend;
  readOnly: boolean;
  resetSignal: number;
  scope: AnnotationScope;
  setPendingTrend: (trend: PendingTrend) => void;
  tool: Tool;
  trade: ClosedTradeChartWorkspaceTrade;
  updatePanel: (panelId: string, patch: Partial<ChartPanelState>, options?: { userEdit?: boolean }) => void;
}) {
  const plotRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const compareRef = useRef<ISeriesApi<"Line"> | null>(null);
  const markerPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const smaRefs = useRef<Array<ISeriesApi<"Line">>>([]);
  const annotationLineRefs = useRef<IPriceLine[]>([]);
  const annotationSeriesRefs = useRef<Array<ISeriesApi<"Line">>>([]);
  const updateExecutionOverlayPositionsRef = useRef<() => void>(() => undefined);
  const applyExecutionOverlayPositionsRef = useRef<() => void>(() => undefined);
  const toolRef = useRef<Tool>(tool);
  const annotationsRef = useRef<ChartAnnotation[]>(annotations);
  const pendingTrendRef = useRef<PendingTrend>(pendingTrend);
  const panelRef = useRef<ChartPanelState>(panel);
  const scopeRef = useRef<AnnotationScope>(scope);
  const readOnlyRef = useRef(readOnly);
  const commitRef = useRef(commitAnnotations);
  const updatePanelRef = useRef(updatePanel);
  const onPendingVisibleRangeChangeRef = useRef(onPendingVisibleRangeChange);
  const setPendingTrendRef = useRef(setPendingTrend);
  const hasFreshCandleDataRef = useRef(false);
  const candleTradeGroupKeyRef = useRef(trade.groupKey);
  const candleCompareSymbolRef = useRef(panel.compareSymbol ?? null);
  const restoringRangeRef = useRef(false);
  const restoreVisibleRangeRef = useRef<(options?: RestoreVisibleRangeOptions) => void>(() => undefined);
  const visibleRangeSaveTimerRef = useRef<number | null>(null);
  const visibleRangeInteractionTimerRef = useRef<number | null>(null);
  const visibleRangeInteractionUntilRef = useRef(0);
  const visibleRangeDragStartRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const pendingVisibleRangeRef = useRef<VisibleRangeDraft | null>(null);
  const visibleRangePendingRef = useRef(false);
  const lastCommittedVisibleRangeRef = useRef<{ visibleFrom: number | null; visibleTo: number | null }>({
    visibleFrom: panel.visibleFrom ?? null,
    visibleTo: panel.visibleTo ?? null,
  });
  const skipNextVisibleRangeRestoreRef = useRef(false);
  const executionOverlayFrameRef = useRef<number | null>(null);
  const liveVisibleRangeFrameRef = useRef<number | null>(null);
  const visibleRangeRestoreFrameRef = useRef<number | null>(null);
  const pendingLiveVisibleRangeRef = useRef<{ from: Time; to: Time } | null>(null);
  const lastExecutionOverlaySignatureRef = useRef("");
  const latestExecutionOverlaysRef = useRef<ExecutionOverlay[]>([]);
  const executionOverlayLineRefs = useRef(new Map<string, SVGLineElement>());
  const executionOverlayLabelRefs = useRef(new Map<string, HTMLDivElement>());
  const [candles, setCandles] = useState<Candle[]>([]);
  const [compareCandles, setCompareCandles] = useState<Candle[]>([]);
  const [compareSource, setCompareSource] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [candleWarnings, setCandleWarnings] = useState<string[]>([]);
  const [loadedCandleRequestPath, setLoadedCandleRequestPath] = useState<string | null>(null);
  const [symbolInput, setSymbolInput] = useState(panel.symbol);
  const [compareInput, setCompareInput] = useState(panel.compareSymbol ?? "");
  const [timeframeInput, setTimeframeInput] = useState(timeframeCommand(panel.timeframe));
  const baseHeight = featured ? 560 : compact ? 280 : 520;
  const baseHeightRef = useRef(baseHeight);
  const [chartHeight, setChartHeight] = useState(baseHeight);
  const [executionOverlays, setExecutionOverlays] = useState<ExecutionOverlay[]>([]);
  const showsTradeExecutions = panel.symbol === trade.symbol;
  const tradeExecutionsSignature = executionListSignature(trade.executions);
  const tradeExecutions = useMemo(() => executionsFromSignature(tradeExecutionsSignature), [tradeExecutionsSignature]);
  const tradeOpenTime = trade.openTime;
  const tradeCloseTime = trade.closeTime;
  const currentCandleRequestPath = useMemo(
    () =>
      candleRequestPath(
        {
          symbol: panel.symbol,
          timeframe: panel.timeframe,
          compareSymbol: panel.compareSymbol,
          rangePreset: panel.rangePreset,
        },
        { openTime: tradeOpenTime, closeTime: tradeCloseTime },
      ),
    [panel.compareSymbol, panel.rangePreset, panel.symbol, panel.timeframe, tradeCloseTime, tradeOpenTime],
  );
  const hasFreshCandleData = loadedCandleRequestPath === currentCandleRequestPath;
  const chartSeriesData = useMemo(() => prepareChartSeriesData(candles, SMA_PERIODS), [candles]);
  const fallbackPriceRange = useMemo<PriceRange>(() => {
    const prices = [
      chartSeriesData.priceMin,
      chartSeriesData.priceMax,
      ...tradeExecutions.map((execution) => execution.price),
    ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (prices.length === 0) return null;
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }, [chartSeriesData.priceMax, chartSeriesData.priceMin, tradeExecutions]);
  const executionOverlayAnchors = useMemo(() => {
    if (!showsTradeExecutions || !hasFreshCandleData || chartSeriesData.validCandles.length === 0 || tradeExecutions.length === 0) return [];
    const offsetSeconds = inferExecutionOffsetSeconds(
      tradeExecutions.map((execution) => ({ executedAt: execution.executedAt, price: execution.price })),
      chartSeriesData.validCandles,
      chartSeriesData.intervalSeconds,
    );

    return tradeExecutions.flatMap((execution, index): ExecutionOverlayAnchor[] => {
      const markerTime = alignExecutionToBarTime(execution.executedAt, chartSeriesData.validCandles, offsetSeconds, chartSeriesData.intervalSeconds);
      if (markerTime === null) return [];
      return [{
        key: execution.id,
        label: `${execution.side} ${index + 1}`,
        detail: `${execution.quantity} @ ${execution.price.toFixed(2)}`,
        side: execution.side,
        markerTime,
        markerIndex: chartSeriesData.candleTimeIndex.get(markerTime) ?? null,
        price: execution.price,
      }];
    });
  }, [chartSeriesData, hasFreshCandleData, showsTradeExecutions, tradeExecutions]);
  const chartIntervalSeconds = useMemo(
    () => chartSeriesData.intervalSeconds ?? secondsForTimeframe(panel.timeframe),
    [chartSeriesData.intervalSeconds, panel.timeframe],
  );
  const panelId = panel.id;
  const panelSymbol = panel.symbol;
  const panelTimeframe = panel.timeframe;
  const fillPriceWarning = useMemo(() => {
    if (!showsTradeExecutions || chartSeriesData.validCandles.length === 0) return "";
    return formatExecutionCandleDiagnosticWarning(getExecutionCandleDiagnostics(tradeExecutions, chartSeriesData.validCandles));
  }, [chartSeriesData.validCandles, showsTradeExecutions, tradeExecutions]);
  const chartWarning = useMemo(
    () => [fillPriceWarning, ...candleWarnings].filter(Boolean).join(" "),
    [candleWarnings, fillPriceWarning],
  );
  const filteredPanelAnnotations = useMemo(
    () => annotations.filter((annotation) => annotationMatchesPanel(annotation, { id: panelId, symbol: panelSymbol, timeframe: panelTimeframe })),
    [annotations, panelId, panelSymbol, panelTimeframe],
  );
  const filteredPanelAnnotationSignature = annotationSignature(filteredPanelAnnotations);
  const panelAnnotations = useMemo(
    () => annotationsFromSignature(filteredPanelAnnotationSignature),
    [filteredPanelAnnotationSignature],
  );
  const overlayHeight = chartHeight || baseHeight;

  const applyExecutionOverlayElementPositions = useCallback((next: ExecutionOverlay[]) => {
    for (const item of next) {
      const line = executionOverlayLineRefs.current.get(item.key);
      if (line) {
        line.setAttribute("x1", String(item.x));
        line.setAttribute("x2", String(item.laneX));
        line.setAttribute("y1", String(item.y));
        line.setAttribute("y2", String(item.laneY));
      }
      const label = executionOverlayLabelRefs.current.get(item.key);
      if (label) {
        label.style.transform = executionOverlayTransform(item);
      }
    }
  }, []);

  const syncExecutionOverlays = useCallback((next: ExecutionOverlay[]) => {
    latestExecutionOverlaysRef.current = next;
    const signature = executionOverlayIdentitySignature(next);
    if (signature === lastExecutionOverlaySignatureRef.current) {
      applyExecutionOverlayElementPositions(next);
      return;
    }
    lastExecutionOverlaySignatureRef.current = signature;
    setExecutionOverlays(next);
  }, [applyExecutionOverlayElementPositions]);

  useEffect(() => {
    if (hasFreshCandleData) return;
    syncExecutionOverlays([]);
  }, [hasFreshCandleData, syncExecutionOverlays]);

  const registerExecutionOverlayLine = useCallback((key: string, node: SVGLineElement | null) => {
    if (node) {
      executionOverlayLineRefs.current.set(key, node);
    } else {
      executionOverlayLineRefs.current.delete(key);
    }
  }, []);

  const registerExecutionOverlayLabel = useCallback((key: string, node: HTMLDivElement | null) => {
    if (node) {
      executionOverlayLabelRefs.current.set(key, node);
    } else {
      executionOverlayLabelRefs.current.delete(key);
    }
  }, []);

  useLayoutEffect(() => {
    applyExecutionOverlayElementPositions(latestExecutionOverlaysRef.current);
  }, [applyExecutionOverlayElementPositions, executionOverlays]);

  useLayoutEffect(() => {
    hasFreshCandleDataRef.current = hasFreshCandleData;
  }, [hasFreshCandleData]);

  const setVisibleRangePending = useCallback((pending: boolean) => {
    if (visibleRangePendingRef.current === pending) return;
    visibleRangePendingRef.current = pending;
    onPendingVisibleRangeChangeRef.current(panelRef.current.id, pending);
  }, []);

  const commitPendingVisibleRange = useCallback(() => {
    const nextRange = pendingVisibleRangeRef.current;
    pendingVisibleRangeRef.current = null;
    if (visibleRangeSaveTimerRef.current != null) {
      window.clearTimeout(visibleRangeSaveTimerRef.current);
      visibleRangeSaveTimerRef.current = null;
    }

    if (!nextRange || readOnlyRef.current) {
      visibleRangeInteractionUntilRef.current = 0;
      setVisibleRangePending(false);
      return false;
    }

    const committed = lastCommittedVisibleRangeRef.current;
    if (committed.visibleFrom === nextRange.visibleFrom && committed.visibleTo === nextRange.visibleTo) {
      visibleRangeInteractionUntilRef.current = 0;
      setVisibleRangePending(false);
      return false;
    }

    skipNextVisibleRangeRestoreRef.current = true;
    visibleRangeInteractionUntilRef.current = 0;
    updatePanelRef.current(panelRef.current.id, nextRange, { userEdit: true });
    visibleRangePendingRef.current = false;
    return true;
  }, [setVisibleRangePending]);

  const armVisibleRangeInteraction = useCallback(() => {
    if (readOnlyRef.current) return;
    visibleRangeInteractionUntilRef.current = Date.now() + 1500;
    if (visibleRangeInteractionTimerRef.current != null) {
      window.clearTimeout(visibleRangeInteractionTimerRef.current);
    }
    visibleRangeInteractionTimerRef.current = window.setTimeout(() => {
      visibleRangeInteractionTimerRef.current = null;
      if (
        visibleRangeSaveTimerRef.current == null
        && pendingVisibleRangeRef.current == null
        && !visibleRangePendingRef.current
      ) {
        visibleRangeInteractionUntilRef.current = 0;
      }
    }, 1200);
  }, []);
  const hasActiveVisibleRangeInteraction = useCallback(() => {
    return (
      visibleRangePendingRef.current ||
      pendingVisibleRangeRef.current !== null ||
      visibleRangeSaveTimerRef.current !== null ||
      Date.now() <= visibleRangeInteractionUntilRef.current
    );
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const clearDragStart = () => {
      visibleRangeDragStartRef.current = null;
    };
    const beginDragCandidate = (event: PointerEvent) => {
      visibleRangeDragStartRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const armDragIfMoved = (event: PointerEvent) => {
      const start = visibleRangeDragStartRef.current;
      if (!start || start.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - start.x;
      const deltaY = event.clientY - start.y;
      if (Math.hypot(deltaX, deltaY) < VISIBLE_RANGE_DRAG_THRESHOLD_PX) return;
      visibleRangeDragStartRef.current = null;
      armVisibleRangeInteraction();
    };
    const armWheel = () => armVisibleRangeInteraction();
    container.addEventListener("pointerdown", beginDragCandidate, true);
    container.addEventListener("pointermove", armDragIfMoved, true);
    container.addEventListener("pointerup", clearDragStart, true);
    container.addEventListener("pointercancel", clearDragStart, true);
    container.addEventListener("wheel", armWheel, { capture: true, passive: true });
    return () => {
      container.removeEventListener("pointerdown", beginDragCandidate, true);
      container.removeEventListener("pointermove", armDragIfMoved, true);
      container.removeEventListener("pointerup", clearDragStart, true);
      container.removeEventListener("pointercancel", clearDragStart, true);
      container.removeEventListener("wheel", armWheel, true);
    };
  }, [armVisibleRangeInteraction]);

  useEffect(() => {
    toolRef.current = tool;
    annotationsRef.current = annotations;
    pendingTrendRef.current = pendingTrend;
    panelRef.current = panel;
    scopeRef.current = scope;
    readOnlyRef.current = readOnly;
    commitRef.current = commitAnnotations;
    updatePanelRef.current = updatePanel;
    onPendingVisibleRangeChangeRef.current = onPendingVisibleRangeChange;
    setPendingTrendRef.current = setPendingTrend;
  }, [annotations, commitAnnotations, onPendingVisibleRangeChange, panel, pendingTrend, readOnly, scope, setPendingTrend, tool, updatePanel]);

  useEffect(() => {
    if (!hasFreshCandleData) {
      onExecutionAnchorsChange(panel.id, null);
      return () => onExecutionAnchorsChange(panel.id, null);
    }

    onExecutionAnchorsChange(panel.id, {
      anchors: executionOverlayAnchors,
      intervalSeconds: chartIntervalSeconds,
      priceRange: fallbackPriceRange,
      symbol: panel.symbol,
      timeframe: panel.timeframe,
      rangePreset: panel.rangePreset,
    });
    return () => onExecutionAnchorsChange(panel.id, null);
  }, [
    chartIntervalSeconds,
    executionOverlayAnchors,
    fallbackPriceRange,
    hasFreshCandleData,
    onExecutionAnchorsChange,
    panel.id,
    panel.rangePreset,
    panel.symbol,
    panel.timeframe,
  ]);

  useEffect(() => setSymbolInput(panel.symbol), [panel.symbol]);
  useEffect(() => setCompareInput(panel.compareSymbol ?? ""), [panel.compareSymbol]);
  useEffect(() => setTimeframeInput(timeframeCommand(panel.timeframe)), [panel.timeframe]);
  useEffect(() => {
    lastCommittedVisibleRangeRef.current = {
      visibleFrom: panel.visibleFrom ?? null,
      visibleTo: panel.visibleTo ?? null,
    };
  }, [panel.visibleFrom, panel.visibleTo]);

  useEffect(() => () => {
    if (visibleRangeSaveTimerRef.current != null) {
      window.clearTimeout(visibleRangeSaveTimerRef.current);
      visibleRangeSaveTimerRef.current = null;
    }
    if (visibleRangeInteractionTimerRef.current != null) {
      window.clearTimeout(visibleRangeInteractionTimerRef.current);
      visibleRangeInteractionTimerRef.current = null;
    }
    if (executionOverlayFrameRef.current != null) {
      window.cancelAnimationFrame(executionOverlayFrameRef.current);
      executionOverlayFrameRef.current = null;
    }
    const committedPendingRange = commitPendingVisibleRange();
    if (!committedPendingRange) {
      visibleRangeInteractionUntilRef.current = 0;
      setVisibleRangePending(false);
    }
  }, [commitPendingVisibleRange, panel.id, setVisibleRangePending, trade.groupKey]);

  useEffect(() => {
    onRegisterVisibleRangeFlusher(panel.id, commitPendingVisibleRange);
    return () => onRegisterVisibleRangeFlusher(panel.id, null);
  }, [commitPendingVisibleRange, onRegisterVisibleRangeFlusher, panel.id]);

  useEffect(() => {
    const tradeChanged = candleTradeGroupKeyRef.current !== trade.groupKey;
    const compareSymbolChanged = candleCompareSymbolRef.current !== (panel.compareSymbol ?? null);
    candleTradeGroupKeyRef.current = trade.groupKey;
    candleCompareSymbolRef.current = panel.compareSymbol ?? null;

    if (deferCandles) {
      setCandles([]);
      setCompareCandles([]);
      setCompareSource(null);
      setSource(null);
      setCandleWarnings([]);
      setLoadedCandleRequestPath(null);
      setStatus("Preparing chart...");
      return;
    }

    let cancelled = false;

    if (tradeChanged) {
      setCandles([]);
      setSource(null);
    }
    if (tradeChanged || compareSymbolChanged) {
      setCompareCandles([]);
      setCompareSource(null);
    }
    setLoadedCandleRequestPath(null);
    setStatus("Loading bars...");
    setCandleWarnings([]);
    loadCandleResponse(currentCandleRequestPath)
      .then((payload) => {
        if (cancelled) return;
        const nextCandles = (payload.candles ?? []).filter((candle) => [candle.time, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite));
        const nextCompareCandles = (payload.compare?.candles ?? []).filter((candle) => [candle.time, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite));
        setCandles(nextCandles);
        setCompareCandles(nextCompareCandles);
        setSource(payload.source ?? null);
        setCompareSource(payload.compare?.source ?? null);
        setCandleWarnings([
          ...(nextCandles.length === 0 ? ["No candles returned for the requested range."] : []),
          ...(Array.isArray(payload.metadata?.warnings) ? payload.metadata.warnings : []),
          ...(Array.isArray(payload.compare?.metadata?.warnings)
            ? payload.compare.metadata.warnings.map((warning) => `${payload.compare?.symbol ?? panel.compareSymbol}: ${warning}`)
            : []),
          ...(panel.compareSymbol && nextCompareCandles.length === 0 && payload.compare ? [`No comparison candles returned for ${panel.compareSymbol}.`] : []),
          ...(payload.compareError ? [payload.compareError] : []),
          ...(panel.compareSymbol && !payload.compare && !payload.compareError ? [`No comparison candle data found for ${panel.compareSymbol}.`] : []),
        ]);
        setLoadedCandleRequestPath(currentCandleRequestPath);
        setStatus("");
      })
      .catch((error) => {
        if (cancelled) return;
        setCandles([]);
        setCompareCandles([]);
        setCompareSource(null);
        setSource(null);
        setCandleWarnings([]);
        setLoadedCandleRequestPath(null);
        setStatus(error instanceof Error ? error.message : "Unable to load candles.");
      });

    return () => {
      cancelled = true;
    };
  }, [currentCandleRequestPath, deferCandles, panel.compareSymbol, trade.groupKey]);

  const applyExecutionOverlayPositions = useCallback(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const container = containerRef.current;
    if (!showsTradeExecutions || !chart || !series || !container || executionOverlayAnchors.length === 0) {
      syncExecutionOverlays([]);
      return;
    }

    const width = container.clientWidth;
    const rightReserve = Math.max(EXECUTION_PRICE_AXIS_RESERVE, overlayRightReserve);
    const plotRight = Math.max(1, width - rightReserve);
    const laneX = Math.min(
      Math.max(EXECUTION_LABEL_PANEL_PADDING, width - EXECUTION_LABEL_WIDTH - rightReserve),
      Math.max(EXECUTION_LABEL_PANEL_PADDING, width - EXECUTION_LABEL_WIDTH - EXECUTION_LABEL_PANEL_PADDING),
    );
    const raw = executionOverlayAnchors.flatMap((anchor): ExecutionOverlay[] => {
      const x = chart.timeScale().timeToCoordinate(anchor.markerTime as UTCTimestamp)
        ?? fallbackExecutionX(anchor.markerIndex, chartSeriesData.validCandles.length, width, rightReserve);
      const y = series.priceToCoordinate(anchor.price)
        ?? fallbackExecutionY(anchor.price, fallbackPriceRange, overlayHeight);
      if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) return [];
      if (x < -EXECUTION_LABEL_WIDTH || x > plotRight + EXECUTION_LABEL_WIDTH) return [];
      return [{
        key: anchor.key,
        label: anchor.label,
        detail: anchor.detail,
        side: anchor.side,
        x,
        y,
        laneX,
        laneY: y + (anchor.side === "BUY" ? -34 : 34),
        price: anchor.price,
      }];
    });

    const sorted = raw.sort((left, right) => left.laneY - right.laneY || left.y - right.y);
    const minY = EXECUTION_LABEL_PANEL_PADDING + EXECUTION_LABEL_HEIGHT / 2;
    const maxY = overlayHeight - EXECUTION_LABEL_PANEL_PADDING - EXECUTION_LABEL_HEIGHT / 2;
    let lastY = minY - EXECUTION_LABEL_MIN_GAP;
    for (const item of sorted) {
      item.laneY = Math.min(maxY, Math.max(minY, item.laneY, lastY + EXECUTION_LABEL_MIN_GAP));
      lastY = item.laneY;
    }
    const overflow = (sorted.at(-1)?.laneY ?? maxY) - maxY;
    if (overflow > 0) {
      for (const item of sorted) {
        item.laneY = Math.max(minY, item.laneY - overflow);
      }
    }
    lastY = minY - EXECUTION_LABEL_MIN_GAP;
    for (const item of sorted) {
      item.laneY = Math.max(minY, Math.max(item.laneY, lastY + EXECUTION_LABEL_MIN_GAP));
      lastY = item.laneY;
    }
    syncExecutionOverlays(sorted);
  }, [
    chartSeriesData.validCandles.length,
    executionOverlayAnchors,
    fallbackPriceRange,
    overlayHeight,
    overlayRightReserve,
    showsTradeExecutions,
    syncExecutionOverlays,
  ]);

  const scheduleExecutionOverlayPositionsUpdate = useCallback(() => {
    if (executionOverlayFrameRef.current != null) return;
    executionOverlayFrameRef.current = window.requestAnimationFrame(() => {
      executionOverlayFrameRef.current = null;
      applyExecutionOverlayPositionsRef.current();
    });
  }, []);

  useLayoutEffect(() => {
    applyExecutionOverlayPositionsRef.current = applyExecutionOverlayPositions;
  }, [applyExecutionOverlayPositions]);

  const setLiveVisibleRangeAttributes = useCallback((range: { from: Time; to: Time } | null) => {
    const plot = plotRef.current;
    if (!plot) return;
    const visibleFrom = toUnixSeconds(range?.from);
    const visibleTo = toUnixSeconds(range?.to);
    if (visibleFrom == null || visibleTo == null || visibleFrom >= visibleTo) {
      plot.dataset.visibleTimeRangeReady = "false";
      delete plot.dataset.visibleTimeRangeFrom;
      delete plot.dataset.visibleTimeRangeTo;
      return;
    }
    plot.dataset.visibleTimeRangeReady = "true";
    plot.dataset.visibleTimeRangeFrom = String(visibleFrom);
    plot.dataset.visibleTimeRangeTo = String(visibleTo);
  }, []);

  const scheduleLiveVisibleRangeAttributesUpdate = useCallback((range: { from: Time; to: Time } | null) => {
    pendingLiveVisibleRangeRef.current = range;
    if (liveVisibleRangeFrameRef.current != null) return;
    liveVisibleRangeFrameRef.current = window.requestAnimationFrame(() => {
      liveVisibleRangeFrameRef.current = null;
      const nextRange = pendingLiveVisibleRangeRef.current;
      pendingLiveVisibleRangeRef.current = null;
      setLiveVisibleRangeAttributes(nextRange);
    });
  }, [setLiveVisibleRangeAttributes]);

  const cancelLiveVisibleRangeAttributesUpdate = useCallback(() => {
    if (liveVisibleRangeFrameRef.current != null) {
      window.cancelAnimationFrame(liveVisibleRangeFrameRef.current);
      liveVisibleRangeFrameRef.current = null;
    }
    pendingLiveVisibleRangeRef.current = null;
  }, []);

  const cancelVisibleRangeRestoreFrame = useCallback(() => {
    if (visibleRangeRestoreFrameRef.current != null) {
      window.cancelAnimationFrame(visibleRangeRestoreFrameRef.current);
      visibleRangeRestoreFrameRef.current = null;
    }
  }, []);

  const scheduleVisibleRangeRestoreCompletion = useCallback((chart: IChartApi) => {
    cancelVisibleRangeRestoreFrame();
    visibleRangeRestoreFrameRef.current = window.requestAnimationFrame(() => {
      visibleRangeRestoreFrameRef.current = null;
      restoringRangeRef.current = false;
      if (chartRef.current !== chart) return;
      cancelLiveVisibleRangeAttributesUpdate();
      setLiveVisibleRangeAttributes(chart.timeScale().getVisibleRange());
      scheduleExecutionOverlayPositionsUpdate();
    });
  }, [cancelLiveVisibleRangeAttributesUpdate, cancelVisibleRangeRestoreFrame, scheduleExecutionOverlayPositionsUpdate, setLiveVisibleRangeAttributes]);

  const restoreVisibleRange = useCallback((options?: RestoreVisibleRangeOptions) => {
    const chart = chartRef.current;
    if (!chart) return;
    if (options?.skipDuringInteraction && hasActiveVisibleRangeInteraction()) {
      cancelLiveVisibleRangeAttributesUpdate();
      setLiveVisibleRangeAttributes(chart.timeScale().getVisibleRange());
      scheduleExecutionOverlayPositionsUpdate();
      return;
    }
    const firstCandleTime = candles[0]?.time;
    const lastCandleTime = candles.at(-1)?.time;
    const committedRange = lastCommittedVisibleRangeRef.current;
    const visibleFrom = committedRange.visibleFrom;
    const visibleTo = committedRange.visibleTo;
    const hasRestorableRange =
      typeof visibleFrom === "number" &&
      typeof visibleTo === "number" &&
      Number.isFinite(visibleFrom) &&
      Number.isFinite(visibleTo) &&
      visibleFrom < visibleTo &&
      typeof firstCandleTime === "number" &&
      typeof lastCandleTime === "number" &&
      visibleFrom < lastCandleTime &&
      visibleTo > firstCandleTime;

    restoringRangeRef.current = true;
    if (hasRestorableRange) {
      const applyRange = (from: number, to: number) => {
        if (from >= to) return false;
        try {
          chart.timeScale().setVisibleRange({
            from: from as UTCTimestamp,
            to: to as UTCTimestamp,
          });
          return true;
        } catch {
          return false;
        }
      };
      const exactRangeApplied = applyRange(visibleFrom as number, visibleTo as number);
      const from = Math.max(visibleFrom as number, firstCandleTime as number);
      const to = Math.min(visibleTo as number, lastCandleTime as number);
      if (!exactRangeApplied && !applyRange(from, to)) {
        chart.timeScale().fitContent();
      }
    } else {
      chart.timeScale().fitContent();
    }
    scheduleVisibleRangeRestoreCompletion(chart);
  }, [
    cancelLiveVisibleRangeAttributesUpdate,
    candles,
    hasActiveVisibleRangeInteraction,
    scheduleExecutionOverlayPositionsUpdate,
    scheduleVisibleRangeRestoreCompletion,
    setLiveVisibleRangeAttributes,
  ]);

  useEffect(() => {
    restoreVisibleRangeRef.current = restoreVisibleRange;
  }, [restoreVisibleRange]);

  useEffect(() => {
    updateExecutionOverlayPositionsRef.current = scheduleExecutionOverlayPositionsUpdate;
  }, [scheduleExecutionOverlayPositionsUpdate]);

  useLayoutEffect(() => {
    baseHeightRef.current = baseHeight;
  }, [baseHeight]);

  useEffect(() => {
    setChartHeight(baseHeight);
  }, [baseHeight]);

  useEffect(() => {
    if (!containerRef.current) return;
    const initialWidth = Math.round(containerRef.current.clientWidth);
    const initialHeight = Math.round(containerRef.current.clientHeight || baseHeightRef.current);
    setChartHeight(initialHeight);
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#334155",
      },
      width: initialWidth,
      height: initialHeight,
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
      leftPriceScale: {
        visible: false,
        borderColor: "#cbd5e1",
        scaleMargins: { top: 0.14, bottom: 0.22 },
      },
      timeScale: {
        borderColor: "#cbd5e1",
        rightOffset: 18,
        barSpacing: 8,
        minBarSpacing: 0.5,
        timeVisible: true,
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
    const compareSeries = chart.addSeries(LineSeries, {
      color: "#0f766e",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      priceScaleId: "left",
      priceFormat: { type: "percent" },
      title: "Compare %",
    });

    chartRef.current = chart;
    seriesRef.current = candleSeries;
    volumeRef.current = volumeSeries;
    compareRef.current = compareSeries;
    smaRefs.current = smaSeries;
    markerPluginRef.current = createSeriesMarkers(candleSeries);

    const clickHandler = (param: MouseEventParams<Time>) => {
      if (readOnlyRef.current) return;
      const activeTool = toolRef.current;
      const activePanel = panelRef.current;
      if (activeTool === "cursor" || !seriesRef.current || !param.point) return;
      if (!hasFreshCandleDataRef.current) {
        setStatus("Wait for current chart candles before drawing.");
        return;
      }
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
    let resizeFrame: number | null = null;
    let lastAppliedWidth = initialWidth;
    let lastAppliedHeight = initialHeight;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeFrame != null) return;
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        if (!containerRef.current) return;
        const nextWidth = Math.round(containerRef.current.clientWidth);
        const nextHeight = Math.round(containerRef.current.clientHeight || baseHeightRef.current);
        if (nextWidth !== lastAppliedWidth || nextHeight !== lastAppliedHeight) {
          lastAppliedWidth = nextWidth;
          lastAppliedHeight = nextHeight;
          chart.applyOptions({ width: nextWidth, height: nextHeight });
          setChartHeight(nextHeight);
          restoreVisibleRangeRef.current({ skipDuringInteraction: true });
        }
        updateExecutionOverlayPositionsRef.current();
      });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      if (resizeFrame != null) window.cancelAnimationFrame(resizeFrame);
      cancelVisibleRangeRestoreFrame();
      cancelLiveVisibleRangeAttributesUpdate();
      resizeObserver.disconnect();
      chart.unsubscribeClick(clickHandler);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeRef.current = null;
      compareRef.current = null;
      smaRefs.current = [];
      markerPluginRef.current = null;
    };
  }, [cancelLiveVisibleRangeAttributesUpdate, cancelVisibleRangeRestoreFrame]);

  useEffect(() => {
    chartRef.current?.applyOptions({
      timeScale: {
        timeVisible: panel.timeframe !== "1d" && panel.timeframe !== "1wk",
        secondsVisible: false,
      },
    });
  }, [panel.timeframe]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    scheduleExecutionOverlayPositionsUpdate();
    const visibleLogicalRangeHandler = () => {
      scheduleLiveVisibleRangeAttributesUpdate(chart.timeScale().getVisibleRange());
      scheduleExecutionOverlayPositionsUpdate();
    };
    const visibleTimeRangeHandler = (range: { from: Time; to: Time } | null) => {
      const visibleFrom = toUnixSeconds(range?.from);
      const visibleTo = toUnixSeconds(range?.to);
      scheduleLiveVisibleRangeAttributesUpdate(range);
      if (visibleFrom == null || visibleTo == null || visibleFrom >= visibleTo) return;
      if (readOnlyRef.current) return;
      if (restoringRangeRef.current) return;
      const now = Date.now();
      if (!visibleRangePendingRef.current && now > visibleRangeInteractionUntilRef.current) return;
      visibleRangeInteractionUntilRef.current = now + 1500;
      const nextRange = { visibleFrom, visibleTo };
      const committed = lastCommittedVisibleRangeRef.current;
      if (committed.visibleFrom === nextRange.visibleFrom && committed.visibleTo === nextRange.visibleTo) {
        pendingVisibleRangeRef.current = null;
        if (visibleRangeSaveTimerRef.current != null) {
          window.clearTimeout(visibleRangeSaveTimerRef.current);
          visibleRangeSaveTimerRef.current = null;
        }
        setVisibleRangePending(false);
        return;
      }
      pendingVisibleRangeRef.current = nextRange;
      setVisibleRangePending(true);
      if (visibleRangeInteractionTimerRef.current != null) {
        window.clearTimeout(visibleRangeInteractionTimerRef.current);
        visibleRangeInteractionTimerRef.current = null;
      }
      if (visibleRangeSaveTimerRef.current != null) {
        window.clearTimeout(visibleRangeSaveTimerRef.current);
      }
      visibleRangeSaveTimerRef.current = window.setTimeout(() => {
        visibleRangeSaveTimerRef.current = null;
        const nextRange = pendingVisibleRangeRef.current;
        pendingVisibleRangeRef.current = null;
        if (!nextRange) {
          visibleRangeInteractionUntilRef.current = 0;
          setVisibleRangePending(false);
          return;
        }
        const committed = lastCommittedVisibleRangeRef.current;
        if (committed.visibleFrom === nextRange.visibleFrom && committed.visibleTo === nextRange.visibleTo) {
          visibleRangeInteractionUntilRef.current = 0;
          setVisibleRangePending(false);
          return;
        }
        skipNextVisibleRangeRestoreRef.current = true;
        visibleRangeInteractionUntilRef.current = 0;
        updatePanelRef.current(panelRef.current.id, nextRange, { userEdit: true });
        visibleRangePendingRef.current = false;
      }, 600);
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(visibleLogicalRangeHandler);
    chart.timeScale().subscribeVisibleTimeRangeChange(visibleTimeRangeHandler);
    setLiveVisibleRangeAttributes(chart.timeScale().getVisibleRange());
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(visibleLogicalRangeHandler);
      chart.timeScale().unsubscribeVisibleTimeRangeChange(visibleTimeRangeHandler);
      cancelLiveVisibleRangeAttributesUpdate();
    };
  }, [
    cancelLiveVisibleRangeAttributesUpdate,
    scheduleExecutionOverlayPositionsUpdate,
    scheduleLiveVisibleRangeAttributesUpdate,
    setLiveVisibleRangeAttributes,
    setVisibleRangePending,
  ]);

  useEffect(() => {
    if (resetSignal === 0) return;
    restoringRangeRef.current = true;
    chartRef.current?.timeScale().fitContent();
    const chart = chartRef.current;
    if (chart) scheduleVisibleRangeRestoreCompletion(chart);
  }, [resetSignal, scheduleVisibleRangeRestoreCompletion]);

  useEffect(() => {
    if (!seriesRef.current) return;
    seriesRef.current.setData(chartSeriesData.candles);
    volumeRef.current?.setData(chartSeriesData.volume);
    chartSeriesData.sma.forEach((series, index) => {
      smaRefs.current[index]?.setData(series.points);
    });
    if (chartSeriesData.validCandles.length === 0) {
      setLiveVisibleRangeAttributes(null);
    }
  }, [chartSeriesData, setLiveVisibleRangeAttributes]);

  useEffect(() => {
    if (chartSeriesData.validCandles.length === 0) return;
    if (skipNextVisibleRangeRestoreRef.current) {
      skipNextVisibleRangeRestoreRef.current = false;
      return;
    }
    restoreVisibleRange();
  }, [chartSeriesData, panel.visibleFrom, panel.visibleTo, restoreVisibleRange]);

  useEffect(() => {
    if (chartSeriesData.validCandles.length === 0) return;
    const frames: number[] = [];
    const timers: number[] = [];
    const restoreAfterResize = () => restoreVisibleRange({ skipDuringInteraction: true });
    frames.push(window.requestAnimationFrame(() => {
      restoreAfterResize();
      frames.push(window.requestAnimationFrame(restoreAfterResize));
    }));
    timers.push(window.setTimeout(restoreAfterResize, 120));
    timers.push(window.setTimeout(restoreAfterResize, 320));
    return () => {
      for (const frame of frames) window.cancelAnimationFrame(frame);
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [chartSeriesData.validCandles.length, featured, restoreVisibleRange]);

  useEffect(() => {
    const series = compareRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    if (!panel.compareSymbol || compareCandles.length === 0) {
      series.setData([]);
      chart.applyOptions({ leftPriceScale: { visible: false } });
      return;
    }
    const compareSeries = buildPercentChangeSeries(compareCandles);
    if (compareSeries.length === 0) {
      series.setData([]);
      chart.applyOptions({ leftPriceScale: { visible: false } });
      return;
    }
    chart.applyOptions({ leftPriceScale: { visible: true } });
    series.setData(
      compareSeries.map((point) => ({
        time: point.time as UTCTimestamp,
        value: point.value,
      })),
    );
  }, [compareCandles, panel.compareSymbol]);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;

    for (const line of annotationLineRefs.current) series.removePriceLine(line);
    for (const annotationSeries of annotationSeriesRefs.current) chart.removeSeries(annotationSeries);
    annotationLineRefs.current = [];
    annotationSeriesRefs.current = [];

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
      if (annotation.type === "execution-line" && annotation.points.length >= 2) {
        const executionLine = chart.addSeries(LineSeries, {
          color,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        executionLine.setData(
          annotation.points
            .slice(0, 2)
            .map((point) => ({ time: point.time as UTCTimestamp, value: point.price })),
        );
        annotationSeriesRefs.current.push(executionLine);
      }
    }

    markerPluginRef.current?.setMarkers(
      panelAnnotations
        .filter((annotation) => !["horizontal", "ray", "trend", "execution-line"].includes(annotation.type))
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
  }, [candles, panelAnnotations, showsTradeExecutions, tradeExecutions]);

  function commitSymbol() {
    if (readOnly) return;
    onActivate(panel.id);
    const next = symbolInput.trim().toUpperCase();
    if (next) updatePanel(panel.id, { symbol: next, compareSymbol: panel.compareSymbol === next ? null : panel.compareSymbol, visibleFrom: null, visibleTo: null }, { userEdit: true });
  }

  function commitCompareSymbol() {
    if (readOnly) return;
    onActivate(panel.id);
    const next = compareInput.trim().toUpperCase();
    if (!next || next === panel.symbol) {
      updatePanel(panel.id, { compareSymbol: null, visibleFrom: null, visibleTo: null }, { userEdit: true });
      return;
    }
    if (!SYMBOL_PATTERN.test(next)) {
      setCompareInput(panel.compareSymbol ?? "");
      setStatus("Invalid compare symbol.");
      return;
    }
    updatePanel(panel.id, { compareSymbol: next, visibleFrom: null, visibleTo: null }, { userEdit: true });
  }

  function commitTimeframe() {
    if (readOnly) return;
    onActivate(panel.id);
    updatePanel(panel.id, { timeframe: normalizeTimeframe(timeframeInput), visibleFrom: null, visibleTo: null }, { userEdit: true });
  }

  function selectTimeframe(timeframe: ChartTimeframe) {
    if (readOnly) return;
    onActivate(panel.id);
    updatePanel(panel.id, { timeframe, visibleFrom: null, visibleTo: null }, { userEdit: true });
  }

  function selectRangePreset(rangePreset: RangePreset) {
    if (readOnly) return;
    onActivate(panel.id);
    updatePanel(panel.id, { rangePreset, visibleFrom: null, visibleTo: null }, { userEdit: true });
  }

  return (
    <section
      className={cn(
        "flex min-w-0 overflow-hidden rounded-lg border bg-white",
        featured ? "h-full min-h-[620px] flex-col" : "flex-col",
        active ? "border-slate-400 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.12)]" : "border-slate-200",
      )}
      data-panel-id={panel.id}
      data-testid="closed-trade-chart-panel"
      data-timeframe={panel.timeframe}
      tabIndex={0}
      onFocusCapture={() => onActivate(panel.id)}
      onPointerDown={() => onActivate(panel.id)}
    >
      <div className={cn("shrink-0 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/70 px-3 py-2", compact && "gap-1 px-2 py-1.5")}>
        <Input
          className={cn("h-8 w-24 rounded-lg px-2 text-xs font-semibold", compact && "w-20")}
          disabled={readOnly}
          value={symbolInput}
          onBlur={commitSymbol}
          onChange={(event) => setSymbolInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          aria-label="Symbol"
        />
        <Input
          className={cn("h-8 w-24 rounded-lg px-2 text-xs font-semibold", compact && "w-20")}
          disabled={readOnly}
          placeholder="Compare"
          value={compareInput}
          onBlur={commitCompareSymbol}
          onChange={(event) => setCompareInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setCompareInput(panel.compareSymbol ?? "");
              event.currentTarget.blur();
            }
          }}
          aria-label="Compare symbol"
        />
        <Input
          className={cn("h-8 w-20 rounded-lg px-2 text-xs font-semibold", compact && "hidden")}
          disabled={readOnly}
          value={timeframeInput}
          onBlur={commitTimeframe}
          onChange={(event) => setTimeframeInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          aria-label="Timeframe"
        />
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {TIMEFRAME_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={readOnly}
              aria-pressed={panel.timeframe === option.value}
              className={cn(
                "h-7 rounded-md px-2 text-xs font-semibold text-slate-600",
                panel.timeframe === option.value && "bg-slate-950 text-white",
                readOnly && "cursor-not-allowed opacity-50",
              )}
              onClick={() => selectTimeframe(option.value)}
              title={`Switch to ${option.label}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {compact ? (
          <select
            aria-label="Range preset"
            className={cn(
              "h-8 w-24 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700",
              readOnly && "cursor-not-allowed opacity-50",
            )}
            data-testid="compact-range-preset"
            disabled={readOnly}
            onChange={(event) => selectRangePreset(event.target.value as RangePreset)}
            onFocus={() => onActivate(panel.id)}
            value={panel.rangePreset}
          >
            {RANGE_PRESETS.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
          </select>
        ) : (
          <div className="flex items-center gap-1 overflow-x-auto" data-testid="range-preset-controls">
            {RANGE_PRESETS.map((preset) => (
              <button
                key={preset.value}
                disabled={readOnly}
                aria-pressed={panel.rangePreset === preset.value}
                className={cn(
                  "h-8 rounded-md px-2 text-xs font-semibold text-slate-600",
                  panel.rangePreset === preset.value && "bg-slate-950 text-white",
                  readOnly && "cursor-not-allowed opacity-50",
                )}
                onClick={() => selectRangePreset(preset.value)}
                type="button"
              >
                {preset.label}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          <Badge variant={trade.realizedPnl >= 0 ? "success" : "danger"} className={cn("tracking-normal", compact && "hidden")}>
            {formatCurrency(trade.realizedPnl)}
          </Badge>
          <span data-testid="chart-panel-source">{source ? source.toUpperCase() : "DATA"}</span>
          {panel.compareSymbol ? <span className="font-medium text-teal-700">vs {panel.compareSymbol}{compareSource ? ` ${compareSource.toUpperCase()}` : ""}</span> : null}
          {source && source !== "alpaca" && source !== "cache" ? <span className="text-amber-600">Fallback data</span> : null}
          <span data-candle-count={candles.length} data-testid="chart-panel-bar-count">{candles.length.toLocaleString()} bars</span>
        </div>
      </div>
      <div
        ref={plotRef}
        className={cn("relative min-h-0 bg-white", featured ? "flex-1" : "")}
        data-panel-id={panel.id}
        data-testid="closed-trade-chart-plot"
        data-candle-fresh={hasFreshCandleData ? "true" : "false"}
      >
        <div
          ref={containerRef}
          className={cn("w-full", featured ? "h-full min-h-[560px]" : "")}
          style={featured ? undefined : { height: baseHeight }}
        />
        <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full">
          {executionOverlays.map((item) => (
            <line
              key={`${item.key}-line`}
              ref={(node) => registerExecutionOverlayLine(item.key, node)}
              data-execution-id={item.key}
              data-panel-id={panel.id}
              data-testid="execution-overlay-line"
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
              ref={(node) => registerExecutionOverlayLabel(item.key, node)}
              data-execution-id={item.key}
              data-panel-id={panel.id}
              data-testid="execution-overlay-label"
              className={cn(
                "absolute flex h-9 w-[8.5rem] flex-col items-center justify-center rounded-md border px-2 text-[10px] font-bold leading-tight text-white shadow-sm",
                item.side === "BUY" ? "border-emerald-700 bg-emerald-600" : "border-red-700 bg-red-600",
              )}
              style={{
                left: 0,
                top: 0,
                transform: executionOverlayTransform(item),
                willChange: "transform",
              }}
              title={`${item.label} @ ${item.price.toFixed(2)}`}
            >
              <span>{item.label}</span>
              <span className="font-medium opacity-90">{item.detail}</span>
            </div>
          ))}
        </div>
      </div>
      <div className={cn("shrink-0 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-3 py-2 text-xs text-slate-500", compact && "px-2 py-1.5")}>
        <div className="flex flex-wrap gap-2">
          {SMA_CONFIG.map((config) => (
            <span key={config.period} className="font-medium" style={{ color: config.color }}>
              SMA {config.period}
            </span>
          ))}
          {panel.compareSymbol && compareCandles.length > 0 ? (
            <span className="font-medium text-teal-700">Compare {panel.compareSymbol} %</span>
          ) : null}
        </div>
        <span className={cn(chartWarning && "text-amber-700")} data-panel-id={panel.id} data-testid="chart-warning">
          {status || chartWarning || `${panel.symbol} ${timeframeCommand(panel.timeframe)}`}
        </span>
      </div>
    </section>
  );
}

"use client";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  AutoscaleInfo,
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  IChartApi,
  ISeriesApi,
  LineSeries,
  type MouseEventParams,
  UTCTimestamp,
} from "lightweight-charts";
import { Crosshair, Download, Maximize2, Minimize2, Info, X, Eye, EyeOff } from "lucide-react";
import {
  Candle,
  ChartPanel,
  Drawing,
  Interval,
  Point,
  Tool,
  Trade,
  WorkstationAdapter,
  WorkspacePreferences,
  intervals,
  seconds,
} from "@/lib/workstation/types";
import {
  completedCandles,
  executionBar,
  movingAverage,
  volumeMovingAverage,
  logicalTimeIndex,
  visibleDrawings,
} from "@/lib/workstation/math";
import {
  CandleHistory,
  HistoryRange,
  HistoryState,
  initialHistoryRange,
  indicatorWarmupRange,
  preloadHistoryRange,
  fitTradeHistoryRange,
  preserveHistoryViewport,
} from "@/lib/workstation/history";
import { Hit, hitAt, PaintOptions, paintChart } from "./chart-paint";
import { translateMeasurement } from "@/lib/workstation/measurement-drag";
import { volumeColor } from "@/lib/workstation/volume-style";
import { drawingStyleFor } from "@/lib/workstation/drawing-style";
import {
  ChartDateTarget,
  dateTargetAnchor,
  dateTargetIsVisible,
} from "@/lib/workstation/date-link";

export type ChartHandle = {
  focus: () => void;
  inspect: (id: string) => void;
  cancel: () => void;
  capture: (light?: boolean, scale?: number, frame?: { width: number; height: number }) => Promise<HTMLCanvasElement>;
  fit: () => void;
  beforeTrade: () => void;
  toggleSession: () => void;
  toggleComparison: () => void;
  toggleLabels: () => void;
  reveal: (target: ChartDateTarget) => void;
  view: () => HistoryRange | null;
};
type Props = {
  panel: ChartPanel;
  trade: Trade;
  adapter: WorkstationAdapter;
  preferences: WorkspacePreferences;
  labelMode: WorkspacePreferences["labels"];
  drawings: Drawing[];
  drawingsHidden?: boolean;
  selected: string | null;
  selectedExecution: string | null;
  tool: Tool;
  replay: number | null;
  active: boolean;
  onActive: () => void;
  onInterval: (interval: Interval) => void;
  onPanel?: (patch: Partial<ChartPanel>) => void;
  onDrawing: (drawing: Drawing) => void;
  onSelect: (id: string | null) => void;
  onEditDrawing?: (id: string) => void;
  onExecution: (id: string) => void;
  onToolDone: () => void;
  register: (id: string, handle: ChartHandle | null) => void;
  onDownload: () => void;
  onDateClick: (target: ChartDateTarget) => void;
  fullscreen: boolean;
  onFullscreen: () => void;
  fullscreenTitle: string;
  beforeTradeTitle: string;
  fitTitle: string;
  sessionTitle: string;
  comparisonTitle: string;
  labelsTitle: string;
  style?: CSSProperties;
  onToggleLabels: () => void;
  onPriceAdjustment?: (adjustment: SplitAdjustment | undefined) => void;
  onHistoryReady?: (tradeId: string) => void;
  initialRange?: HistoryRange | null;
  onViewChange?: (range: HistoryRange) => void;
};
import { diagnoseExecution, executionDiagnosticSummary } from "@/lib/workstation/execution-diagnostics";
import { executionVisibility, visibilityLabels, visibilitySummary, type ExecutionVisibility } from "@/lib/workstation/execution-visibility";
import { ExecutionDetails } from "./execution-details";
import { createOhlcLegend } from "./ohlc-legend";
import { hasExtendedSession, SessionBackground } from "./session-background";

import { beforeEntryBoundary, beforeEntryCandles, beforeEntryDrawings } from "@/lib/workstation/before-entry";
import { executionColors, benchmarkColor, selectBenchmark, toggleBenchmark } from "@/lib/workstation/comparison";
import { createBenchmarkLayer, benchmarkStyle, benchmarkScale } from "./benchmark-layer";
import { useBenchmark } from "./use-benchmark";
import { splitAdjustedDrawing, splitAdjustedTrade, type SplitAdjustment } from "@/lib/workstation/split-adjustment";
import { tradeChartSession } from "@/lib/workstation/chart-session";

const asTime = (time: number) => time as UTCTimestamp;

export function TradeChart(input: Props) {
  // A panel's session is part of its data identity. Sibling preference changes
  // must not recreate this trade object and restart its history session.
  const trade = useMemo(() => ({ ...input.trade, chartSession: tradeChartSession(input.trade, input.panel.session) }), [input.trade, input.panel.session]);
  const [historyState, setHistoryState] = useState<HistoryState | null>(null);
  const result = historyState?.result ?? { candles: [], warning: "", source: "" };
  const adjustedTrade = useMemo(() => splitAdjustedTrade(trade, result.splitAdjustment), [trade, result.splitAdjustment]);
  const drawings = useMemo(() => input.drawings.map(d => splitAdjustedDrawing(d, result.splitAdjustment)), [input.drawings, result.splitAdjustment]);
  const props = { ...input, trade: adjustedTrade, drawings,
    onDrawing: (drawing: Drawing) => input.onDrawing(splitAdjustedDrawing(drawing, result.splitAdjustment, true)) };
  const adjustmentCallback = useRef(input.onPriceAdjustment); adjustmentCallback.current = input.onPriceAdjustment;
  useEffect(() => { adjustmentCallback.current?.(result.splitAdjustment); }, [result.splitAdjustment]);
  const container = useRef<HTMLElement>(null);
  const ohlcHost = useRef<HTMLDivElement>(null);
  const ohlcLegend = useRef<ReturnType<typeof createOhlcLegend> | null>(null);
  const ohlcContext = useRef("");
  const benchmarkHost = useRef<HTMLDivElement>(null);
  const benchmarkLayer = useRef<ReturnType<typeof createBenchmarkLayer> | null>(null);
  const beforeEntryView = useRef<{ range: { from: number; to: number }; candles: Candle[]; interval: Interval; context: string } | null>(null);
  const wasBeforeEntry = useRef(false);
  const sessionBackground = useRef<SessionBackground | null>(null);
  const host = useRef<HTMLDivElement>(null),
    overlay = useRef<HTMLCanvasElement>(null),
    chart = useRef<IChartApi | null>(null),
    series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const bars = useRef<Candle[]>([]),
    hits = useRef<Hit[]>([]),
    paintRef = useRef<() => void>(() => {});
  const history = useRef<CandleHistory | null>(null),
    checkHistory = useRef<() => void>(() => {}),
    autoPages = useRef(0);
  const loading = (!!historyState?.interval && historyState.interval !== props.panel.interval) || ((!historyState || historyState.loading === "initial") && !result.candles.length);
  const failure = historyState?.failed === "initial" && !result.candles.length ? historyState.error : "";
  const [reload, setReload] = useState(0);
  const [visibility, setVisibility] = useState<ExecutionVisibility[]>([]);
  const visibilityKey = useRef("");
  const ownHandle = useRef<ChartHandle | null>(null);
  const [fillsOpen, setFillsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const historyResult = useRef(result); historyResult.current = result;
  const [visibleWindow, setVisibleWindow] = useState<HistoryRange | null>(null);
  const [visibleBars, setVisibleBars] = useState(0);
  const clickGesture = useRef<{
    pointerId: number;
    x: number;
    y: number;
    moved: boolean;
    target?: ChartDateTarget;
    execution?: string;
  } | null>(null);
  const focusedWindow = useRef<HistoryRange | null>(null);
  const focusedTarget = useRef<{
    target: ChartDateTarget;
    width: number;
  } | null>(null);
  const interpretationVersion = useRef(props.trade.timeInterpretationVersion);
  const historyPopover = useRef<HTMLDivElement>(null);
  const navigation = useRef<{
    time: number;
    trade: string;
    fit: boolean;
    range?: HistoryRange;
    reveal?: { target: ChartDateTarget; width: number };
  } | null>(null);
  const destination = useRef<{
    time: number;
    fit: boolean;
    range?: HistoryRange;
    reveal?: { target: ChartDateTarget; width: number };
  } | null>(null);
  const requestFit = useRef<() => void>(() => {});
  const revealRef = useRef<(target: ChartDateTarget, width: number) => void>(
    () => {},
  );
  const pending = useRef<Point | null>(null),
    draft = useRef<Drawing | null>(null),
    drag = useRef<{ drawing: Drawing; point?: number; offset?: { x: number; y: number }; whole?: { start: { x: number; y: number }; candles: Candle[] } } | null>(null);
  const previewPin = useRef<string | null>(null), touchPin = useRef<string | null>(null);
  const dimensions = useRef({ width: 0, height: 0 }),
    currentInterval = useRef<Interval>(props.panel.interval),
    currentSession = useRef(props.trade.chartSession),
    lastData = useRef<Candle[]>([]);
  const renderedData = useRef<Candle[]>([]),
    currentTrade = useRef(props.trade.id);
  const changingData = useRef(false);
  const viewBeforeUpdate = useRef<{ from: number; to: number } | null>(null);
  const wasReplaying = useRef(props.replay !== null);
  const beforeReplay = useRef<{
    range: { from: number; to: number };
    candles: Candle[];
    interval: Interval;
    trade: string;
  } | null>(null);
  const fitRef = useRef<() => void>(() => {}),
    dataReady = useRef(false);
  const entryBoundary = beforeEntryBoundary(props.trade, props.panel.interval, result.session);
  const beforeEntry = !!props.panel.beforeEntry && entryBoundary !== null;
  const beforeEntryActive = useRef(beforeEntry); beforeEntryActive.current = beforeEntry;
  const data = useMemo(() => {
    const completed = completedCandles(result.candles, props.panel.interval, props.replay, result.session);
    return beforeEntry ? beforeEntryCandles(completed, props.trade, props.panel.interval, result.session) : completed;
  }, [result.candles, result.session, props.panel.interval, props.replay, props.trade, beforeEntry]);
  bars.current = data;

  useEffect(() => {
    const changedTimeBasis = interpretationVersion.current !== trade.timeInterpretationVersion;
    interpretationVersion.current = trade.timeInterpretationVersion;
    if (changedTimeBasis) { focusedWindow.current = null; focusedTarget.current = null; beforeReplay.current = null; }
    const visible =
      !changedTimeBasis && currentTrade.current === trade.id
        ? chart.current?.timeScale().getVisibleRange()
        : null;
    const intervalContext =
      (currentInterval.current !== props.panel.interval || currentSession.current !== trade.chartSession) &&
      visible &&
      typeof visible.from === "number" &&
      typeof visible.to === "number"
        ? {
            time: (visible.from + visible.to) / 2,
            range: { from: visible.from, to: visible.to },
            fit: false,
            trade: trade.id,
          }
        : null;
    // A timezone confirmation changes markers and auto session, while a saved viewport stays put.
    const requested: typeof navigation.current = changedTimeBasis && !latest.current.initialRange ? { time: trade.openTime, trade: trade.id, fit: true } :
      navigation.current?.trade === trade.id
        ? navigation.current
        : intervalContext ?? (latest.current.initialRange ? { time: (latest.current.initialRange.from + latest.current.initialRange.to) / 2, trade: trade.id, fit: false, range: latest.current.initialRange } : null);
    if (
      currentTrade.current !== trade.id ||
      currentInterval.current !== props.panel.interval || currentSession.current !== trade.chartSession
    ) {
      focusedWindow.current = requested?.range ?? null;
      focusedTarget.current = requested?.reveal ?? null;
    }
    navigation.current = null;
    destination.current = requested;
    const context = requested
      ? (requested.range ?? {
          from: requested.time - seconds[props.panel.interval] * 24,
          to: requested.time + seconds[props.panel.interval] * 24,
        })
      : visible &&
          typeof visible.from === "number" &&
          typeof visible.to === "number"
        ? { from: visible.from, to: visible.to }
        : null;
    dataReady.current = false;
    sessionBackground.current?.setData([], props.panel.interval, undefined, latest.current.preferences.theme === "light");
    const nextOhlcContext = JSON.stringify([trade.id, props.panel.interval, trade.chartSession, trade.timeInterpretationVersion]);
    if (ohlcContext.current !== nextOhlcContext) ohlcLegend.current?.reset();
    else ohlcLegend.current?.update(null);
    ohlcContext.current = nextOhlcContext;
    pending.current = null;
    draft.current = null;
    autoPages.current = 0;
    setHistoryState(null);
    let disposed = false;
    const indicatorPeriods = Math.max(0, ...latest.current.preferences.averages,
      latest.current.preferences.volume && latest.current.preferences.volumeAverage.enabled ? latest.current.preferences.volumeAverage.period : 0);
    const restoredHistory = requested?.range ? indicatorWarmupRange(requested.range, props.panel.interval, indicatorPeriods) : null;
    const session = new CandleHistory(
      props.adapter,
      trade,
      props.panel.interval,
      // Restore the exact viewport, including bounded indicator warm-up context
      // so longer averages do not disappear after a narrow saved view is reloaded.
      restoredHistory && !(intervalContext && beforeEntryActive.current) ? { from: restoredHistory.from, to: Math.min(restoredHistory.to, restoredHistory.from + ({ "5m": 14, "10m": 21, "15m": 28, "1h": 90, "1d": 365, "1wk": 1825 }[props.panel.interval]) * 86400) } : initialHistoryRange(trade, props.panel.interval, context),
      (state) => {
        setHistoryState(state);
        dataReady.current = state.result.candles.length > 0 || (!state.loading && !state.failed);
      },
    );
    history.current = session;
    void (async () => {
      const started = await session.start();
      if (started && requested?.range) await session.cover(requested.range);
      if (disposed) return;
      if (requested?.fit && session.state.result.candles.length) { destination.current = requested; }
      dataReady.current = session.state.result.candles.length > 0 || session.state.failed !== "initial";
      setHistoryState(session.state);
      if (session.state.result.candles.length) latest.current.onHistoryReady?.(trade.id);
      if (started && !requested && !context && props.panel.interval === "1h") {
        void session.preload(preloadHistoryRange(trade, props.panel.interval));
      }
    })();
    return () => {
      disposed = true;
      session.dispose();
      if (history.current === session) history.current = null;
    };
  }, [props.adapter, trade, props.panel.interval, reload]);

  useEffect(() => {
    if (!historyOpen) return;
    const close = (event: PointerEvent) => {
      if (
        !historyPopover.current?.contains(event.target as Node) &&
        !(event.target as Element).closest(".ws-history-toggle")
      )
        setHistoryOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHistoryOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [historyOpen]);

  useEffect(() => {
    if (!host.current || !overlay.current || !ohlcHost.current) return;
    ohlcLegend.current = createOhlcLegend(ohlcHost.current);
    const p = latest.current;
    const api = createChart(host.current, {
      autoSize: false,
      layout: {
        background: { type: ColorType.Solid, color: "#10151f" },
        textColor: "#7e899e",
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: 10,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "#1b2230", visible: p.preferences.gridlines.vertical },
        horzLines: { color: "#1b2230", visible: p.preferences.gridlines.horizontal },
      },
      rightPriceScale: {
        borderVisible: false,
        minimumWidth: 60,
        scaleMargins: { top: 0.16, bottom: 0.22 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: 7,
        // Shared calendar windows may contain thousands of intraday bars.
        minBarSpacing: 0.001,
      },
      crosshair: {
        mode: 0,
        vertLine: { color: "#68758c", labelBackgroundColor: "#39465e" },
        horzLine: { color: "#68758c", labelBackgroundColor: "#39465e" },
      },
    });
    const candles = api.addSeries(CandlestickSeries, {
      upColor: "#38bfa6",
      downColor: "#e47886",
      wickUpColor: "#38bfa6",
      wickDownColor: "#e47886",
      borderVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const info = original();
        if (!info?.priceRange) return info;
        const range = api.timeScale().getVisibleRange();
        const lowTime =
            typeof range?.from === "number" ? range.from : -Infinity,
          highTime = typeof range?.to === "number" ? range.to : Infinity;
        for (const e of latest.current.trade.executions) {
          const markerTime = executionBar(e, bars.current, latest.current.panel.interval, historyResult.current.session)?.time;
          if (
            markerTime !== undefined && markerTime >= lowTime &&
            markerTime <= highTime &&
            (latest.current.replay === null || e.time <= latest.current.replay)
          ) {
            info.priceRange.minValue = Math.min(
              info.priceRange.minValue,
              e.price,
            );
            info.priceRange.maxValue = Math.max(
              info.priceRange.maxValue,
              e.price,
            );
          }
        }
        return info;
      },
    });
    api.timeScale().applyOptions({
      shiftVisibleRangeOnNewBar: false,
      lockVisibleTimeRangeOnResize: true,
    });
    chart.current = api;
    series.current = candles;
    if (benchmarkHost.current) benchmarkLayer.current = createBenchmarkLayer(api, benchmarkHost.current);
    const x = (time: number) => {
      const list = bars.current;
      if (!list.length) return null;
      let lo = 0,
        hi = list.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid].time < time) lo = mid + 1;
        else hi = mid - 1;
      }
      let logical: number;
      if (lo < list.length && list[lo].time === time) logical = lo;
      else if (lo === 0)
        logical =
          (time - list[0].time) / seconds[latest.current.panel.interval];
      else if (lo >= list.length)
        logical =
          list.length -
          1 +
          (time - list[list.length - 1].time) /
            seconds[latest.current.panel.interval];
      else
        logical =
          lo -
          1 +
          (time - list[lo - 1].time) / (list[lo].time - list[lo - 1].time);
      return api.timeScale().logicalToCoordinate(logical as never);
    };
    const options = (
      exporting = false,
      light = latest.current.preferences.theme === "light",
    ): PaintOptions => ({
      ...dimensions.current,
      plotWidth: api.timeScale().width(),
      plotHeight: Math.max(
        0,
        dimensions.current.height - api.timeScale().height(),
      ),
      x,
      y: (price) => candles.priceToCoordinate(price),
      drawings: latest.current.drawingsHidden ? [] : [
        ...visibleDrawings(
          beforeEntryActive.current ? beforeEntryDrawings(latest.current.drawings, bars.current, latest.current.panel.interval, historyResult.current.session) : latest.current.drawings,
          p.panel.id,
          latest.current.replay,
        ).filter((d) => d.id !== draft.current?.id),
        ...(draft.current ? beforeEntryActive.current ? beforeEntryDrawings([draft.current], bars.current, latest.current.panel.interval, historyResult.current.session) : [draft.current] : []),
      ],
      trade: beforeEntryActive.current ? { ...latest.current.trade, executions: [] } : latest.current.trade,
      executionColors: executionColors(latest.current.preferences.executionColors),
      beforeEntry: beforeEntryActive.current,
      candles: bars.current,
      interval: latest.current.panel.interval,
      labels: latest.current.labelMode,
      session: historyResult.current.session,
      covered: historyResult.current.cache?.covered,
      visibleRange: api.timeScale().getVisibleRange() as HistoryRange | null,
      selected: latest.current.selected,
      selectedExecution: latest.current.selectedExecution,
      pinPreview: previewPin.current,
      capturePinNotes: latest.current.preferences.capturePinNotes,
      light,
      export: exporting,
      replay: latest.current.replay,
    });
    let frame = 0;
    const paint = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const canvas = overlay.current,
          ctx = canvas?.getContext("2d");
        if (!ctx || !canvas) return;
        const { width, height } = dimensions.current,
          ratio = window.devicePixelRatio || 1;
        if (
          canvas.width !== Math.round(width * ratio) ||
          canvas.height !== Math.round(height * ratio)
        ) {
          canvas.width = Math.round(width * ratio);
          canvas.height = Math.round(height * ratio);
          canvas.style.width = `${width}px`;
          canvas.style.height = `${height}px`;
        }
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, width, height);
        if (dataReady.current) {
          const o = options();
          hits.current = paintChart(ctx, o);
          container.current?.querySelectorAll<HTMLButtonElement>("[data-pin-target]").forEach(button => {
            const hit = hits.current.find(h => h.id === button.dataset.pinTarget && h.kind === "drawing" && h.point === undefined);
            button.hidden = !hit;
            if (hit) { button.style.left = `${hit.x}px`; button.style.top = `${hit.y}px`; button.style.width = `${hit.w}px`; button.style.height = `${hit.h}px`; }
          });
          if (container.current) container.current.dataset.pinPreview = previewPin.current ?? "";
          const rows = executionVisibility({ ...o, executions: o.trade.executions });
          const key = JSON.stringify([latest.current.trade.id, latest.current.trade.timeInterpretationVersion, rows.map(r => [r.diagnostic.execution.id, r.reason, r.diagnostic.status, r.diagnostic.candle?.time])]);
          if (key !== visibilityKey.current) { visibilityKey.current = key; setVisibility(rows); }
        }
      });
    };
    paintRef.current = paint;
    const resize = new ResizeObserver((entries) => {
      autoPages.current = 0;
      const { width, height } = entries[0].contentRect;
      if (width < 20 || height < 20) return;
      dimensions.current = {
        width: Math.floor(width),
        height: Math.floor(height),
      };
      api.resize(Math.floor(width), Math.floor(height));
      paint();
    });
    resize.observe(host.current);
    let historyTimer: ReturnType<typeof setTimeout>;
    checkHistory.current = () => {
      const session = history.current,
        range = api.timeScale().getVisibleLogicalRange();
      if (
        !session ||
        !range ||
        !dataReady.current ||
        session.state.loading ||
        session.state.failed ||
        !bars.current.length ||
        autoPages.current <= 0
      )
        return;
      const threshold = Math.min(
        200,
        Math.max(20, (range.to - range.from) * 0.2),
      );
      const direction =
        range.from < threshold && !session.state.messages.older
          ? "older"
          : !beforeEntryActive.current && latest.current.replay === null &&
              range.to > bars.current.length - 1 - threshold &&
              !session.state.messages.newer
            ? "newer"
            : null;
      if (direction) {
        autoPages.current--;
        void session.extend(direction, false, Math.ceil(threshold + (direction === "older" ? Math.max(0, -range.from) : Math.max(0, range.to - bars.current.length))));
      }
    };
    const rangeChanged = () => {
      if (!changingData.current) benchmarkLayer.current?.refresh();
      paint();
      clearTimeout(historyTimer);
      historyTimer = setTimeout(() => {
        const range = api.timeScale().getVisibleRange();
        const logical = api.timeScale().getVisibleLogicalRange();
        setVisibleBars(logical ? logical.to - logical.from : 0);
        if (
          range &&
          typeof range.from === "number" &&
          typeof range.to === "number"
        ) {
          const window = { from: range.from, to: range.to };
          if (latest.current.replay === null && !changingData.current && dataReady.current && window.to > window.from) latest.current.onViewChange?.(window);
          setVisibleWindow((previous) =>
            previous?.from === window.from && previous?.to === window.to
              ? previous
              : window,
          );
        }
        if (!range) setVisibleWindow(null);
        checkHistory.current();
      }, 180);
    };
    const background = new SessionBackground();
    sessionBackground.current = background;
    candles.attachPrimitive(background);
    api.timeScale().subscribeVisibleLogicalRangeChange(rangeChanged);
    let syncing = false;
    const crosshairMoved = (event: MouseEventParams) => {
      paint();
      if (
        syncing ||
        changingData.current ||
        !dataReady.current ||
        !event.sourceEvent ||
        !event.point ||
        typeof event.time !== "number"
      )
        return;
      ohlcLegend.current?.inspect(event.seriesData.get(candles));
      benchmarkLayer.current?.inspect(event.time);
      if (!latest.current.preferences.linked) return;
      window.dispatchEvent(
        new CustomEvent("workstation-crosshair", {
          detail: { source: p.panel.id, time: event.time },
        }),
      );
    };
    api.subscribeCrosshairMove(crosshairMoved);
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<{ source: string; time: number }>)
        .detail;
      if (
        detail.source === p.panel.id ||
        !latest.current.preferences.linked ||
        changingData.current ||
        !dataReady.current
      )
        return;
      const bar = executionBar(
        { time: detail.time } as never,
        renderedData.current,
        latest.current.panel.interval,
        historyResult.current.session,
      );
      syncing = true;
      try {
        if (
          bar &&
          api.timeScale().timeToCoordinate(asTime(bar.time)) !== null &&
          candles.priceToCoordinate(bar.close) !== null
        ) {
          api.setCrosshairPosition(bar.close, asTime(bar.time), candles);
          // Lightweight Charts does not emit crosshair events for synthetic positions.
          ohlcLegend.current?.inspect(bar);
          benchmarkLayer.current?.inspect(bar.time);
        } else api.clearCrosshairPosition();
      } finally {
        syncing = false;
      }
    };
    window.addEventListener("workstation-crosshair", sync);
    const fit = () => {
      focusedWindow.current = null;
      focusedTarget.current = null;
      if (!bars.current.length) return;
      const trade = latest.current.trade,
        interval = latest.current.panel.interval;
      const padding = Math.max(
        seconds[interval] * 10,
        (trade.closeTime - trade.openTime) * 0.35,
      );
      const min = bars.current[0].time,
        max = bars.current[bars.current.length - 1].time;
      const from = Math.max(min, trade.openTime - padding),
        to = Math.min(max, trade.closeTime + padding);
      if (to > from)
        api.timeScale().setVisibleRange({ from: asTime(from), to: asTime(to) });
      else api.timeScale().fitContent();
      candles.priceScale().applyOptions({ autoScale: true });
      paint();
    };
    fitRef.current = fit;
    const navigate = (
      time: number,
      fitTrade: boolean,
      range?: HistoryRange,
      reveal?: { target: ChartDateTarget; width: number },
    ) => {
      const p = latest.current;
      navigation.current = {
        time,
        trade: p.trade.id,
        fit: fitTrade,
        range,
        reveal,
      };
      setReload((n) => n + 1);
    };
    requestFit.current = () => {
      if (beforeEntryActive.current) {
        const size = api.timeScale().getVisibleLogicalRange();
        api.timeScale().setVisibleLogicalRange({ from: bars.current.length - Math.max(30, size ? size.to - size.from : 120), to: bars.current.length + 2 });
        return;
      }
      focusedWindow.current = null; focusedTarget.current = null;
      const p = latest.current;
      if (
        p.replay === null &&
        (!executionBar(
          { time: p.trade.openTime } as never,
          bars.current,
          p.panel.interval,
          historyResult.current.session,
        ) ||
          !executionBar(
            { time: p.trade.closeTime } as never,
            bars.current,
            p.panel.interval,
            historyResult.current.session,
          ))
      )
        navigate((p.trade.openTime + p.trade.closeTime) / 2, true, fitTradeHistoryRange(p.trade, p.panel.interval));
      else fit();
    };
    const targetAnchor = (target: ChartDateTarget) =>
      dateTargetAnchor(
        target,
        bars.current,
        latest.current.trade.executions.filter(
          (fill) =>
            latest.current.replay === null ||
            fill.time <= latest.current.replay,
        ),
      );
    revealRef.current = (target, width) => {
      if (!bars.current.length) return;
      const time = targetAnchor(target);
      const containing = executionBar(
        { time } as never,
        bars.current,
        latest.current.panel.interval,
        historyResult.current.session,
      );
      let index = containing
        ? bars.current.indexOf(containing)
        : bars.current.findIndex((bar) => bar.time >= time);
      if (index < 0) index = bars.current.length - 1;
      api.timeScale().setVisibleLogicalRange({
        from: index - width / 2,
        to: index + width / 2,
      });
      paint();
    };
    const handle: ChartHandle = {
      inspect: (id) => setInspectedId(id),
      focus: () => container.current?.focus({ preventScroll: true }),
      cancel: () => {
        pending.current = null;
        draft.current = null;
        drag.current = null;
        paintRef.current();
      },
      fit: () => { autoPages.current = 0; requestFit.current(); },
      beforeTrade: () => {
        const p = latest.current;
        if (beforeEntryBoundary(p.trade, p.panel.interval, historyResult.current.session) === null) return;
        p.onPanel?.({ beforeEntry: !p.panel.beforeEntry });
      },
      toggleLabels: () => latest.current.onToggleLabels(),
      toggleComparison: () => {
        const p = latest.current;
        p.onPanel?.(toggleBenchmark(p.panel));
      },
      toggleSession: () => {
        const p = latest.current;
        p.onPanel?.({ session: p.trade.chartSession === "regular" ? "extended" : "regular" });
      },
      view() {
        const range = api.timeScale().getVisibleRange();
        return range &&
          typeof range.from === "number" &&
          typeof range.to === "number"
          ? { from: range.from, to: range.to }
          : null;
      },
      reveal(target) {
        if (!Number.isFinite(target.time)) return;
        const range = api.timeScale().getVisibleRange();
        const visible =
          range &&
          typeof range.from === "number" &&
          typeof range.to === "number"
            ? { from: range.from, to: range.to }
            : null;
        if (dateTargetIsVisible(target, visible, latest.current.panel.interval))
          return;
        const time = targetAnchor(target);
        const logical = api.timeScale().getVisibleLogicalRange();
        const width = logical ? logical.to - logical.from : 40;
        const duration =
          range &&
          typeof range.to === "number" &&
          typeof range.from === "number"
            ? range.to - range.from
            : seconds[latest.current.panel.interval] * 40;
        const desired = {
          from: time - duration / 2,
          to: time + duration / 2,
        };
        focusedWindow.current = null;
        focusedTarget.current = { target, width };
        const coverage = history.current?.state.range;
        if (
          !coverage ||
          !dataReady.current ||
          desired.from < coverage.from ||
          Math.min(desired.to, Date.now() / 1000) > coverage.to
        ) {
          navigate(time, false, desired, { target, width });
          return;
        }
        revealRef.current(target, width);
      },
      async capture(
        light = latest.current.preferences.theme === "light",
        scale = 2,
        frame?: { width: number; height: number },
      ) {
        if (!dataReady.current || !bars.current.length)
          throw new Error("Wait for chart candles before exporting.");
        const frozen = options(true, light),
          snapshotBars = [...bars.current],
          prefs = latest.current.preferences;
        const frozenBenchmark = benchmarkLayer.current?.snapshot();
        const header = frozenBenchmark?.symbol ? 48 : 30;
        const width = frame?.width ?? dimensions.current.width, height = frame ? Math.max(60, frame.height - header) : dimensions.current.height + 75;
        const frozenBeforeEntry = beforeEntryActive.current;
        const frozenTrade = frozenBeforeEntry ? { ...latest.current.trade, executions: [] } : latest.current.trade, frozenInterval = latest.current.panel.interval, frozenHistory = historyResult.current;
        const priceRange = candles.priceScale().getVisibleRange();
        const container = document.createElement("div");
        container.style.cssText = `position:fixed;left:-100000px;top:0;width:${width * scale}px;height:${height * scale}px;`;
        document.body.appendChild(container);
        const clone = createChart(container, {
          width: width * scale,
          height: height * scale,
          layout: {
            background: {
              type: ColorType.Solid,
              color: light ? "#ffffff" : "#10151f",
            },
            textColor: light ? "#526077" : "#8996ad",
            fontSize: 10 * scale,
            attributionLogo: false,
          },
          grid: {
            vertLines: { color: light ? "#edf0f5" : "#1b2230", visible: prefs.gridlines.vertical },
            horzLines: { color: light ? "#edf0f5" : "#1b2230", visible: prefs.gridlines.horizontal },
          },
          rightPriceScale: {
            borderVisible: false,
            minimumWidth: api.priceScale("right").width() * scale,
            scaleMargins: { top: 0.16, bottom: 0.22 },
          },
          timeScale: {
            borderVisible: false,
            timeVisible: true,
            barSpacing: api.timeScale().options().barSpacing * scale,
          },
        });
        let detachExportBackground = () => {};
        try {
          const cs = clone.addSeries(CandlestickSeries, {
            upColor: "#38bfa6",
            downColor: "#e47886",
            wickUpColor: "#38bfa6",
            wickDownColor: "#e47886",
            borderVisible: false,
            priceLineVisible: false,
            lastValueVisible: false,
          });
          cs.setData(snapshotBars.map((b) => ({ ...b, time: asTime(b.time) })));
          if (frozenBenchmark?.candles.length) {
            const comparison = clone.addSeries(CandlestickSeries, benchmarkStyle(light, prefs.benchmarkColor));
            comparison.priceScale().applyOptions(benchmarkScale);
            comparison.setData(frozenBenchmark.candles.map(b => ({ ...b, time: asTime(b.time) })));
          }
          const exportBackground = new SessionBackground();
          exportBackground.setData(snapshotBars, frozenInterval, frozenHistory.session, light);
          cs.attachPrimitive(exportBackground);
          detachExportBackground = () => cs.detachPrimitive(exportBackground);
          if (prefs.volume) {
            const vs = clone.addSeries(HistogramSeries, {
              priceFormat: { type: "volume" },
              priceScaleId: "volume",
              lastValueVisible: false,
              priceLineVisible: false,
            });
            vs.priceScale().applyOptions({
              scaleMargins: { top: 0.84, bottom: 0 },
            });
            vs.setData(
              snapshotBars.map((b) => ({
                time: asTime(b.time),
                value: b.volume,
                color: volumeColor(prefs.volumeStyle, b.close >= b.open ? "up" : "down", light, "capture"),
              })),
            );
            if (prefs.volumeAverage.enabled) {
              const average = clone.addSeries(LineSeries, {
                priceScaleId: "volume", priceFormat: { type: "volume" },
                color: volumeColor(prefs.volumeStyle, "average", light, "capture"), lineWidth: Math.min(4, scale) as 1 | 2 | 3 | 4,
                lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
              });
              average.setData(volumeMovingAverage(snapshotBars, prefs.volumeAverage.period).map(b => ({ ...b, time: asTime(b.time) })));
            }
          }
          prefs.averages.forEach((period, i) => {
            const sma = clone.addSeries(LineSeries, {
              color: ["#c4a36c", "#8a8ac8", "#609fce", "#ba7997"][i % 4],
              lineWidth: Math.min(4, scale) as 1 | 2 | 3 | 4,
              lastValueVisible: false,
              priceLineVisible: false,
              crosshairMarkerVisible: false,
            });
            sma.setData(
              movingAverage(snapshotBars, period).map((b) => ({
                ...b,
                time: asTime(b.time),
              })),
            );
          });
          const range = api.timeScale().getVisibleLogicalRange();
          if (range) clone.timeScale().setVisibleLogicalRange(range);
          if (priceRange) { cs.priceScale().setAutoScale(false); cs.priceScale().setVisibleRange(priceRange); }
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          const native = clone.takeScreenshot(true, false),
            output = document.createElement("canvas");
          output.width = width * scale;
          output.height = (height + header) * scale;
          const ctx = output.getContext("2d")!;
          ctx.fillStyle = light ? "#ffffff" : "#10151f";
          ctx.fillRect(0, 0, output.width, output.height);
          ctx.drawImage(
            native,
            0,
            header * scale,
            width * scale,
            height * scale,
          );
          ctx.save();
          ctx.translate(0, header * scale);
          ctx.scale(scale, scale);
          const exportOptions: PaintOptions = { ...frozen, width, height, plotWidth: clone.timeScale().width() / scale, plotHeight: height - clone.timeScale().height() / scale, x: time => { const x = clone.timeScale().logicalToCoordinate(logicalTimeIndex(time, snapshotBars, frozenInterval) as never); return x === null ? null : x / scale; }, y: price => { const y = cs.priceToCoordinate(price); return y === null ? null : y / scale; } };
          paintChart(ctx, exportOptions);
          ctx.restore();
          ctx.scale(scale, scale);
          ctx.fillStyle = light ? "#243149" : "#dde5f3";
          ctx.font = "600 13px system-ui";
          ctx.fillText(
            `${frozenTrade.symbol} / ${frozenInterval}${frozenBeforeEntry ? " · BEFORE ENTRY" : ""}${frozenBenchmark?.symbol ? ` · ${frozenBenchmark.symbol} comparison` : ""} · ${frozenTrade.direction} · UTC${frozenHistory.splitAdjustment ? " \u00b7 SPLIT ADJUSTED" : ""}${frozen.replay !== null ? ` · REPLAY ${new Date(frozen.replay * 1000).toISOString()}` : ""}`,
            16,
            21,
          );
          ctx.fillStyle = light ? "#526077" : "#8996ad";
          ctx.font = "10px system-ui";
          if (frozenBenchmark?.symbol) { ctx.fillStyle = benchmarkColor(light, prefs.benchmarkColor); ctx.fillText(frozenBenchmark.legend, 16, 38, width - 32); ctx.fillStyle = light ? "#526077" : "#8996ad"; }
          return output;
        } finally {
          detachExportBackground();
          clone.remove();
          container.remove();
        }
      },
    };
    ownHandle.current = handle;
    p.register(p.panel.id, handle);
    return () => {
      ownHandle.current = null;
      p.register(p.panel.id, null);
      resize.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(historyTimer);
      window.removeEventListener("workstation-crosshair", sync);
      api.unsubscribeCrosshairMove(crosshairMoved);
      candles.detachPrimitive(background);
      sessionBackground.current = null;
      ohlcLegend.current?.reset();
      ohlcLegend.current = null;
      benchmarkLayer.current?.dispose();
      benchmarkLayer.current = null;
      api.remove();
      chart.current = null;
      series.current = null;
    };
  }, []);

  useEffect(() => {
    const api = chart.current,
      cs = series.current;
    if (!api || !cs || loading || failure) return;
    const previousRange = api.timeScale().getVisibleRange(),
      previousLogical =
        viewBeforeUpdate.current ?? api.timeScale().getVisibleLogicalRange(),
      changedInterval = currentInterval.current !== props.panel.interval;
    viewBeforeUpdate.current = null;
    const changedTrade = currentTrade.current !== props.trade.id;
    if (!wasReplaying.current && props.replay !== null && previousLogical)
      beforeReplay.current = {
        range: previousLogical,
        candles: renderedData.current,
        interval: props.panel.interval,
        trade: props.trade.id,
      };
    const replayRestore =
      wasReplaying.current &&
      props.replay === null &&
      beforeReplay.current?.interval === props.panel.interval &&
      beforeReplay.current.trade === props.trade.id
        ? beforeReplay.current
        : null;
    wasReplaying.current = props.replay !== null;
    if (props.replay === null) beforeReplay.current = null;
    const entryContext = `${props.trade.id}:${props.trade.timeInterpretationVersion}:${props.panel.interval}:${JSON.stringify(result.session)}`;
    if (!wasBeforeEntry.current && beforeEntry && previousLogical) beforeEntryView.current = { range: previousLogical, candles: renderedData.current, interval: props.panel.interval, context: entryContext };
    const entryRestore = wasBeforeEntry.current && !beforeEntry && beforeEntryView.current?.context === entryContext ? beforeEntryView.current : null;
    const entryStart = beforeEntry && (!wasBeforeEntry.current || changedInterval || changedTrade);
    wasBeforeEntry.current = beforeEntry;
    if (!beforeEntry) beforeEntryView.current = null;
    changingData.current = true;
    // Remove old comparison timestamps before primary history contracts for replay.
    benchmarkLayer.current?.update({ primary: [], benchmark: [], symbol: "", light: props.preferences.theme === "light" });
    cs.setData(data.map((b) => ({ ...b, time: asTime(b.time) })));
    sessionBackground.current?.setData(data, props.panel.interval, result.session, props.preferences.theme === "light");
    const volume = api.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
      visible: props.preferences.volume,
    });
    volume
      .priceScale()
      .applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    volume.setData(
      data.map((b) => ({
        time: asTime(b.time),
        value: b.volume,
        color: volumeColor(props.preferences.volumeStyle, b.close >= b.open ? "up" : "down", props.preferences.theme === "light"),
      })),
    );
    const averages = props.preferences.averages.map((period, i) => {
      const sma = api.addSeries(LineSeries, {
        color: ["#c4a36c", "#8a8ac8", "#609fce", "#ba7997"][i % 4],
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
      sma.setData(
        movingAverage(data, period).map((b) => ({
          ...b,
          time: asTime(b.time),
        })),
      );
      return sma;
    });
    if (destination.current) {
      const target = destination.current;
      destination.current = null;
      if (target.fit) fitRef.current();
      else if (target.reveal)
        revealRef.current(target.reveal.target, target.reveal.width);
      else if (data.length)
        api.timeScale().setVisibleRange({
          from: asTime(
            target.range?.from ??
              target.time - seconds[props.panel.interval] * 24,
          ),
          to: asTime(
            target.range?.to ??
              target.time + seconds[props.panel.interval] * 24,
          ),
        });
    } else if (replayRestore)
      api
        .timeScale()
        .setVisibleLogicalRange(
          preserveHistoryViewport(
            replayRestore.candles,
            data,
            replayRestore.range,
          ),
        );
    else if (focusedTarget.current && data.length && props.replay === null)
      revealRef.current(
        focusedTarget.current.target,
        focusedTarget.current.width,
      );
    else if (focusedWindow.current && data.length && props.replay === null)
      api.timeScale().setVisibleRange({
        from: asTime(focusedWindow.current.from),
        to: asTime(focusedWindow.current.to),
      });
    else if (!lastData.current.length || changedTrade) fitRef.current();
    else if (
      changedInterval &&
      previousRange &&
      typeof previousRange.from === "number" &&
      typeof previousRange.to === "number"
    ) {
      const center = (previousRange.from + previousRange.to) / 2;
      const radius = Math.max(
        (previousRange.to - previousRange.from) / 2,
        seconds[props.panel.interval] * 12,
      );
      api.timeScale().setVisibleRange({
        from: asTime(center - radius),
        to: asTime(center + radius),
      });
    } else if (previousLogical)
      api
        .timeScale()
        .setVisibleLogicalRange(
          preserveHistoryViewport(renderedData.current, data, previousLogical),
        );
    if (entryStart && data.length) {
      const width = Math.max(20, previousLogical ? previousLogical.to - previousLogical.from : 120);
      api.timeScale().setVisibleLogicalRange({ from: data.length - 1 - width, to: data.length + 2 });
    } else if (entryRestore) api.timeScale().setVisibleLogicalRange(preserveHistoryViewport(entryRestore.candles, data, entryRestore.range));
    currentInterval.current = props.panel.interval;
    currentSession.current = props.trade.chartSession;
    currentTrade.current = props.trade.id;
    lastData.current = result.candles;
    renderedData.current = data;
    changingData.current = false;
    paintRef.current();
    return () => {
      changingData.current = true;
      if (chart.current === api) {
        viewBeforeUpdate.current = api.timeScale().getVisibleLogicalRange();
        api.removeSeries(volume);
        averages.forEach((s) => api.removeSeries(s));
      }
    };
    // Candles are deliberately updated without recreating the chart or losing its visible range.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    result.candles,
    props.panel.interval,
    props.preferences.volume,
    props.preferences.volumeStyle,
    props.preferences.averages,
    beforeEntry,
    props.replay,
    loading,
    failure,
  ]);
  useEffect(() => {
    const api = chart.current;
    if (!api || loading || failure || !props.preferences.volume || !props.preferences.volumeAverage.enabled) return;
    const average = api.addSeries(LineSeries, {
      priceScaleId: "volume", priceFormat: { type: "volume" },
      color: volumeColor(props.preferences.volumeStyle, "average", props.preferences.theme === "light"), lineWidth: 1,
      lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
    });
    average.setData(volumeMovingAverage(data, props.preferences.volumeAverage.period).map(b => ({ ...b, time: asTime(b.time) })));
    return () => { if (chart.current === api) api.removeSeries(average); };
  }, [data, props.preferences.volume, props.preferences.volumeAverage.enabled, props.preferences.volumeAverage.period, props.preferences.volumeStyle, props.preferences.theme, loading, failure]);
  useEffect(() => {
    if (loading || failure || changingData.current) return;
    // Reconcile after setData; hover itself never enters React or the data effects.
    ohlcLegend.current?.reconcile(renderedData.current, visibleWindow?.to);
  }, [result.candles, props.panel.interval, props.replay, beforeEntry, visibleWindow, loading, failure]);
  const benchmark = useBenchmark(props.adapter, trade, props.panel, visibleWindow ?? props.initialRange ?? null);
  useEffect(() => {
    if (!chart.current || loading || changingData.current) return;
    benchmarkLayer.current?.update({ primary: renderedData.current, benchmark: benchmark.candles, symbol: props.panel.benchmark === "off" ? "" : props.panel.benchmark ?? "", light: props.preferences.theme === "light", color: props.preferences.benchmarkColor });
  }, [benchmark.candles, props.preferences.benchmarkColor, result.candles, props.panel.benchmark, props.panel.interval, props.preferences.theme, props.preferences.volume, props.preferences.averages, props.replay, beforeEntry, loading, failure]);
  useEffect(() => {
    const light = props.preferences.theme === "light";
    sessionBackground.current?.setTheme(light);
    chart.current?.applyOptions({
      layout: {
        background: {
          type: ColorType.Solid,
          color: light ? "#ffffff" : "#10151f",
        },
        textColor: light ? "#68758a" : "#7e899e",
      },
      grid: {
        vertLines: { color: light ? "#edf0f5" : "#1b2230", visible: props.preferences.gridlines.vertical },
        horzLines: { color: light ? "#edf0f5" : "#1b2230", visible: props.preferences.gridlines.horizontal },
      },
    });
    paintRef.current();
  }, [props.preferences.theme, props.preferences.gridlines.horizontal, props.preferences.gridlines.vertical]);
  useEffect(() => {
    paintRef.current();
  }, [
    props.drawings,
    props.drawingsHidden,
    props.selected,
    props.selectedExecution,
    props.labelMode,
    props.preferences.executionColors,
    beforeEntry,
    props.replay,
  ]);
  useEffect(() => {
    pending.current = null;
    draft.current = null;
    drag.current = null;
    previewPin.current = null; touchPin.current = null;
    paintRef.current();
  }, [props.tool, props.trade.id, props.trade.timeInterpretationVersion, props.panel.interval, props.trade.chartSession, beforeEntry, props.replay, props.drawingsHidden, result.splitAdjustment]);

  const pointer = (event: React.PointerEvent) => {
    const rect = host.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const pointAt = (pos: { x: number; y: number }, free = false): Point | null => {
    const logical = chart.current?.timeScale().coordinateToLogical(pos.x),
      price = series.current?.coordinateToPrice(pos.y);
    if (
      logical === null ||
      logical === undefined ||
      price === null ||
      price === undefined ||
      !bars.current.length
    )
      return null;
    if (free) {
      const list = bars.current, index = Math.floor(logical);
      const time = logical < 0 ? list[0].time + logical * seconds[props.panel.interval]
        : logical >= list.length - 1 ? list.at(-1)!.time + (logical - list.length + 1) * seconds[props.panel.interval]
        : list[index].time + (logical - index) * (list[index + 1].time - list[index].time);
      return { time: Math.max(0, time), price };
    }
    const index = Math.max(
        0,
        Math.min(bars.current.length - 1, Math.round(logical)),
      ),
      bar = bars.current[index];
    return {
      time: bar.time,
      price: props.preferences.magnet
        ? [bar.open, bar.high, bar.low, bar.close].sort(
            (a, b) => Math.abs(a - price) - Math.abs(b - price),
          )[0]
        : Math.round(price * 10000) / 10000,
    };
  };
  const makeDrawing = (points: Point[]): Drawing => ({
    id: crypto.randomUUID(),
    tool: props.tool === "cursor" ? "text" : props.tool,
    points,
    text: props.tool === "text" || props.tool === "pin" ? "New note" : "",
    ...drawingStyleFor(props.tool === "cursor" ? "text" : props.tool, props.preferences.drawingStyles),
    locked: false,
    hidden: false,
    panel: props.panel.id,
    createdAt: props.replay ?? Date.now() / 1000,
  });
  const down = (event: React.PointerEvent<HTMLDivElement>) => {
    focusedWindow.current = null;
    focusedTarget.current = null;
    clickGesture.current = null;
    props.onActive();
    if (!dataReady.current || loading || failure || event.button !== 0) return;
    const pos = pointer(event);
    if (
      pos.x > (chart.current?.timeScale().width() ?? 0) ||
      pos.y > dimensions.current.height - 25
    )
      return;
    const hit = hitAt(hits.current, pos);
    if (event.pointerType === "touch") {
      const pin = props.drawings.find(d => d.id === hit?.id && d.tool === "pin");
      touchPin.current = pin && touchPin.current !== pin.id ? pin.id : null;
      previewPin.current = touchPin.current; paintRef.current();
    }
    if (props.tool === "cursor") {
      if (hit) {
        event.preventDefault();
        event.stopPropagation();
        if (hit.kind === "execution")
          clickGesture.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            moved: false,
            execution: hit.id,
          };
        else {
          props.onSelect(hit.id);
          const wholeDrawing = props.drawings.find(d => d.id === hit.id);
          if (hit.point === undefined && wholeDrawing && ["measure", "ray", "pin"].includes(wholeDrawing.tool) && !wholeDrawing.locked && !props.trade.stale) {
            const logical = chart.current?.timeScale().coordinateToLogical(pos.x), price = series.current?.coordinateToPrice(pos.y);
            if (logical != null && price != null) {
              drag.current = { drawing: wholeDrawing, whole: { start: pos, candles: [...bars.current] } };
              event.currentTarget.setPointerCapture(event.pointerId);
            }
          }
          if (hit.point !== undefined) {
            let drawing = props.drawings.find((d) => d.id === hit.id);
            if (drawing && !drawing.locked && !props.trade.stale) {
              const note = drawing.tool === "text" || drawing.tool === "price-note";
              // Materialize a legacy note's implicit box anchor only when it is moved.
              const box = note ? hits.current.find(h => h.id === hit.id && h.point === 1 && h.anchor)?.anchor : undefined;
              if (box && !drawing.points[1]) {
                const end = pointAt(box, true);
                if (end) drawing = { ...drawing, points: [drawing.points[0], end] };
              }
              const anchor = hit.anchor ?? (note ? { x: hit.x + hit.w / 2, y: hit.y + hit.h / 2 } : undefined);
              drag.current = { drawing, point: hit.point, offset: anchor ? { x: pos.x - anchor.x, y: pos.y - anchor.y } : undefined };
              event.currentTarget.setPointerCapture(event.pointerId);
            }
          }
        }
      } else {
        props.onSelect(null);
        const time = chart.current?.timeScale().coordinateToTime(pos.x);
        if (typeof time === "number" && event.isPrimary)
          clickGesture.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            moved: false,
            target: { time, end: time + seconds[props.panel.interval] },
          };
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const point = pointAt(pos);
    if (!point) return;
    const twoPoint = [
      "trend",
      "arrow",
      "zone",
      "measure",
      "long",
      "short",
    ].includes(props.tool);
    if (twoPoint && !pending.current) {
      pending.current = point;
      draft.current = makeDrawing([point, point]);
      paintRef.current();
      return;
    }
    const drawing = makeDrawing(
      pending.current ? [pending.current, point] : [point],
    );
    if (drawing.tool === "long" || drawing.tool === "short") {
      const direction = drawing.tool === "long" ? 1 : -1;
      drawing.points.push({
        time: point.time,
        price:
          drawing.points[0].price -
          (direction * Math.abs(point.price - drawing.points[0].price)) / 2,
      });
    }
    props.onDrawing(drawing);
    props.onSelect(drawing.id);
    pending.current = null;
    draft.current = null;
    if (!props.preferences.keepTool) props.onToolDone();
    paintRef.current();
  };
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const click = clickGesture.current;
    if (
      click &&
      (event.pointerId !== click.pointerId ||
        Math.hypot(event.clientX - click.x, event.clientY - click.y) > 4)
    )
      click.moved = true;
    if (click?.moved && click.target && event.buttons === 1 && props.tool === "cursor") autoPages.current = 3;
    if (!dataReady.current) return;
    if (!event.buttons && event.pointerType !== "touch") {
      const hit = hitAt(hits.current, pointer(event));
      const pin = props.drawings.find(d => d.id === hit?.id && d.tool === "pin");
      const next = pin?.id ?? touchPin.current;
      if (next !== previewPin.current) { previewPin.current = next; paintRef.current(); }
    }
    const current = drag.current;
    if (current?.whole) {
      event.preventDefault(); event.stopPropagation();
      const pos = pointer(event), state = current.whole;
      if (Math.hypot(pos.x - state.start.x, pos.y - state.start.y) < 4 && !draft.current) return;
      const logical = chart.current?.timeScale().coordinateToLogical(pos.x), price = series.current?.coordinateToPrice(pos.y);
      // Selection may resize the plot when the properties banner opens. Compute
      // both pointer coordinates against the current scale to avoid a jump.
      const startLogical = chart.current?.timeScale().coordinateToLogical(state.start.x), startPrice = series.current?.coordinateToPrice(state.start.y);
      if (logical == null || price == null || startLogical == null || startPrice == null) return;
      let logicalDelta = logical - startLogical, priceDelta = price - startPrice;
      if (props.preferences.magnet) {
        const referenceIndex = logicalTimeIndex(current.drawing.points[0].time, state.candles, props.panel.interval);
        const snapped = Math.max(0, Math.min(state.candles.length - 1, Math.round(referenceIndex + logicalDelta)));
        logicalDelta = snapped - referenceIndex;
        const bar = state.candles[snapped], desired = current.drawing.points[0].price + priceDelta;
        priceDelta = [bar.open, bar.high, bar.low, bar.close].sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired))[0] - current.drawing.points[0].price;
      }
      const maximum = beforeEntry || props.replay !== null ? state.candles.at(-1)?.time : undefined;
      draft.current = { ...current.drawing, points: translateMeasurement(current.drawing.points, state.candles, props.panel.interval, logicalDelta, priceDelta, maximum) };
      paintRef.current();
      return;
    }
    const pos = pointer(event), offset = drag.current?.offset;
    const point = pointAt(offset ? { x: pos.x - offset.x, y: pos.y - offset.y } : pos, !!offset);
    if (!point) return;
    if (drag.current) {
      draft.current = {
        ...drag.current.drawing,
        points: drag.current.drawing.points.map((p, i) =>
          i === drag.current!.point ? point : p,
        ),
      };
      paintRef.current();
    } else if (pending.current && draft.current) {
      draft.current = { ...draft.current, points: [pending.current, point] };
      paintRef.current();
    }
  };
  const up = () => {
    if (drag.current && draft.current && draft.current.points.some((p, i) => p.time !== drag.current!.drawing.points[i]?.time || p.price !== drag.current!.drawing.points[i]?.price)) props.onDrawing(draft.current);
    drag.current = null;
    draft.current = null;
    paintRef.current();
  };
  const clickDate = (event: React.PointerEvent<HTMLDivElement>) => {
    const click = clickGesture.current;
    clickGesture.current = null;
    if (
      !click ||
      click.moved ||
      click.pointerId !== event.pointerId ||
      Math.hypot(event.clientX - click.x, event.clientY - click.y) > 4
    )
      return;
    if (click.execution) { setInspectedId(click.execution); props.onExecution(click.execution); }
    else if (click.target) props.onDateClick(click.target);
  };
  const visibleExecutions = (beforeEntry ? [] : props.trade.executions).filter(
    (e) => props.replay === null || e.time <= props.replay,
  );
  const diagnostics = loading ? [] : visibleExecutions.map(e => diagnoseExecution(e, data, props.panel.interval, result.session));
  const currentVisibility = visibility.filter(r => visibleExecutions.some(e => e.id === r.diagnostic.execution.id));
  const missing = diagnostics.filter(d => d.status === "missing").length;
  const outside = diagnostics.filter(d => d.status === "price-outside").length;
  const inspected = diagnostics.find(d => d.execution.id === inspectedId);
  const coverageLabel = loading ? "Loading execution comparison" : executionDiagnosticSummary(diagnostics);
  const historyWarning =
    !!historyState?.error ||
    missing > 0 || outside > 0 || diagnostics.some(d => d.timezoneUnverified || d.periodUnverified) ||
    (!!result.warning && props.adapter.mode !== "demo");
  return (
    <section
      ref={container}
      tabIndex={0}
      data-chart-id={props.panel.id}
      style={props.fullscreen ? undefined : props.style}
      data-label-mode={props.labelMode}
      data-price-adjustment={result.provider?.adjustment ?? "unverified"}
      data-session={props.trade.chartSession}
      onFocusCapture={props.onActive}
      onPointerDownCapture={(event) => {
        props.onActive();
        if (!(event.target as Element).closest("button,input,select,a,textarea,[contenteditable]")) container.current?.focus({ preventScroll: true });
      }}
      className={`ws-chart ${props.active ? "ws-chart-active" : ""} ${props.fullscreen ? "ws-chart-fullscreen" : ""}`}
      aria-label={`${props.trade.symbol} ${props.panel.interval} chart`}
      data-visible-from={visibleWindow?.from}
      data-visible-to={visibleWindow?.to}
      data-visible-bars={visibleBars}
      data-history-interval={historyState?.interval}
      data-visible-executions={loading ? 0 : currentVisibility.filter(r => r.reason === "visible").length}
    >
      <div className="ws-chart-heading" onClick={props.onActive}>
        <div className="ws-chart-symbol">
          <strong>{props.trade.symbol}</strong>
          <span>·</span>
          <select
            aria-label={`Timeframe ${props.panel.id}`}
            value={props.panel.interval}
            onChange={(e) => props.onInterval(e.target.value as Interval)}
          >
            {intervals.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
          <select aria-label={`Comparison ${props.panel.id}`} title={props.comparisonTitle} value={props.panel.benchmark ?? "off"} onChange={e => props.onPanel?.(selectBenchmark(props.panel, e.target.value as NonNullable<ChartPanel["benchmark"]>))}>
            <option value="off">Off</option><option>SPY</option><option>QQQ</option>
          </select>
          <select className="ws-chart-session" aria-label={`Chart session ${props.panel.id}`} value={props.panel.session ?? "auto"} title={`${props.sessionTitle}${props.panel.interval === "1d" || props.panel.interval === "1wk" ? "; daily and weekly bars retain provider aggregation" : ""}`} onChange={e => props.onPanel?.({ session: e.target.value as ChartPanel["session"] })}>
            <option value="auto">Auto ({props.trade.chartSession})</option><option value="regular">Regular</option><option value="extended">Extended</option>
          </select>
          <button className={beforeEntry ? "active" : ""} aria-label={`Before entry ${props.panel.id}`} aria-pressed={beforeEntry} disabled={entryBoundary === null} title={entryBoundary === null ? "Resolve the execution time and candle session before using Before entry" : props.beforeTradeTitle} onClick={() => ownHandle.current?.beforeTrade()}>Before entry</button>
          <span className="ws-session">
            {props.panel.interval === "5m" ? "EXECUTION" : "CONTEXT"}
          </span>
        </div>
        <div className="ws-chart-actions">
          <button className="ws-fill-toggle" aria-label={`Execution visibility ${props.panel.id}`} aria-expanded={fillsOpen} title={loading ? "Loading execution visibility" : visibilitySummary(currentVisibility)} onClick={() => setFillsOpen(v => !v)}>
            {loading ? "?" : `${currentVisibility.filter(r => r.reason === "visible").length}/${visibleExecutions.length}`} fills
          </button>
          <button aria-label={`${props.labelMode === "labels" ? "Hide" : "Show"} execution labels ${props.panel.id}`} aria-pressed={props.labelMode === "labels"} title={props.labelsTitle} onClick={props.onToggleLabels}>{props.labelMode === "labels" ? <Eye size={14} /> : <EyeOff size={14} />}</button>
          <button
            className={`ws-history-toggle ${historyWarning ? "ws-history-warning" : ""}`}
            aria-label={`Chart history ${props.panel.id}`}
            aria-expanded={historyOpen}
            title={`${result.source || "History"} · ${coverageLabel}${historyState?.error ? ` · ${historyState.error}` : ""}`}
            onClick={() => setHistoryOpen((value) => !value)}
          >
            <Info size={13} />
            <span>
              {historyState?.loading
                ? "Loading"
                : missing || outside
                  ? "Check fills"
                  : result.source || "History"}
            </span>
          </button>
          <button
            title={props.fitTitle}
            aria-label={`Fit trade ${props.panel.id}`}
            onClick={() => ownHandle.current?.fit()}
          >
            <Crosshair size={13} />
          </button>
          <button
            title="Export chart"
            aria-label={`Export ${props.panel.id}`}
            onClick={props.onDownload}
          >
            <Download size={13} />
          </button>
          <button
            title={props.fullscreenTitle}
            aria-label={`Focus ${props.panel.id}`}
            aria-pressed={props.fullscreen}
            onClick={props.onFullscreen}
          >
            {props.fullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
        </div>
      </div>
      <div className="ws-benchmark-legend" ref={benchmarkHost} style={{ color: benchmarkColor(props.preferences.theme === "light", props.preferences.benchmarkColor) }} />
      {props.panel.benchmark && props.panel.benchmark !== "off" && benchmark.error && <button className="ws-benchmark-error" onClick={benchmark.retry}>{benchmark.error}</button>}
      {beforeEntry && !loading && !data.length && <div className="ws-before-entry-empty" role="status">No completed candles before entry</div>}
      <div
        className={`ws-plot ${props.tool !== "cursor" ? "ws-drawing" : ""}`}
        onWheelCapture={() => {
          focusedWindow.current = null;
          focusedTarget.current = null;
          clickGesture.current = null;
          autoPages.current = 3;
          props.onActive();
        }}
        onPointerDownCapture={down}
        onPointerMoveCapture={move}
        onPointerLeave={() => { if (!container.current?.querySelector("[data-pin-target]:focus-visible")) { previewPin.current = touchPin.current; paintRef.current(); } }}
        onDoubleClick={event => {
          const rect = host.current!.getBoundingClientRect();
          const hit = hitAt(hits.current, { x: event.clientX - rect.left, y: event.clientY - rect.top });
          const drawing = props.drawings.find(d => d.id === hit?.id);
          if (drawing?.tool === "pin" && !drawing.locked && !props.trade.stale) props.onEditDrawing?.(drawing.id);
        }}
        onPointerUpCapture={clickDate}
        onPointerUp={up}
        onPointerCancel={() => {
          clickGesture.current = null;
          drag.current = null;
          draft.current = null;
          paintRef.current();
        }}
        onLostPointerCapture={() => {
          clickGesture.current = null; drag.current = null; draft.current = null; paintRef.current();
        }}
      >
      {!props.drawingsHidden && visibleDrawings(beforeEntry ? beforeEntryDrawings(props.drawings, data, props.panel.interval, result.session) : props.drawings, props.panel.id, props.replay).filter(d => d.tool === "pin").map(d => <button
        key={d.id} type="button" className="ws-pin-target" data-pin-target={d.id} hidden
        aria-label={`Pin: ${d.text || "Empty note"}`}
        onFocus={() => { previewPin.current = d.id; paintRef.current(); }}
        onBlur={() => { previewPin.current = touchPin.current; paintRef.current(); }}
        onClick={event => { if (event.detail === 0) { props.onSelect(d.id); previewPin.current = d.id; paintRef.current(); } }}
        onKeyDown={event => {
          if (event.key === "F2" && !d.locked && !props.trade.stale) { event.preventDefault(); props.onEditDrawing?.(d.id); }
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); previewPin.current = null; touchPin.current = null; container.current?.focus(); paintRef.current(); }
        }} />)}
      <div className="ws-ohlc" ref={ohlcHost}>
        {/* The legend controller owns these text slots, classes and hidden flags. */}
        <span hidden>O <b data-ohlc="open" /></span>
        <span hidden>H <b data-ohlc="high" /></span>
        <span hidden>L <b data-ohlc="low" /></span>
        <span hidden>C <b data-ohlc="close" /></span>
        <b hidden data-ohlc-percent title="Change from the previous candle close" aria-label="Change from previous close" />
        <span data-ohlc-empty>No completed candles</span>
        {!loading && data.length > 0 && hasExtendedSession(props.panel.interval, result.session) && <span className="ws-session-legend"><i aria-hidden="true" />Extended hours</span>}
        <span className="ws-indicator-legend">
          {props.preferences.averages.map((n, i) => (
            <span
              key={n}
              style={{
                color: ["#c4a36c", "#8a8ac8", "#609fce", "#ba7997"][i % 4],
              }}
            >
              SMA {n}
            </span>
          ))}
        </span>
      </div>
        <div ref={host} className="ws-chart-canvas" />
        <canvas ref={overlay} className="ws-chart-overlay" />
        {!!historyState?.loading && !!result.candles.length && <div className="ws-history-progress" role="status">Loading additional history</div>}
        {result.cache?.persistencePaused && <div className="ws-history-progress" role="status">Storage limit reached—this history was not saved</div>}
        {loading && <div className="ws-chart-state">Loading candles…</div>}
        {failure && (
          <div className="ws-chart-state">
            <p>{failure}</p>
            <button onClick={() => setReload((n) => n + 1)}>
              Retry candles
            </button>
          </div>
        )}
        {!beforeEntry && !loading && !failure && !data.length && (
          <div className="ws-chart-state">
            {props.replay !== null
              ? "No completed candles at this replay time."
              : "No candles returned for this period. Try loading an adjacent history window."}
          </div>
        )}
      </div>
      {fillsOpen && <div className="ws-history-popover ws-fill-popover" role="dialog" aria-label={`Execution visibility details ${props.panel.id}`} onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); setFillsOpen(false); } }}>
        <div className="ws-history-popover-heading"><strong>Execution visibility</strong><button autoFocus aria-label="Close execution visibility" onClick={() => setFillsOpen(false)}><X size={14} /></button></div>
        <p>{loading ? "Loading candles?" : visibilitySummary(currentVisibility)}</p>
        <div className="ws-diagnostic-list">{visibility.filter(r => visibleExecutions.some(e => e.id === r.diagnostic.execution.id)).map(r => <div key={r.diagnostic.execution.id} className="ws-fill-row">
          <button onClick={() => { setInspectedId(r.diagnostic.execution.id); props.onExecution(r.diagnostic.execution.id); setFillsOpen(false); }}>{r.index + 1}. {r.diagnostic.execution.side} {r.diagnostic.execution.quantity} @ {r.diagnostic.execution.price.toFixed(2)}<span>{visibilityLabels[r.reason]}{r.diagnostic.timezoneUnverified ? " ? timing unverified" : ""}</span></button>
          <button aria-label={`Show execution ${r.index + 1}`} onClick={() => { const target: ChartDateTarget = { time: r.diagnostic.execution.time }; ownHandle.current?.reveal(target); props.onDateClick(target); if (r.reason === "outside-price-scale") series.current?.priceScale().applyOptions({ autoScale: true }); props.onExecution(r.diagnostic.execution.id); setInspectedId(r.diagnostic.execution.id); setFillsOpen(false); paintRef.current(); }}>Show execution</button>
        </div>)}</div>
        <p>Independent chart ranges are preserved. Fit trade shows the full holding period. Session exclusions and unresolved timestamps require their respective settings; navigation never moves a fill onto a different candle.</p>
      </div>}
      {inspected && <ExecutionDetails diagnostic={inspected} history={result} onClose={() => setInspectedId(null)} />}
      {historyOpen && (
        <div
          ref={historyPopover}
          className="ws-history-popover"
          role="dialog"
          aria-label={`History details ${props.panel.id}`}
        >
          <div className="ws-history-popover-heading">
            <strong>Chart history</strong>
            <button
              aria-label={`Close history ${props.panel.id}`}
              onClick={() => setHistoryOpen(false)}
            >
              <X size={13} />
            </button>
          </div>
          {props.adapter.refreshCandles && <button className="ws-tool-button" disabled={!!historyState?.loading} onClick={() => void history.current?.refresh(visibleWindow)}>Refresh this history window</button>}
          {result.cache?.enabled && <p>Cache: {result.cache.status} · {result.cache.missing.length} uncovered range{result.cache.missing.length === 1 ? "" : "s"}. Cached candles stay visible while history loads.</p>}
          {visibleWindow && (
            <p className="ws-visible-window">
              {Math.round(visibleBars)} visible bars ·{" "}
              {new Date(visibleWindow.from * 1000)
                .toISOString()
                .slice(0, 16)
                .replace("T", " ")}{" "}
              —{" "}
              {new Date(visibleWindow.to * 1000)
                .toISOString()
                .slice(0, 16)
                .replace("T", " ")}{" "}
              UTC
            </p>
          )}
          <div
            className="ws-history-controls"
            aria-label={`History ${props.panel.id}`}
          >
            <button
              disabled={loading || !!historyState?.loading}
              onClick={() => void history.current?.extend("older", true)}
            >
              Load older
            </button>
            <span
              role="status"
              title={[
                result.source,
                result.warning,
                historyState?.messages.older,
                historyState?.messages.newer,
              ]
                .filter(Boolean)
                .join(" · ")}
            >
              {historyState?.loading && historyState.loading !== "initial"
                ? `Loading ${historyState.loading} candles…`
                : `${data.length.toLocaleString()} bars · ${result.source || "History"}${data.length ? ` · ${new Date(data[0].time * 1000).toISOString().slice(0, 10)} – ${new Date(data[data.length - 1].time * 1000).toISOString().slice(0, 10)}` : ""}`}
            </span>
            <button
              disabled={
                loading || !!historyState?.loading || props.replay !== null
              }
              title={
                props.replay !== null
                  ? "Newer history is hidden during replay"
                  : "Load the next history window"
              }
              onClick={() => void history.current?.extend("newer", true)}
            >
              Load newer
            </button>
          </div>
          {historyState?.error && !failure && (
            <div className="ws-history-notice" role="alert">
              {historyState.error}{" "}
              <button
                disabled={!!historyState.loading}
                onClick={() => void history.current?.retry()}
              >
                Retry history
              </button>
              <button disabled={!!historyState.loading} onClick={() => setReload(n => n + 1)}>Reload chart</button>
            </div>
          )}
          {(historyState?.messages.older || historyState?.messages.newer) && (
            <div className="ws-history-notice" role="status">
              {historyState.messages.older || historyState.messages.newer}
            </div>
          )}
          <div className="ws-chart-footer">
            <span className="ws-feed-dot" />{" "}
            <span title={result.warning}>
              {result.warning || result.source || "Loading history"}
            </span>
            <span className="ws-chart-coverage">{coverageLabel}</span>
          </div>
          <div className="ws-diagnostic-list">{diagnostics.map(d => <button key={d.execution.id} onClick={() => { setHistoryOpen(false); setInspectedId(d.execution.id); props.onExecution(d.execution.id); }}>{d.execution.side} {d.execution.quantity} @ {d.execution.price.toFixed(2)} <span>{d.status === "price-outside" ? "Price outside candle" : d.status === "missing" ? "Missing candle" : "Time bucket / price match"}</span></button>)}</div>
          <p className="ws-history-help">
            Pan near an edge to load more. Workstation times display in UTC; markers
            use their containing candle.
            {props.replay !== null
              ? " Future bars and executions are concealed during replay."
              : ""}
          </p>
        </div>
      )}
    </section>
  );
}

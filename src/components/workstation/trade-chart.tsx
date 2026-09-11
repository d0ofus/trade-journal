"use client";
import { useEffect, useRef, useState } from "react";
import {
  AutoscaleInfo,
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  IChartApi,
  ISeriesApi,
  LineSeries,
  UTCTimestamp,
} from "lightweight-charts";
import { Crosshair, Download, Maximize2, Minimize2, Info, X } from "lucide-react";
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
  visibleDrawings,
} from "@/lib/workstation/math";
import {
  CandleHistory,
  HistoryRange,
  HistoryState,
  initialHistoryRange,
  preserveHistoryViewport,
} from "@/lib/workstation/history";
import { Hit, hitAt, PaintOptions, paintChart } from "./chart-paint";
import {
  ChartDateTarget,
  dateTargetAnchor,
  dateTargetIsVisible,
} from "@/lib/workstation/date-link";

export type ChartHandle = {
  focus: () => void;
  cancel: () => void;
  capture: (light?: boolean, scale?: number) => Promise<HTMLCanvasElement>;
  fit: () => void;
  reveal: (target: ChartDateTarget) => void;
  view: () => HistoryRange | null;
};
type Props = {
  panel: ChartPanel;
  trade: Trade;
  adapter: WorkstationAdapter;
  preferences: WorkspacePreferences;
  drawings: Drawing[];
  selected: string | null;
  selectedExecution: string | null;
  tool: Tool;
  replay: number | null;
  active: boolean;
  onActive: () => void;
  onInterval: (interval: Interval) => void;
  onDrawing: (drawing: Drawing) => void;
  onSelect: (id: string | null) => void;
  onExecution: (id: string) => void;
  onToolDone: () => void;
  register: (id: string, handle: ChartHandle | null) => void;
  onDownload: () => void;
  onDateClick: (target: ChartDateTarget) => void;
  fullscreen: boolean;
  onFullscreen: () => void;
  fullscreenTitle: string;
};
const asTime = (time: number) => time as UTCTimestamp;

export function TradeChart(props: Props) {
  const container = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null),
    overlay = useRef<HTMLCanvasElement>(null),
    chart = useRef<IChartApi | null>(null),
    series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const bars = useRef<Candle[]>([]),
    hits = useRef<Hit[]>([]),
    paintRef = useRef<() => void>(() => {});
  const [historyState, setHistoryState] = useState<HistoryState | null>(null);
  const history = useRef<CandleHistory | null>(null),
    checkHistory = useRef<() => void>(() => {}),
    autoPages = useRef(3);
  const result = historyState?.result ?? {
    candles: [],
    warning: "",
    source: "",
  };
  const loading = !historyState || historyState.loading === "initial";
  const failure = historyState?.failed === "initial" ? historyState.error : "";
  const [reload, setReload] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
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
    drag = useRef<{ drawing: Drawing; point: number } | null>(null);
  const dimensions = useRef({ width: 0, height: 0 }),
    currentInterval = useRef<Interval>(props.panel.interval),
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
  const data = completedCandles(
    result.candles,
    props.panel.interval,
    props.replay,
  );
  bars.current = data;

  useEffect(() => {
    const visible =
      currentTrade.current === props.trade.id
        ? chart.current?.timeScale().getVisibleRange()
        : null;
    const intervalContext =
      currentInterval.current !== props.panel.interval &&
      visible &&
      typeof visible.from === "number" &&
      typeof visible.to === "number"
        ? {
            time: (visible.from + visible.to) / 2,
            range: { from: visible.from, to: visible.to },
            fit: false,
            trade: props.trade.id,
          }
        : null;
    const requested: typeof navigation.current =
      navigation.current?.trade === props.trade.id
        ? navigation.current
        : intervalContext;
    if (
      currentTrade.current !== props.trade.id ||
      currentInterval.current !== props.panel.interval
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
    pending.current = null;
    draft.current = null;
    autoPages.current = 3;
    setHistoryState(null);
    let disposed = false;
    let preparing = true;
    const session = new CandleHistory(
      props.adapter,
      props.trade,
      props.panel.interval,
      initialHistoryRange(props.trade, props.panel.interval, context),
      (state) => {
        setHistoryState(preparing ? { ...state, loading: "initial" } : state);
        dataReady.current =
          !preparing &&
          state.loading !== "initial" &&
          state.failed !== "initial";
      },
    );
    history.current = session;
    void (async () => {
      const started = await session.start();
      if (started && requested?.range) await session.cover(requested.range);
      if (disposed) return;
      preparing = false;
      dataReady.current = session.state.failed !== "initial";
      setHistoryState(session.state);
    })();
    return () => {
      disposed = true;
      session.dispose();
      if (history.current === session) history.current = null;
    };
  }, [props.adapter, props.trade, props.panel.interval, reload]);

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
    if (!host.current || !overlay.current) return;
    const p = latest.current;
    const api = createChart(host.current, {
      autoSize: false,
      layout: {
        background: { type: ColorType.Solid, color: "#10151f" },
        textColor: "#7e899e",
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: 10,
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: "#1b2230" },
        horzLines: { color: "#1b2230" },
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
        for (const e of latest.current.trade.executions)
          if (
            e.time >= lowTime &&
            e.time <= highTime &&
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
        return info;
      },
    });
    api.timeScale().applyOptions({
      shiftVisibleRangeOnNewBar: false,
      lockVisibleTimeRangeOnResize: true,
    });
    chart.current = api;
    series.current = candles;
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
      drawings: [
        ...visibleDrawings(
          latest.current.drawings,
          p.panel.id,
          latest.current.replay,
        ).filter((d) => d.id !== draft.current?.id),
        ...(draft.current ? [draft.current] : []),
      ],
      trade: latest.current.trade,
      candles: bars.current,
      interval: latest.current.panel.interval,
      labels: latest.current.preferences.labels,
      selected: latest.current.selected,
      selectedExecution: latest.current.selectedExecution,
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
        if (dataReady.current) hits.current = paintChart(ctx, options());
      });
    };
    paintRef.current = paint;
    const resize = new ResizeObserver((entries) => {
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
          : latest.current.replay === null &&
              range.to > bars.current.length - 1 - threshold &&
              !session.state.messages.newer
            ? "newer"
            : null;
      if (direction) {
        autoPages.current--;
        void session.extend(direction);
      }
    };
    const rangeChanged = () => {
      paint();
      clearTimeout(historyTimer);
      historyTimer = setTimeout(() => {
        const range = api.timeScale().getVisibleRange();
        const logical = api.timeScale().getVisibleLogicalRange();
        if (logical) setVisibleBars(logical.to - logical.from);
        if (
          range &&
          typeof range.from === "number" &&
          typeof range.to === "number"
        ) {
          const window = { from: range.from, to: range.to };
          setVisibleWindow((previous) =>
            previous?.from === window.from && previous?.to === window.to
              ? previous
              : window,
          );
        }
        checkHistory.current();
      }, 180);
    };
    api.timeScale().subscribeVisibleLogicalRangeChange(rangeChanged);
    let syncing = false;
    api.subscribeCrosshairMove((event) => {
      paint();
      if (
        syncing ||
        changingData.current ||
        !event.sourceEvent ||
        !latest.current.preferences.linked ||
        !event.point ||
        typeof event.time !== "number"
      )
        return;
      window.dispatchEvent(
        new CustomEvent("workstation-crosshair", {
          detail: { source: p.panel.id, time: event.time },
        }),
      );
    });
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
      );
      syncing = true;
      try {
        if (
          bar &&
          api.timeScale().timeToCoordinate(asTime(bar.time)) !== null &&
          candles.priceToCoordinate(bar.close) !== null
        )
          api.setCrosshairPosition(bar.close, asTime(bar.time), candles);
        else api.clearCrosshairPosition();
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
      const p = latest.current;
      if (
        p.replay === null &&
        (!executionBar(
          { time: p.trade.openTime } as never,
          bars.current,
          p.panel.interval,
        ) ||
          !executionBar(
            { time: p.trade.closeTime } as never,
            bars.current,
            p.panel.interval,
          ))
      )
        navigate((p.trade.openTime + p.trade.closeTime) / 2, true);
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
    p.register(p.panel.id, {
      focus: () => container.current?.focus({ preventScroll: true }),
      cancel: () => {
        pending.current = null;
        draft.current = null;
        drag.current = null;
        paintRef.current();
      },
      fit: () => requestFit.current(),
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
      ) {
        if (!dataReady.current || !bars.current.length)
          throw new Error("Wait for chart candles before exporting.");
        const frozen = options(true, light),
          snapshotBars = [...bars.current],
          prefs = latest.current.preferences;
        const width = dimensions.current.width,
          height = dimensions.current.height,
          header = 44,
          footer = 26;
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
            attributionLogo: true,
          },
          grid: {
            vertLines: { color: light ? "#edf0f5" : "#1b2230" },
            horzLines: { color: light ? "#edf0f5" : "#1b2230" },
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
                color: b.close >= b.open ? "#38bfa633" : "#e4788633",
              })),
            );
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
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          const native = clone.takeScreenshot(true, false),
            output = document.createElement("canvas");
          output.width = width * scale;
          output.height = (height + header + footer) * scale;
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
          paintChart(ctx, frozen);
          ctx.restore();
          ctx.scale(scale, scale);
          ctx.fillStyle = light ? "#243149" : "#dde5f3";
          ctx.font = "600 13px system-ui";
          ctx.fillText(
            `${latest.current.trade.symbol} / ${latest.current.panel.interval} · ${latest.current.trade.direction} · UTC${latest.current.replay !== null ? " · REPLAY" : ""}`,
            16,
            26,
          );
          ctx.fillStyle = light ? "#526077" : "#8996ad";
          ctx.font = "10px system-ui";
          ctx.fillText(
            `${latest.current.adapter.mode === "demo" ? "Synthetic demo data" : "Provider history"} · ${new Date().toISOString()} · Execution Lab · TradingView Lightweight Charts`,
            12,
            height + header + 17,
          );
          return output;
        } finally {
          clone.remove();
          container.remove();
        }
      },
    });
    return () => {
      p.register(p.panel.id, null);
      resize.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(historyTimer);
      window.removeEventListener("workstation-crosshair", sync);
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
    changingData.current = true;
    cs.setData(data.map((b) => ({ ...b, time: asTime(b.time) })));
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
        color: b.close >= b.open ? "#38bfa62d" : "#e478862d",
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
    currentInterval.current = props.panel.interval;
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
    props.preferences.averages,
    props.replay,
    loading,
    failure,
  ]);
  useEffect(() => {
    const light = props.preferences.theme === "light";
    chart.current?.applyOptions({
      layout: {
        background: {
          type: ColorType.Solid,
          color: light ? "#ffffff" : "#10151f",
        },
        textColor: light ? "#68758a" : "#7e899e",
      },
      grid: {
        vertLines: { color: light ? "#edf0f5" : "#1b2230" },
        horzLines: { color: light ? "#edf0f5" : "#1b2230" },
      },
    });
    paintRef.current();
  }, [props.preferences.theme]);
  useEffect(() => {
    paintRef.current();
  }, [
    props.drawings,
    props.selected,
    props.selectedExecution,
    props.preferences.labels,
    props.replay,
  ]);
  useEffect(() => {
    pending.current = null;
    draft.current = null;
    paintRef.current();
  }, [props.tool, props.trade.id, props.panel.interval]);

  const pointer = (event: React.PointerEvent) => {
    const rect = host.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const pointAt = (pos: { x: number; y: number }): Point | null => {
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
    text: props.tool === "text" ? "New note" : "",
    ...props.preferences.style,
    locked: false,
    hidden: false,
    panel: props.panel.id,
    createdAt: props.replay ?? Date.now() / 1000,
  });
  const down = (event: React.PointerEvent<HTMLDivElement>) => {
    focusedWindow.current = null;
    focusedTarget.current = null;
    clickGesture.current = null;
    autoPages.current = 3;
    props.onActive();
    if (!dataReady.current || loading || failure || event.button !== 0) return;
    const pos = pointer(event);
    if (
      pos.x > (chart.current?.timeScale().width() ?? 0) ||
      pos.y > dimensions.current.height - 25
    )
      return;
    const hit = hitAt(hits.current, pos);
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
          if (hit.kind === "handle") {
            const drawing = props.drawings.find((d) => d.id === hit.id);
            if (drawing && !drawing.locked) {
              drag.current = { drawing, point: hit.point! };
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
    if (!dataReady.current) return;
    const point = pointAt(pointer(event));
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
    if (drag.current && draft.current) props.onDrawing(draft.current);
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
    if (click.execution) props.onExecution(click.execution);
    else if (click.target) props.onDateClick(click.target);
  };
  const visibleExecutions = props.trade.executions.filter(
    (e) => props.replay === null || e.time <= props.replay,
  );
  const missing = loading
    ? 0
    : visibleExecutions.filter(
        (e) => !executionBar(e, data, props.panel.interval),
      ).length;
  const last =
    (visibleWindow && data.findLast((bar) => bar.time <= visibleWindow.to)) ||
    data[data.length - 1];
  const coverageLabel =
    missing > 0
      ? `${missing} execution${missing === 1 ? "" : "s"} outside candle coverage`
      : `${visibleExecutions.length} executions · candle aligned`;
  const historyWarning =
    !!historyState?.error ||
    missing > 0 ||
    (!!result.warning && props.adapter.mode !== "demo");
  return (
    <section
      ref={container}
      tabIndex={0}
      data-chart-id={props.panel.id}
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
          <span className="ws-session">
            {props.panel.interval === "5m" ? "EXECUTION" : "CONTEXT"}
          </span>
        </div>
        <div className="ws-chart-actions">
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
                : missing
                  ? "Coverage"
                  : result.source || "History"}
            </span>
          </button>
          <button
            title="Fit trade"
            aria-label={`Fit trade ${props.panel.id}`}
            onClick={() => requestFit.current()}
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
      <div className="ws-ohlc">
        {last ? (
          <>
            <span>
              O <b>{last.open.toFixed(2)}</b>
            </span>
            <span>
              H <b>{last.high.toFixed(2)}</b>
            </span>
            <span>
              L <b>{last.low.toFixed(2)}</b>
            </span>
            <span>
              C{" "}
              <b className={last.close >= last.open ? "positive" : "negative"}>
                {last.close.toFixed(2)}
              </b>
            </span>
          </>
        ) : (
          <span>No completed candles</span>
        )}
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
        onPointerUpCapture={clickDate}
        onPointerUp={up}
        onPointerCancel={() => {
          clickGesture.current = null;
          drag.current = null;
          draft.current = null;
          paintRef.current();
        }}
      >
        <div ref={host} className="ws-chart-canvas" />
        <canvas ref={overlay} className="ws-chart-overlay" />
        {loading && <div className="ws-chart-state">Loading candles…</div>}
        {failure && (
          <div className="ws-chart-state">
            <p>{failure}</p>
            <button onClick={() => setReload((n) => n + 1)}>
              Retry candles
            </button>
          </div>
        )}
        {!loading && !failure && !data.length && (
          <div className="ws-chart-state">
            {props.replay !== null
              ? "No completed candles at this replay time."
              : "No candles returned for this period. Try loading an adjacent history window."}
          </div>
        )}
      </div>
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
          <p className="ws-history-help">
            Pan near an edge to load more. Execution times are exact; markers
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

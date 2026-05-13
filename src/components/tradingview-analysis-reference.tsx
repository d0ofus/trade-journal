"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JOURNAL_TIMEFRAMES, type JournalTimeframe } from "@/lib/journal/schema";

const INTERVAL_BY_TIMEFRAME: Record<JournalTimeframe, string> = {
  "1W": "W",
  "1D": "D",
  "1H": "60",
  "15min": "15",
  "10min": "10",
  "5min": "5",
};

function tradingViewSymbol(symbol: string) {
  const clean = symbol.trim().toUpperCase();
  return clean.includes(":") ? clean : `NASDAQ:${clean}`;
}

export function tradingViewWidgetConfig(symbol: string, timeframe: JournalTimeframe) {
  return {
    allow_symbol_change: true,
    calendar: false,
    details: false,
    hide_side_toolbar: false,
    hide_top_toolbar: false,
    hide_legend: false,
    hide_volume: false,
    hotlist: false,
    interval: INTERVAL_BY_TIMEFRAME[timeframe],
    locale: "en",
    save_image: true,
    style: "1",
    symbol: tradingViewSymbol(symbol || "AAPL"),
    theme: "light",
    timezone: "Etc/UTC",
    backgroundColor: "#ffffff",
    gridColor: "rgba(46, 46, 46, 0.06)",
    watchlist: [],
    withdateranges: true,
    compareSymbols: [],
    studies: ["STD;SMA"],
    autosize: true,
  };
}

export function TradingViewAnalysisReference({
  symbol,
  timeframe,
}: {
  symbol: string;
  timeframe: JournalTimeframe;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [localTimeframe, setLocalTimeframe] = useState<JournalTimeframe>(timeframe);
  const [reloadKey, setReloadKey] = useState(0);
  const config = useMemo(() => tradingViewWidgetConfig(symbol, localTimeframe), [localTimeframe, symbol]);
  const externalUrl = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(config.symbol)}`;

  useEffect(() => {
    setLocalTimeframe(timeframe);
  }, [timeframe]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = "";

    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.height = "calc(100% - 32px)";
    widget.style.width = "100%";

    const copyright = document.createElement("div");
    copyright.className = "tradingview-widget-copyright";
    copyright.innerHTML = `<a href="${externalUrl}" rel="noopener nofollow" target="_blank"><span class="blue-text">${config.symbol} chart</span></a><span class="trademark"> by TradingView</span>`;

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.innerHTML = JSON.stringify(config);

    container.appendChild(widget);
    container.appendChild(copyright);
    container.appendChild(script);
  }, [config, externalUrl, reloadKey]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-[24px] border border-slate-200/80 bg-white/85 p-3">
        {JOURNAL_TIMEFRAMES.map((option) => (
          <Button
            key={option}
            size="sm"
            variant={localTimeframe === option ? "default" : "outline"}
            onClick={() => setLocalTimeframe(option)}
          >
            {option}
          </Button>
        ))}
        <Button className="ml-auto" size="sm" variant="outline" onClick={() => setReloadKey((current) => current + 1)}>
          <RefreshCw className="h-4 w-4" />
          Reload
        </Button>
        <a className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50" href={externalUrl} target="_blank" rel="noreferrer">
          <ExternalLink className="h-3.5 w-3.5" />
          Open in TradingView
        </a>
      </div>
      <div
        ref={containerRef}
        className="tradingview-widget-container h-[640px] w-full overflow-hidden rounded-[28px] border border-slate-200/80 bg-white"
      />
      <p className="text-xs text-slate-500">
        TradingView is a reference workspace. Use its built-in image save, then upload or paste the image into the journal if you want it stored as a chart artifact.
      </p>
    </div>
  );
}

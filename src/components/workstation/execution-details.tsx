"use client";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { executionDiagnosticLabel, type ExecutionDiagnostic } from "@/lib/workstation/execution-diagnostics";
import type { CandleResult } from "@/lib/workstation/types";
import { brokerTimeLabel } from "@/lib/workstation/timestamp-interpretation";
import { executionTimezoneLabel } from "@/lib/workstation/execution-time-provenance";
const utc = (time: number) => new Date(time * 1000).toISOString().replace("T", " ").replace(".000Z", " UTC");
export function ExecutionDetails({ diagnostic: d, history, onClose }: { diagnostic: ExecutionDiagnostic; history: CandleResult; onClose(): void }) {
  const ref = useRef<HTMLElement>(null), close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node) && !(event.target as Element).closest(".ws-plot")) close.current(); };
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("pointerdown", outside); if (before?.isConnected) before.focus({ preventScroll: true }); };
  }, []);
  return <aside ref={ref} className="ws-execution-details" role="dialog" aria-label="Execution details" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <div className="ws-history-popover-heading"><strong>{d.execution.side === "BUY" ? "Buy" : "Sell"} {d.execution.quantity} @ {d.execution.price.toFixed(2)}</strong><button aria-label="Close execution details" onClick={onClose}><X size={15} /></button></div>
    <p className={d.status === "matching" && !d.periodUnverified ? "positive" : "ws-diagnostic-warning"}>{executionDiagnosticLabel(d)}</p>
    {d.execution.provenance?.interpretationStatus === "applied" && d.execution.provenance.timezone === "America/New_York" && <p>{brokerTimeLabel(d.execution.time, "America/New_York")} → {utc(d.execution.time)}</p>}
    {d.execution.provenance?.timezoneStatus === "user-confirmed" && <p>{executionTimezoneLabel(d.execution)}. The account confirmation supplies the timezone; archived source verification is unavailable for this report.</p>}
    <dl><dt>Stored execution time</dt><dd>{utc(d.execution.provenance?.storedTime ?? d.execution.time)}</dd><dt>Workstation UTC time</dt><dd>{utc(d.execution.time)}</dd>{d.execution.provenance?.brokerWallTime && <><dt>Original broker timestamp</dt><dd>{d.execution.provenance.brokerWallTime}</dd><dt>Interpretation</dt><dd>{d.execution.provenance.timezone} to UTC / {d.execution.provenance.confirmationBasis} / revision {d.execution.provenance.interpretationVersion}</dd></>}<dt>Candle interval</dt><dd>{d.period ? `${utc(d.period.start)} – ${utc(d.period.end)} (end exclusive)` : "No containing candle in loaded history"}</dd>
      {d.candle && <><dt>Low / high</dt><dd>{d.candle.low.toFixed(4)} / {d.candle.high.toFixed(4)}</dd><dt>Distance outside candle</dt><dd>{d.distance.toFixed(4)} (price units)</dd></>}
      <dt>Provider / feed</dt><dd>{history.provider ? `${history.provider.provider}${history.provider.feed ? ` / ${history.provider.feed}` : ""}` : history.source || "Unknown"}</dd><dt>Price adjustment</dt><dd>{history.provider?.adjustment ?? "Unverified"}</dd><dt>Candle date convention</dt><dd>{history.session?.timezone ?? "Unverified"} · {history.session?.calendar ?? "unknown"}</dd><dt>Aggregation basis</dt><dd>{history.session?.aggregation ?? "Provider-native candles"}</dd><dt>Execution source</dt><dd>{d.execution.provenance?.source ?? "Stored execution"}</dd><dt>Source timezone</dt><dd>{d.timezoneUnverified ? "Unverified — stored time is displayed as UTC" : d.execution.provenance?.timezone}</dd>
    </dl>
    {d.execution.provenance?.interpretationStatus === "pending" && <p role="status">The confirmed account policy is awaiting preparation for this report. Settings / Trade data shows preparation status. The original stored time is shown until preparation completes.</p>}
    {d.execution.provenance?.interpretationStatus === "stale" && <p role="alert">The confirmed interpretation no longer matches its source. Review this batch in Settings / Trade data. The original stored time is shown.</p>}
    {d.execution.provenance?.interpretationReason && <p role="status">{d.execution.provenance.interpretationReason}</p>}
    {d.timezoneUnverified && <p className="ws-diagnostic-warning">The import did not preserve a verified source timezone. Confirm it against a timezone-bearing broker report. This chart does not apply a guessed time offset.</p>}
    {d.status === "price-outside" && <p>The recorded price is outside this candle. Timezone interpretation, session coverage, feed differences, price adjustments, or trade conditions excluded from OHLC may explain it. The execution price and time are preserved.</p>}
    {d.status === "missing" && <p>Load history around this execution. Out-of-session fills may be absent from regular-session candles.</p>}
  </aside>;
}

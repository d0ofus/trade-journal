"use client";
import { memo, useMemo, type Dispatch, type SetStateAction } from "react";
import type { Trade } from "@/lib/workstation/types";
import type { ReviewStatusSummary } from "@/lib/workstation/review-status";
import { peakCostDescription, peakPositionCost, formatPeakPositionCost } from "@/lib/workstation/peak-position-cost";
import { ReviewStatusDot } from "./review-status-dot";
import type { useTradeDocument } from "./use-trade-document";
import { useStableCallbacks } from "./use-stable-callbacks";
import { money, time, date } from "./trade-display-format";
type Props = { filtered: Trade[]; activeId: string; checked: string[]; onChecked: Dispatch<SetStateAction<string[]>>; onSelect: (id: string) => Promise<void>; replay: number | null; reviewStatuses: Record<string, ReviewStatusSummary>; peakCosts: Map<string, ReturnType<typeof peakPositionCost> & { formatted: ReturnType<typeof formatPeakPositionCost> }>; persistence: Pick<ReturnType<typeof useTradeDocument>, "subscribe" | "getSnapshot"> };
const emptySnapshot = () => null;
export function TradeListRows(props: Omit<Props, "persistence"> & { persistence: ReturnType<typeof useTradeDocument> }) {
  const callbacks = useStableCallbacks(props);
  const { subscribe, getSnapshot } = props.persistence;
  const ready = !!props.persistence.document;
  const persistence = useMemo(() => ({ subscribe, getSnapshot: ready ? getSnapshot : emptySnapshot }), [subscribe, getSnapshot, ready]);
  return <Rows {...callbacks} persistence={persistence} />;
}
const Rows = memo(function TradeListRows({ filtered, activeId, checked, onChecked, onSelect, replay, reviewStatuses, peakCosts, persistence }: Props) {
  return <>
    {filtered.map((t, i) => (
      <div key={t.id}>
        <div className="ws-list-date">
          {i === 0 ||
          date(filtered[i - 1].openTime) !== date(t.openTime)
            ? date(t.openTime)
            : null}
        </div>
        <div
          className={`ws-trade-card ${t.id === activeId ? "active" : ""}`}
        >
          <input
            className="ws-trade-checkbox"
            type="checkbox"
            aria-label={`Select ${t.symbol} for export`}
            checked={checked.includes(t.id)}
            onChange={(e) =>
              onChecked((ids) =>
                e.target.checked
                  ? [...ids, t.id]
                  : ids.filter((id) => id !== t.id),
              )
            }
          />
          <button
            className="ws-trade-card-main"
            onClick={() => void onSelect(t.id)}
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
              <ReviewStatusDot summary={reviewStatuses[t.id]} persistence={t.id === activeId ? persistence : undefined} />
            </div>
          </button>
        </div>
      </div>
    ))}
  </>;
});

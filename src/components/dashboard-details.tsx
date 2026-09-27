import type { DashboardAggregation } from "@/lib/stats/dashboard-aggregation";
import { formatCurrency } from "@/lib/utils";

export function DashboardDetails({ data }: { data: DashboardAggregation }) {
  return <div className="space-y-4">
    <details className="rounded-2xl border bg-white p-5"><summary className="cursor-pointer font-semibold">Metric definitions and data coverage</summary>
      <div className="mt-3 space-y-2 text-sm text-slate-600">
        <p>All performance figures use the same completed cycles, selected by their final closing date in America/New_York. The complete entry and exit economics are included even when an entry predates the range. Open cycles, partial exits in unfinished cycles and their charges are excluded.</p>
        <p>Gross P&L is price profit multiplied by contract size. Net P&L subtracts allocated commissions, fees and transaction taxes. Archived broker multipliers take precedence; identified legacy options use the approved 100× assumption. Historical taxes are recovered only where archived source evidence can be matched unambiguously.</p>
        <p>Win rate = profitable trades ÷ all completed trades (breakeven included). Profit factor = positive net P&L ÷ absolute negative net P&L; unavailable without losses. Expectancy = total net P&L ÷ trade count. Payoff = average win ÷ absolute average loss; unavailable without both outcomes.</p>
        <p>Drawdown is the decline from the highest cumulative net dollar P&L, starting at zero. Simultaneous closures are combined. Recovery measures elapsed time from the preceding high through recovery, or through period end when still underwater. These are realized-trade statistics, not account-equity drawdowns.</p>
        <p>Quantity closed is counted once, divided by the number of active closing days. Shares and contracts are separate. Holding durations use interpreted timestamps; unknown carried-entry times are excluded. Entry-time sample: {data.cohort.knownEntryCount}/{data.cohort.count}; known winning holds: {data.cards.knownWinHoldCount}; known losing holds: {data.cards.knownLossHoldCount}.</p>
        <p>Daily consistency = profitable closing days ÷ active closing days. Cost drag = costs ÷ sum of absolute gross trade P&L. Profit concentration = the five largest net winners ÷ all positive net P&L. Breakeven trades end streaks; simultaneous trades use stable ID order for streaks and rolling windows.</p>
        <p>Day, week and month cards are subsets of the selected cohort ending on its last reporting date; weeks start Monday. Zero opening chart points are separate from actual first-day results.</p>
        <p>Sharpe, Sortino and Calmar: unavailable. Real-account equity and cash-flow-adjusted return history are absent. Dollar-P&L statistics cannot substitute for portfolio return ratios. <a className="underline" href="https://web.stanford.edu/~wfsharpe/art/sr/sr.htm">Sharpe</a> · <a className="underline" href="https://www.ibkrguides.com/reportingreference/reportguide/riskmeasures.htm">IBKR risk measures</a> · <a className="underline" href="https://app.tradervue.com/help/reports_dt">Entry-time analysis</a>.</p>
      </div>
    </details>
    <div className="grid gap-4 lg:grid-cols-2">{Object.entries(data.breakdowns).map(([name, rows]) => <section key={name} className="overflow-auto rounded-2xl border bg-white p-5">
      <h2 className="mb-3 font-semibold capitalize">{name === "holding" ? "Holding duration" : name} breakdown</h2>
      <table className="w-full text-right text-sm"><thead><tr><th className="text-left">Group</th><th>Trades</th><th>Net P&L</th><th>Expectancy</th><th>Win rate</th></tr></thead><tbody>{rows.map(row => <tr key={row.label} className="border-t"><th className="py-2 text-left font-normal">{row.label}</th><td>{row.count}</td><td>{formatCurrency(row.pnl)}</td><td>{row.expectancy == null ? "—" : formatCurrency(row.expectancy)}</td><td>{row.winRate?.toFixed(1)}%</td></tr>)}</tbody></table>
      {!rows.length && <p className="py-3 text-sm text-slate-500">No completed trades in range.</p>}
    </section>)}</div>
  </div>;
}

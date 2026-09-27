"use client";
import "@/components/dashboard-workspace.css";

export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="dashboard-workspace"><section className="dashboard-panel" role="alert">
    <h2>Dashboard unavailable</h2>
    <p className="dashboard-muted">The report could not be loaded. Try again to retrieve the selected period.</p>
    <button className="dashboard-apply dashboard-retry" onClick={reset}>Try again</button>
  </section></div>;
}

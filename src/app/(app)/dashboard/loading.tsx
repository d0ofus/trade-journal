import "@/components/dashboard-workspace.css";

export default function DashboardLoading() {
  return <div className="dashboard-workspace"><div className="dashboard-loading" role="status" aria-label="Loading dashboard">
    <div className="dashboard-metrics dashboard-overview">{Array.from({ length: 6 }, (_, i) => <div key={i} className="dashboard-metric" />)}</div>
    <div className="dashboard-empty">Loading completed-trade performance…</div>
  </div></div>;
}

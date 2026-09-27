"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type KeyboardEvent } from "react";
import "./dashboard-workspace.css";

export type DashboardTab = "performance" | "timing" | "breakdowns";
export function dashboardTab(value: unknown): DashboardTab {
  return value === "timing" || value === "breakdowns" ? value : "performance";
}
const tabs = [{ id: "performance", label: "Performance" }, { id: "timing", label: "Entry timing" }, { id: "breakdowns", label: "Breakdowns" }] as const;
const DashboardContext = createContext({ tab: "performance" as DashboardTab, select: (_tab: DashboardTab) => {} });

export function DashboardWorkspace({ initialTab, children }: { initialTab: DashboardTab; children: ReactNode }) {
  const [tab, setTab] = useState(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  useEffect(() => {
    const restore = () => setTab(dashboardTab(new URL(location.href).searchParams.get("tab")));
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const select = (next: DashboardTab) => {
    if (next === tab) return;
    const url = new URL(location.href);
    url.searchParams.set("tab", next);
    window.history.pushState(null, "", url);
    setTab(next);
  };
  return <DashboardContext.Provider value={{ tab, select }}><div className="dashboard-workspace">{children}</div></DashboardContext.Provider>;
}

export function DashboardTabs() {
  const { tab, select } = useContext(DashboardContext);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const key = (event: KeyboardEvent, index: number) => {
    const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); select(tabs[next].id); buttons.current[next]?.focus();
  };
  return <div className="dashboard-tabs" role="tablist" aria-label="Dashboard reports">{tabs.map((item, index) => <button key={item.id} ref={element => { buttons.current[index] = element; }} id={`dashboard-tab-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls={`dashboard-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} onKeyDown={event => key(event, index)} onClick={() => select(item.id)}>{item.label}</button>)}</div>;
}

export function DashboardPanel({ tab, children }: { tab: DashboardTab; children: ReactNode }) {
  const current = useContext(DashboardContext).tab;
  // Keep controls mounted so their drafts and selections survive tab changes.
  return <section id={`dashboard-panel-${tab}`} role="tabpanel" aria-labelledby={`dashboard-tab-${tab}`} hidden={current !== tab} className="dashboard-tab-panel">{children}</section>;
}
export function DashboardActiveCharts({ children }: { children: ReactNode }) {
  return useContext(DashboardContext).tab === "performance" ? children : null;
}
export function DashboardTabInput() {
  return <input type="hidden" name="tab" value={useContext(DashboardContext).tab} />;
}
export function DashboardPresetLink({ preset, active, children }: { preset: string; active: boolean; children: ReactNode }) {
  const { tab } = useContext(DashboardContext);
  return <Link prefetch={false} className="dashboard-preset" aria-current={active ? "true" : undefined} href={`/dashboard?${new URLSearchParams({ preset, tab })}`}>{children}</Link>;
}

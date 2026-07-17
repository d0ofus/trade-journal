"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  Download,
  FlaskConical,
  LayoutDashboard,
  ListOrdered,
  LogOut,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { requestWorkstationNavigation } from "@/lib/workstation-navigation-guard";

const links = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/trades", label: "Trades", icon: ListOrdered },
  { href: "/journal", label: "Journal", icon: NotebookPen },
  { href: "/positions", label: "Positions", icon: BarChart3 },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/import", label: "Import", icon: Download },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

const SIDEBAR_COLLAPSED_KEY = "execution-lab-sidebar-collapsed";
const SIDEBAR_COLLAPSE_EVENT = "execution-lab-sidebar-collapse-change";

function getSidebarCollapsedSnapshot() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
}

function subscribeToSidebarCollapsed(callback: () => void) {
  const handleChange = () => callback();
  window.addEventListener("storage", handleChange);
  window.addEventListener(SIDEBAR_COLLAPSE_EVENT, handleChange);
  return () => {
    window.removeEventListener("storage", handleChange);
    window.removeEventListener(SIDEBAR_COLLAPSE_EVENT, handleChange);
  };
}

export function Sidebar() {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(subscribeToSidebarCollapsed, getSidebarCollapsedSnapshot, () => false);

  function toggleCollapsed() {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(!collapsed));
    window.dispatchEvent(new Event(SIDEBAR_COLLAPSE_EVENT));
  }

  function signOutSafely() {
    if (!requestWorkstationNavigation("sign out")) return;
    void signOut({ callbackUrl: "/login" });
  }

  useEffect(() => {
    document.querySelector<HTMLElement>('[data-mobile-nav-active="true"]')?.scrollIntoView({
      behavior: "instant",
      block: "nearest",
      inline: "center",
    });
  }, [pathname]);

  return (
    <>
      <div className="fixed inset-x-0 top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur lg:hidden">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-950 text-cyan-200">
              <FlaskConical className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">Execution Lab</p>
              <p className="text-sm font-semibold text-slate-950">Trading workspace</p>
            </div>
          </div>
          <button
            type="button"
            className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
            onClick={signOutSafely}
          >
            Sign Out
          </button>
        </div>
        <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Primary navigation">
          {links.map((link) => {
            const Icon = link.icon;
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                aria-current={active ? "page" : undefined}
                data-mobile-nav-active={active ? "true" : undefined}
                href={link.href}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium",
                  active ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700",
                )}
              >
                <Icon className="h-4 w-4" />
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col overflow-hidden border-r border-slate-800/80 bg-[#071421] text-slate-100 shadow-[18px_0_48px_-36px_rgba(15,23,42,0.65)] transition-[width] duration-200 lg:flex",
          collapsed ? "w-[76px]" : "w-[224px]",
        )}
      >
        <div className={cn("flex h-16 items-center border-b border-white/10", collapsed ? "justify-center px-2" : "px-4")}>
          <Link href="/dashboard" className={cn("flex min-w-0 items-center gap-3", collapsed && "justify-center")} title="Execution Lab">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-cyan-300/30 bg-cyan-300/10 text-cyan-200">
              <FlaskConical className="h-5 w-5" />
            </span>
            {!collapsed && (
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold uppercase tracking-[0.14em] text-white">Execution Lab</p>
              </div>
            )}
          </Link>
        </div>

        <nav className="flex-1 space-y-1 px-2 py-4" aria-label="Primary navigation">
          {links.map((link) => {
            const Icon = link.icon;
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                aria-current={active ? "page" : undefined}
                href={link.href}
                title={collapsed ? link.label : undefined}
                className={cn(
                  "group flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-slate-300",
                  collapsed && "justify-center px-0",
                  active ? "bg-white/12 text-white shadow-[inset_3px_0_0_#14b8a6]" : "hover:bg-white/8 hover:text-white",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="min-w-0 flex-1 truncate">{link.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-2">
          <button
            type="button"
            className={cn(
              "mb-2 flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-slate-300 hover:bg-white/8 hover:text-white",
              collapsed && "justify-center px-0",
            )}
            onClick={toggleCollapsed}
            title={collapsed ? "Expand navigation" : "Collapse navigation"}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            {!collapsed && <span>Collapse</span>}
          </button>
          <button
            type="button"
            className={cn(
              "flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-slate-300 hover:bg-white/8 hover:text-white",
              collapsed && "justify-center px-0",
            )}
            onClick={signOutSafely}
            title={collapsed ? "Sign out" : undefined}
          >
            <LogOut className="h-4 w-4" />
            {!collapsed && <span>Sign Out</span>}
          </button>
        </div>
      </aside>
    </>
  );
}

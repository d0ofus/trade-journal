"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, BarChart3, CalendarDays, Download, LayoutDashboard, ListOrdered, Settings2 } from "lucide-react";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const links = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/trades", label: "Trades", icon: ListOrdered },
  { href: "/positions", label: "Positions", icon: BarChart3 },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/import", label: "Import", icon: Download },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <>
      <div className="fixed inset-x-4 top-4 z-20 rounded-[24px] border border-white/50 bg-white/80 p-3 shadow-[0_20px_50px_-32px_rgba(15,23,42,0.4)] backdrop-blur lg:hidden">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">Execution Lab</p>
            <p className="text-sm font-semibold text-slate-900">Trading workspace</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => signOut({ callbackUrl: "/login" })}>
            Sign Out
          </Button>
        </div>
        <nav className="flex gap-2 overflow-x-auto pb-1">
          {links.map((link) => {
            const Icon = link.icon;
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-2xl px-3 py-2 text-sm font-medium",
                  active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700",
                )}
              >
                <Icon className="h-4 w-4" />
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <aside className="sticky top-4 hidden h-[calc(100vh-2rem)] w-[280px] shrink-0 flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(9,17,31,0.98),rgba(15,23,42,0.94)_42%,rgba(15,118,110,0.9)_100%)] text-white shadow-[0_30px_90px_-38px_rgba(15,23,42,0.95)] lg:flex">
        <div className="border-b border-white/10 px-6 py-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/8 text-lg font-semibold text-white shadow-inner shadow-white/5">
              EL
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-100/60">Trade Journal</p>
              <h1 className="text-xl font-semibold tracking-tight text-white">Execution Lab</h1>
            </div>
          </div>
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/6 p-4">
            <p className="text-xs font-medium text-sky-100/70">Professional trading review workspace</p>
            <p className="mt-2 text-sm leading-6 text-white/90">
              Monitor execution quality, refine setups, and keep a clean record of every imported trade.
            </p>
          </div>
        </div>

        <nav className="flex-1 space-y-1.5 p-4">
          {links.map((link) => {
            const Icon = link.icon;
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "group flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium text-slate-200/78",
                  active
                    ? "bg-white text-slate-950 shadow-[0_18px_40px_-28px_rgba(255,255,255,0.9)]"
                    : "hover:bg-white/8 hover:text-white",
                )}
              >
                <span
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-2xl border text-inherit",
                    active ? "border-slate-200 bg-slate-100" : "border-white/10 bg-white/6",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="flex-1">{link.label}</span>
                <ArrowUpRight className={cn("h-4 w-4 transition-transform", active ? "text-slate-400" : "opacity-0 group-hover:opacity-100")} />
              </Link>
            );
          })}
        </nav>

        <div className="space-y-4 border-t border-white/10 p-4">
          <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/55">Workspace</p>
            <p className="mt-2 text-sm text-white/85">Frontend refreshed, backend workflows preserved.</p>
          </div>
          <Button variant="outline" className="w-full border-white/14 bg-white/8 text-white hover:bg-white/14 hover:text-white" onClick={() => signOut({ callbackUrl: "/login" })}>
            Sign Out
          </Button>
        </div>
      </aside>
    </>
  );
}

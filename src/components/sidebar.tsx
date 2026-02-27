"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CalendarDays, Download, LayoutDashboard, ListOrdered, Settings2 } from "lucide-react";
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
    <aside className="flex h-screen w-64 flex-col border-r border-slate-200 bg-slate-50">
      <div className="border-b border-slate-200 px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Trade Journal</p>
        <h1 className="text-xl font-bold text-slate-900">Execution Lab</h1>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200",
                pathname === link.href && "bg-slate-900 text-white hover:bg-slate-900",
              )}
            >
              <Icon className="h-4 w-4" />
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-200 p-3">
        <Button variant="outline" className="w-full" onClick={() => signOut({ callbackUrl: "/login" })}>
          Sign Out
        </Button>
      </div>
    </aside>
  );
}

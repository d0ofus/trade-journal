"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { Activity, BarChart3, BookOpen, CalendarDays, Download, LayoutDashboard, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Settings2, Sun, TrendingUp, X } from "lucide-react";
import { requestWorkstationNavigation } from "@/lib/workstation-navigation-guard";
import type { Appearance } from "@/lib/workstation/appearance";

export const applicationLinks = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/trades", label: "Trades", icon: TrendingUp },
  { href: "/journal", label: "Journal", icon: BookOpen },
  { href: "/positions", label: "Positions", icon: BarChart3 },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/import", label: "Import", icon: Download },
  { href: "/settings", label: "Settings", icon: Settings2 },
];
const expansionEvent = "execution-lab-navigation-expansion";
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback); window.addEventListener(expansionEvent, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(expansionEvent, callback); };
}
export function ApplicationNavigation({ mode, theme, setTheme, menuOpen, setMenuOpen, beforeNavigate }: {
  mode: "application" | "demo"; theme: Appearance; setTheme(value: Appearance): boolean;
  menuOpen: boolean; setMenuOpen(open: boolean): void; beforeNavigate(): Promise<boolean>;
}) {
  const pathname = usePathname(), router = useRouter();
  const expansionKey = `execution-lab:navigation:${mode}:expanded:v1`;
  const expanded = useSyncExternalStore(subscribe, () => { try { return localStorage.getItem(expansionKey) === "1"; } catch { return false; } }, () => false);
  const drawer = useRef<HTMLElement>(null), opener = useRef<HTMLButtonElement>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    drawer.current?.querySelector<HTMLElement>("button,a")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); setMenuOpen(false); opener.current?.focus(); }
      if (e.key !== "Tab") return;
      const items = Array.from(drawer.current?.querySelectorAll<HTMLElement>("a[href],button:not(:disabled)") ?? []).filter(el => el.getClientRects().length);
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (items.length && ((e.shiftKey && index <= 0) || (!e.shiftKey && index === items.length - 1))) { e.preventDefault(); items[e.shiftKey ? items.length - 1 : 0].focus(); }
    };
    const media = window.matchMedia("(min-width: 901px)");
    const resize = () => { if (media.matches) setMenuOpen(false); };
    document.addEventListener("keydown", key); media.addEventListener("change", resize);
    return () => { document.removeEventListener("keydown", key); media.removeEventListener("change", resize); };
  }, [menuOpen, setMenuOpen]);
  async function navigate(href?: string) {
    if (pending) return;
    setPending(true);
    try {
      if (!(await beforeNavigate())) { setMessage("Resolve the review save issue before leaving. Your draft is preserved."); return; }
      if (!requestWorkstationNavigation(href ? "leave this page" : "sign out", href)) return;
      setMenuOpen(false); setMessage("");
      if (href) router.push(href); else await signOut({ callbackUrl: "/login" });
    } finally { setPending(false); }
  }
  const navLinks = mode === "demo" ? applicationLinks.filter(link => ["/trades", "/journal"].includes(link.href)).map(link => ({ ...link, href: `/preview${link.href}` })) : applicationLinks;
  return <>
    <header className="app-mobile-header"><button ref={opener} aria-label="Open navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu size={20} /></button><Activity size={20} /><span>Execution Lab</span></header>
    {menuOpen && <div className="app-nav-backdrop" onClick={() => { setMenuOpen(false); opener.current?.focus(); }} />}
    <aside ref={drawer} className={`app-navigation ${expanded ? "is-expanded" : ""} ${menuOpen ? "is-open" : ""}`} role={menuOpen ? "dialog" : undefined} aria-modal={menuOpen || undefined} aria-label={menuOpen ? "Navigation menu" : "Application navigation"}>
      <div className="app-nav-brand"><span className="app-nav-logo"><Activity size={22} /></span><span className="app-nav-label">Execution Lab</span><button className="app-nav-close" aria-label="Close navigation" onClick={() => { setMenuOpen(false); opener.current?.focus(); }}><X size={19} /></button></div>
      <nav aria-label="Primary navigation">{navLinks.map(({ href, label, icon: Icon }) => <Link key={href} href={href} data-navigation-managed="true" aria-label={label} aria-current={pathname === href ? "page" : undefined} className="app-nav-item" onClick={event => {
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); void navigate(href);
      }}><Icon size={19} /><span className="app-nav-label">{label}</span><span className="app-nav-tooltip" aria-hidden="true">{label}</span></Link>)}</nav>
      <div className="app-nav-bottom">
        <button className="app-nav-item" aria-label="Appearance" title="Appearance" onClick={() => { if (!setTheme(theme === "dark" ? "light" : "dark")) setMessage("Appearance could not be saved on this device."); }}><span>{theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}</span><span className="app-nav-label">{theme === "dark" ? "Light appearance" : "Dark appearance"}</span><span className="app-nav-tooltip" aria-hidden="true">Switch appearance</span></button>
        <button className="app-nav-item app-nav-expand" aria-label={expanded ? "Collapse navigation" : "Expand navigation"} aria-expanded={expanded} onClick={() => { try { localStorage.setItem(expansionKey, expanded ? "0" : "1"); window.dispatchEvent(new Event(expansionEvent)); } catch { setMessage("Navigation preference could not be saved."); } }}><span>{expanded ? <PanelLeftClose size={19} /> : <PanelLeftOpen size={19} />}</span><span className="app-nav-label">Collapse</span><span className="app-nav-tooltip" aria-hidden="true">Expand navigation</span></button>
        {mode === "application" && <button className="app-nav-item" aria-label="Sign out" disabled={pending} onClick={() => void navigate()}><LogOut size={19} /><span className="app-nav-label">Sign out</span><span className="app-nav-tooltip" aria-hidden="true">Sign out</span></button>}
      </div>
    </aside>
    {message && <div className="app-navigation-message" role="status">{message}<button aria-label="Dismiss navigation message" onClick={() => setMessage("")}><X size={16} /></button></div>}
  </>;
}

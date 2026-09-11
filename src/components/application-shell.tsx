"use client";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { ApplicationNavigation } from "./application-navigation";
import { useAppearance } from "@/lib/workstation/appearance";

const ShellContext = createContext<{ registerSave(save: () => Promise<boolean>): () => void; setFocused(focused: boolean): void }>({ registerSave: () => () => {}, setFocused: () => {} });
export const useApplicationShell = () => useContext(ShellContext);

export function ApplicationShell({ children, mode = "application" }: { children: ReactNode; mode?: "application" | "demo" }) {
  const { theme, setTheme } = useAppearance(mode);
  const [focused, setFocused] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const save = useRef<null | (() => Promise<boolean>)>(null);
  const registerSave = useCallback((callback: () => Promise<boolean>) => {
    save.current = callback;
    return () => { if (save.current === callback) save.current = null; };
  }, []);
  return <ShellContext.Provider value={{ registerSave, setFocused }}>
    <div className={`application-shell app-theme ${focused ? "app-focused" : ""}`} data-theme={theme} data-demo={mode === "demo" || undefined}>
      <ApplicationNavigation mode={mode} theme={theme} setTheme={setTheme} menuOpen={menuOpen} setMenuOpen={setMenuOpen} beforeNavigate={() => save.current?.() ?? Promise.resolve(true)} />
      <main className="application-content" inert={menuOpen || undefined}>{children}</main>
    </div>
  </ShellContext.Provider>;
}

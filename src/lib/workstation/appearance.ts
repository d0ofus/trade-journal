"use client";
import { useCallback, useSyncExternalStore } from "react";

type Mode = "application" | "demo";
export type Appearance = "dark" | "light";
const eventName = "execution-lab-appearance-change";
const key = (mode: Mode) => `execution-lab:appearance:${mode}:v1`;
function read(mode: Mode): Appearance {
  try {
    const value = localStorage.getItem(key(mode));
    if (value === "light" || value === "dark") return value;
    const previous = JSON.parse(localStorage.getItem(`execution-lab:workstation:preferences:${mode}:v1`) ?? "null");
    return previous?.theme === "light" ? "light" : "dark";
  } catch { return "dark"; }
}
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(eventName, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(eventName, callback); };
}
export function useAppearance(mode: Mode) {
  const theme = useSyncExternalStore(subscribe, () => read(mode), () => "dark" as Appearance);
  const setTheme = useCallback((value: Appearance) => {
    try { localStorage.setItem(key(mode), value); window.dispatchEvent(new Event(eventName)); return true; }
    catch { return false; }
  }, [mode]);
  return { theme, setTheme };
}

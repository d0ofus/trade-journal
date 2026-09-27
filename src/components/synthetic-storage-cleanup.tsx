"use client";
import { useEffect } from "react";
const prefixes = ["execution-lab:workstation:demo:v1:", "execution-lab:workstation:draft:demo:", "execution-lab:trade-view:demo:", "execution-lab:workstation:draft:application:demo-account-workstation:", "execution-lab:trade-view:application:demo-account-workstation:"];
export function SyntheticStorageCleanup() {
  useEffect(() => {
    // Exact synthetic namespaces only. Preferences and genuine recovery records are untouched.
    try { for (const key of Object.keys(localStorage)) if (prefixes.some(prefix => key.startsWith(prefix))) localStorage.removeItem(key); } catch { /* Private browsing can disable storage. */ }
    void Promise.all([
      import("@/lib/journal/recovery").then(m => m.clearSyntheticRecovery()),
      import("@/lib/workstation/evidence-storage").then(m => m.clearSyntheticImages()),
    ]).catch(() => { /* Keep existing data if storage is unavailable; retry next app load. */ });
  }, []);
  return null;
}

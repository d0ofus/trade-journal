"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
const key = "execution-lab:backup-reminder:snoozed:v1";
export function BackupReminder({ beforeNavigate }: { beforeNavigate: () => Promise<boolean> }) {
  const router = useRouter();
  const [due, setDue] = useState(false);
  useEffect(() => {
    let active = true;
    try { if (Date.now() - Number(localStorage.getItem(key)) < 7 * 86400_000) return; } catch { /* reminder still usable */ }
    void fetch("/api/admin/backup/reminder").then(response => response.ok ? response.json() : null).then(body => { if (active) setDue(!!body?.due); }).catch(() => {});
    return () => { active = false; };
  }, []);
  if (!due) return null;
  return <aside className="app-backup-reminder" role="status">Your saved changes are due for a local backup. <Link href="/settings#download-verify" onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); void beforeNavigate().then(saved => { if (saved) router.push("/settings#download-verify"); }); }}>Download &amp; Verify</Link><button aria-label="Remind me in one week" onClick={() => { setDue(false); try { localStorage.setItem(key, String(Date.now())); } catch { /* dismissed for this visit */ } }}>Later</button></aside>;
}

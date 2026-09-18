"use client";
import { useEffect, useState } from "react";
import { peerContextSchema, selectPeerGroup, type PeerGroup } from "@/lib/workstation/peers";

export type PeerGroupSelection = { group: PeerGroup; groups: PeerGroup[] };
export function PeerGroups({ symbol, savedId, mode, onSelect, onCompare }: {
  symbol: string; savedId?: string; mode: "demo" | "application";
  onSelect: (id: string) => void; onCompare: (selection: PeerGroupSelection) => void;
}) {
  const [groups, setGroups] = useState<PeerGroup[]>([]), [error, setError] = useState(""), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  const [manageUrl, setManageUrl] = useState("https://market-overview-nu.vercel.app/peer-groups");
  const selected = selectPeerGroup(groups, savedId);
  useEffect(() => {
    const controller = new AbortController();
    // Reset the previous ticker's asynchronous result when the query changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true); setError(""); setGroups([]);
    const load = async () => {
      if (mode === "demo") return { detail: { groups: [{ id: "demo-peers", name: "Demo peer group (synthetic charts)", priority: 0, isActive: true, members: [symbol, ...Array.from({ length: 50 }, (_, i) => `PEER${String(i + 1).padStart(2, "0")}`)].map(ticker => ({ ticker, name: ticker, exchange: "NASDAQ" })) }] } };
      const response = await fetch(`/api/journal/market-context?${new URLSearchParams({ symbol, membershipOnly: "1" })}`, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error("Peer memberships could not be loaded.");
      const result = peerContextSchema.parse(await response.json());
      if (result.errors?.length && !result.detail) throw new Error(result.errors.join(" "));
      return result;
    };
    void load().then(result => {
      if (controller.signal.aborted) return;
      setGroups(result.detail?.groups ?? []);
      if ("peerGroupsUrl" in result && typeof result.peerGroupsUrl === "string" && /^https?:\/\//.test(result.peerGroupsUrl)) setManageUrl(result.peerGroupsUrl);
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Peer groups unavailable."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [symbol, mode, retry]);
  return <div className="ws-peer-launch">
    {loading ? <p role="status">Loading peer groups…</p> : error ? <p role="alert">{error} <button type="button" onClick={() => setRetry(v => v + 1)}>Retry</button></p> : selected.selected ? <>
      <label>Peer group <select aria-label="Peer group" value={selected.selected.id} onChange={e => onSelect(e.target.value)}>{selected.groups.map(group => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label>
      {selected.changed && <p className="ws-help">The saved group is no longer active. Showing the highest-priority available group.</p>}
      <button type="button" className="ws-primary" onClick={() => onCompare({ group: selected.selected!, groups: selected.groups })}>Compare peers</button>
    </> : <p>No matching peer group.</p>}
    <a href={manageUrl} target="_blank" rel="noreferrer">Manage peer groups ↗</a>
  </div>;
}

import { prisma } from "@/lib/prisma";

export async function loadReconciledPositions() {
  const [positions, snapshots, executions] = await Promise.all([
    prisma.position.findMany({ include: { account: { select: { ibkrAccount: true } }, instrument: { include: { symbolNotes: true } } } }),
    prisma.positionSnapshot.findMany({ include: { instrument: true }, orderBy: [{ date: "desc" }, { updatedAt: "desc" }] }),
    prisma.execution.findMany({ select: { accountId: true, executedAt: true, side: true, quantity: true, brokerContractId: true, instrument: true } }),
  ]);
  const identity = (row: { accountId: string; instrument: { id: string; brokerContractId: string | null } }) => `${row.accountId}:${row.instrument.brokerContractId ? "conid:" + row.instrument.brokerContractId : "instrument:" + row.instrument.id}`;
  const latestAccountDate = new Map<string, string>();
  for (const s of snapshots) if (!latestAccountDate.has(s.accountId)) latestAccountDate.set(s.accountId, s.date.toISOString().slice(0, 10));
  const groups = new Map<string, typeof positions>();
  for (const p of positions) { const key = identity(p); groups.set(key, [...(groups.get(key) ?? []), p]); }
  type Result = Omit<(typeof positions)[number], "avgCost"> & { avgCost: number | null; asOf: string | null; evidence: string };
  return [...groups].flatMap<Result>(([key, group]) => {
    const snapshot = snapshots.find(s => identity(s) === key);
    const position = group.find(p => p.instrumentId === snapshot?.instrumentId) ?? group[0];
    if (!snapshot) return Math.abs(position.quantity) < 1e-8 ? [] : [{ ...position, asOf: null, evidence: "Unverified: no dated broker snapshot", avgCost: position.avgCost as number | null }];
    const date = snapshot.date.toISOString().slice(0, 10);
    const conflicting = snapshots.some(s => identity(s) === key && s.date.getTime() === snapshot.date.getTime() && s.quantity !== snapshot.quantity);
    const after = executions.filter(e => identity(e) === key && e.executedAt.toISOString().slice(0, 10) > date);
    const quantity = snapshot.quantity + after.reduce((total, e) => total + (e.side === "BUY" ? e.quantity : -e.quantity), 0);
    if (!conflicting && Math.abs(quantity) < 1e-8) return [];
    const asOf = after.length ? after.map(e => e.executedAt.toISOString().slice(0, 10)).sort().at(-1)! : date;
    return [{ ...position, quantity, avgCost: after.length ? null : snapshot.avgCost, unrealizedPnl: after.length ? null : snapshot.unrealizedPnl, asOf,
      evidence: conflicting ? "Conflicting dated snapshots — reconciliation required" : after.length ? `Reconstructed from ${date} snapshot and subsequent fills` : date === latestAccountDate.get(position.accountId) ? "Broker confirmed · partial report" : "Last confirmed holding · absent from later partial reports; status unresolved",
      instrument: { ...position.instrument, symbolNotes: group.flatMap(p => p.instrument.symbolNotes) },
    }];
  });
}

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { R2_REFRESH_MS, R2_STALE_MS, type R2AccountUsage } from "@/lib/storage-usage";
import { parseR2AccountMetrics } from "./evidence-usage";

const SNAPSHOT_KEY = "r2-account-usage", REFRESH_KEY = "r2-account-usage-refresh";
type RefreshState = { attemptId?: string; lastAttemptAt?: string; nextRefreshAt?: string; error?: string | null };
type Snapshot = { measuredAt?: string; metrics?: unknown };
const time = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;

export async function readR2AccountUsage() {
  const rows = await prisma.evidenceMaintenanceState.findMany({ where: { key: { in: [SNAPSHOT_KEY, REFRESH_KEY] } }, select: { key: true, payload: true } });
  const saved = rows.find(row => row.key === SNAPSHOT_KEY)?.payload as Snapshot | undefined;
  const refresh = rows.find(row => row.key === REFRESH_KEY)?.payload as RefreshState | undefined;
  const counters = parseR2AccountMetrics(saved?.metrics), measured = time(saved?.measuredAt);
  const next = Math.max(time(refresh?.nextRefreshAt), measured ? measured + R2_REFRESH_MS : 0);
  const error = refresh?.error || (!counters || !measured ? "No valid Cloudflare account reading is available." : null);
  const nextRefreshAt = next ? new Date(next).toISOString() : null;
  const account: R2AccountUsage | null = counters && measured ? {
    measuredAt: new Date(measured).toISOString(), ...counters, stale: Date.now() - measured >= R2_STALE_MS,
    warning: counters.standardBytes >= 10e9 ? "Above 10 GB: additional Standard storage is metered; uploads continue."
      : counters.standardBytes >= 9e9 ? "Above 9 GB account-wide usage." : counters.standardBytes >= 8e9 ? "Above 8 GB account-wide usage." : null,
    estimatedMonthlyStorageUsd: Math.max(0, Math.ceil(counters.standardBytes / 1e9) - 10) * .015,
    nextRefreshAt: nextRefreshAt ?? undefined, lastAttemptAt: refresh?.lastAttemptAt ?? null, error,
  } : null;
  return { account, nextRefreshAt, error };
}

export function r2RetryAt(header: string | null, now: number) {
  const seconds = header && /^\d+$/.test(header.trim()) ? Number(header) : NaN;
  const requested = Number.isFinite(seconds) ? now + seconds * 1000 : time(header);
  return Math.max(now + R2_REFRESH_MS, Number.isFinite(requested) && requested <= 8.64e15 ? requested : 0);
}

/** Used by Settings and the daily cron. The durable claim throttles every server instance. */
export async function refreshR2AccountUsage() {
  const token = process.env.EVIDENCE_R2_METRICS_TOKEN, accountId = process.env.EVIDENCE_R2_ACCOUNT_ID;
  if (!token || !accountId || !/^[a-f0-9]{32}$/i.test(accountId)) {
    return { ...await readR2AccountUsage(), available: false, refreshed: false, error: "Account-wide R2 metrics credentials are not configured.", nextRefreshAt: new Date(Date.now() + R2_REFRESH_MS).toISOString() };
  }
  const attemptId = randomUUID(), now = Date.now();
  const claimed = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('r2-account-metrics-refresh'))`;
    const rows = await tx.evidenceMaintenanceState.findMany({ where: { key: { in: [SNAPSHOT_KEY, REFRESH_KEY] } } });
    const previous = rows.find(row => row.key === REFRESH_KEY)?.payload as RefreshState | undefined;
    const saved = rows.find(row => row.key === SNAPSHOT_KEY)?.payload as Snapshot | undefined;
    if (Math.max(time(previous?.nextRefreshAt), time(saved?.measuredAt) + R2_REFRESH_MS) > now) return false;
    const payload = { attemptId, lastAttemptAt: new Date(now).toISOString(), nextRefreshAt: new Date(now + R2_REFRESH_MS).toISOString(), error: previous?.error ?? null };
    await tx.evidenceMaintenanceState.upsert({ where: { key: REFRESH_KEY }, create: { key: REFRESH_KEY, payload }, update: { payload } });
    return true;
  }, { maxWait: 5_000, timeout: 10_000 });
  if (!claimed) { const saved = await readR2AccountUsage(); return { ...saved, available: !!saved.account, refreshed: false }; }

  let nextRefreshAt = now + R2_REFRESH_MS, error: string | null = null;
  let snapshot: Prisma.InputJsonObject | null = null;
  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/metrics`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 429) { nextRefreshAt = r2RetryAt(response.headers.get("retry-after"), Date.now()); throw new Error("rate-limit"); }
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "permission" : "provider");
    const body = await response.json();
    if (!body.success || !parseR2AccountMetrics(body.result)) throw new Error("incomplete");
    snapshot = { measuredAt: new Date().toISOString(), metrics: body.result };
  } catch (cause) {
    const kind = cause instanceof Error ? cause.message : "";
    error = kind === "rate-limit" ? "Cloudflare requested a cooldown; the last valid reading was retained."
      : kind === "permission" ? "Cloudflare metrics access was denied. Check the read-only account token."
      : kind === "incomplete" ? "Cloudflare returned incomplete metrics; the last valid reading was retained."
      : "Cloudflare metrics refresh failed; the last valid reading was retained.";
  }
  await prisma.$transaction(async tx => {
    const updated = await tx.evidenceMaintenanceState.updateMany({ where: { key: REFRESH_KEY, payload: { path: ["attemptId"], equals: attemptId } },
      data: { payload: { attemptId, lastAttemptAt: new Date(now).toISOString(), nextRefreshAt: new Date(nextRefreshAt).toISOString(), error } } });
    if (updated.count && snapshot) await tx.evidenceMaintenanceState.upsert({ where: { key: SNAPSHOT_KEY }, create: { key: SNAPSHOT_KEY, payload: snapshot }, update: { payload: snapshot } });
  });
  const saved = await readR2AccountUsage();
  return { ...saved, available: !!saved.account, refreshed: !!snapshot };
}

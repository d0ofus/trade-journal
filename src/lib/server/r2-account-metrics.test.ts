import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { readR2AccountUsage, refreshR2AccountUsage, r2RetryAt } from "./r2-account-metrics";
import { GET, POST } from "@/app/api/settings/storage/route";
import { R2_REFRESH_MS } from "@/lib/storage-usage";

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => null) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
const keys = ["r2-account-usage", "r2-account-usage-refresh"];
let original: Awaited<ReturnType<typeof prisma.evidenceMaintenanceState.findMany>> = [];
const now = Date.parse("2026-09-24T12:00:00Z");
const metrics = { standard: { published: { payloadSize: 7_000_000_000, metadataSize: 100 }, uploaded: { payloadSize: 12, metadataSize: 0 } } };
const clear = () => prisma.evidenceMaintenanceState.deleteMany({ where: { key: { in: keys } } });
beforeAll(async () => { original = await prisma.evidenceMaintenanceState.findMany({ where: { key: { in: keys } } }); });
beforeEach(async () => {
  await clear(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  vi.stubEnv("EVIDENCE_R2_ACCOUNT_ID", "00000000000000000000000000000000"); vi.stubEnv("EVIDENCE_R2_METRICS_TOKEN", "synthetic-only");
});
afterEach(async () => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.mocked(getServerSession).mockResolvedValue(null); await clear(); });
afterAll(async () => {
  for (const row of original) await prisma.evidenceMaintenanceState.create({ data: { ...row, payload: row.payload as Prisma.InputJsonValue } });
  await prisma.$disconnect();
});

describe("durable Cloudflare metrics refresh", () => {
  it("allows only one concurrent provider request and retains a 15-minute cooldown across calls", async () => {
    const network = vi.fn(async () => Response.json({ success: true, result: metrics })); vi.stubGlobal("fetch", network);
    const results = await Promise.all([refreshR2AccountUsage(), refreshR2AccountUsage(), refreshR2AccountUsage()]);
    expect(network).toHaveBeenCalledTimes(1);
    expect(results.filter(result => result.refreshed)).toHaveLength(1);
    expect((await readR2AccountUsage()).account?.standardBytes).toBe(7_000_000_112);
    expect((await refreshR2AccountUsage()).refreshed).toBe(false);
    vi.setSystemTime(now + R2_REFRESH_MS);
    expect((await refreshR2AccountUsage()).refreshed).toBe(true);
    expect(network).toHaveBeenCalledTimes(2);
  });
  it("uses a saved snapshot to enforce the interval even before a refresh-state record exists", async () => {
    await prisma.evidenceMaintenanceState.create({ data: { key: keys[0], payload: { measuredAt: new Date(now - 60_000).toISOString(), metrics } } });
    const network = vi.fn(); vi.stubGlobal("fetch", network);
    expect((await refreshR2AccountUsage()).refreshed).toBe(false); expect(network).not.toHaveBeenCalled();
  });
  it("retains the old measurement timestamp on permission, invalid-counter and transport failures", async () => {
    for (const response of [() => Promise.resolve(new Response(null, { status: 403 })), () => Promise.resolve(Response.json({ success: true, result: {} })), () => Promise.reject(new Error("private provider details"))]) {
      await clear();
      const measuredAt = new Date(now - 3600_000).toISOString();
      await prisma.evidenceMaintenanceState.create({ data: { key: keys[0], payload: { measuredAt, metrics } } });
      vi.stubGlobal("fetch", vi.fn(response));
      const result = await refreshR2AccountUsage();
      expect(result.refreshed).toBe(false); expect(result.error).toBeTruthy(); expect(result.account?.measuredAt).toBe(measuredAt);
      expect(result.account?.stale).toBe(true); expect(JSON.stringify(result)).not.toContain("private provider details");
    }
  });
  it("honors Retry-After and does not recreate a timestamp during provider cooldown", async () => {
    const network = vi.fn(async () => new Response(null, { status: 429, headers: { "Retry-After": "7200" } })); vi.stubGlobal("fetch", network);
    const result = await refreshR2AccountUsage();
    expect(result.account).toBeNull(); expect(result.error).toMatch(/cooldown/);
    expect(Date.parse(result.nextRefreshAt!)).toBe(now + 7200_000);
    vi.setSystemTime(now + R2_REFRESH_MS); await refreshR2AccountUsage(); expect(network).toHaveBeenCalledTimes(1);
    expect(r2RetryAt(new Date(now + 3600_000).toUTCString(), now)).toBe(now + 3600_000);
    expect(r2RetryAt("invalid", now)).toBe(now + R2_REFRESH_MS);
  });
  it("does not contact Cloudflare without configured credentials", async () => {
    vi.stubEnv("EVIDENCE_R2_METRICS_TOKEN", ""); const network = vi.fn(); vi.stubGlobal("fetch", network);
    expect((await refreshR2AccountUsage()).available).toBe(false); expect(network).not.toHaveBeenCalled();
    expect(await prisma.evidenceMaintenanceState.count({ where: { key: { in: keys } } })).toBe(0);
  });
  it("authenticates both methods and rejects cross-origin session POSTs before provider access", async () => {
    const network = vi.fn(); vi.stubGlobal("fetch", network);
    expect((await GET(new NextRequest("http://localhost/api/settings/storage"))).status).toBe(401);
    expect((await POST(new NextRequest("http://localhost/api/settings/storage", { method: "POST" }))).status).toBe(401);
    vi.mocked(getServerSession).mockResolvedValue({ user: {}, expires: "2099-01-01" });
    expect((await POST(new NextRequest("http://localhost/api/settings/storage", { method: "POST", headers: { origin: "https://untrusted.test" } }))).status).toBe(403);
    expect(network).not.toHaveBeenCalled();
  });
  it("GET measures storage without refreshing Cloudflare or creating coordination records", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: {}, expires: "2099-01-01" });
    const network = vi.fn(); vi.stubGlobal("fetch", network);
    const result = await GET(new NextRequest("http://localhost/api/settings/storage"));
    expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(network).not.toHaveBeenCalled();
    expect(await prisma.evidenceMaintenanceState.count({ where: { key: { in: keys } } })).toBe(0);
  });
});

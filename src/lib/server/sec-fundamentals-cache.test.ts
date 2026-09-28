import { brotliCompressSync } from "node:zlib";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ cache: { findUnique: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), delete: vi.fn(), upsert: vi.fn() }, lease: vi.fn(), lock: vi.fn(), transaction: vi.fn(), usage: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { secFundamentalsCache: mocks.cache, $transaction: mocks.transaction } }));
vi.mock("./workstation-cache-store", () => ({ cacheUsage: mocks.usage }));
import { readSecCache, writeSecCache } from "./sec-fundamentals-cache";
const lease = { key: "sec:fundamentals:facts:v1:1", token: "test" };
const entry = { value: { Revenues: [{ val: 100, filed: "2024-05-01" }, { val: 150, filed: "2025-05-01" }] }, fetchedAt: "2026-09-28T00:00:00.000Z" };
beforeEach(() => {
  vi.resetAllMocks(); mocks.lease.mockResolvedValue(lease); mocks.usage.mockResolvedValue({ cacheBytes: 1000, databaseBytes: 1000 }); mocks.cache.findMany.mockResolvedValue([]);
  mocks.transaction.mockImplementation(async work => work({ secFundamentalsCache: mocks.cache, workstationCandleLease: { findFirst: mocks.lease }, $executeRaw: mocks.lock }));
});
it("round-trips compressed source versions and treats corruption as a miss", async () => {
  await writeSecCache("facts", entry, lease);
  const saved = mocks.cache.upsert.mock.calls[0][0].create;
  mocks.cache.findUnique.mockResolvedValue(saved);
  expect(await readSecCache("facts")).toEqual(entry);
  mocks.cache.findUnique.mockResolvedValue({ ...saved, payload: Buffer.from("corrupt") }); expect(await readSecCache("facts")).toBeNull();
  expect(saved.bytes).toBe(brotliCompressSync(Buffer.from(JSON.stringify(entry.value))).length);
});
it("fences expired requests and respects the shared database budget", async () => {
  mocks.lease.mockResolvedValue(null); await writeSecCache("facts", entry, lease); expect(mocks.cache.upsert).not.toHaveBeenCalled();
  mocks.lease.mockResolvedValue(lease); mocks.usage.mockResolvedValue({ cacheBytes: 99_500_000, databaseBytes: 1000 });
  await writeSecCache("facts", entry, lease); expect(mocks.cache.upsert).not.toHaveBeenCalled();
});
it("evicts only regenerable SEC records within its own ten-megabyte allocation", async () => {
  mocks.cache.findMany.mockResolvedValue([{ key: "old-facts", bytes: 9_900_000 }, { key: "recent-facts", bytes: 500_000 }]);
  await writeSecCache("facts", entry, lease);
  expect(mocks.cache.delete).toHaveBeenCalledExactlyOnceWith({ where: { key: "old-facts" } }); expect(mocks.cache.upsert).toHaveBeenCalledOnce();
});

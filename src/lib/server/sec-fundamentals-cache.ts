import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { prisma } from "@/lib/prisma";
import { cacheUsage, type CacheLease } from "./workstation-cache-store";

export type SecCacheEntry = { value: unknown; fetchedAt: string };
export async function readSecCache(key: string): Promise<SecCacheEntry | null> {
  const row = await prisma.secFundamentalsCache.findUnique({ where: { key } });
  if (!row) return null;
  try {
    const value: unknown = JSON.parse(brotliDecompressSync(row.payload, { maxOutputLength: 30_000_000 }).toString("utf8"));
    await prisma.secFundamentalsCache.updateMany({ where: { key }, data: { accessedAt: new Date() } });
    return { value, fetchedAt: row.fetchedAt.toISOString() };
  } catch { return null; }
}
export async function writeSecCache(key: string, entry: SecCacheEntry, lease: CacheLease): Promise<void> {
  const raw = JSON.stringify(entry.value); if (Buffer.byteLength(raw) > 30_000_000) return;
  const payload = brotliCompressSync(Buffer.from(raw)), bytes = payload.length;
  if (bytes > 5_000_000) return;
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(731934281)`;
    const live = await tx.workstationCandleLease.findFirst({ where: { ...lease, expiresAt: { gt: new Date() } } });
    if (!live) return;
    const usage = await cacheUsage(tx);
    if (usage.cacheBytes >= 99_000_000 || usage.databaseBytes >= 399_000_000) return;
    const rows = await tx.secFundamentalsCache.findMany({ orderBy: { accessedAt: "asc" }, select: { key: true, bytes: true } });
    let total = bytes + rows.reduce((sum, r) => sum + (r.key === key ? 0 : r.bytes), 0);
    for (const row of rows) {
      if (total <= 10_000_000) break;
      if (row.key !== key) { await tx.secFundamentalsCache.delete({ where: { key: row.key } }); total -= row.bytes; }
    }
    const data = { payload, bytes, fetchedAt: new Date(entry.fetchedAt), accessedAt: new Date() };
    await tx.secFundamentalsCache.upsert({ where: { key }, create: { key, ...data }, update: data });
  });
}

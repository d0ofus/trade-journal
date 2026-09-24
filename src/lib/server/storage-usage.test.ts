import { afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadStorageUsage } from "./storage-usage";
import { storageGuard } from "@/lib/storage-usage";
import { GET } from "@/app/api/settings/storage/route";
import { readPhysicalStorage } from "./storage-physical";

vi.mock("./storage-physical", () => ({ readPhysicalStorage: vi.fn(async () => ({ currentBytes: BigInt(1000), branchBytes: BigInt(2000), cacheBytes: BigInt(100), metricCacheBytes: BigInt(10), measuredAt: new Date() })) }));

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => null) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
afterAll(() => prisma.$disconnect());
describe("storage monitor", () => {
  it("uses existing guard boundaries and clamps exhausted headroom", () => {
    expect(storageGuard(79_999_999, "cache").status).toBe("Within guard");
    expect(storageGuard(80_000_000, "cache").status).toBe("Warning");
    expect(storageGuard(99_000_000, "cache").status).toBe("Paused");
    expect(storageGuard(350_000_000, "branch").status).toBe("Warning");
    expect(storageGuard(399_000_000, "branch").status).toBe("Paused");
    expect(storageGuard(500_000_000, "branch")).toMatchObject({ remaining: 0, percent: 100 });
  });
  it("rejects unauthenticated requests before querying storage", async () => {
    expect((await GET(new NextRequest("http://localhost/api/settings/storage"))).status).toBe(401);
  });
  it("returns partial groups when a query fails, and fails only if every database group fails", async () => {
    const query = vi.spyOn(prisma, "$queryRaw");
    try {
      vi.mocked(readPhysicalStorage).mockRejectedValueOnce(new Error("Size permission denied"));
      const partial = await loadStorageUsage();
      expect(partial.database).toBeNull(); expect(partial.payloads).not.toBeNull();
      expect(partial.issues).toContain("Database size measurements are unavailable.");
      vi.mocked(readPhysicalStorage).mockRejectedValueOnce(new Error("offline")); query.mockRejectedValueOnce(new Error("offline"));
      const backupOnly = await loadStorageUsage();
      expect(backupOnly.backup).not.toBeNull(); expect(backupOnly.database).toBeNull();
      vi.mocked(readPhysicalStorage).mockRejectedValueOnce(new Error("offline")); query.mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("offline"));
      await expect(loadStorageUsage()).rejects.toThrow("Storage measurements unavailable");
    } finally { query.mockRestore(); }
  });
  it("measures embedded reviews and archives without returning their contents, tolerating invalid review JSON", async () => {
    const before = await loadStorageUsage(); expect(before.database).not.toBeNull(); expect(before.payloads).not.toBeNull();
    const key = `storage-test-${crypto.randomUUID()}`, image = "data:image/png;base64,aGVsbG8=", content = "private archive Ω";
    try {
      await prisma.closedTradeNote.createMany({ data: [
        { groupKey: key, content: "", workstationJson: JSON.stringify({ evidence: [{ image }, { image: "https://example.test/secret-image.png" }] }) },
        { groupKey: key + "-invalid", content: "", workstationJson: "broken JSON" },
      ] });
      await prisma.importArtifact.create({ data: { storageKey: key, rawSha256: key, rawBytes: Buffer.byteLength(content), content } });
      const after = await loadStorageUsage();
      expect(after.payloads!.inlineBytes - before.payloads!.inlineBytes).toBe(Buffer.byteLength(image));
      expect(after.payloads!.workstationInlineCount - before.payloads!.workstationInlineCount).toBe(1);
      expect(after.payloads!.externalCount - before.payloads!.externalCount).toBe(1);
      expect(after.payloads!.invalidReviews - before.payloads!.invalidReviews).toBe(1);
      expect(after.payloads!.importBytes - before.payloads!.importBytes).toBe(Buffer.byteLength(content));
      expect(after.database!.branchBytes).toBeGreaterThanOrEqual(after.database!.currentBytes);
      expect(JSON.stringify(after)).not.toContain("secret-image"); expect(JSON.stringify(after)).not.toContain(content);
    } finally {
      await prisma.closedTradeNote.deleteMany({ where: { groupKey: { in: [key, key + "-invalid"] } } });
      await prisma.importArtifact.deleteMany({ where: { storageKey: key } });
    }
  });
});

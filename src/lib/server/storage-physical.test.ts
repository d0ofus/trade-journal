import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ set: vi.fn(), query: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
import { readPhysicalStorage } from "./storage-physical";

describe("bounded physical measurements", () => {
  it("bounds the server-side directory scan and lets the caller report its failure separately", async () => {
    mocks.transaction.mockImplementation(async callback => callback({ $executeRaw: mocks.set, $queryRaw: mocks.query }));
    mocks.query.mockRejectedValueOnce(new Error("statement timeout"));
    await expect(readPhysicalStorage()).rejects.toThrow("statement timeout");
    expect(mocks.transaction.mock.calls[0][1]).toEqual({ maxWait: 2000, timeout: 8000 });
    expect(mocks.set.mock.calls[0][0].join("")).toContain("statement_timeout = '5000ms'");
    expect(mocks.query.mock.calls[0][0].join("")).toContain("pg_database_size");
  });
});

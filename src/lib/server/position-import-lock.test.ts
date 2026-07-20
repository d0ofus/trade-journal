import { describe, expect, it, vi } from "vitest";

import {
  lockPositionImportAccounts,
  positionImportAccountCodes,
  positionImportLockKeys,
  positionImportLockQuery,
} from "@/lib/server/position-import-lock";

describe("position import account lock", () => {
  const databaseUrl =
    "postgresql://user:password@db.example/trades?schema=trade_journal_phase14_test";

  it("deduplicates and sorts account codes before locking", () => {
    expect(positionImportAccountCodes(["DU-B", "DU-A", "DU-B"])).toEqual(["DU-A", "DU-B"]);
    expect(positionImportLockKeys(["DU-B", "DU-A"], databaseUrl)).toEqual([
      'trade-journal:position-import:["trade_journal_phase14_test","DU-A"]',
      'trade-journal:position-import:["trade_journal_phase14_test","DU-B"]',
    ]);
  });

  it("uses public when Prisma has no explicit schema", () => {
    expect(
      positionImportLockKeys(["DU-A"], "postgresql://user:password@db.example/trades"),
    ).toEqual(['trade-journal:position-import:["public","DU-A"]']);
  });

  it("encodes schema and account tuples without delimiter ambiguity", () => {
    const first = positionImportLockKeys(
      ["b:position-import:c"],
      "postgresql://user:password@db.example/trades?schema=a",
    );
    const second = positionImportLockKeys(
      ["c"],
      "postgresql://user:password@db.example/trades?schema=a%3Aposition-import%3Ab",
    );

    expect(first).not.toEqual(second);
  });

  it("parameterizes the schema-scoped advisory lock key", () => {
    const key = positionImportLockKeys(["DU-A"], databaseUrl)[0];
    const query = positionImportLockQuery(key);

    expect(query.text).toContain("pg_advisory_xact_lock(hashtextextended(");
    expect(query.values).toEqual([key]);
    expect(query.text).not.toContain("DU-A");
  });

  it("rejects invalid database URLs", () => {
    expect(() => positionImportLockKeys(["DU-A"], "not a URL")).toThrow(
      "DATABASE_URL must be a valid URL",
    );
  });

  it("runs hooks around the complete sorted lock set", async () => {
    const events: string[] = [];
    const queryRaw = vi.fn(async (query: { values: unknown[] }) => {
      events.push(`lock:${String(query.values[0])}`);
      return [{ acquired: "" }];
    });
    const lockKeys = positionImportLockKeys(["DU-B", "DU-A"]);

    await lockPositionImportAccounts(
      { $queryRaw: queryRaw } as never,
      ["DU-B", "DU-A", "DU-B"],
      {
        beforeAcquire: (accounts) => events.push(`before:${accounts.join(",")}`),
        afterAcquire: (accounts) => events.push(`after:${accounts.join(",")}`),
      },
    );

    expect(events).toEqual([
      "before:DU-A,DU-B",
      `lock:${lockKeys[0]}`,
      `lock:${lockKeys[1]}`,
      "after:DU-A,DU-B",
    ]);
  });
});

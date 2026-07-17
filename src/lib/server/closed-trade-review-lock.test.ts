import { describe, expect, it, vi } from "vitest";

import { closedTradeLockQuery, lockClosedTradeForReview } from "@/lib/server/closed-trade-review-lock";

describe("closed-trade review lock", () => {
  it("qualifies the lock table with the Prisma URL schema", () => {
    const query = closedTradeLockQuery(
      "demo-group",
      "postgresql://user:password@db.example/trades?schema=trade_journal_phase10_test",
    );

    expect(query.text).toContain('FROM "trade_journal_phase10_test"."ClosedTrade"');
    expect(query.values).toEqual(["demo-group"]);
    expect(query.text).not.toContain("demo-group");
  });

  it("uses public when Prisma has no explicit schema", () => {
    const query = closedTradeLockQuery("demo-group", "postgresql://user:password@db.example/trades");

    expect(query.text).toContain('FROM "public"."ClosedTrade"');
  });

  it("escapes schema identifiers before constructing raw SQL", () => {
    const query = closedTradeLockQuery(
      "demo-group",
      "postgresql://user:password@db.example/trades?schema=review%22schema",
    );

    expect(query.text).toContain('FROM "review""schema"."ClosedTrade"');
  });

  it("returns the locked row from the qualified query", async () => {
    const row = { groupKey: "demo-group", isStale: false };
    const queryRaw = vi.fn().mockResolvedValue([row]);

    await expect(
      lockClosedTradeForReview({ $queryRaw: queryRaw } as never, row.groupKey),
    ).resolves.toEqual(row);
    expect(queryRaw).toHaveBeenCalledOnce();
  });
});

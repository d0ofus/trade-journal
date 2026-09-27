import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { buildSyntheticDeletionManifest } from "./dashboard-maintenance";
import { assertPreservedTradeAllocations } from "./closed-trades-materialized";
import { computeClosedTradeGroups, type ExecutionForClosed } from "../stats/closed-trades";

describe("dashboard repair compatibility gates", () => {
  it("rejects trade identity, fill allocation and timestamp changes before repair", () => {
    const fill = (id: string, side: "BUY" | "SELL", day: number): ExecutionForClosed => ({ id, accountId: "real", accountCode: "TEST-REAL", instrumentId: "instrument", symbol: "XYZ", assetType: "STOCK", currency: "USD", executedAt: new Date(Date.UTC(2026, 0, day)), side, quantity: 3, price: 10, commission: 1, fees: 0 });
    const groups = computeClosedTradeGroups([fill("buy", "BUY", 1), fill("sell", "SELL", 2)], new Map());
    const links = groups.flatMap(g => g.executions.map((e, sortOrder) => ({ closedTradeGroupKey: g.groupKey, executionId: e.id, sortOrder, executedAt: new Date(e.executedAt), side: e.side, quantity: e.quantity, price: e.price })));
    expect(() => assertPreservedTradeAllocations(groups, links, groups)).not.toThrow();
    expect(() => assertPreservedTradeAllocations(groups, links, [{ ...groups[0], groupKey: "changed" }])).toThrow("identities changed");
    for (const change of [{ quantity: 2 }, { price: 11 }, { executedAt: "2026-01-01T00:00:01.000Z" }]) {
      const changed = [{ ...groups[0], executions: [{ ...groups[0].executions[0], ...change }, ...groups[0].executions.slice(1)] }];
      expect(() => assertPreservedTradeAllocations(groups, links, changed)).toThrow("allocations changed");
    }
    const accounting = groups.map(g => ({ ...g, realizedPnl: -15, executions: g.executions.map(e => ({ ...e, fees: 5 })) }));
    expect(() => assertPreservedTradeAllocations(groups, links, accounting)).not.toThrow();
  });

  it("removes exact synthetic ownership while retaining shared journals, instruments and evidence", () => {
    const data: Record<string, Record<string, unknown>[]> = Object.fromEntries(Prisma.dmmf.datamodel.models.map(m => [m.name, []]));
    data.Account = [{ id: "demo", ibkrAccount: "DEMO-WORKSTATION" }, { id: "real", ibkrAccount: "TEST-GENUINE" }];
    data.ClosedTrade = [{ groupKey: "demo-trade", accountId: "demo", instrumentId: "demo-inst-a" }, { groupKey: "real-trade", accountId: "real", instrumentId: "demo-inst-a" }];
    data.Instrument = [{ id: "demo-inst-a" }];
    data.JournalEntry = [{ id: "shared" }, { id: "demo-journal-a" }];
    data.JournalLink = [{ id: "demo-link", journalEntryId: "shared", targetType: "CLOSED_TRADE", targetId: "demo-trade" }, { id: "real-link", journalEntryId: "shared", targetType: "CLOSED_TRADE", targetId: "real-trade" }];
    data.EvidenceAsset = [{ id: "shared-asset" }, { id: "exclusive" }];
    data.EvidenceAssetReference = [{ assetId: "shared-asset", kind: "review", key: "demo-trade" }, { assetId: "shared-asset", kind: "review", key: "real-trade" }, { assetId: "exclusive", kind: "review", key: "demo-trade" }];
    const manifest = buildSyntheticDeletionManifest(data);
    expect(manifest.Account).toEqual([{ id: "demo" }]);
    expect(manifest.JournalEntry).toEqual([{ id: "demo-journal-a" }]);
    expect(manifest.JournalLink).toEqual([{ id: "demo-link" }]);
    expect(manifest.Instrument).toBeUndefined();
    expect(manifest.EvidenceAsset).toEqual([{ id: "exclusive" }]);
    const remaining = Object.fromEntries(Object.entries(data).map(([model, rows]) => [model, rows.filter(row => !(manifest[model] ?? []).some(key => Object.entries(key).every(([k, value]) => row[k] === value)))]));
    expect(buildSyntheticDeletionManifest(remaining)).toEqual({});
  });
});

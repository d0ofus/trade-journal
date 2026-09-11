import { beforeEach, expect, it, vi } from "vitest";
import { workstationCandleSession } from "./workstation-candle-session";
import type { WorkstationCandles } from "./workstation-candles";
const mock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { instrument: { findMany: mock } } }));
const loaded = (source = "yahoo"): WorkstationCandles => ({ symbol: "MU", source, candles: [], provider: { identity: source, provider: source, feed: null, adjustment: "unverified", delaySeconds: 0, cached: false, fallback: false } });
beforeEach(() => mock.mockResolvedValue([{ assetType: "STOCK", currency: "USD", exchange: "NASDAQ" }]));
it("supplies exchange-calendar and regular-session metadata for US Yahoo history", async () => {
  expect(await workstationCandleSession(loaded())).toEqual({ timezone: "America/New_York", calendar: "exchange", marketHours: "regular" });
});
it("does not impose regular hours on cached or extended-session history", async () => {
  expect(await workstationCandleSession(loaded("cache"))).toMatchObject({ timezone: "America/New_York", marketHours: "unknown" });
});
it("keeps unsupported and ambiguous instruments unverified", async () => {
  mock.mockResolvedValue([{ assetType: "STOCK", currency: "AUD", exchange: "ASX" }]);
  expect(await workstationCandleSession(loaded())).toEqual({ timezone: null, calendar: "unknown", marketHours: "unknown" });
  mock.mockResolvedValue([{ assetType: "STOCK", currency: "USD", exchange: null }]);
  expect((await workstationCandleSession(loaded())).calendar).toBe("unknown");
});
it("retains the UTC date-label convention of Stooq daily bars", async () => {
  expect(await workstationCandleSession(loaded("stooq"))).toEqual({ timezone: "UTC", calendar: "utc", marketHours: "unknown" });
});

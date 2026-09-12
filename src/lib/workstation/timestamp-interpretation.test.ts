import { describe, expect, it } from "vitest";
import { interpretBrokerTimestamp } from "./timestamp-interpretation";
import { timingDemoTrade } from "./timing-demo";
import snapshot from "./timing-candles.json";
import { diagnoseExecution } from "./execution-diagnostics";
import { tradeChartSession } from "./chart-session";
import { reviewCsv, reviewArchive, timestampBasis } from "./export";
import { emptyDocument } from "./types";
import { unzipSync, strFromU8 } from "fflate";
const iso = (raw: string) => { const result = interpretBrokerTimestamp(raw); return result.utc === null ? result.status : new Date(result.utc * 1000).toISOString(); };
describe("source timezone interpretation", () => {
  it.each([
    ["20260908;150925", "2026-09-08T19:09:25.000Z"],
    ["20260108;150925", "2026-01-08T20:09:25.000Z"],
    ["20260908;233000", "2026-09-09T03:30:00.000Z"],
    ["2026-09-08T15:09:25Z", "2026-09-08T15:09:25.000Z"],
    ["2026-09-08T15:09:25-04:00", "2026-09-08T19:09:25.000Z"],
    ["20260308;023000", "invalid"],
    ["20261101;013000", "ambiguous"],
    ["20260230;150925", "invalid"],
    ["20260908", "unsupported"],
  ])("interprets %s deterministically", (raw, expected) => expect(iso(raw)).toBe(expected));
  it("reproduces eight fills without changing their economics or IDs", () => {
    const original = timingDemoTrade(false), corrected = timingDemoTrade(true), session = { timezone: "America/New_York", calendar: "exchange" as const, marketHours: "extended" as const };
    const candles = snapshot.candles;
    expect(original.executions.filter(e => diagnoseExecution(e, candles, "5m", session).status === "matching")).toHaveLength(1);
    expect(corrected.executions.filter(e => diagnoseExecution(e, candles, "5m", session).status === "matching")).toHaveLength(8);
    expect(corrected.executions.map(e => [e.id, e.price, e.quantity, e.side])).toEqual(original.executions.map(e => [e.id, e.price, e.quantity, e.side]));
    expect(corrected.pnl).toBe(original.pnl); expect(corrected.id).toBe(original.id);
    const sell = corrected.executions[4]; expect(new Date(sell.time * 1000).toISOString()).toBe("2026-09-08T19:09:25.000Z");
    expect(diagnoseExecution(sell, candles, "5m", session).period?.start).toBe(Date.parse("2026-09-08T19:05:00Z") / 1000);
    expect(tradeChartSession(corrected)).toBe("extended"); expect(tradeChartSession(original)).toBe("regular"); expect(tradeChartSession(corrected, "regular")).toBe("regular");
    const explicit = { ...corrected, executions: [{ ...corrected.executions[0], provenance: { ...corrected.executions[0].provenance!, timezone: "Explicit offset" } }] };
    expect(tradeChartSession(explicit)).toBe("extended");
    expect(diagnoseExecution(corrected.executions[0], candles, "5m", { ...session, marketHours: "regular" }).status).toBe("missing");
  });
  it("exports original and interpreted provenance with a versioned manifest", async () => {
    const trade = timingDemoTrade(true), doc = emptyDocument(), rows = [{ trade, doc, url: "/trades" }];
    expect(reviewCsv(rows)).toContain("Broker trade date"); expect(reviewCsv(rows)).toContain("User-confirmed");
    const files = unzipSync(new Uint8Array(await (await reviewArchive(rows, ["Opened UTC", "Broker trade date"], {})).arrayBuffer()));
    const json = JSON.parse(strFromU8(files[Object.keys(files).find(k => k.endsWith("/review.json"))!]));
    expect(json.trade.executions[4].provenance.brokerWallTime).toBe("20260908;150925"); expect(json.trade.executions[4].time - json.trade.executions[4].provenance.storedTime).toBe(14400);
    expect(JSON.parse(strFromU8(files["manifest.json"])).schema).toBe(2);
    const mixed = { ...trade, executions: [trade.executions[0], timingDemoTrade(false).executions[1]] };
    expect(timestampBasis(mixed)).toContain("1/2 executions; remaining executions retain their original, unverified times");
  });
});

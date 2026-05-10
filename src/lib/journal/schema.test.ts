import { describe, expect, it } from "vitest";
import {
  JOURNAL_CHART_PURPOSES,
  JOURNAL_MARKET_REGIMES,
  JOURNAL_OUTCOME_STATUSES,
  JOURNAL_TIMEFRAMES,
  journalChartPayloadSchema,
  journalEntryPayloadSchema,
  journalPlaybookPayloadSchema,
  journalReviewPayloadSchema,
  normalizeJournalTagName,
  normalizeJournalTags,
} from "@/lib/journal/schema";

describe("journal schema", () => {
  it("normalizes journal tags without hash prefixes", () => {
    expect(normalizeJournalTagName("#New Setup!")).toBe("new-setup");
    expect(normalizeJournalTags(["#flag", "Flag", "  risk/off  "])).toEqual(["flag", "risk-off"]);
  });

  it("validates macro sentiment and lesson tags", () => {
    const parsed = journalEntryPayloadSchema.parse({
      symbol: " vnet ",
      ideaDate: "2026-05-10",
      macroSentiment: "BULLISH",
      tags: {
        LESSON: ["#new-setup"],
      },
    });

    expect(parsed.symbol).toBe("VNET");
    expect(parsed.macroSentiment).toBe("BULLISH");
    expect(normalizeJournalTags(parsed.tags.LESSON)).toEqual(["new-setup"]);
  });

  it("allows the requested chart timeframes", () => {
    expect(JOURNAL_TIMEFRAMES).toEqual(["1W", "1D", "1H", "15min", "10min", "5min"]);
  });

  it("validates professional journal fields", () => {
    const parsed = journalEntryPayloadSchema.parse({
      symbol: "nvda",
      ideaDate: "2026-05-10",
      outcomeStatus: "WORKED_WITHOUT_ME",
      marketRegime: "RISK_ON",
      plannedEntry: 200,
      plannedStop: 190,
      bestExitR: 3.5,
      confidenceScore: 4,
      sectorEtf: "xlk",
    });

    expect(JOURNAL_OUTCOME_STATUSES).toContain(parsed.outcomeStatus);
    expect(JOURNAL_MARKET_REGIMES).toContain(parsed.marketRegime);
    expect(parsed.sectorEtf).toBe("XLK");
  });

  it("validates chart purpose and comparison metadata", () => {
    const parsed = journalChartPayloadSchema.parse({
      symbol: "NVDA",
      purpose: "FOLLOW_THROUGH",
      compareSymbol: "qqq",
    });

    expect(JOURNAL_CHART_PURPOSES).toContain(parsed.purpose);
    expect(parsed.compareSymbol).toBe("QQQ");
  });

  it("validates playbooks and reviews", () => {
    expect(
      journalPlaybookPayloadSchema.parse({
        name: "Flag continuation",
        rules: [{ text: "Price tightens above rising 20 SMA", required: true }],
      }).rules,
    ).toHaveLength(1);

    expect(
      journalReviewPayloadSchema.parse({
        period: "WEEKLY",
        startDate: "2026-05-04",
        endDate: "2026-05-10",
        actions: [{ label: "Promote the best flag example" }],
      }).actions[0].status,
    ).toBe("OPEN");
  });
});

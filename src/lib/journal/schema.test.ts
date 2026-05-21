import { describe, expect, it } from "vitest";
import {
  JOURNAL_CHART_PURPOSES,
  JOURNAL_MARKET_REGIMES,
  JOURNAL_NOTION_IDEAL_EXECUTION_OPTIONS,
  JOURNAL_NOTION_IDEAL_STOP_LOSS_OPTIONS,
  JOURNAL_NOTION_TRADE_STATUSES,
  JOURNAL_OUTCOME_STATUSES,
  JOURNAL_TIMEFRAMES,
  deriveJournalNotionSystemFields,
  journalChartPayloadSchema,
  journalDraftPayloadSchema,
  journalEntryPayloadSchema,
  journalSavedViewPayloadSchema,
  journalTagOperationSchema,
  normalizeJournalNotionRelations,
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

  it("validates Notion-style journal fields and relation tags", () => {
    const parsed = journalEntryPayloadSchema.parse({
      symbol: "pltr",
      tradeTitle: "Opening range continuation",
      ideaDate: "2026-05-10",
      entryEndAt: "2026-05-10T10:20:00.000Z",
      tradeStatus: "Open",
      exitMarked: true,
      highAvat: true,
      indexSupportive: false,
      daysConsolidating: 8,
      daysFromT: 2,
      xFrom50Sma: 4.5,
      stopLossPercent: 2.2,
      riskPercent: 0.5,
      maxRiskReward: 3.4,
      idealExecutionOptions: ["Stop Buy Oda CP"],
      idealStopLossOptions: ["Opening Range Low", "Prior Day Low"],
      notionRelations: {
        ACCOUNT: ["Backtest"],
        TYPE_OF_TRADE: ["Breakout"],
        CONFLUENCE: ["High volume", "Index aligned"],
      },
    });

    expect(JOURNAL_NOTION_TRADE_STATUSES).toContain(parsed.tradeStatus);
    expect(JOURNAL_NOTION_IDEAL_EXECUTION_OPTIONS).toContain(parsed.idealExecutionOptions[0]);
    expect(JOURNAL_NOTION_IDEAL_STOP_LOSS_OPTIONS).toContain(parsed.idealStopLossOptions[0]);
    expect(parsed.notionRelations.ACCOUNT).toEqual(["Backtest"]);
    expect(parsed.notionRelations.CONFLUENCE).toHaveLength(2);
  });

  it("normalizes Notion relation tags and caps single-value relations", () => {
    const normalized = normalizeJournalNotionRelations({
      ACCOUNT: [" Backtest ", "Live"],
      CHART_PATTERN: ["Bull flag", "bull flag", " ORB "],
    });

    expect(normalized.ACCOUNT).toEqual(["Backtest"]);
    expect(normalized.CHART_PATTERN).toEqual(["Bull flag", "ORB"]);
  });

  it("derives Notion system fields from saved journal data", () => {
    const derived = deriveJournalNotionSystemFields({
      id: "entry_1",
      createdAt: "2026-05-10T09:00:00.000Z",
      ideaDate: "2026-05-10T09:30:00.000Z",
      entryEndAt: "2026-05-10T10:15:00.000Z",
      notionRelations: { ACCOUNT: ["Backtest"] },
      bestExitR: -0.2,
      outcomeStatus: "FAILED",
    });

    expect(derived.id).toBe("entry_1");
    expect(derived.createdTime).toBe("2026-05-10T09:00:00.000Z");
    expect(derived.durationMinutes).toBe(45);
    expect(derived.backtest).toBe(true);
    expect(derived.profitLoss).toBe("Loss");
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

  it("validates quick drafts, saved views, and tag operations", () => {
    expect(
      journalDraftPayloadSchema.parse({
        symbol: " nvda ",
        tags: { LESSON: ["#new-setup"] },
      }).symbol,
    ).toBe("NVDA");

    expect(
      journalSavedViewPayloadSchema.parse({
        name: "Worked without me",
        viewType: "VISUAL",
        filtersJson: "{\"outcomeStatus\":\"WORKED_WITHOUT_ME\"}",
      }).sortDirection,
    ).toBe("desc");

    expect(
      journalTagOperationSchema.parse({
        category: "LESSON",
        from: "#new setup",
        to: "#new-setup",
      }).category,
    ).toBe("LESSON");
  });
});

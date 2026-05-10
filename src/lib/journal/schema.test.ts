import { describe, expect, it } from "vitest";
import {
  JOURNAL_TIMEFRAMES,
  journalEntryPayloadSchema,
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
});

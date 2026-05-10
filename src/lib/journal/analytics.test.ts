import { describe, expect, it } from "vitest";
import { computeJournalAnalytics, computeRuleFitScore, type JournalAnalyticsEntry } from "@/lib/journal/analytics";

const baseTags = {
  SETUP: [] as string[],
  LESSON: [] as string[],
  MISTAKE: [] as string[],
  CONTEXT: [] as string[],
  CUSTOM: [] as string[],
};

function entry(overrides: Partial<JournalAnalyticsEntry>): JournalAnalyticsEntry {
  return {
    id: overrides.id ?? "entry-1",
    symbol: overrides.symbol ?? "NVDA",
    setup: overrides.setup ?? "flag",
    status: overrides.status ?? "MISSED",
    playbookId: overrides.playbookId ?? null,
    playbook: overrides.playbook ?? null,
    outcomeStatus: overrides.outcomeStatus ?? "UNREVIEWED",
    marketRegime: overrides.marketRegime ?? "UNKNOWN",
    macroSentiment: overrides.macroSentiment ?? "NEUTRAL",
    mfeR: overrides.mfeR ?? null,
    maeR: overrides.maeR ?? null,
    bestExitR: overrides.bestExitR ?? null,
    charts: overrides.charts ?? [],
    tags: overrides.tags ?? baseTags,
    ruleChecks: overrides.ruleChecks ?? [],
  };
}

describe("journal analytics", () => {
  it("computes opportunity and outcome metrics", () => {
    const analytics = computeJournalAnalytics(
      [
        entry({
          id: "a",
          outcomeStatus: "WORKED_WITHOUT_ME",
          bestExitR: 4,
          mfeR: 5,
          charts: [{}],
          tags: { ...baseTags, LESSON: ["new-setup"] },
          playbook: { id: "pb", name: "Flag" },
        }),
        entry({ id: "b", outcomeStatus: "FAILED", bestExitR: -1, mfeR: 0.5, setup: "breakout" }),
      ],
      [
        { name: "new-setup", category: "LESSON", count: 1 },
        { name: "chased", category: "MISTAKE", count: 1 },
      ],
    );

    expect(analytics.totals.entries).toBe(2);
    expect(analytics.totals.workedWithoutMeRate).toBe(0.5);
    expect(analytics.totals.withCharts).toBe(1);
    expect(analytics.newSetupCandidates[0].id).toBe("a");
    expect(analytics.lessonTags[0].name).toBe("new-setup");
  });

  it("weights required playbook rules in fit score", () => {
    expect(
      computeRuleFitScore([
        { status: "PASS", playbookRule: { required: true } },
        { status: "FAIL", playbookRule: { required: false } },
        { status: "NA", playbookRule: { required: true } },
      ]),
    ).toBe(67);
  });
});

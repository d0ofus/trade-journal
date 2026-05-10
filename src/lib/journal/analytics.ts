import type { JournalTagCategoryValue } from "@/lib/journal/schema";

type TagBuckets = Record<JournalTagCategoryValue, string[]>;

export type JournalAnalyticsEntry = {
  id: string;
  symbol: string;
  setup: string | null;
  status: string;
  playbookId?: string | null;
  playbook?: { id: string; name: string } | null;
  outcomeStatus: string;
  marketRegime: string;
  macroSentiment: string;
  mfeR?: number | null;
  maeR?: number | null;
  bestExitR?: number | null;
  charts: unknown[];
  tags: TagBuckets;
  ruleChecks?: Array<{ status: string; playbookRule?: { text: string; required: boolean } | null }>;
};

type TagRow = { tagId?: string; name: string; category: JournalTagCategoryValue; count: number };

function average(values: Array<number | null | undefined>) {
  const nums = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : null;
}

function countBy<T extends string>(values: T[]) {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function groupByKey(entries: JournalAnalyticsEntry[], keyFor: (entry: JournalAnalyticsEntry) => string) {
  return countBy(entries.map(keyFor).filter(Boolean));
}

export function computeRuleFitScore(checks: Array<{ status: string; playbookRule?: { required: boolean } | null }>) {
  const applicable = checks.filter((check) => check.status !== "NA");
  if (applicable.length === 0) return null;
  const totalWeight = applicable.reduce((sum, check) => sum + (check.playbookRule?.required ? 2 : 1), 0);
  const passWeight = applicable
    .filter((check) => check.status === "PASS")
    .reduce((sum, check) => sum + (check.playbookRule?.required ? 2 : 1), 0);
  return Math.round((passWeight / Math.max(1, totalWeight)) * 100);
}

export function computeJournalAnalytics(entries: JournalAnalyticsEntry[], tags: TagRow[] = []) {
  const reviewed = entries.filter((entry) => entry.outcomeStatus && entry.outcomeStatus !== "UNREVIEWED");
  const triggered = entries.filter((entry) => entry.outcomeStatus === "TRIGGERED" || entry.outcomeStatus === "WORKED_WITHOUT_ME");
  const workedWithoutMe = entries.filter((entry) => entry.outcomeStatus === "WORKED_WITHOUT_ME");
  const failed = entries.filter((entry) => entry.outcomeStatus === "FAILED");
  const withCharts = entries.filter((entry) => entry.charts.length > 0);
  const lessonTags = tags.filter((tag) => tag.category === "LESSON");
  const mistakeTags = tags.filter((tag) => tag.category === "MISTAKE");
  const newSetupCandidates = entries
    .filter((entry) => entry.tags.LESSON?.includes("new-setup"))
    .map((entry) => ({
      id: entry.id,
      symbol: entry.symbol,
      setup: entry.setup,
      bestExitR: entry.bestExitR ?? null,
      mfeR: entry.mfeR ?? null,
      chartCount: entry.charts.length,
    }))
    .sort((a, b) => (b.bestExitR ?? b.mfeR ?? -999) - (a.bestExitR ?? a.mfeR ?? -999));

  const recurringRuleFailures = countBy(
    entries.flatMap((entry) =>
      (entry.ruleChecks ?? [])
        .filter((check) => check.status === "FAIL")
        .map((check) => check.playbookRule?.text ?? "Unmapped rule"),
    ),
  );

  return {
    totals: {
      entries: entries.length,
      reviewed: reviewed.length,
      withCharts: withCharts.length,
      triggerRate: entries.length ? triggered.length / entries.length : 0,
      workedWithoutMeRate: entries.length ? workedWithoutMe.length / entries.length : 0,
      failedAfterTriggerRate: entries.length ? failed.length / entries.length : 0,
      avgMfeR: average(entries.map((entry) => entry.mfeR)),
      avgMaeR: average(entries.map((entry) => entry.maeR)),
      avgBestExitR: average(entries.map((entry) => entry.bestExitR)),
    },
    byStatus: groupByKey(entries, (entry) => entry.status),
    byOutcome: groupByKey(entries, (entry) => entry.outcomeStatus),
    bySetup: groupByKey(entries, (entry) => entry.setup ?? "No setup"),
    byPlaybook: groupByKey(entries, (entry) => entry.playbook?.name ?? "No playbook"),
    byMarketRegime: groupByKey(entries, (entry) => entry.marketRegime),
    byMacroSentiment: groupByKey(entries, (entry) => entry.macroSentiment),
    lessonTags,
    mistakeTags,
    newSetupCandidates,
    recurringRuleFailures,
    opportunityRank: entries
      .filter((entry) => entry.bestExitR != null || entry.mfeR != null)
      .map((entry) => ({
        id: entry.id,
        symbol: entry.symbol,
        setup: entry.setup,
        playbook: entry.playbook?.name ?? null,
        bestExitR: entry.bestExitR ?? null,
        mfeR: entry.mfeR ?? null,
        outcomeStatus: entry.outcomeStatus,
      }))
      .sort((a, b) => (b.bestExitR ?? b.mfeR ?? -999) - (a.bestExitR ?? a.mfeR ?? -999))
      .slice(0, 12),
  };
}

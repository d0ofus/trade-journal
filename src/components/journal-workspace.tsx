"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState, useTransition } from "react";
import type { ReactNode } from "react";
import {
  BarChart3,
  BookOpen,
  BookOpenCheck,
  CheckCircle2,
  Filter,
  LayoutDashboard,
  LinkIcon,
  Loader2,
  NotebookPen,
  Plus,
  RefreshCw,
  Save,
  Search,
  Tags,
  Trash2,
} from "lucide-react";
import { JournalChartEditor } from "@/components/journal-chart-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  JOURNAL_MARKET_REGIMES,
  JOURNAL_OUTCOME_STATUSES,
  JOURNAL_REVIEW_PERIODS,
  JOURNAL_RULE_CHECK_STATUSES,
  JOURNAL_TAG_CATEGORIES,
  JOURNAL_TIMEFRAMES,
  JOURNAL_TREND_STATES,
  normalizeJournalTags,
  type JournalChartPurposeValue,
  type JournalMarketRegimeValue,
  type JournalOutcomeStatusValue,
  type JournalTagCategoryValue,
  type JournalTimeframe,
  type JournalTrendStateValue,
} from "@/lib/journal/schema";
import { cn } from "@/lib/utils";

type TagsByCategory = Record<JournalTagCategoryValue, string[]>;
type Trend = JournalTrendStateValue;
type Outcome = JournalOutcomeStatusValue;
type MarketRegime = JournalMarketRegimeValue;

type JournalChart = {
  id: string;
  symbol: string;
  timeframe: string;
  purpose: JournalChartPurposeValue;
  compareSymbol: string | null;
  screenshotUrl: string | null;
  caption: string;
  createdAt: string;
};

type JournalPlaybookRule = {
  id?: string;
  playbookId?: string;
  text: string;
  category: string;
  required: boolean;
  sortOrder: number;
};

type JournalPlaybook = {
  id: string;
  name: string;
  setupType: string | null;
  description: string;
  idealConditions: string;
  invalidationRules: string;
  marketRegimeFit: string;
  archived: boolean;
  rules: JournalPlaybookRule[];
  _count?: { entries: number };
};

type RuleCheck = {
  id: string;
  playbookRuleId: string | null;
  status: "PASS" | "FAIL" | "NA";
  notes: string;
  playbookRule: JournalPlaybookRule | null;
};

type JournalEntry = {
  id: string;
  symbol: string;
  ideaDate: string;
  direction: "LONG" | "SHORT";
  status: "DRAFT" | "WATCHING" | "MISSED" | "PASSED" | "INVALIDATED" | "PLAYBOOK" | "ARCHIVED";
  playbookId: string | null;
  playbook: JournalPlaybook | null;
  setup: string | null;
  timeframe: string;
  macroSentiment: "BULLISH" | "NEUTRAL" | "BEARISH";
  thesis: string;
  trigger: string;
  riskPlan: string;
  idealExecutionPlan: string;
  missedReason: string;
  marketContext: string;
  peerContext: string;
  rating: number | null;
  lessonLearned: string;
  plannedEntry: number | null;
  plannedStop: number | null;
  plannedTarget1: number | null;
  plannedTarget2: number | null;
  plannedTarget3: number | null;
  invalidationLevel: number | null;
  expectedR: number | null;
  actualTriggerAt: string | null;
  followThroughDays: number | null;
  mfeR: number | null;
  maeR: number | null;
  bestExitR: number | null;
  outcomeStatus: Outcome;
  outcomeNotes: string;
  confidenceScore: number | null;
  planClarityScore: number | null;
  preparationScore: number | null;
  patienceScore: number | null;
  ruleAdherenceScore: number | null;
  emotionalState: string | null;
  wouldTakeAgain: boolean | null;
  marketRegime: MarketRegime;
  spyTrend: Trend;
  qqqTrend: Trend;
  iwmTrend: Trend;
  sectorTrend: Trend;
  sectorEtf: string | null;
  breadthNotes: string;
  catalystNotes: string;
  relativeStrengthNotes: string;
  tags: TagsByCategory;
  charts: JournalChart[];
  ruleChecks: RuleCheck[];
  contextSnapshots: Array<{ id: string; provider: string; kind: string; payloadJson: string; createdAt: string }>;
  links: Array<{ id: string; linkType: string; targetType: string; targetId: string | null; url: string | null; label: string | null }>;
  createdAt: string;
  updatedAt: string;
};

type JournalTagRow = { tagId?: string; name: string; category: JournalTagCategoryValue; count: number };

type JournalReviewAction = {
  id?: string;
  label: string;
  status: "OPEN" | "DONE" | "ARCHIVED";
  journalEntryId: string | null;
  playbookId: string | null;
  dueDate: string | null;
};

type JournalReview = {
  id: string;
  period: "DAILY" | "WEEKLY" | "MONTHLY";
  startDate: string;
  endDate: string;
  summary: string;
  bestIdea: string;
  bestIdeaEntryId: string | null;
  worstMiss: string;
  worstMissEntryId: string | null;
  recurringLesson: string;
  nextFocus: string;
  actions: JournalReviewAction[];
  createdAt: string;
  updatedAt: string;
};

type JournalAnalytics = {
  totals: {
    entries: number;
    reviewed: number;
    withCharts: number;
    triggerRate: number;
    workedWithoutMeRate: number;
    failedAfterTriggerRate: number;
    avgMfeR: number | null;
    avgMaeR: number | null;
    avgBestExitR: number | null;
  };
  byStatus: Array<{ name: string; count: number }>;
  byOutcome: Array<{ name: string; count: number }>;
  bySetup: Array<{ name: string; count: number }>;
  byPlaybook: Array<{ name: string; count: number }>;
  byMarketRegime: Array<{ name: string; count: number }>;
  byMacroSentiment: Array<{ name: string; count: number }>;
  lessonTags: JournalTagRow[];
  mistakeTags: JournalTagRow[];
  newSetupCandidates: Array<{ id: string; symbol: string; setup: string | null; bestExitR: number | null; mfeR: number | null; chartCount: number }>;
  recurringRuleFailures: Array<{ name: string; count: number }>;
  opportunityRank: Array<{ id: string; symbol: string; setup: string | null; playbook: string | null; bestExitR: number | null; mfeR: number | null; outcomeStatus: string }>;
};

type Tab = "dashboard" | "ideas" | "entry" | "playbooks" | "visual" | "reviews";

const emptyTags = (): TagsByCategory => ({ SETUP: [], LESSON: [], MISTAKE: [], CONTEXT: [], CUSTOM: [] });
const emptyRule = (sortOrder: number): JournalPlaybookRule => ({ text: "", category: "SETUP", required: true, sortOrder });
const emptyAction = (): JournalReviewAction => ({ label: "", status: "OPEN", journalEntryId: null, playbookId: null, dueDate: null });

function blankForm(): Omit<JournalEntry, "id" | "playbook" | "charts" | "ruleChecks" | "contextSnapshots" | "links" | "createdAt" | "updatedAt"> {
  return {
    symbol: "",
    ideaDate: new Date().toISOString(),
    direction: "LONG",
    status: "DRAFT",
    playbookId: null,
    setup: "",
    timeframe: "1D",
    macroSentiment: "NEUTRAL",
    thesis: "",
    trigger: "",
    riskPlan: "",
    idealExecutionPlan: "",
    missedReason: "",
    marketContext: "",
    peerContext: "",
    rating: null,
    lessonLearned: "",
    plannedEntry: null,
    plannedStop: null,
    plannedTarget1: null,
    plannedTarget2: null,
    plannedTarget3: null,
    invalidationLevel: null,
    expectedR: null,
    actualTriggerAt: null,
    followThroughDays: null,
    mfeR: null,
    maeR: null,
    bestExitR: null,
    outcomeStatus: "UNREVIEWED",
    outcomeNotes: "",
    confidenceScore: null,
    planClarityScore: null,
    preparationScore: null,
    patienceScore: null,
    ruleAdherenceScore: null,
    emotionalState: "",
    wouldTakeAgain: null,
    marketRegime: "UNKNOWN",
    spyTrend: "UNKNOWN",
    qqqTrend: "UNKNOWN",
    iwmTrend: "UNKNOWN",
    sectorTrend: "UNKNOWN",
    sectorEtf: "",
    breadthNotes: "",
    catalystNotes: "",
    relativeStrengthNotes: "",
    tags: emptyTags(),
  };
}

function blankPlaybookForm(): Omit<JournalPlaybook, "id" | "_count"> {
  return {
    name: "",
    setupType: "",
    description: "",
    idealConditions: "",
    invalidationRules: "",
    marketRegimeFit: "",
    archived: false,
    rules: [emptyRule(0)],
  };
}

function blankReviewForm(): Omit<JournalReview, "id" | "createdAt" | "updatedAt"> {
  const today = new Date().toISOString();
  return {
    period: "WEEKLY",
    startDate: today,
    endDate: today,
    summary: "",
    bestIdea: "",
    bestIdeaEntryId: null,
    worstMiss: "",
    worstMissEntryId: null,
    recurringLesson: "",
    nextFocus: "",
    actions: [emptyAction()],
  };
}

function dateInputValue(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "";
}

function datetimeInputValue(value: string | null | undefined) {
  return value ? value.slice(0, 16) : "";
}

function datetimeFromInput(value: string) {
  return value ? new Date(value).toISOString() : null;
}

function tagString(values: string[]) {
  return values.map((value) => `#${value}`).join(", ");
}

function parseTagInput(value: string) {
  return normalizeJournalTags(value.split(/[,\n\s]+/));
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatR(value: number | null | undefined) {
  return typeof value === "number" ? `${value.toFixed(2)}R` : "-";
}

function coerceTimeframe(value: string): JournalTimeframe {
  return JOURNAL_TIMEFRAMES.includes(value as JournalTimeframe) ? (value as JournalTimeframe) : "1D";
}

function statusTone(status: JournalEntry["status"]) {
  if (status === "PLAYBOOK") return "success";
  if (status === "INVALIDATED" || status === "MISSED") return "danger";
  return "outline";
}

function outcomeTone(status: Outcome) {
  if (status === "WORKED_WITHOUT_ME" || status === "TRIGGERED") return "success";
  if (status === "FAILED") return "danger";
  return "outline";
}

function compactLabel(value: string) {
  return value.replaceAll("_", " ");
}

function normalizeNumberInput(value: string) {
  if (!value.trim()) return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function sectionTitle(title: string, detail?: string) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <p className="text-sm font-semibold text-slate-950">{title}</p>
      {detail ? <p className="text-xs text-slate-500">{detail}</p> : null}
    </div>
  );
}

export function JournalWorkspace({
  initialAnalytics,
  initialEntries,
  initialPlaybooks,
  initialReviews,
  initialTags,
}: {
  initialAnalytics: JournalAnalytics;
  initialEntries: JournalEntry[];
  initialPlaybooks: JournalPlaybook[];
  initialReviews: JournalReview[];
  initialTags: JournalTagRow[];
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [tagRows, setTagRows] = useState(initialTags);
  const [playbooks, setPlaybooks] = useState(initialPlaybooks);
  const [reviews, setReviews] = useState(initialReviews);
  const [analytics, setAnalytics] = useState(initialAnalytics);
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [form, setForm] = useState(blankForm());
  const [playbookForm, setPlaybookForm] = useState(blankPlaybookForm());
  const [reviewForm, setReviewForm] = useState(blankReviewForm());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedPlaybookId, setSelectedPlaybookId] = useState<string | null>(null);
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const [ruleDrafts, setRuleDrafts] = useState<Record<string, { status: "PASS" | "FAIL" | "NA"; notes: string }>>({});
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [filterCategory, setFilterCategory] = useState<JournalTagCategoryValue | "">("");
  const [filterSentiment, setFilterSentiment] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterOutcome, setFilterOutcome] = useState("");
  const [filterRegime, setFilterRegime] = useState("");
  const [filterPlaybook, setFilterPlaybook] = useState("");
  const [filterChart, setFilterChart] = useState("");
  const [marketContext, setMarketContext] = useState<{
    peerGroupsUrl: string;
    metrics?: { rows?: Array<{ ticker: string; change1d: number | null; price: number | null; marketCap: number | null }> };
    detail?: { groups?: Array<{ id: string; name: string; members: Array<{ ticker: string; name: string | null }> }> };
    errors?: string[];
  } | null>(null);
  const [pending, startTransition] = useTransition();

  const selectedEntry = useMemo(() => entries.find((entry) => entry.id === selectedId) ?? null, [entries, selectedId]);
  const selectedPlaybook = useMemo(() => playbooks.find((playbook) => playbook.id === (form.playbookId || selectedPlaybookId)) ?? null, [form.playbookId, playbooks, selectedPlaybookId]);
  const chartRows = useMemo(() => entries.flatMap((entry) => entry.charts.map((chart) => ({ entry, chart }))), [entries]);

  useEffect(() => {
    if (!selectedPlaybook) {
      setRuleDrafts({});
      return;
    }
    const existing = new Map((selectedEntry?.ruleChecks ?? []).map((check) => [check.playbookRuleId, check]));
    setRuleDrafts(
      Object.fromEntries(
        selectedPlaybook.rules.map((rule) => {
          const check = rule.id ? existing.get(rule.id) : null;
          return [rule.id ?? rule.text, { status: check?.status ?? "NA", notes: check?.notes ?? "" }];
        }),
      ),
    );
  }, [selectedEntry, selectedPlaybook]);

  function selectEntry(entry: JournalEntry) {
    setSelectedId(entry.id);
    setForm({
      symbol: entry.symbol,
      ideaDate: entry.ideaDate,
      direction: entry.direction,
      status: entry.status,
      playbookId: entry.playbookId,
      setup: entry.setup ?? "",
      timeframe: entry.timeframe,
      macroSentiment: entry.macroSentiment,
      thesis: entry.thesis,
      trigger: entry.trigger,
      riskPlan: entry.riskPlan,
      idealExecutionPlan: entry.idealExecutionPlan,
      missedReason: entry.missedReason,
      marketContext: entry.marketContext,
      peerContext: entry.peerContext,
      rating: entry.rating,
      lessonLearned: entry.lessonLearned,
      plannedEntry: entry.plannedEntry,
      plannedStop: entry.plannedStop,
      plannedTarget1: entry.plannedTarget1,
      plannedTarget2: entry.plannedTarget2,
      plannedTarget3: entry.plannedTarget3,
      invalidationLevel: entry.invalidationLevel,
      expectedR: entry.expectedR,
      actualTriggerAt: entry.actualTriggerAt,
      followThroughDays: entry.followThroughDays,
      mfeR: entry.mfeR,
      maeR: entry.maeR,
      bestExitR: entry.bestExitR,
      outcomeStatus: entry.outcomeStatus,
      outcomeNotes: entry.outcomeNotes,
      confidenceScore: entry.confidenceScore,
      planClarityScore: entry.planClarityScore,
      preparationScore: entry.preparationScore,
      patienceScore: entry.patienceScore,
      ruleAdherenceScore: entry.ruleAdherenceScore,
      emotionalState: entry.emotionalState ?? "",
      wouldTakeAgain: entry.wouldTakeAgain,
      marketRegime: entry.marketRegime,
      spyTrend: entry.spyTrend,
      qqqTrend: entry.qqqTrend,
      iwmTrend: entry.iwmTrend,
      sectorTrend: entry.sectorTrend,
      sectorEtf: entry.sectorEtf ?? "",
      breadthNotes: entry.breadthNotes,
      catalystNotes: entry.catalystNotes,
      relativeStrengthNotes: entry.relativeStrengthNotes,
      tags: entry.tags,
    });
    setMarketContext(null);
    setActiveTab("entry");
  }

  function newEntry() {
    setSelectedId(null);
    setForm(blankForm());
    setMarketContext(null);
    setRuleDrafts({});
    setActiveTab("entry");
  }

  function selectPlaybook(playbook: JournalPlaybook) {
    setSelectedPlaybookId(playbook.id);
    setPlaybookForm({
      name: playbook.name,
      setupType: playbook.setupType ?? "",
      description: playbook.description,
      idealConditions: playbook.idealConditions,
      invalidationRules: playbook.invalidationRules,
      marketRegimeFit: playbook.marketRegimeFit,
      archived: playbook.archived,
      rules: playbook.rules.length ? playbook.rules : [emptyRule(0)],
    });
    setActiveTab("playbooks");
  }

  function newPlaybook() {
    setSelectedPlaybookId(null);
    setPlaybookForm(blankPlaybookForm());
    setActiveTab("playbooks");
  }

  function selectReview(review: JournalReview) {
    setSelectedReviewId(review.id);
    setReviewForm({
      period: review.period,
      startDate: review.startDate,
      endDate: review.endDate,
      summary: review.summary,
      bestIdea: review.bestIdea,
      bestIdeaEntryId: review.bestIdeaEntryId,
      worstMiss: review.worstMiss,
      worstMissEntryId: review.worstMissEntryId,
      recurringLesson: review.recurringLesson,
      nextFocus: review.nextFocus,
      actions: review.actions.length ? review.actions : [emptyAction()],
    });
    setActiveTab("reviews");
  }

  function updateTags(category: JournalTagCategoryValue, value: string) {
    setForm((current) => ({ ...current, tags: { ...current.tags, [category]: parseTagInput(value) } }));
  }

  function setNumberField<K extends keyof typeof form>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: normalizeNumberInput(value) }));
  }

  async function reloadEntries(overrides?: {
    q?: string;
    tag?: string;
    category?: JournalTagCategoryValue | "";
    macroSentiment?: string;
    status?: string;
    outcomeStatus?: string;
    marketRegime?: string;
    playbookId?: string;
    chartFilter?: string;
  }) {
    const params = new URLSearchParams();
    const nextQuery = overrides?.q ?? query;
    const nextTag = overrides?.tag ?? filterTag;
    const nextCategory = overrides?.category ?? filterCategory;
    const nextSentiment = overrides?.macroSentiment ?? filterSentiment;
    const nextStatus = overrides?.status ?? filterStatus;
    const nextOutcome = overrides?.outcomeStatus ?? filterOutcome;
    const nextRegime = overrides?.marketRegime ?? filterRegime;
    const nextPlaybook = overrides?.playbookId ?? filterPlaybook;
    const nextChartFilter = overrides?.chartFilter ?? filterChart;
    if (nextQuery) params.set("q", nextQuery);
    if (nextTag) params.set("tag", nextTag);
    if (nextCategory) params.set("category", nextCategory);
    if (nextSentiment) params.set("macroSentiment", nextSentiment);
    if (nextStatus) params.set("status", nextStatus);
    if (nextOutcome) params.set("outcomeStatus", nextOutcome);
    if (nextRegime) params.set("marketRegime", nextRegime);
    if (nextPlaybook) params.set("playbookId", nextPlaybook);
    if (nextChartFilter) params.set("chartFilter", nextChartFilter);
    params.set("limit", "100");
    const [entryRes, tagRes, analyticsRes] = await Promise.all([
      fetch(`/api/journal?${params.toString()}`),
      fetch("/api/journal/tags"),
      fetch("/api/journal/analytics"),
    ]);
    if (!entryRes.ok) throw new Error("Failed to load journal entries.");
    const entryData = await entryRes.json();
    const tagData = tagRes.ok ? await tagRes.json() : { rows: tagRows };
    const analyticsData = analyticsRes.ok ? await analyticsRes.json() : { analytics };
    setEntries(entryData.rows ?? []);
    setTagRows(tagData.rows ?? []);
    setAnalytics(analyticsData.analytics ?? analytics);
  }

  async function reloadPlaybooks() {
    const res = await fetch("/api/journal/playbooks?includeArchived=true");
    if (!res.ok) throw new Error("Failed to load playbooks.");
    const data = await res.json();
    setPlaybooks(data.rows ?? []);
  }

  function saveEntry() {
    startTransition(async () => {
      try {
        setMessage("Saving journal entry...");
        const payload = {
          ...form,
          ideaDate: dateInputValue(form.ideaDate),
          actualTriggerAt: form.actualTriggerAt,
          symbol: form.symbol.trim().toUpperCase(),
          playbookId: form.playbookId || null,
          sectorEtf: form.sectorEtf ? form.sectorEtf.trim().toUpperCase() : null,
          setup: form.setup || null,
          emotionalState: form.emotionalState || null,
        };
        const res = await fetch(selectedId ? `/api/journal/${selectedId}` : "/api/journal", {
          method: selectedId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Failed to save journal entry.");
        const data = await res.json();
        const saved = data.entry as JournalEntry;
        setSelectedId(saved.id);
        setEntries((current) => [saved, ...current.filter((entry) => entry.id !== saved.id)]);
        await Promise.all([reloadEntries(), reloadPlaybooks()]);
        setMessage("Saved journal entry.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Failed to save journal entry.");
      }
    });
  }

  function saveRuleChecks() {
    if (!selectedId || !selectedPlaybook) return;
    startTransition(async () => {
      try {
        const checks = selectedPlaybook.rules
          .filter((rule) => rule.id)
          .map((rule) => ({
            playbookRuleId: rule.id as string,
            status: ruleDrafts[rule.id as string]?.status ?? "NA",
            notes: ruleDrafts[rule.id as string]?.notes ?? "",
          }));
        const res = await fetch(`/api/journal/${selectedId}/rule-checks`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checks }),
        });
        if (!res.ok) throw new Error("Failed to save rule checks.");
        const data = await res.json();
        const saved = data.entry as JournalEntry;
        setEntries((current) => [saved, ...current.filter((entry) => entry.id !== saved.id)]);
        setMessage("Saved rule checks.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Failed to save rule checks.");
      }
    });
  }

  function deleteEntry() {
    if (!selectedId) return;
    startTransition(async () => {
      try {
        const res = await fetch(`/api/journal/${selectedId}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Failed to delete journal entry.");
        setEntries((current) => current.filter((entry) => entry.id !== selectedId));
        newEntry();
        await reloadEntries().catch(() => undefined);
        setMessage("Deleted journal entry.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Failed to delete journal entry.");
      }
    });
  }

  function savePlaybook() {
    startTransition(async () => {
      try {
        const payload = {
          ...playbookForm,
          setupType: playbookForm.setupType || null,
          rules: playbookForm.rules
            .filter((rule) => rule.text.trim())
            .map((rule, index) => ({ ...rule, sortOrder: index })),
        };
        const res = await fetch(selectedPlaybookId ? `/api/journal/playbooks/${selectedPlaybookId}` : "/api/journal/playbooks", {
          method: selectedPlaybookId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Failed to save playbook.");
        const data = await res.json();
        const saved = data.playbook as JournalPlaybook;
        setSelectedPlaybookId(saved.id);
        setPlaybooks((current) => [saved, ...current.filter((playbook) => playbook.id !== saved.id)].sort((a, b) => a.name.localeCompare(b.name)));
        setMessage("Saved playbook.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Failed to save playbook.");
      }
    });
  }

  function saveReview() {
    startTransition(async () => {
      try {
        const payload = {
          ...reviewForm,
          startDate: dateInputValue(reviewForm.startDate),
          endDate: dateInputValue(reviewForm.endDate),
          actions: reviewForm.actions.filter((action) => action.label.trim()),
        };
        const res = await fetch(selectedReviewId ? `/api/journal/reviews/${selectedReviewId}` : "/api/journal/reviews", {
          method: selectedReviewId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Failed to save review.");
        const data = await res.json();
        const saved = data.review as JournalReview;
        setSelectedReviewId(saved.id);
        setReviews((current) => [saved, ...current.filter((review) => review.id !== saved.id)]);
        setMessage("Saved review.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Failed to save review.");
      }
    });
  }

  function loadMarketContext() {
    if (!form.symbol.trim()) return;
    startTransition(async () => {
      setMessage("Loading market context...");
      const res = await fetch(`/api/journal/market-context?symbol=${encodeURIComponent(form.symbol.trim().toUpperCase())}`);
      if (!res.ok) {
        setMessage("Failed to load market context.");
        return;
      }
      const data = await res.json();
      setMarketContext(data);
      const rows = (data.metrics?.rows ?? []) as Array<{ ticker: string; change1d: number | null }>;
      const leaders = [...rows].sort((a, b) => (b.change1d ?? -999) - (a.change1d ?? -999)).slice(0, 3).map((row) => row.ticker).join(", ");
      const laggards = [...rows].sort((a, b) => (a.change1d ?? 999) - (b.change1d ?? 999)).slice(0, 3).map((row) => row.ticker).join(", ");
      setForm((current) => ({
        ...current,
        peerContext: rows.length > 0 ? `Leaders: ${leaders}. Laggards: ${laggards}.` : current.peerContext,
      }));
      setMessage(data.errors?.length ? data.errors.join(" ") : "Loaded market context.");
    });
  }

  function saveContextSnapshot() {
    if (!selectedId || !marketContext) return;
    startTransition(async () => {
      const res = await fetch(`/api/journal/${selectedId}/context-snapshots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "market-overview", kind: "peer-context", payloadJson: JSON.stringify(marketContext) }),
      });
      setMessage(res.ok ? "Saved context snapshot." : "Failed to save context snapshot.");
      await reloadEntries().catch(() => undefined);
    });
  }

  function saveChartCaption(chart: JournalChart, caption: string) {
    startTransition(async () => {
      const entry = entries.find((row) => row.charts.some((candidate) => candidate.id === chart.id));
      if (!entry) return;
      const res = await fetch(`/api/journal/${entry.id}/charts/${chart.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption }),
      });
      if (res.ok) await reloadEntries();
    });
  }

  function promoteNewSetup(entry: JournalEntry) {
    setSelectedPlaybookId(null);
    setPlaybookForm({
      ...blankPlaybookForm(),
      name: entry.setup || `${entry.symbol} setup`,
      setupType: entry.setup ?? "",
      description: entry.thesis,
      idealConditions: entry.trigger,
      invalidationRules: entry.riskPlan,
      marketRegimeFit: entry.marketRegime === "UNKNOWN" ? "" : compactLabel(entry.marketRegime),
    });
    setActiveTab("playbooks");
  }

  return (
    <div className="space-y-5">
      <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-2 shadow-[0_18px_45px_-34px_rgba(15,23,42,0.32)]">
        <div className="flex flex-wrap gap-2">
          {[
            ["dashboard", "Dashboard", LayoutDashboard],
            ["ideas", "Ideas", NotebookPen],
            ["entry", selectedId ? "Entry" : "New Entry", Save],
            ["playbooks", "Playbooks", BookOpen],
            ["visual", "Visual Review", BarChart3],
            ["reviews", "Reviews", BookOpenCheck],
          ].map(([key, label, Icon]) => (
            <button
              key={key as string}
              className={cn(
                "inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium",
                activeTab === key ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100",
              )}
              onClick={() => setActiveTab(key as Tab)}
              type="button"
            >
              <Icon className="h-4 w-4" />
              {label as string}
            </button>
          ))}
          <Button className="ml-auto" size="sm" onClick={newEntry}>
            <Plus className="h-4 w-4" />
            New Idea
          </Button>
        </div>
      </div>

      {message && (
        <div className="rounded-2xl border border-slate-200/80 bg-white/85 px-4 py-3 text-sm text-slate-600">
          {pending && <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />}
          {message}
        </div>
      )}

      {activeTab === "dashboard" && (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              ["Ideas", analytics.totals.entries],
              ["Reviewed", analytics.totals.reviewed],
              ["With Charts", analytics.totals.withCharts],
              ["Trigger Rate", formatPercent(analytics.totals.triggerRate)],
              ["Worked Without Me", formatPercent(analytics.totals.workedWithoutMeRate)],
              ["Failed", formatPercent(analytics.totals.failedAfterTriggerRate)],
              ["Avg MFE", formatR(analytics.totals.avgMfeR)],
              ["Avg Best Exit", formatR(analytics.totals.avgBestExitR)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-[24px] border border-slate-200/80 bg-white/85 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            <SummaryList title="Setup Health" rows={analytics.bySetup} />
            <SummaryList title="Outcome Mix" rows={analytics.byOutcome} />
            <SummaryList title="Recurring Rule Failures" rows={analytics.recurringRuleFailures} />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-5">
              {sectionTitle("Top Opportunity Cost")}
              <div className="space-y-2">
                {analytics.opportunityRank.map((row) => (
                  <button key={row.id} className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-left text-sm" onClick={() => entries.find((entry) => entry.id === row.id) && selectEntry(entries.find((entry) => entry.id === row.id) as JournalEntry)}>
                    <span className="font-semibold text-slate-900">{row.symbol} {row.setup ? `| ${row.setup}` : ""}</span>
                    <span className="font-mono text-slate-600">{formatR(row.bestExitR ?? row.mfeR)}</span>
                  </button>
                ))}
                {analytics.opportunityRank.length === 0 ? <p className="text-sm text-slate-500">No outcome metrics yet.</p> : null}
              </div>
            </div>
            <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-5">
              {sectionTitle("#new-setup Candidates")}
              <div className="space-y-2">
                {analytics.newSetupCandidates.map((row) => {
                  const entry = entries.find((candidate) => candidate.id === row.id);
                  return (
                    <button key={row.id} className="flex w-full items-center justify-between rounded-2xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-left text-sm" onClick={() => entry && promoteNewSetup(entry)}>
                      <span className="font-semibold text-amber-950">{row.symbol} {row.setup ? `| ${row.setup}` : ""}</span>
                      <span className="font-mono text-amber-800">{formatR(row.bestExitR ?? row.mfeR)}</span>
                    </button>
                  );
                })}
                {analytics.newSetupCandidates.length === 0 ? <p className="text-sm text-slate-500">No #new-setup lesson tags yet.</p> : null}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "ideas" && (
        <div className="space-y-4">
          <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_10rem_10rem_10rem_10rem_10rem_10rem_10rem_auto]">
              <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Search
                <div className="relative mt-1">
                  <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} />
                </div>
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Tag<Input className="mt-1" value={filterTag} onChange={(event) => setFilterTag(event.target.value.replace(/^#+/, ""))} /></label>
              <FilterSelect label="Category" value={filterCategory} onChange={(value) => setFilterCategory(value as JournalTagCategoryValue | "")} options={["", ...JOURNAL_TAG_CATEGORIES]} />
              <FilterSelect label="Status" value={filterStatus} onChange={setFilterStatus} options={["", "DRAFT", "WATCHING", "MISSED", "PASSED", "INVALIDATED", "PLAYBOOK", "ARCHIVED"]} />
              <FilterSelect label="Macro" value={filterSentiment} onChange={setFilterSentiment} options={["", "BULLISH", "NEUTRAL", "BEARISH"]} />
              <FilterSelect label="Outcome" value={filterOutcome} onChange={setFilterOutcome} options={["", ...JOURNAL_OUTCOME_STATUSES]} />
              <FilterSelect label="Regime" value={filterRegime} onChange={setFilterRegime} options={["", ...JOURNAL_MARKET_REGIMES]} />
              <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Playbook
                <Select className="mt-1" value={filterPlaybook} onChange={(event) => setFilterPlaybook(event.target.value)}>
                  <option value="">Any</option>
                  {playbooks.map((playbook) => <option key={playbook.id} value={playbook.id}>{playbook.name}</option>)}
                </Select>
              </label>
              <div className="flex items-end gap-2">
                <Button onClick={() => startTransition(() => void reloadEntries())}><Filter className="h-4 w-4" />Filter</Button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant={filterChart === "" ? "default" : "outline"} onClick={() => { setFilterChart(""); startTransition(() => void reloadEntries({ chartFilter: "" })); }}>All Charts</Button>
              <Button size="sm" variant={filterChart === "WITH_CHARTS" ? "default" : "outline"} onClick={() => { setFilterChart("WITH_CHARTS"); startTransition(() => void reloadEntries({ chartFilter: "WITH_CHARTS" })); }}>With Charts</Button>
              <Button size="sm" variant={filterChart === "WITHOUT_CHARTS" ? "default" : "outline"} onClick={() => { setFilterChart("WITHOUT_CHARTS"); startTransition(() => void reloadEntries({ chartFilter: "WITHOUT_CHARTS" })); }}>No Charts</Button>
            </div>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {entries.map((entry) => (
              <button key={entry.id} className="rounded-[28px] border border-slate-200/80 bg-white/85 p-5 text-left shadow-[0_18px_45px_-36px_rgba(15,23,42,0.32)] hover:border-slate-300" onClick={() => selectEntry(entry)}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xl font-semibold tracking-tight text-slate-950">{entry.symbol}</p>
                      <Badge variant={statusTone(entry.status)}>{entry.status}</Badge>
                      <Badge variant={outcomeTone(entry.outcomeStatus)}>{compactLabel(entry.outcomeStatus)}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{dateInputValue(entry.ideaDate)} | {entry.direction} | {entry.timeframe} | {entry.setup || "No setup"}</p>
                    <p className="mt-1 text-xs text-slate-500">{entry.playbook?.name ?? "No playbook"} | {compactLabel(entry.marketRegime)} | {entry.charts.length} chart{entry.charts.length === 1 ? "" : "s"}</p>
                  </div>
                  <div className="text-right text-sm font-semibold text-slate-700">
                    <p>{entry.rating ? `${entry.rating}/5` : "-"}</p>
                    <p className="font-mono text-xs text-slate-500">{formatR(entry.bestExitR ?? entry.mfeR)}</p>
                  </div>
                </div>
                <p className="mt-4 line-clamp-2 text-sm leading-6 text-slate-600">{entry.thesis || entry.lessonLearned || "No thesis yet."}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {JOURNAL_TAG_CATEGORIES.flatMap((category) => entry.tags[category].map((tag) => (
                    <span key={`${entry.id}-${category}-${tag}`} className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", category === "LESSON" ? "bg-amber-100 text-amber-800" : category === "MISTAKE" ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-700")}>#{tag}</span>
                  )))}
                </div>
              </button>
            ))}
            {entries.length === 0 ? <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-6 text-sm text-slate-500">No journal entries found.</div> : null}
          </div>
        </div>
      )}

      {activeTab === "entry" && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.4fr)]">
          <div className="space-y-4">
            <Panel title="Idea">
              <div className="grid gap-3 sm:grid-cols-2">
                <LabelInput label="Symbol" value={form.symbol} onChange={(value) => setForm((current) => ({ ...current, symbol: value.toUpperCase() }))} />
                <DateField label="Idea Date" value={form.ideaDate} onChange={(value) => setForm((current) => ({ ...current, ideaDate: `${value}T00:00:00.000Z` }))} />
                <SelectField label="Direction" value={form.direction} options={["LONG", "SHORT"]} onChange={(value) => setForm((current) => ({ ...current, direction: value as JournalEntry["direction"] }))} />
                <SelectField label="Status" value={form.status} options={["DRAFT", "WATCHING", "MISSED", "PASSED", "INVALIDATED", "PLAYBOOK", "ARCHIVED"]} onChange={(value) => setForm((current) => ({ ...current, status: value as JournalEntry["status"] }))} />
                <LabelInput label="Setup" value={form.setup ?? ""} onChange={(value) => setForm((current) => ({ ...current, setup: value }))} />
                <SelectField label="Timeframe" value={form.timeframe} options={[...JOURNAL_TIMEFRAMES]} onChange={(value) => setForm((current) => ({ ...current, timeframe: value }))} />
                <SelectField label="Macro Sentiment" value={form.macroSentiment} options={["BULLISH", "NEUTRAL", "BEARISH"]} onChange={(value) => setForm((current) => ({ ...current, macroSentiment: value as JournalEntry["macroSentiment"] }))} />
                <SelectField label="Playbook" value={form.playbookId ?? ""} options={["", ...playbooks.map((playbook) => playbook.id)]} optionLabels={{ "": "No playbook", ...Object.fromEntries(playbooks.map((playbook) => [playbook.id, playbook.name])) }} onChange={(value) => setForm((current) => ({ ...current, playbookId: value || null }))} />
              </div>
              <TextAreaField label="Thesis" value={form.thesis} onChange={(value) => setForm((current) => ({ ...current, thesis: value }))} />
              <TextAreaField label="Trigger" value={form.trigger} onChange={(value) => setForm((current) => ({ ...current, trigger: value }))} />
            </Panel>

            <Panel title="Plan">
              <div className="grid gap-3 sm:grid-cols-4">
                <NumberField label="Entry" value={form.plannedEntry} onChange={(value) => setNumberField("plannedEntry", value)} />
                <NumberField label="Stop" value={form.plannedStop} onChange={(value) => setNumberField("plannedStop", value)} />
                <NumberField label="Target 1" value={form.plannedTarget1} onChange={(value) => setNumberField("plannedTarget1", value)} />
                <NumberField label="Target 2" value={form.plannedTarget2} onChange={(value) => setNumberField("plannedTarget2", value)} />
                <NumberField label="Target 3" value={form.plannedTarget3} onChange={(value) => setNumberField("plannedTarget3", value)} />
                <NumberField label="Invalidation" value={form.invalidationLevel} onChange={(value) => setNumberField("invalidationLevel", value)} />
                <NumberField label="Expected R" value={form.expectedR} onChange={(value) => setNumberField("expectedR", value)} />
                <NumberField label="Follow Days" value={form.followThroughDays} onChange={(value) => setNumberField("followThroughDays", value)} />
              </div>
              <TextAreaField label="Risk Plan" value={form.riskPlan} onChange={(value) => setForm((current) => ({ ...current, riskPlan: value }))} />
              <TextAreaField label="Ideal Execution" value={form.idealExecutionPlan} onChange={(value) => setForm((current) => ({ ...current, idealExecutionPlan: value }))} />
              <TextAreaField label="Missed / No-Trade Reason" value={form.missedReason} onChange={(value) => setForm((current) => ({ ...current, missedReason: value }))} />
            </Panel>

            <Panel title="Context">
              <div className="grid gap-3 sm:grid-cols-3">
                <SelectField label="Market Regime" value={form.marketRegime} options={[...JOURNAL_MARKET_REGIMES]} onChange={(value) => setForm((current) => ({ ...current, marketRegime: value as MarketRegime }))} />
                <SelectField label="SPY Trend" value={form.spyTrend} options={[...JOURNAL_TREND_STATES]} onChange={(value) => setForm((current) => ({ ...current, spyTrend: value as Trend }))} />
                <SelectField label="QQQ Trend" value={form.qqqTrend} options={[...JOURNAL_TREND_STATES]} onChange={(value) => setForm((current) => ({ ...current, qqqTrend: value as Trend }))} />
                <SelectField label="IWM Trend" value={form.iwmTrend} options={[...JOURNAL_TREND_STATES]} onChange={(value) => setForm((current) => ({ ...current, iwmTrend: value as Trend }))} />
                <SelectField label="Sector Trend" value={form.sectorTrend} options={[...JOURNAL_TREND_STATES]} onChange={(value) => setForm((current) => ({ ...current, sectorTrend: value as Trend }))} />
                <LabelInput label="Sector ETF" value={form.sectorEtf ?? ""} onChange={(value) => setForm((current) => ({ ...current, sectorEtf: value.toUpperCase() }))} />
              </div>
              <TextAreaField label="Market Context" value={form.marketContext} onChange={(value) => setForm((current) => ({ ...current, marketContext: value }))} />
              <TextAreaField label="Peer Context" value={form.peerContext} onChange={(value) => setForm((current) => ({ ...current, peerContext: value }))} />
              <TextAreaField label="Breadth Notes" value={form.breadthNotes} onChange={(value) => setForm((current) => ({ ...current, breadthNotes: value }))} />
              <TextAreaField label="Catalyst / News" value={form.catalystNotes} onChange={(value) => setForm((current) => ({ ...current, catalystNotes: value }))} />
              <TextAreaField label="Relative Strength" value={form.relativeStrengthNotes} onChange={(value) => setForm((current) => ({ ...current, relativeStrengthNotes: value }))} />
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="outline" disabled={pending || !form.symbol.trim()} onClick={loadMarketContext}><RefreshCw className="h-4 w-4" />Market Context</Button>
                {selectedId && marketContext ? <Button variant="outline" disabled={pending} onClick={saveContextSnapshot}><BookOpenCheck className="h-4 w-4" />Save Snapshot</Button> : null}
              </div>
            </Panel>

            <Panel title="Psychology">
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ["Confidence", "confidenceScore"],
                  ["Plan Clarity", "planClarityScore"],
                  ["Preparation", "preparationScore"],
                  ["Patience", "patienceScore"],
                  ["Rule Adherence", "ruleAdherenceScore"],
                  ["Rating", "rating"],
                ].map(([label, key]) => (
                  <NumberField key={key} label={label} max={5} min={1} value={form[key as keyof typeof form] as number | null} onChange={(value) => setNumberField(key as keyof typeof form, value)} />
                ))}
                <LabelInput label="Emotional State" value={form.emotionalState ?? ""} onChange={(value) => setForm((current) => ({ ...current, emotionalState: value }))} />
                <SelectField label="Would Take Again" value={form.wouldTakeAgain == null ? "" : form.wouldTakeAgain ? "YES" : "NO"} options={["", "YES", "NO"]} onChange={(value) => setForm((current) => ({ ...current, wouldTakeAgain: value ? value === "YES" : null }))} />
              </div>
              <TextAreaField label="Lesson Learned" value={form.lessonLearned} onChange={(value) => setForm((current) => ({ ...current, lessonLearned: value }))} />
            </Panel>

            <Panel title="Outcome">
              <div className="grid gap-3 sm:grid-cols-4">
                <SelectField label="Outcome" value={form.outcomeStatus} options={[...JOURNAL_OUTCOME_STATUSES]} onChange={(value) => setForm((current) => ({ ...current, outcomeStatus: value as Outcome }))} />
                <DateTimeField label="Trigger Time" value={form.actualTriggerAt} onChange={(value) => setForm((current) => ({ ...current, actualTriggerAt: datetimeFromInput(value) }))} />
                <NumberField label="MFE R" value={form.mfeR} onChange={(value) => setNumberField("mfeR", value)} />
                <NumberField label="MAE R" value={form.maeR} onChange={(value) => setNumberField("maeR", value)} />
                <NumberField label="Best Exit R" value={form.bestExitR} onChange={(value) => setNumberField("bestExitR", value)} />
              </div>
              <TextAreaField label="Outcome Notes" value={form.outcomeNotes} onChange={(value) => setForm((current) => ({ ...current, outcomeNotes: value }))} />
            </Panel>

            <Panel title="Tags">
              <div className="grid gap-3 sm:grid-cols-2">
                {JOURNAL_TAG_CATEGORIES.map((category) => (
                  <LabelInput key={category} label={category === "LESSON" ? "Lesson Tags" : `${category} Tags`} value={tagString(form.tags[category])} onChange={(value) => updateTags(category, value)} />
                ))}
              </div>
            </Panel>

            <div className="flex flex-wrap gap-2">
              <Button disabled={pending || !form.symbol.trim()} onClick={saveEntry}><Save className="h-4 w-4" />Save Entry</Button>
              {selectedId ? <Button variant="destructive" disabled={pending} onClick={deleteEntry}><Trash2 className="h-4 w-4" />Delete</Button> : null}
            </div>

            {marketContext ? (
              <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">Peer Group Context</p>
                    <p className="mt-1 text-sm text-slate-500">{marketContext.detail?.groups?.[0]?.name ?? "No peer group loaded"}</p>
                  </div>
                  <a className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50" href={marketContext.peerGroupsUrl} target="_blank" rel="noreferrer">
                    <LinkIcon className="h-3.5 w-3.5" /> Peer Groups
                  </a>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {(marketContext.metrics?.rows ?? []).slice(0, 12).map((row) => (
                    <div key={row.ticker} className="rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm">
                      <span className="font-semibold text-slate-900">{row.ticker}</span>
                      <span className={cn("float-right font-medium", (row.change1d ?? 0) < 0 ? "text-red-600" : "text-emerald-600")}>
                        {row.change1d == null ? "-" : `${row.change1d >= 0 ? "+" : ""}${row.change1d.toFixed(2)}%`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-4">
            {selectedEntry ? (
              <>
                <Panel title="Rule Checklist" detail={selectedPlaybook?.name ?? "No playbook selected"}>
                  {selectedPlaybook?.rules.length ? (
                    <div className="space-y-3">
                      {selectedPlaybook.rules.map((rule) => (
                        <div key={rule.id ?? rule.text} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="text-sm font-medium text-slate-900">{rule.text}</p>
                            <div className="flex gap-1">
                              {JOURNAL_RULE_CHECK_STATUSES.map((status) => (
                                <Button key={status} size="sm" variant={ruleDrafts[rule.id ?? rule.text]?.status === status ? "default" : "outline"} onClick={() => setRuleDrafts((current) => ({ ...current, [rule.id ?? rule.text]: { ...current[rule.id ?? rule.text], status } }))}>{status}</Button>
                              ))}
                            </div>
                          </div>
                          <Input className="mt-2" value={ruleDrafts[rule.id ?? rule.text]?.notes ?? ""} onChange={(event) => setRuleDrafts((current) => ({ ...current, [rule.id ?? rule.text]: { status: current[rule.id ?? rule.text]?.status ?? "NA", notes: event.target.value } }))} placeholder="Rule notes" />
                        </div>
                      ))}
                      <Button size="sm" onClick={saveRuleChecks}><CheckCircle2 className="h-4 w-4" />Save Rule Checks</Button>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">Attach a playbook with rules to score this idea.</p>
                  )}
                </Panel>

                <Panel title="Chart Capture">
                  <JournalChartEditor entryId={selectedEntry.id} symbol={selectedEntry.symbol} initialTimeframe={coerceTimeframe(selectedEntry.timeframe)} sectorEtf={selectedEntry.sectorEtf} onSaved={() => void reloadEntries()} />
                </Panel>
                <div className="grid gap-4 lg:grid-cols-2">
                  {selectedEntry.charts.map((chart) => (
                    <div key={chart.id} className="rounded-[24px] border border-slate-200/80 bg-white/85 p-3">
                      {chart.screenshotUrl ? <img src={chart.screenshotUrl} alt={`${chart.symbol} saved chart`} className="aspect-[16/10] w-full rounded-2xl object-cover" /> : <div className="aspect-[16/10] rounded-2xl bg-slate-100" />}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{compactLabel(chart.purpose)}</Badge>
                        <Badge variant="outline">{chart.timeframe}</Badge>
                        {chart.compareSymbol ? <Badge variant="outline">vs {chart.compareSymbol}</Badge> : null}
                      </div>
                      <Textarea className="mt-3 min-h-20" defaultValue={chart.caption} onBlur={(event) => saveChartCaption(chart, event.currentTarget.value)} />
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-6 text-sm text-slate-500">Save the journal entry before adding charts.</div>
            )}
          </div>
        </div>
      )}

      {activeTab === "playbooks" && (
        <div className="grid gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
          <div className="space-y-3">
            <Button className="w-full" onClick={newPlaybook}><Plus className="h-4 w-4" />New Playbook</Button>
            {playbooks.map((playbook) => (
              <button key={playbook.id} className={cn("w-full rounded-[22px] border p-4 text-left", selectedPlaybookId === playbook.id ? "border-slate-950 bg-white" : "border-slate-200 bg-white/80")} onClick={() => selectPlaybook(playbook)}>
                <p className="font-semibold text-slate-950">{playbook.name}</p>
                <p className="mt-1 text-sm text-slate-500">{playbook.setupType || "General"} | {playbook.rules.length} rules | {playbook._count?.entries ?? 0} ideas</p>
              </button>
            ))}
          </div>
          <Panel title={selectedPlaybookId ? "Edit Playbook" : "New Playbook"}>
            <div className="grid gap-3 sm:grid-cols-2">
              <LabelInput label="Name" value={playbookForm.name} onChange={(value) => setPlaybookForm((current) => ({ ...current, name: value }))} />
              <LabelInput label="Setup Type" value={playbookForm.setupType ?? ""} onChange={(value) => setPlaybookForm((current) => ({ ...current, setupType: value }))} />
            </div>
            <TextAreaField label="Description" value={playbookForm.description} onChange={(value) => setPlaybookForm((current) => ({ ...current, description: value }))} />
            <TextAreaField label="Ideal Conditions" value={playbookForm.idealConditions} onChange={(value) => setPlaybookForm((current) => ({ ...current, idealConditions: value }))} />
            <TextAreaField label="Invalidation Rules" value={playbookForm.invalidationRules} onChange={(value) => setPlaybookForm((current) => ({ ...current, invalidationRules: value }))} />
            <TextAreaField label="Market Regime Fit" value={playbookForm.marketRegimeFit} onChange={(value) => setPlaybookForm((current) => ({ ...current, marketRegimeFit: value }))} />
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-950">Rules</p>
                <Button size="sm" variant="outline" onClick={() => setPlaybookForm((current) => ({ ...current, rules: [...current.rules, emptyRule(current.rules.length)] }))}><Plus className="h-4 w-4" />Rule</Button>
              </div>
              {playbookForm.rules.map((rule, index) => (
                <div key={rule.id ?? index} className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-3 sm:grid-cols-[minmax(0,1fr)_8rem_6rem_auto]">
                  <Input value={rule.text} onChange={(event) => setPlaybookForm((current) => ({ ...current, rules: current.rules.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, text: event.target.value } : candidate) }))} />
                  <Input value={rule.category} onChange={(event) => setPlaybookForm((current) => ({ ...current, rules: current.rules.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, category: event.target.value } : candidate) }))} />
                  <Select value={rule.required ? "required" : "optional"} onChange={(event) => setPlaybookForm((current) => ({ ...current, rules: current.rules.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, required: event.target.value === "required" } : candidate) }))}>
                    <option value="required">Required</option>
                    <option value="optional">Optional</option>
                  </Select>
                  <Button size="sm" variant="outline" onClick={() => setPlaybookForm((current) => ({ ...current, rules: current.rules.filter((_, candidateIndex) => candidateIndex !== index) }))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button disabled={!playbookForm.name.trim()} onClick={savePlaybook}><Save className="h-4 w-4" />Save Playbook</Button>
              <Button variant="outline" onClick={() => setPlaybookForm((current) => ({ ...current, archived: !current.archived }))}>{playbookForm.archived ? "Restore" : "Archive"}</Button>
            </div>
          </Panel>
        </div>
      )}

      {activeTab === "visual" && (
        <div className="space-y-4">
          <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Tags className="h-4 w-4 text-slate-500" />
              {tagRows.map((row) => (
                <button key={`${row.category}-${row.name}`} className={cn("rounded-full px-3 py-1.5 text-xs font-medium", row.category === "LESSON" ? "bg-amber-100 text-amber-800" : row.category === "MISTAKE" ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-700")} onClick={() => { setFilterTag(row.name); setFilterCategory(row.category); setActiveTab("ideas"); startTransition(() => void reloadEntries({ tag: row.name, category: row.category })); }}>
                  #{row.name} {row.count}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {chartRows.map(({ entry, chart }) => (
              <button key={chart.id} className="rounded-[24px] border border-slate-200/80 bg-white/85 p-3 text-left hover:border-slate-300" onClick={() => selectEntry(entry)}>
                {chart.screenshotUrl ? <img src={chart.screenshotUrl} alt={`${entry.symbol} visual review`} className="aspect-[16/10] w-full rounded-2xl object-cover" /> : <div className="aspect-[16/10] rounded-2xl bg-slate-100" />}
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-950">{entry.symbol}</p>
                    <p className="text-xs text-slate-500">{chart.timeframe} | {compactLabel(chart.purpose)} | {dateInputValue(entry.ideaDate)}</p>
                  </div>
                  <Badge variant={outcomeTone(entry.outcomeStatus)}>{compactLabel(entry.outcomeStatus)}</Badge>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-slate-600">{chart.caption || entry.lessonLearned || entry.thesis}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {activeTab === "reviews" && (
        <div className="grid gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
          <div className="space-y-3">
            <Button className="w-full" onClick={() => { setSelectedReviewId(null); setReviewForm(blankReviewForm()); }}><Plus className="h-4 w-4" />New Review</Button>
            {reviews.map((review) => (
              <button key={review.id} className={cn("w-full rounded-[22px] border p-4 text-left", selectedReviewId === review.id ? "border-slate-950 bg-white" : "border-slate-200 bg-white/80")} onClick={() => selectReview(review)}>
                <p className="font-semibold text-slate-950">{review.period} Review</p>
                <p className="mt-1 text-sm text-slate-500">{dateInputValue(review.startDate)} to {dateInputValue(review.endDate)}</p>
              </button>
            ))}
          </div>
          <Panel title={selectedReviewId ? "Edit Review" : "New Review"}>
            <div className="grid gap-3 sm:grid-cols-3">
              <SelectField label="Period" value={reviewForm.period} options={[...JOURNAL_REVIEW_PERIODS]} onChange={(value) => setReviewForm((current) => ({ ...current, period: value as JournalReview["period"] }))} />
              <DateField label="Start" value={reviewForm.startDate} onChange={(value) => setReviewForm((current) => ({ ...current, startDate: `${value}T00:00:00.000Z` }))} />
              <DateField label="End" value={reviewForm.endDate} onChange={(value) => setReviewForm((current) => ({ ...current, endDate: `${value}T00:00:00.000Z` }))} />
            </div>
            <TextAreaField label="Summary" value={reviewForm.summary} onChange={(value) => setReviewForm((current) => ({ ...current, summary: value }))} />
            <TextAreaField label="Best Idea" value={reviewForm.bestIdea} onChange={(value) => setReviewForm((current) => ({ ...current, bestIdea: value }))} />
            <TextAreaField label="Worst Miss" value={reviewForm.worstMiss} onChange={(value) => setReviewForm((current) => ({ ...current, worstMiss: value }))} />
            <TextAreaField label="Recurring Lesson" value={reviewForm.recurringLesson} onChange={(value) => setReviewForm((current) => ({ ...current, recurringLesson: value }))} />
            <TextAreaField label="Next Focus" value={reviewForm.nextFocus} onChange={(value) => setReviewForm((current) => ({ ...current, nextFocus: value }))} />
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-950">Action Items</p>
                <Button size="sm" variant="outline" onClick={() => setReviewForm((current) => ({ ...current, actions: [...current.actions, emptyAction()] }))}><Plus className="h-4 w-4" />Action</Button>
              </div>
              {reviewForm.actions.map((action, index) => (
                <div key={action.id ?? index} className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
                  <Input value={action.label} onChange={(event) => setReviewForm((current) => ({ ...current, actions: current.actions.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, label: event.target.value } : candidate) }))} />
                  <Select value={action.status} onChange={(event) => setReviewForm((current) => ({ ...current, actions: current.actions.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, status: event.target.value as JournalReviewAction["status"] } : candidate) }))}>
                    <option value="OPEN">Open</option>
                    <option value="DONE">Done</option>
                    <option value="ARCHIVED">Archived</option>
                  </Select>
                  <Button size="sm" variant="outline" onClick={() => setReviewForm((current) => ({ ...current, actions: current.actions.filter((_, candidateIndex) => candidateIndex !== index) }))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
            <Button className="mt-5" onClick={saveReview}><Save className="h-4 w-4" />Save Review</Button>
          </Panel>
        </div>
      )}
    </div>
  );
}

function Panel({ children, detail, title }: { children: ReactNode; detail?: string; title: string }) {
  return (
    <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-5">
      {sectionTitle(title, detail)}
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function SummaryList({ rows, title }: { rows: Array<{ name: string; count: number }>; title: string }) {
  return (
    <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-5">
      {sectionTitle(title)}
      <div className="space-y-2">
        {rows.slice(0, 8).map((row) => (
          <div key={row.name} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm">
            <span className="font-medium text-slate-800">{compactLabel(row.name)}</span>
            <span className="font-mono text-slate-500">{row.count}</span>
          </div>
        ))}
        {rows.length === 0 ? <p className="text-sm text-slate-500">No data yet.</p> : null}
      </div>
    </div>
  );
}

function LabelInput({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
      {label}
      <Input className="mt-1" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function NumberField({ label, max, min, onChange, value }: { label: string; max?: number; min?: number; onChange: (value: string) => void; value: number | null }) {
  return (
    <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
      {label}
      <Input className="mt-1" max={max} min={min} type="number" value={value ?? ""} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function DateField({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string | null }) {
  return (
    <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
      {label}
      <Input className="mt-1" type="date" value={dateInputValue(value)} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function DateTimeField({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string | null }) {
  return (
    <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
      {label}
      <Input className="mt-1" type="datetime-local" value={datetimeInputValue(value)} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SelectField({
  label,
  onChange,
  optionLabels,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  optionLabels?: Record<string, string>;
  options: string[];
  value: string;
}) {
  return (
    <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
      {label}
      <Select className="mt-1" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>{optionLabels?.[option] ?? compactLabel(option || "Any")}</option>
        ))}
      </Select>
    </label>
  );
}

function FilterSelect({ label, onChange, options, value }: { label: string; onChange: (value: string) => void; options: readonly string[]; value: string }) {
  return <SelectField label={label} value={value} options={[...options]} onChange={onChange} />;
}

function TextAreaField({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
      {label}
      <Textarea className="mt-1" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

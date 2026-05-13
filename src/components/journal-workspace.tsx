"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { ReactNode } from "react";
import {
  BarChart3,
  BookOpen,
  BookOpenCheck,
  CheckCircle2,
  ClipboardList,
  GitCompare,
  Inbox,
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
  Upload,
} from "lucide-react";
import { JournalEntryChartPreview } from "@/components/journal-entry-chart-preview";
import { JournalChartEditor } from "@/components/journal-chart-editor";
import { TradingViewAnalysisReference } from "@/components/tradingview-analysis-reference";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  JOURNAL_MARKET_REGIMES,
  JOURNAL_CHART_PURPOSES,
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

type JournalPlaybookExample = {
  id: string;
  journalEntryId: string;
  chartId: string | null;
  note: string;
  sortOrder: number;
  createdAt: string;
  fitScore: number | null;
  journalEntry: {
    id: string;
    symbol: string;
    setup: string | null;
    outcomeStatus: Outcome;
    bestExitR: number | null;
    mfeR: number | null;
    tags: TagsByCategory;
  };
  chart: {
    id: string;
    screenshotUrl: string | null;
    caption: string;
    purpose: JournalChartPurposeValue;
    timeframe: string;
  } | null;
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
  examples?: JournalPlaybookExample[];
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
  autoDraft: boolean;
  reviewDueAt: string | null;
  outcomeCalculatedAt: string | null;
  outcomeCalculationJson: string | null;
  tags: TagsByCategory;
  charts: JournalChart[];
  ruleChecks: RuleCheck[];
  contextSnapshots: Array<{ id: string; provider: string; kind: string; payloadJson: string; createdAt: string }>;
  links: Array<{ id: string; linkType: string; targetType: string; targetId: string | null; url: string | null; label: string | null }>;
  createdAt: string;
  updatedAt: string;
};

type JournalTagRow = { tagId?: string; name: string; category: JournalTagCategoryValue; count: number };
type JournalSavedView = { id: string; name: string; viewType: "IDEAS" | "VISUAL"; filtersJson: string; sortKey: string | null; sortDirection: "asc" | "desc"; createdAt: string; updatedAt: string };

type JournalInbox = {
  dueReview: JournalEntry[];
  missingPlan: JournalEntry[];
  missingChart: JournalEntry[];
  triggeredUnreviewed: JournalEntry[];
  workedWithoutMe: JournalEntry[];
  newSetupCandidates: JournalEntry[];
  openReviewActions: Array<JournalReviewAction & { reviewId: string; reviewPeriod: string; reviewRange: string }>;
};

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
    missingPlan: number;
    dueReview: number;
    chartCoverage: number;
    avgFitScore: number | null;
  };
  byStatus: Array<{ name: string; count: number }>;
  byOutcome: Array<{ name: string; count: number }>;
  bySetup: Array<{ name: string; count: number }>;
  byPlaybook: Array<{ name: string; count: number }>;
  byMarketRegime: Array<{ name: string; count: number }>;
  byMacroSentiment: Array<{ name: string; count: number }>;
  byFitScore: Array<{ name: string; count: number }>;
  lessonTags: JournalTagRow[];
  mistakeTags: JournalTagRow[];
  tagPerformance: Array<JournalTagRow & { reviewed: number; chartCount: number; avgMfeR: number | null; avgMaeR: number | null; avgBestExitR: number | null }>;
  newSetupCandidates: Array<{ id: string; symbol: string; setup: string | null; bestExitR: number | null; mfeR: number | null; chartCount: number }>;
  recurringRuleFailures: Array<{ name: string; count: number }>;
  opportunityRank: Array<{ id: string; symbol: string; setup: string | null; playbook: string | null; bestExitR: number | null; mfeR: number | null; outcomeStatus: string }>;
};

type Tab = "dashboard" | "capture" | "inbox" | "ideas" | "entry" | "playbooks" | "visual" | "tags" | "reviews";
type EntrySection = "basics" | "plan" | "thesis" | "context" | "review" | "tags";
type ChartPreviewRequest = { symbol: string; requestKey: number };

const ENTRY_SECTIONS: Array<{ key: EntrySection; label: string }> = [
  { key: "basics", label: "Basics" },
  { key: "plan", label: "Plan" },
  { key: "thesis", label: "Thesis" },
  { key: "context", label: "Context" },
  { key: "review", label: "Review" },
  { key: "tags", label: "Tags" },
];

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
    autoDraft: false,
    reviewDueAt: null,
    outcomeCalculatedAt: null,
    outcomeCalculationJson: null,
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

function fitScore(entry: { ruleChecks: RuleCheck[] }) {
  const applicable = entry.ruleChecks.filter((check) => check.status !== "NA");
  if (!applicable.length) return null;
  const total = applicable.reduce((sum, check) => sum + (check.playbookRule?.required ? 2 : 1), 0);
  const pass = applicable.filter((check) => check.status === "PASS").reduce((sum, check) => sum + (check.playbookRule?.required ? 2 : 1), 0);
  return Math.round((pass / Math.max(1, total)) * 100);
}

function formatFitScore(entry: { ruleChecks: RuleCheck[] }) {
  const score = fitScore(entry);
  return score == null ? "-" : `${score}%`;
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
  const [entrySection, setEntrySection] = useState<EntrySection>("basics");
  const [entryChartHeight, setEntryChartHeight] = useState(680);
  const [chartPreviewRequest, setChartPreviewRequest] = useState<ChartPreviewRequest | null>(null);
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
  const [filterPurpose, setFilterPurpose] = useState("");
  const [filterTimeframe, setFilterTimeframe] = useState("");
  const [minFitScore, setMinFitScore] = useState("");
  const [minBestExitR, setMinBestExitR] = useState("");
  const [savedViews, setSavedViews] = useState<JournalSavedView[]>([]);
  const [savedViewName, setSavedViewName] = useState("");
  const [inboxData, setInboxData] = useState<JournalInbox | null>(null);
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);
  const [selectedChartIds, setSelectedChartIds] = useState<string[]>([]);
  const [bulkTagInput, setBulkTagInput] = useState("");
  const [tagManager, setTagManager] = useState({ category: "LESSON" as JournalTagCategoryValue, from: "", to: "", name: "" });
  const [autosaveState, setAutosaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveReadyRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
  const filteredChartRows = useMemo(() => chartRows.filter(({ entry, chart }) => {
    if (filterPurpose && chart.purpose !== filterPurpose) return false;
    if (filterTimeframe && chart.timeframe !== filterTimeframe) return false;
    const minFit = minFitScore ? Number(minFitScore) : null;
    const score = fitScore(entry);
    if (minFit != null && (score == null || score < minFit)) return false;
    const minR = minBestExitR ? Number(minBestExitR) : null;
    if (minR != null && (entry.bestExitR == null || entry.bestExitR < minR)) return false;
    return true;
  }), [chartRows, filterPurpose, filterTimeframe, minFitScore, minBestExitR]);
  const compareRows = useMemo(() => chartRows.filter((row) => selectedChartIds.includes(row.chart.id)).slice(0, 4), [chartRows, selectedChartIds]);
  const entryEssentials = useMemo(() => [
    { label: "Chart", done: Boolean(selectedEntry?.charts.length) },
    { label: "Entry", done: form.plannedEntry != null },
    { label: "Stop", done: form.plannedStop != null },
    { label: "Thesis", done: Boolean(form.thesis.trim()) },
    { label: "Trigger", done: Boolean(form.trigger.trim()) },
    { label: "Tags", done: JOURNAL_TAG_CATEGORIES.some((category) => form.tags[category].length > 0) },
    { label: "Outcome", done: form.outcomeStatus !== "UNREVIEWED" },
  ], [form.outcomeStatus, form.plannedEntry, form.plannedStop, form.tags, form.thesis, form.trigger, selectedEntry?.charts.length]);
  const entryCompletion = Math.round((entryEssentials.filter((item) => item.done).length / entryEssentials.length) * 100);
  const planRisk = typeof form.plannedEntry === "number" && typeof form.plannedStop === "number"
    ? Math.abs(form.plannedEntry - form.plannedStop)
    : null;

  function updateSymbol(value: string) {
    const nextSymbol = value.toUpperCase();
    setForm((current) => ({ ...current, symbol: nextSymbol }));
    setChartPreviewRequest((current) => (current && current.symbol !== nextSymbol.trim() ? null : current));
  }

  function loadChartPreview() {
    const requestedSymbol = form.symbol.trim().toUpperCase();
    if (!requestedSymbol) return;
    setChartPreviewRequest((current) => ({
      symbol: requestedSymbol,
      requestKey: (current?.requestKey ?? 0) + 1,
    }));
  }

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

  useEffect(() => {
    if (activeTab !== "capture" || !selectedId || !autosaveReadyRef.current) return;
    setAutosaveState("dirty");
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      void autosaveCaptureDraft();
    }, 800);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  // Capture autosave intentionally watches the editable form fields and uses the latest selected draft id.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeTab,
    selectedId,
    form.symbol,
    form.ideaDate,
    form.direction,
    form.timeframe,
    form.setup,
    form.macroSentiment,
    form.thesis,
    form.trigger,
    form.plannedEntry,
    form.plannedStop,
    form.plannedTarget1,
    form.tags,
  ]);

  useEffect(() => {
    if (activeTab === "inbox") loadInbox();
    if (activeTab === "visual") loadSavedViews("VISUAL");
  }, [activeTab]);

  useEffect(() => {
    function syncEntryChartHeight() {
      const width = window.innerWidth;
      setEntryChartHeight(width < 640 ? 460 : width < 1280 ? 590 : 680);
    }
    syncEntryChartHeight();
    window.addEventListener("resize", syncEntryChartHeight);
    return () => window.removeEventListener("resize", syncEntryChartHeight);
  }, []);

  function selectEntry(entry: JournalEntry) {
    autosaveReadyRef.current = false;
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
      autoDraft: entry.autoDraft,
      reviewDueAt: entry.reviewDueAt,
      outcomeCalculatedAt: entry.outcomeCalculatedAt,
      outcomeCalculationJson: entry.outcomeCalculationJson,
      tags: entry.tags,
    });
    setMarketContext(null);
    setChartPreviewRequest(null);
    setActiveTab("entry");
  }

  function newEntry() {
    autosaveReadyRef.current = false;
    setSelectedId(null);
    setForm(blankForm());
    setMarketContext(null);
    setChartPreviewRequest(null);
    setRuleDrafts({});
    setEntrySection("basics");
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

  function journalPayload() {
    return {
      ...form,
      ideaDate: dateInputValue(form.ideaDate),
      actualTriggerAt: form.actualTriggerAt,
      reviewDueAt: form.reviewDueAt,
      outcomeCalculatedAt: form.outcomeCalculatedAt,
      symbol: form.symbol.trim().toUpperCase(),
      playbookId: form.playbookId || null,
      sectorEtf: form.sectorEtf ? form.sectorEtf.trim().toUpperCase() : null,
      setup: form.setup || null,
      emotionalState: form.emotionalState || null,
    };
  }

  async function createCaptureDraft(targetTab: Tab = "capture") {
    const symbol = form.symbol.trim().toUpperCase();
    if (!symbol) return;
    setAutosaveState("saving");
    const res = await fetch("/api/journal/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol,
        ideaDate: dateInputValue(form.ideaDate),
        direction: form.direction,
        timeframe: form.timeframe,
        setup: form.setup || null,
        macroSentiment: form.macroSentiment,
        thesis: form.thesis,
        trigger: form.trigger,
        plannedEntry: form.plannedEntry,
        plannedStop: form.plannedStop,
        plannedTarget1: form.plannedTarget1,
        tags: { SETUP: form.tags.SETUP, LESSON: form.tags.LESSON },
      }),
    });
    if (!res.ok) {
      setAutosaveState("error");
      setMessage("Failed to create capture draft.");
      return;
    }
    const data = await res.json();
    const saved = data.entry as JournalEntry;
    setSelectedId(saved.id);
    selectEntry(saved);
    setActiveTab(targetTab);
    setEntries((current) => [saved, ...current.filter((entry) => entry.id !== saved.id)]);
    setAutosaveState("saved");
    autosaveReadyRef.current = true;
  }

  async function autosaveCaptureDraft() {
    if (!selectedId) return;
    setAutosaveState("saving");
    const res = await fetch(`/api/journal/${selectedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...journalPayload(), autoDraft: true }),
    });
    if (!res.ok) {
      setAutosaveState("error");
      return;
    }
    const data = await res.json();
    const saved = data.entry as JournalEntry;
    setEntries((current) => [saved, ...current.filter((entry) => entry.id !== saved.id)]);
    setAutosaveState("saved");
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
        const payload = { ...journalPayload(), autoDraft: false };
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

  function loadInbox() {
    startTransition(async () => {
      const res = await fetch("/api/journal/inbox");
      if (!res.ok) {
        setMessage("Failed to load review inbox.");
        return;
      }
      const data = await res.json();
      setInboxData(data.inbox);
    });
  }

  function loadSavedViews(viewType?: "IDEAS" | "VISUAL") {
    startTransition(async () => {
      const params = viewType ? `?viewType=${viewType}` : "";
      const res = await fetch(`/api/journal/saved-views${params}`);
      if (res.ok) {
        const data = await res.json();
        setSavedViews(data.rows ?? []);
      }
    });
  }

  function saveCurrentVisualView() {
    if (!savedViewName.trim()) return;
    startTransition(async () => {
      const filtersJson = JSON.stringify({
        tag: filterTag,
        category: filterCategory,
        status: filterStatus,
        outcomeStatus: filterOutcome,
        macroSentiment: filterSentiment,
        marketRegime: filterRegime,
        playbookId: filterPlaybook,
        purpose: filterPurpose,
        timeframe: filterTimeframe,
        minFitScore,
        minBestExitR,
      });
      const res = await fetch("/api/journal/saved-views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: savedViewName, viewType: "VISUAL", filtersJson, sortDirection: "desc" }),
      });
      setMessage(res.ok ? "Saved visual review view." : "Failed to save view.");
      if (res.ok) {
        setSavedViewName("");
        loadSavedViews("VISUAL");
      }
    });
  }

  function applySavedView(view: JournalSavedView) {
    try {
      const filters = JSON.parse(view.filtersJson) as Record<string, string>;
      setFilterTag(filters.tag ?? "");
      setFilterCategory((filters.category as JournalTagCategoryValue) ?? "");
      setFilterStatus(filters.status ?? "");
      setFilterOutcome(filters.outcomeStatus ?? "");
      setFilterSentiment(filters.macroSentiment ?? "");
      setFilterRegime(filters.marketRegime ?? "");
      setFilterPlaybook(filters.playbookId ?? "");
      setFilterPurpose(filters.purpose ?? "");
      setFilterTimeframe(filters.timeframe ?? "");
      setMinFitScore(filters.minFitScore ?? "");
      setMinBestExitR(filters.minBestExitR ?? "");
    } catch {
      setMessage("Saved view filters could not be applied.");
    }
  }

  function calculateOutcome(entryId: string, apply = true) {
    startTransition(async () => {
      setMessage("Calculating journal outcome...");
      const res = await fetch(`/api/journal/${entryId}/outcome/calculate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(typeof data.error === "string" ? data.error : "Failed to calculate outcome.");
        return;
      }
      if (data.entry) {
        const saved = data.entry as JournalEntry;
        setEntries((current) => [saved, ...current.filter((entry) => entry.id !== saved.id)]);
        if (selectedId === saved.id) selectEntry(saved);
      }
      setMessage(data.calculation?.reason ?? "Calculated outcome.");
      await reloadEntries().catch(() => undefined);
      loadInbox();
    });
  }

  function uploadTradingViewImage(file: File | null) {
    if (!file || !selectedId || !selectedEntry) return;
    const reader = new FileReader();
    reader.onload = () => {
      startTransition(async () => {
        const res = await fetch(`/api/journal/${selectedId}/charts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol: selectedEntry.symbol,
            timeframe: coerceTimeframe(selectedEntry.timeframe),
            purpose: "REVIEW",
            caption: "TradingView analysis reference export",
            screenshotDataUrl: String(reader.result),
            mimeType: file.type || "image/png",
            tradingViewLayoutJson: JSON.stringify({ source: "tradingview-widget-upload", fileName: file.name }),
          }),
        });
        setMessage(res.ok ? "Uploaded TradingView chart image." : "Failed to upload TradingView image.");
        if (res.ok) await reloadEntries();
      });
    };
    reader.readAsDataURL(file);
  }

  function toggleEntrySelection(id: string) {
    setSelectedEntryIds((current) => current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]);
  }

  function toggleChartSelection(id: string) {
    setSelectedChartIds((current) => current.includes(id) ? current.filter((candidate) => candidate !== id) : current.length >= 4 ? current : [...current, id]);
  }

  function bulkAddLessonTags() {
    if (selectedEntryIds.length === 0 || !bulkTagInput.trim()) return;
    startTransition(async () => {
      const tags = parseTagInput(bulkTagInput);
      const res = await fetch("/api/journal/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedEntryIds, addTags: { LESSON: tags } }),
      });
      setMessage(res.ok ? "Updated selected entries." : "Failed to bulk update entries.");
      if (res.ok) {
        setSelectedEntryIds([]);
        setBulkTagInput("");
        await reloadEntries();
      }
    });
  }

  function runTagOperation(operation: "rename" | "merge" | "remove") {
    startTransition(async () => {
      const payload = operation === "remove"
        ? { category: tagManager.category, name: tagManager.name }
        : { category: tagManager.category, from: tagManager.from, to: tagManager.to };
      const res = await fetch(`/api/journal/tags/${operation}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setMessage(res.ok ? "Updated journal tags." : "Failed to update tags.");
      if (res.ok) {
        const data = await res.json();
        setTagRows(data.rows ?? tagRows);
        await reloadEntries().catch(() => undefined);
      }
    });
  }

  function addToPlaybookExamples(entry: JournalEntry, chartId?: string | null) {
    const playbookId = entry.playbookId || form.playbookId;
    if (!playbookId) {
      setMessage("Attach a playbook before adding an example.");
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/journal/playbooks/${playbookId}/examples`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journalEntryId: entry.id, chartId: chartId ?? null, note: entry.thesis || entry.lessonLearned }),
      });
      setMessage(res.ok ? "Added playbook example." : "Failed to add playbook example.");
      if (res.ok) await reloadPlaybooks();
    });
  }

  function renderEntrySection() {
    if (entrySection === "basics") {
      return (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Symbol
              <Input
                className="mt-1"
                value={form.symbol}
                onChange={(event) => updateSymbol(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  loadChartPreview();
                }}
              />
            </label>
            <DateField label="Idea Date" value={form.ideaDate} onChange={(value) => setForm((current) => ({ ...current, ideaDate: `${value}T00:00:00.000Z` }))} />
            <SelectField label="Direction" value={form.direction} options={["LONG", "SHORT"]} onChange={(value) => setForm((current) => ({ ...current, direction: value as JournalEntry["direction"] }))} />
            <SelectField label="Status" value={form.status} options={["DRAFT", "WATCHING", "MISSED", "PASSED", "INVALIDATED", "PLAYBOOK", "ARCHIVED"]} onChange={(value) => setForm((current) => ({ ...current, status: value as JournalEntry["status"] }))} />
            <LabelInput label="Setup" value={form.setup ?? ""} onChange={(value) => setForm((current) => ({ ...current, setup: value }))} />
            <SelectField label="Timeframe" value={form.timeframe} options={[...JOURNAL_TIMEFRAMES]} onChange={(value) => setForm((current) => ({ ...current, timeframe: value }))} />
            <SelectField label="Macro Sentiment" value={form.macroSentiment} options={["BULLISH", "NEUTRAL", "BEARISH"]} onChange={(value) => setForm((current) => ({ ...current, macroSentiment: value as JournalEntry["macroSentiment"] }))} />
            <SelectField label="Playbook" value={form.playbookId ?? ""} options={["", ...playbooks.map((playbook) => playbook.id)]} optionLabels={{ "": "No playbook", ...Object.fromEntries(playbooks.map((playbook) => [playbook.id, playbook.name])) }} onChange={(value) => setForm((current) => ({ ...current, playbookId: value || null }))} />
          </div>
        </div>
      );
    }

    if (entrySection === "plan") {
      return (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
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
        </div>
      );
    }

    if (entrySection === "thesis") {
      return (
        <div className="space-y-4">
          <TextAreaField label="Thesis" value={form.thesis} onChange={(value) => setForm((current) => ({ ...current, thesis: value }))} />
          <TextAreaField label="Trigger" value={form.trigger} onChange={(value) => setForm((current) => ({ ...current, trigger: value }))} />
          <TextAreaField label="Ideal Execution" value={form.idealExecutionPlan} onChange={(value) => setForm((current) => ({ ...current, idealExecutionPlan: value }))} />
          <TextAreaField label="Missed / No-Trade Reason" value={form.missedReason} onChange={(value) => setForm((current) => ({ ...current, missedReason: value }))} />
        </div>
      );
    }

    if (entrySection === "context") {
      return (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label="Market Regime" value={form.marketRegime} options={[...JOURNAL_MARKET_REGIMES]} onChange={(value) => setForm((current) => ({ ...current, marketRegime: value as MarketRegime }))} />
            <LabelInput label="Sector ETF" value={form.sectorEtf ?? ""} onChange={(value) => setForm((current) => ({ ...current, sectorEtf: value.toUpperCase() }))} />
            <SelectField label="SPY Trend" value={form.spyTrend} options={[...JOURNAL_TREND_STATES]} onChange={(value) => setForm((current) => ({ ...current, spyTrend: value as Trend }))} />
            <SelectField label="QQQ Trend" value={form.qqqTrend} options={[...JOURNAL_TREND_STATES]} onChange={(value) => setForm((current) => ({ ...current, qqqTrend: value as Trend }))} />
            <SelectField label="IWM Trend" value={form.iwmTrend} options={[...JOURNAL_TREND_STATES]} onChange={(value) => setForm((current) => ({ ...current, iwmTrend: value as Trend }))} />
            <SelectField label="Sector Trend" value={form.sectorTrend} options={[...JOURNAL_TREND_STATES]} onChange={(value) => setForm((current) => ({ ...current, sectorTrend: value as Trend }))} />
          </div>
          <TextAreaField label="Market Context" value={form.marketContext} onChange={(value) => setForm((current) => ({ ...current, marketContext: value }))} />
          <TextAreaField label="Peer Context" value={form.peerContext} onChange={(value) => setForm((current) => ({ ...current, peerContext: value }))} />
          <TextAreaField label="Breadth Notes" value={form.breadthNotes} onChange={(value) => setForm((current) => ({ ...current, breadthNotes: value }))} />
          <TextAreaField label="Catalyst / News" value={form.catalystNotes} onChange={(value) => setForm((current) => ({ ...current, catalystNotes: value }))} />
          <TextAreaField label="Relative Strength" value={form.relativeStrengthNotes} onChange={(value) => setForm((current) => ({ ...current, relativeStrengthNotes: value }))} />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={pending || !form.symbol.trim()} onClick={loadMarketContext}><RefreshCw className="h-4 w-4" />Market Context</Button>
            {selectedId && marketContext ? <Button variant="outline" disabled={pending} onClick={saveContextSnapshot}><BookOpenCheck className="h-4 w-4" />Save Snapshot</Button> : null}
          </div>
        </div>
      );
    }

    if (entrySection === "review") {
      return (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label="Outcome" value={form.outcomeStatus} options={[...JOURNAL_OUTCOME_STATUSES]} onChange={(value) => setForm((current) => ({ ...current, outcomeStatus: value as Outcome }))} />
            <DateTimeField label="Trigger Time" value={form.actualTriggerAt} onChange={(value) => setForm((current) => ({ ...current, actualTriggerAt: datetimeFromInput(value) }))} />
            <NumberField label="MFE R" value={form.mfeR} onChange={(value) => setNumberField("mfeR", value)} />
            <NumberField label="MAE R" value={form.maeR} onChange={(value) => setNumberField("maeR", value)} />
            <NumberField label="Best Exit R" value={form.bestExitR} onChange={(value) => setNumberField("bestExitR", value)} />
            <NumberField label="Rating" max={5} min={1} value={form.rating} onChange={(value) => setNumberField("rating", value)} />
            <NumberField label="Confidence" max={5} min={1} value={form.confidenceScore} onChange={(value) => setNumberField("confidenceScore", value)} />
            <NumberField label="Plan Clarity" max={5} min={1} value={form.planClarityScore} onChange={(value) => setNumberField("planClarityScore", value)} />
            <NumberField label="Preparation" max={5} min={1} value={form.preparationScore} onChange={(value) => setNumberField("preparationScore", value)} />
            <NumberField label="Patience" max={5} min={1} value={form.patienceScore} onChange={(value) => setNumberField("patienceScore", value)} />
            <NumberField label="Rule Adherence" max={5} min={1} value={form.ruleAdherenceScore} onChange={(value) => setNumberField("ruleAdherenceScore", value)} />
            <SelectField label="Would Take Again" value={form.wouldTakeAgain == null ? "" : form.wouldTakeAgain ? "YES" : "NO"} options={["", "YES", "NO"]} onChange={(value) => setForm((current) => ({ ...current, wouldTakeAgain: value ? value === "YES" : null }))} />
          </div>
          <LabelInput label="Emotional State" value={form.emotionalState ?? ""} onChange={(value) => setForm((current) => ({ ...current, emotionalState: value }))} />
          <TextAreaField label="Outcome Notes" value={form.outcomeNotes} onChange={(value) => setForm((current) => ({ ...current, outcomeNotes: value }))} />
          <TextAreaField label="Lesson Learned" value={form.lessonLearned} onChange={(value) => setForm((current) => ({ ...current, lessonLearned: value }))} />
        </div>
      );
    }

    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {JOURNAL_TAG_CATEGORIES.map((category) => (
          <LabelInput key={category} label={category === "LESSON" ? "Lesson Tags" : `${category} Tags`} value={tagString(form.tags[category])} onChange={(value) => updateTags(category, value)} />
        ))}
      </div>
    );
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
            ["capture", "Capture", ClipboardList],
            ["inbox", "Inbox", Inbox],
            ["ideas", "Ideas", NotebookPen],
            ["entry", selectedId ? "Entry" : "New Entry", Save],
            ["playbooks", "Playbooks", BookOpen],
            ["visual", "Visual Review", BarChart3],
            ["tags", "Tags", Tags],
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
              ["Due Review", analytics.totals.dueReview],
              ["Missing Plan", analytics.totals.missingPlan],
              ["Trigger Rate", formatPercent(analytics.totals.triggerRate)],
              ["Worked Without Me", formatPercent(analytics.totals.workedWithoutMeRate)],
              ["Failed", formatPercent(analytics.totals.failedAfterTriggerRate)],
              ["Chart Coverage", formatPercent(analytics.totals.chartCoverage)],
              ["Avg Fit", analytics.totals.avgFitScore == null ? "-" : `${Math.round(analytics.totals.avgFitScore)}%`],
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
            <SummaryList title="Fit Score Buckets" rows={analytics.byFitScore} />
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

      {activeTab === "capture" && (
        <div className="grid gap-5 xl:grid-cols-[24rem_minmax(0,1fr)]">
          <div className="space-y-4">
            <Panel title="Quick Capture" detail={autosaveState === "idle" ? "Chart-first draft" : autosaveState}>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Symbol
                  <Input className="mt-1" value={form.symbol} onChange={(event) => updateSymbol(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); loadChartPreview(); } }} />
                </label>
                <DateField label="Idea Date" value={form.ideaDate} onChange={(value) => setForm((current) => ({ ...current, ideaDate: `${value}T00:00:00.000Z` }))} />
                <SelectField label="Direction" value={form.direction} options={["LONG", "SHORT"]} onChange={(value) => setForm((current) => ({ ...current, direction: value as JournalEntry["direction"] }))} />
                <SelectField label="Timeframe" value={form.timeframe} options={[...JOURNAL_TIMEFRAMES]} onChange={(value) => setForm((current) => ({ ...current, timeframe: value }))} />
                <LabelInput label="Setup" value={form.setup ?? ""} onChange={(value) => setForm((current) => ({ ...current, setup: value }))} />
                <SelectField label="Macro Sentiment" value={form.macroSentiment} options={["BULLISH", "NEUTRAL", "BEARISH"]} onChange={(value) => setForm((current) => ({ ...current, macroSentiment: value as JournalEntry["macroSentiment"] }))} />
                <NumberField label="Entry" value={form.plannedEntry} onChange={(value) => setNumberField("plannedEntry", value)} />
                <NumberField label="Stop" value={form.plannedStop} onChange={(value) => setNumberField("plannedStop", value)} />
                <NumberField label="Target 1" value={form.plannedTarget1} onChange={(value) => setNumberField("plannedTarget1", value)} />
              </div>
              <TextAreaField label="Thesis" value={form.thesis} onChange={(value) => setForm((current) => ({ ...current, thesis: value }))} />
              <TextAreaField label="Trigger" value={form.trigger} onChange={(value) => setForm((current) => ({ ...current, trigger: value }))} />
              <div className="grid gap-3 sm:grid-cols-2">
                <LabelInput label="Setup Tags" value={tagString(form.tags.SETUP)} onChange={(value) => updateTags("SETUP", value)} />
                <LabelInput label="Lesson Tags" value={tagString(form.tags.LESSON)} onChange={(value) => updateTags("LESSON", value)} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={loadChartPreview} variant="outline"><BarChart3 className="h-4 w-4" />Load Chart</Button>
                <Button onClick={() => void createCaptureDraft()} disabled={!form.symbol.trim()}><Save className="h-4 w-4" />{selectedId ? "Refresh Draft" : "Create Draft"}</Button>
                {selectedEntry ? <Button variant="outline" onClick={() => { autosaveReadyRef.current = false; setActiveTab("entry"); }}><NotebookPen className="h-4 w-4" />Full Entry</Button> : null}
              </div>
            </Panel>
            <Panel title="Recent Drafts">
              <div className="space-y-2">
                {entries.filter((entry) => entry.autoDraft || entry.status === "DRAFT").slice(0, 6).map((entry) => (
                  <button key={entry.id} className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-left text-sm" onClick={() => { selectEntry(entry); setActiveTab("capture"); autosaveReadyRef.current = true; }}>
                    <span className="font-semibold text-slate-900">{entry.symbol} {entry.setup ? `| ${entry.setup}` : ""}</span>
                    <span className="text-xs text-slate-500">{dateInputValue(entry.ideaDate)}</span>
                  </button>
                ))}
              </div>
            </Panel>
          </div>
          <div className="space-y-4">
            {chartPreviewRequest ? (
              <JournalEntryChartPreview requestKey={chartPreviewRequest.requestKey} symbol={chartPreviewRequest.symbol} timeframe={coerceTimeframe(form.timeframe)} />
            ) : (
              <div className="flex min-h-[24rem] flex-col items-center justify-center rounded-[28px] border border-slate-200/80 bg-white/85 p-8 text-center text-sm text-slate-500">
                <BarChart3 className="mb-2 h-5 w-5" />
                Load a symbol to preview and select the setup window.
              </div>
            )}
            {selectedEntry ? (
              <>
                <Panel title="App-Owned Saved Chart">
                  <JournalChartEditor
                    entryId={selectedEntry.id}
                    symbol={selectedEntry.symbol}
                    initialTimeframe={coerceTimeframe(selectedEntry.timeframe)}
                    sectorEtf={selectedEntry.sectorEtf}
                    plan={selectedEntry}
                    onSaved={() => void reloadEntries()}
                  />
                </Panel>
                <Panel title="Analysis Reference">
                  <TradingViewAnalysisReference symbol={selectedEntry.symbol} timeframe={coerceTimeframe(selectedEntry.timeframe)} />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <input ref={fileInputRef} className="hidden" type="file" accept="image/*" onChange={(event) => uploadTradingViewImage(event.currentTarget.files?.[0] ?? null)} />
                    <Button variant="outline" onClick={() => fileInputRef.current?.click()}><Upload className="h-4 w-4" />Upload TradingView Image</Button>
                  </div>
                </Panel>
              </>
            ) : (
              <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-6 text-sm text-slate-500">Create a draft before saving charts.</div>
            )}
          </div>
        </div>
      )}

      {activeTab === "inbox" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button onClick={loadInbox}><RefreshCw className="h-4 w-4" />Refresh Inbox</Button>
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            <InboxList title="Due Review" rows={inboxData?.dueReview ?? []} onOpen={selectEntry} onCalculate={calculateOutcome} />
            <InboxList title="Missing Plan" rows={inboxData?.missingPlan ?? []} onOpen={selectEntry} onCalculate={calculateOutcome} />
            <InboxList title="Missing Chart" rows={inboxData?.missingChart ?? []} onOpen={selectEntry} onCalculate={calculateOutcome} />
            <InboxList title="Triggered / Needs Outcome" rows={inboxData?.triggeredUnreviewed ?? []} onOpen={selectEntry} onCalculate={calculateOutcome} />
            <InboxList title="Worked Without Me" rows={inboxData?.workedWithoutMe ?? []} onOpen={selectEntry} onCalculate={calculateOutcome} />
            <InboxList title="#new-setup Candidates" rows={inboxData?.newSetupCandidates ?? []} onOpen={selectEntry} onCalculate={calculateOutcome} />
          </div>
          <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-5">
            {sectionTitle("Open Review Actions")}
            <div className="space-y-2">
              {(inboxData?.openReviewActions ?? []).map((action) => (
                <div key={action.id ?? action.label} className="rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm">
                  <p className="font-semibold text-slate-900">{action.label}</p>
                  <p className="text-xs text-slate-500">{action.reviewPeriod} | {action.reviewRange}</p>
                </div>
              ))}
              {!(inboxData?.openReviewActions ?? []).length ? <p className="text-sm text-slate-500">No open review actions.</p> : null}
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
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-2">
              <Button size="sm" variant="outline" onClick={() => setSelectedEntryIds(entries.map((entry) => entry.id))}>Select Visible</Button>
              <Button size="sm" variant="outline" onClick={() => setSelectedEntryIds([])}>Clear</Button>
              <Input className="max-w-xs" placeholder="Bulk lesson tags, e.g. #new-setup" value={bulkTagInput} onChange={(event) => setBulkTagInput(event.target.value)} />
              <Button size="sm" disabled={selectedEntryIds.length === 0 || !bulkTagInput.trim()} onClick={bulkAddLessonTags}>Apply to {selectedEntryIds.length}</Button>
            </div>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {entries.map((entry) => (
              <div key={entry.id} className={cn("rounded-[28px] border border-slate-200/80 bg-white/85 p-5 text-left shadow-[0_18px_45px_-36px_rgba(15,23,42,0.32)]", selectedEntryIds.includes(entry.id) ? "ring-2 ring-slate-950" : "")}>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
                    <input type="checkbox" checked={selectedEntryIds.includes(entry.id)} onChange={() => toggleEntrySelection(entry.id)} />
                    Select
                  </label>
                  <Button size="sm" variant="outline" onClick={() => selectEntry(entry)}>Open</Button>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xl font-semibold tracking-tight text-slate-950">{entry.symbol}</p>
                      <Badge variant={statusTone(entry.status)}>{entry.status}</Badge>
                      <Badge variant={outcomeTone(entry.outcomeStatus)}>{compactLabel(entry.outcomeStatus)}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{dateInputValue(entry.ideaDate)} | {entry.direction} | {entry.timeframe} | {entry.setup || "No setup"}</p>
                    <p className="mt-1 text-xs text-slate-500">{entry.playbook?.name ?? "No playbook"} | {compactLabel(entry.marketRegime)} | {entry.charts.length} chart{entry.charts.length === 1 ? "" : "s"} | Fit {formatFitScore(entry)}</p>
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
              </div>
            ))}
            {entries.length === 0 ? <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-6 text-sm text-slate-500">No journal entries found.</div> : null}
          </div>
        </div>
      )}

      {activeTab === "entry" && (
        <div className="space-y-4">
          <div className="rounded-[28px] border border-slate-200/80 bg-white/90 p-4 shadow-[0_18px_45px_-36px_rgba(15,23,42,0.3)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-2xl font-semibold tracking-tight text-slate-950">{form.symbol.trim() || "New journal entry"}</h2>
                  <Badge variant={statusTone(form.status)}>{form.status}</Badge>
                  <Badge variant={outcomeTone(form.outcomeStatus)}>{compactLabel(form.outcomeStatus)}</Badge>
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {dateInputValue(form.ideaDate) || "No date"} | {form.direction} | {form.timeframe} | {form.setup || "No setup"} | Fit {selectedEntry ? formatFitScore(selectedEntry) : "-"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={loadChartPreview} disabled={!form.symbol.trim()}><BarChart3 className="h-4 w-4" />Load Chart</Button>
                {!selectedEntry ? <Button variant="outline" onClick={() => void createCaptureDraft("entry")} disabled={!form.symbol.trim()}><Plus className="h-4 w-4" />Create Draft</Button> : null}
                {selectedEntry ? <Button variant="outline" onClick={() => calculateOutcome(selectedEntry.id)}><RefreshCw className="h-4 w-4" />Calculate</Button> : null}
                <Button disabled={pending || !form.symbol.trim()} onClick={saveEntry}><Save className="h-4 w-4" />Save Entry</Button>
                {selectedId ? <Button variant="destructive" disabled={pending} onClick={deleteEntry}><Trash2 className="h-4 w-4" />Delete</Button> : null}
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <MetricTile label="Plan Risk" value={planRisk == null ? "-" : planRisk.toFixed(2)} />
              <MetricTile label="Charts" value={String(selectedEntry?.charts.length ?? 0)} />
              <MetricTile label="Review Due" value={selectedEntry?.reviewDueAt ? dateInputValue(selectedEntry.reviewDueAt) : "-"} />
              <MetricTile label="Best Exit" value={formatR(form.bestExitR ?? form.mfeR)} />
              <MetricTile label="Completion" value={`${entryCompletion}%`} />
            </div>
            <div className="mt-4">
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-slate-950 transition-all" style={{ width: `${entryCompletion}%` }} />
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {entryEssentials.map((item) => (
                  <span key={item.label} className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", item.done ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500")}>
                    {item.done ? "Done" : "Missing"} {item.label}
                  </span>
                ))}
              </div>
              <details className="mt-3 rounded-2xl border border-slate-200/80 bg-slate-50/70 px-3 py-2 text-sm">
                <summary className="cursor-pointer font-semibold text-slate-700">Entry snapshot</summary>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                  <SnapshotRow label="Symbol" value={form.symbol || "-"} />
                  <SnapshotRow label="Setup" value={form.setup || "-"} />
                  <SnapshotRow label="Macro" value={form.macroSentiment} />
                  <SnapshotRow label="Outcome" value={compactLabel(form.outcomeStatus)} />
                  <SnapshotRow label="Chart Count" value={String(selectedEntry?.charts.length ?? 0)} />
                </div>
              </details>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,24rem)]">
            <main className="min-w-0 space-y-4">
              <div className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/90 shadow-[0_20px_60px_-38px_rgba(15,23,42,0.34)]">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-950">{form.symbol.trim() || "Chart workspace"}</span>
                    <Badge variant="outline">{form.timeframe}</Badge>
                    <Badge variant="outline">{form.direction}</Badge>
                    <Badge variant="outline">{form.macroSentiment}</Badge>
                    {form.setup ? <Badge variant="outline">{form.setup}</Badge> : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {JOURNAL_TIMEFRAMES.map((option) => (
                      <Button key={option} size="sm" variant={form.timeframe === option ? "default" : "outline"} onClick={() => setForm((current) => ({ ...current, timeframe: option }))}>{option}</Button>
                    ))}
                  </div>
                </div>
                <div className="p-3">
                  {chartPreviewRequest ? (
                    <JournalEntryChartPreview
                      chartHeight={entryChartHeight}
                      requestKey={chartPreviewRequest.requestKey}
                      symbol={chartPreviewRequest.symbol}
                      timeframe={coerceTimeframe(form.timeframe)}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-300 bg-slate-50/80 p-8 text-center text-sm text-slate-500" style={{ minHeight: entryChartHeight }}>
                      <BarChart3 className="mb-2 h-5 w-5" />
                      Enter a symbol and load the chart to start the review.
                    </div>
                  )}
                </div>
              </div>

              {selectedEntry ? (
                <div className="rounded-[28px] border border-slate-200/80 bg-white/90 p-4 shadow-[0_20px_60px_-38px_rgba(15,23,42,0.28)]">
                  {sectionTitle("Chart Capture", "App-owned saved screenshot")}
                  <JournalChartEditor
                    chartHeight={entryChartHeight}
                    entryId={selectedEntry.id}
                    symbol={selectedEntry.symbol}
                    initialTimeframe={coerceTimeframe(selectedEntry.timeframe)}
                    sectorEtf={selectedEntry.sectorEtf}
                    plan={selectedEntry}
                    onSaved={() => void reloadEntries()}
                  />
                </div>
              ) : (
                <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-6 text-sm text-slate-500">
                  Create a draft after entering a symbol to enable chart capture and saved chart artifacts.
                </div>
              )}
            </main>

            <aside className="space-y-4 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto xl:pr-1">
              <div className="rounded-[28px] border border-slate-200/80 bg-white/90 p-4">
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {ENTRY_SECTIONS.map((section) => (
                    <button
                      key={section.key}
                      className={cn("rounded-xl px-3 py-2 text-xs font-semibold", entrySection === section.key ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}
                      onClick={() => setEntrySection(section.key)}
                      type="button"
                    >
                      {section.label}
                    </button>
                  ))}
                </div>
                <div className="border-t border-slate-200/80 pt-4">
                  {renderEntrySection()}
                </div>
              </div>

              {selectedEntry ? (
                <div className="rounded-[28px] border border-slate-200/80 bg-white/90 p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">Rule Checklist</p>
                      <p className="text-xs text-slate-500">{selectedPlaybook ? `${selectedPlaybook.name} | Fit ${formatFitScore(selectedEntry)}` : "No playbook selected"}</p>
                    </div>
                    {selectedPlaybook?.rules.length ? <Button size="sm" onClick={saveRuleChecks}><CheckCircle2 className="h-4 w-4" />Save</Button> : null}
                  </div>
                  {selectedPlaybook?.rules.length ? (
                    <div className="space-y-2">
                      {selectedPlaybook.rules.map((rule) => (
                        <div key={rule.id ?? rule.text} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
                          <p className="text-sm font-medium text-slate-900">{rule.text}</p>
                          <div className="mt-2 flex gap-1">
                            {JOURNAL_RULE_CHECK_STATUSES.map((status) => (
                              <Button key={status} size="sm" variant={ruleDrafts[rule.id ?? rule.text]?.status === status ? "default" : "outline"} onClick={() => setRuleDrafts((current) => ({ ...current, [rule.id ?? rule.text]: { ...current[rule.id ?? rule.text], status } }))}>{status}</Button>
                            ))}
                          </div>
                          <Input className="mt-2" value={ruleDrafts[rule.id ?? rule.text]?.notes ?? ""} onChange={(event) => setRuleDrafts((current) => ({ ...current, [rule.id ?? rule.text]: { status: current[rule.id ?? rule.text]?.status ?? "NA", notes: event.target.value } }))} placeholder="Rule notes" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">Attach a playbook with rules to score this idea.</p>
                  )}
                </div>
              ) : null}

              {selectedEntry ? (
                <div className="rounded-[28px] border border-slate-200/80 bg-white/90 p-4">
                  {sectionTitle("Saved Charts", `${selectedEntry.charts.length}`)}
                  <div className="space-y-3">
                    {selectedEntry.charts.slice(0, 4).map((chart) => (
                      <div key={chart.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-2">
                        {chart.screenshotUrl ? <img src={chart.screenshotUrl} alt={`${chart.symbol} saved chart`} className="aspect-[16/9] w-full rounded-xl object-cover" /> : <div className="aspect-[16/9] rounded-xl bg-slate-100" />}
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline">{compactLabel(chart.purpose)}</Badge>
                          <Badge variant="outline">{chart.timeframe}</Badge>
                        </div>
                        <Textarea className="mt-2 min-h-16 text-xs" defaultValue={chart.caption} onBlur={(event) => saveChartCaption(chart, event.currentTarget.value)} />
                      </div>
                    ))}
                    {selectedEntry.charts.length === 0 ? <p className="text-sm text-slate-500">No saved charts yet.</p> : null}
                  </div>
                </div>
              ) : null}

              {selectedEntry ? (
                <details className="rounded-[28px] border border-slate-200/80 bg-white/90 p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-950">TradingView Reference</summary>
                  <div className="mt-3">
                    <TradingViewAnalysisReference symbol={selectedEntry.symbol} timeframe={coerceTimeframe(selectedEntry.timeframe)} />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <input ref={fileInputRef} className="hidden" type="file" accept="image/*" onChange={(event) => uploadTradingViewImage(event.currentTarget.files?.[0] ?? null)} />
                      <Button variant="outline" onClick={() => fileInputRef.current?.click()}><Upload className="h-4 w-4" />Upload TradingView Image</Button>
                    </div>
                  </div>
                </details>
              ) : null}

              {marketContext ? (
                <div className="rounded-[28px] border border-slate-200/80 bg-white/90 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">Peer Group Context</p>
                      <p className="mt-1 text-sm text-slate-500">{marketContext.detail?.groups?.[0]?.name ?? "No peer group loaded"}</p>
                    </div>
                    <a className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50" href={marketContext.peerGroupsUrl} target="_blank" rel="noreferrer">
                      <LinkIcon className="h-3.5 w-3.5" /> Peer Groups
                    </a>
                  </div>
                  <div className="mt-4 grid gap-2">
                    {(marketContext.metrics?.rows ?? []).slice(0, 8).map((row) => (
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
            </aside>
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
            {selectedPlaybook?.examples?.length ? (
              <div className="mt-6">
                {sectionTitle("Example Gallery")}
                <div className="grid gap-3 md:grid-cols-2">
                  {selectedPlaybook.examples.map((example) => (
                    <div key={example.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
                      {example.chart?.screenshotUrl ? <img src={example.chart.screenshotUrl} alt={`${example.journalEntry.symbol} playbook example`} className="aspect-[16/10] w-full rounded-xl object-cover" /> : <div className="aspect-[16/10] rounded-xl bg-slate-100" />}
                      <p className="mt-2 font-semibold text-slate-950">{example.journalEntry.symbol} {example.journalEntry.setup ? `| ${example.journalEntry.setup}` : ""}</p>
                      <p className="text-xs text-slate-500">Fit {example.fitScore == null ? "-" : `${example.fitScore}%`} | {compactLabel(example.journalEntry.outcomeStatus)} | {formatR(example.journalEntry.bestExitR ?? example.journalEntry.mfeR)}</p>
                      {example.note ? <p className="mt-2 line-clamp-2 text-sm text-slate-600">{example.note}</p> : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </Panel>
        </div>
      )}

      {activeTab === "visual" && (
        <div className="space-y-4">
          <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_10rem_10rem_10rem_10rem_auto]">
              <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Tag
                <Input className="mt-1" value={filterTag} onChange={(event) => setFilterTag(event.target.value.replace(/^#+/, ""))} />
              </label>
              <FilterSelect label="Category" value={filterCategory} onChange={(value) => setFilterCategory(value as JournalTagCategoryValue | "")} options={["", ...JOURNAL_TAG_CATEGORIES]} />
              <FilterSelect label="Purpose" value={filterPurpose} onChange={setFilterPurpose} options={["", ...JOURNAL_CHART_PURPOSES]} />
              <FilterSelect label="Timeframe" value={filterTimeframe} onChange={setFilterTimeframe} options={["", ...JOURNAL_TIMEFRAMES]} />
              <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Min Best R
                <Input className="mt-1" type="number" value={minBestExitR} onChange={(event) => setMinBestExitR(event.target.value)} />
              </label>
              <div className="flex items-end">
                <Button onClick={() => startTransition(() => void reloadEntries({ tag: filterTag, category: filterCategory }))}><Filter className="h-4 w-4" />Apply</Button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Input className="max-w-xs" placeholder="Saved view name" value={savedViewName} onChange={(event) => setSavedViewName(event.target.value)} />
              <Button size="sm" onClick={saveCurrentVisualView}>Save View</Button>
              {savedViews.filter((view) => view.viewType === "VISUAL").map((view) => (
                <Button key={view.id} size="sm" variant="outline" onClick={() => applySavedView(view)}>{view.name}</Button>
              ))}
            </div>
          </div>
          {compareRows.length > 0 ? (
            <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                {sectionTitle("Compare Selected", `${compareRows.length}/4`)}
                <Button size="sm" variant="outline" onClick={() => setSelectedChartIds([])}>Clear Compare</Button>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {compareRows.map(({ entry, chart }) => (
                  <div key={chart.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
                    {chart.screenshotUrl ? <img src={chart.screenshotUrl} alt={`${entry.symbol} compare`} className="aspect-[16/10] w-full rounded-xl object-cover" /> : <div className="aspect-[16/10] rounded-xl bg-slate-100" />}
                    <p className="mt-2 font-semibold text-slate-950">{entry.symbol}</p>
                    <p className="text-xs text-slate-500">{compactLabel(chart.purpose)} | {chart.timeframe} | Fit {formatFitScore(entry)} | {formatR(entry.bestExitR ?? entry.mfeR)}</p>
                    <p className="mt-2 line-clamp-3 text-sm text-slate-600">{chart.caption || entry.thesis}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredChartRows.map(({ entry, chart }) => (
              <div key={chart.id} className={cn("rounded-[24px] border border-slate-200/80 bg-white/85 p-3 text-left hover:border-slate-300", selectedChartIds.includes(chart.id) ? "ring-2 ring-slate-950" : "")}>
                {chart.screenshotUrl ? <img src={chart.screenshotUrl} alt={`${entry.symbol} visual review`} className="aspect-[16/10] w-full rounded-2xl object-cover" /> : <div className="aspect-[16/10] rounded-2xl bg-slate-100" />}
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-950">{entry.symbol}</p>
                    <p className="text-xs text-slate-500">{chart.timeframe} | {compactLabel(chart.purpose)} | {dateInputValue(entry.ideaDate)} | Fit {formatFitScore(entry)}</p>
                  </div>
                  <Badge variant={outcomeTone(entry.outcomeStatus)}>{compactLabel(entry.outcomeStatus)}</Badge>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-slate-600">{chart.caption || entry.lessonLearned || entry.thesis}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => toggleChartSelection(chart.id)}><GitCompare className="h-4 w-4" />{selectedChartIds.includes(chart.id) ? "Selected" : "Compare"}</Button>
                  <Button size="sm" variant="outline" onClick={() => selectEntry(entry)}>Open</Button>
                  <Button size="sm" variant="outline" onClick={() => addToPlaybookExamples(entry, chart.id)}>Example</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "tags" && (
        <div className="grid gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
          <Panel title="Tag Operations">
            <SelectField label="Category" value={tagManager.category} options={[...JOURNAL_TAG_CATEGORIES]} onChange={(value) => setTagManager((current) => ({ ...current, category: value as JournalTagCategoryValue }))} />
            <LabelInput label="From" value={tagManager.from} onChange={(value) => setTagManager((current) => ({ ...current, from: value }))} />
            <LabelInput label="To" value={tagManager.to} onChange={(value) => setTagManager((current) => ({ ...current, to: value }))} />
            <LabelInput label="Remove Tag" value={tagManager.name} onChange={(value) => setTagManager((current) => ({ ...current, name: value }))} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => runTagOperation("rename")}>Rename</Button>
              <Button size="sm" variant="outline" onClick={() => runTagOperation("merge")}>Merge</Button>
              <Button size="sm" variant="destructive" onClick={() => runTagOperation("remove")}>Remove</Button>
            </div>
          </Panel>
          <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-5">
            {sectionTitle("Journal Tags", "journal-only usage")}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="text-left text-xs uppercase tracking-[0.16em] text-slate-500">
                  <tr>
                    <th className="py-2">Tag</th>
                    <th>Category</th>
                    <th>Count</th>
                    <th>Reviewed</th>
                    <th>Charts</th>
                    <th>Avg MFE</th>
                    <th>Avg MAE</th>
                    <th>Avg Best</th>
                  </tr>
                </thead>
                <tbody>
                  {(analytics.tagPerformance ?? tagRows).map((row) => (
                    <tr key={`${row.category}-${row.name}`} className="border-t border-slate-200">
                      <td className="py-2 font-semibold text-slate-900">#{row.name}</td>
                      <td>{row.category}</td>
                      <td>{row.count}</td>
                      <td>{"reviewed" in row ? row.reviewed : "-"}</td>
                      <td>{"chartCount" in row ? row.chartCount : "-"}</td>
                      <td>{"avgMfeR" in row ? formatR(row.avgMfeR) : "-"}</td>
                      <td>{"avgMaeR" in row ? formatR(row.avgMaeR) : "-"}</td>
                      <td>{"avgBestExitR" in row ? formatR(row.avgBestExitR) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/75 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-1 truncate font-mono text-sm font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function SnapshotRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
      <span className="shrink-0 text-xs font-medium text-slate-500">{label}</span>
      <span className="truncate text-right text-sm font-semibold text-slate-900">{value}</span>
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

function InboxList({
  onCalculate,
  onOpen,
  rows,
  title,
}: {
  title: string;
  rows: JournalEntry[];
  onOpen: (entry: JournalEntry) => void;
  onCalculate: (entryId: string) => void;
}) {
  return (
    <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-5">
      {sectionTitle(title, String(rows.length))}
      <div className="space-y-2">
        {rows.slice(0, 8).map((entry) => (
          <div key={`${title}-${entry.id}`} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-slate-950">{entry.symbol} {entry.setup ? `| ${entry.setup}` : ""}</p>
                <p className="text-xs text-slate-500">{dateInputValue(entry.ideaDate)} | {compactLabel(entry.outcomeStatus)} | {formatR(entry.bestExitR ?? entry.mfeR)}</p>
              </div>
              <Badge variant={outcomeTone(entry.outcomeStatus)}>{compactLabel(entry.status)}</Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => onOpen(entry)}>Open</Button>
              <Button size="sm" variant="outline" onClick={() => onCalculate(entry.id)}>Calculate</Button>
            </div>
          </div>
        ))}
        {rows.length === 0 ? <p className="text-sm text-slate-500">Nothing waiting here.</p> : null}
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

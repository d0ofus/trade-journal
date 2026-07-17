"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, BarChart3, BookOpen, Clock3, LayoutDashboard, Save, StickyNote, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { ClosedTradeChartWorkspace, type ChartWorkspaceSaveActivity } from "@/components/closed-trade-chart-workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatCurrency } from "@/lib/utils";
import { useWorkstationNavigationGuard } from "@/lib/workstation-navigation-guard";

type ClosedTrade = {
  groupKey: string;
  accountId: string;
  accountCode: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  openTime: string;
  closeTime: string;
  avgEntryPrice: number;
  avgExitPrice: number;
  tradeDate: string;
  realizedPnl: number;
  totalCommission: number;
  isStale: boolean;
  staleAt: string | null;
  staleReason: string | null;
  priceReturnPct: number | null;
  largestExecutionQuantity: number;
  largestExecutionNotional: number;
  notionalReturnPct: number | null;
  equityReturnPct: number | null;
  equityBaseline: number | null;
  openingQuantity: number;
  closingQuantity: number;
  executions: Array<{
    id: string;
    executedAt: string;
    side: "BUY" | "SELL";
    quantity: number;
    price: number;
    commission: number;
    fees: number;
  }>;
  dayNote: string;
  tradeNote: string;
  reviewSetup: string;
  reviewThesis: string;
  reviewEntry: string;
  reviewExit: string;
  reviewMistake: string;
  reviewLesson: string;
  reviewFollowUp: string;
  reviewUpdatedAt: string | null;
  closedTradeTags: string[];
  journalEntryId: string | null;
};

type ReviewDraft = {
  content: string;
  setup: string;
  thesis: string;
  entryReview: string;
  exitReview: string;
  mistake: string;
  lesson: string;
  followUp: string;
  tags: string;
};

type StructuredReviewFieldKey = "setup" | "thesis" | "entryReview" | "exitReview" | "mistake" | "lesson" | "followUp";
type ReviewCompletion = {
  completed: number;
  total: number;
  missingLabels: string[];
};
type ReviewQueueKind = "incomplete" | "unsaved" | "noJournal" | "complete";
type ReviewQueueCounts = Record<ReviewQueueKind | "total", number>;
type ReviewQueueTargets = Record<ReviewQueueKind, string | null>;
type ReviewQueueItem = {
  groupKey: string;
  incomplete: boolean;
  unsaved: boolean;
  noJournal: boolean;
  complete: boolean;
};

type WorkstationMode = "full" | "review" | "chart";
type ReviewFieldGroup = "core" | "exit" | "lessons" | "tags" | "all";
type ReviewSaveActivity = {
  id: number;
  message: string;
  sourceGroupKey: string;
  targetGroupKey: string | null;
};

const CLEAN_CHART_SAVE_ACTIVITY: ChartWorkspaceSaveActivity = {
  blocking: false,
  message: "",
  layoutSaveState: "clean",
  annotationSaveState: "clean",
};
const CHART_SAVE_NEEDS_ATTENTION_NOTICE = "Chart save needs attention. Resolve it, then retry the action.";

function chartSaveNeedsAttention(activity: ChartWorkspaceSaveActivity) {
  return (
    activity.layoutSaveState === "error" ||
    activity.layoutSaveState === "conflict" ||
    activity.annotationSaveState === "error" ||
    activity.annotationSaveState === "conflict"
  );
}

const REVIEW_FIELD_GROUPS: Array<{ label: string; value: ReviewFieldGroup }> = [
  { label: "Core", value: "core" },
  { label: "Exit", value: "exit" },
  { label: "Lessons", value: "lessons" },
  { label: "Tags", value: "tags" },
  { label: "All", value: "all" },
];
const REVIEW_COMPLETION_FIELDS: Array<{ key: StructuredReviewFieldKey; label: string }> = [
  { key: "setup", label: "Setup" },
  { key: "thesis", label: "Thesis" },
  { key: "entryReview", label: "Entry" },
  { key: "exitReview", label: "Exit" },
  { key: "mistake", label: "Mistake" },
  { key: "lesson", label: "Lesson" },
  { key: "followUp", label: "Follow Up" },
];

function formatDateLabel(tradeDate: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${tradeDate}T00:00:00.000Z`));
}

function formatTimeLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatDateTimeLabel(value: string) {
  return `${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value))} ${formatTimeLabel(value)}`;
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatQuantity(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 4,
  }).format(value);
}

function formatOptionalCurrency(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  return formatCurrency(value);
}

function formatHoldTime(openTime: string, closeTime: string) {
  const diffMs = Math.max(0, new Date(closeTime).getTime() - new Date(openTime).getTime());
  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function metricTone(value: number | null) {
  if (value === null) return "text-slate-500";
  if (value > 0) return "text-emerald-600";
  if (value < 0) return "text-red-600";
  return "text-slate-700";
}

function draftFromTrade(trade: ClosedTrade): ReviewDraft {
  return {
    content: trade.tradeNote ?? "",
    setup: trade.reviewSetup ?? "",
    thesis: trade.reviewThesis ?? "",
    entryReview: trade.reviewEntry ?? "",
    exitReview: trade.reviewExit ?? "",
    mistake: trade.reviewMistake ?? "",
    lesson: trade.reviewLesson ?? "",
    followUp: trade.reviewFollowUp ?? "",
    tags: trade.closedTradeTags.join(", "),
  };
}

function parseTags(value: string) {
  return [...new Set(value.split(/[,\n]/).map((tag) => tag.trim().replace(/^#/, "").toLowerCase()).filter(Boolean))];
}

function draftsEqual(left: ReviewDraft, right: ReviewDraft) {
  return (
    left.content === right.content &&
    left.setup === right.setup &&
    left.thesis === right.thesis &&
    left.entryReview === right.entryReview &&
    left.exitReview === right.exitReview &&
    left.mistake === right.mistake &&
    left.lesson === right.lesson &&
    left.followUp === right.followUp &&
    parseTags(left.tags).join("|") === parseTags(right.tags).join("|")
  );
}

function reviewCompletionFromDraft(draft: ReviewDraft): ReviewCompletion {
  const missingLabels = REVIEW_COMPLETION_FIELDS.filter(({ key }) => draft[key].trim().length === 0).map(({ label }) => label);
  return {
    completed: REVIEW_COMPLETION_FIELDS.length - missingLabels.length,
    total: REVIEW_COMPLETION_FIELDS.length,
    missingLabels,
  };
}

function reviewCompletionLabel(completion: ReviewCompletion) {
  return `Review ${completion.completed}/${completion.total}`;
}

function reviewCompletionTitle(completion: ReviewCompletion) {
  return completion.missingLabels.length > 0 ? `Missing: ${completion.missingLabels.join(", ")}` : "All structured review fields complete";
}

function reviewCompletionTone(completion: ReviewCompletion) {
  if (completion.completed === completion.total) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (completion.completed === 0) return "border-red-200 bg-red-50 text-red-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function reviewQueueItemFromTrade(trade: ClosedTrade, draft: ReviewDraft, savedDraft: ReviewDraft): ReviewQueueItem {
  const completion = reviewCompletionFromDraft(draft);
  return {
    groupKey: trade.groupKey,
    incomplete: completion.completed < completion.total,
    unsaved: !draftsEqual(draft, savedDraft),
    noJournal: !trade.journalEntryId,
    complete: completion.completed === completion.total,
  };
}

function reviewQueueMatches(item: ReviewQueueItem, kind: ReviewQueueKind) {
  return item[kind];
}

function selectedGroupKeyHref(groupKey: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("groupKey", groupKey);
  return `${url.pathname}${url.search}${url.hash}`;
}

function replaceSelectedGroupKeyInUrl(groupKey: string) {
  const url = new URL(window.location.href);
  if (url.searchParams.get("groupKey") === groupKey) return;
  window.history.replaceState(window.history.state, "", selectedGroupKeyHref(groupKey));
}

function findNextReviewQueueGroupKey(items: ReviewQueueItem[], kind: ReviewQueueKind, selectedGroupKey: string | null) {
  if (items.length === 0) return null;

  const selectedIndex = Math.max(0, items.findIndex((item) => item.groupKey === selectedGroupKey));
  for (let offset = 1; offset <= items.length; offset += 1) {
    const item = items[(selectedIndex + offset) % items.length];
    if (reviewQueueMatches(item, kind)) {
      return item.groupKey;
    }
  }

  return null;
}

function reviewQueueCountsFromItems(items: ReviewQueueItem[]): ReviewQueueCounts {
  return items.reduce<ReviewQueueCounts>(
    (counts, item) => ({
      total: counts.total + 1,
      incomplete: counts.incomplete + (item.incomplete ? 1 : 0),
      unsaved: counts.unsaved + (item.unsaved ? 1 : 0),
      noJournal: counts.noJournal + (item.noJournal ? 1 : 0),
      complete: counts.complete + (item.complete ? 1 : 0),
    }),
    { total: 0, incomplete: 0, unsaved: 0, noJournal: 0, complete: 0 },
  );
}

function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function activeReviewFieldKey() {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return null;
  return activeElement.dataset.reviewField ?? null;
}

function focusReviewField(fieldKey: string) {
  const fields = Array.from(document.querySelectorAll<HTMLElement>("[data-review-field]"));
  const field = fields.find((element) => {
    if (element.dataset.reviewField !== fieldKey) return false;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      return !element.disabled;
    }
    return true;
  });
  field?.focus();
  return Boolean(field);
}

function sideBadgeVariant(side: "BUY" | "SELL") {
  return side === "BUY" ? "success" : "danger";
}

export function ClosedTradesPanel({
  closedTrades,
  initialSelectedGroupKey = null,
}: {
  closedTrades: ClosedTrade[];
  initialSelectedGroupKey?: string | null;
}) {
  const router = useRouter();
  const sortedTrades = useMemo(
    () =>
      [...closedTrades].sort((left, right) => {
        if (left.isStale !== right.isStale) return left.isStale ? 1 : -1;
        return right.closeTime.localeCompare(left.closeTime) || left.groupKey.localeCompare(right.groupKey);
      }),
    [closedTrades],
  );
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(() => {
    if (initialSelectedGroupKey) {
      return sortedTrades.some((trade) => trade.groupKey === initialSelectedGroupKey) ? initialSelectedGroupKey : null;
    }
    return sortedTrades[0]?.groupKey ?? null;
  });
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, ReviewDraft>>({});
  const [savedReviewDrafts, setSavedReviewDrafts] = useState<Record<string, ReviewDraft>>({});
  const [reviewUpdatedAt, setReviewUpdatedAt] = useState<Record<string, string | null>>({});
  const [reviewConflicts, setReviewConflicts] = useState<Record<string, boolean>>({});
  const [reviewLocks, setReviewLocks] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  const [workstationMode, setWorkstationMode] = useState<WorkstationMode>("full");
  const [reviewDockOpen, setReviewDockOpen] = useState(false);
  const [chartSaveActivity, setChartSaveActivity] = useState<ChartWorkspaceSaveActivity>(CLEAN_CHART_SAVE_ACTIVITY);
  const chartSaveActivityRef = useRef<ChartWorkspaceSaveActivity>(CLEAN_CHART_SAVE_ACTIVITY);
  const [workspaceNotice, setWorkspaceNotice] = useState("");
  const [pendingReviewSwitchGroupKey, setPendingReviewSwitchGroupKey] = useState<string | null>(null);
  const [pendingJournalOpenGroupKey, setPendingJournalOpenGroupKey] = useState<string | null>(null);
  const journalOpenRequestGroupKeyRef = useRef<string | null>(null);
  const [reviewSaveActivity, setReviewSaveActivity] = useState<ReviewSaveActivity | null>(null);
  const reviewSaveActivityRef = useRef<ReviewSaveActivity | null>(null);
  const reviewSaveActivityIdRef = useRef(0);
  const pendingReviewFocusFieldRef = useRef<string | null>(null);
  const routeSelectionAfterSaveRef = useRef<string | null>(null);
  const [pending, startTransition] = useTransition();
  const reviewSaveBlocking = Boolean(reviewSaveActivity);
  const chartSaveActionNeedsAttention = chartSaveNeedsAttention(chartSaveActivity);
  const dirtyReviewGroupKeys = useMemo(
    () =>
      sortedTrades
        .filter((trade) => {
          const savedDraft = savedReviewDrafts[trade.groupKey] ?? draftFromTrade(trade);
          const draft = reviewDrafts[trade.groupKey] ?? savedDraft;
          return !draftsEqual(draft, savedDraft);
        })
        .map((trade) => trade.groupKey),
    [reviewDrafts, savedReviewDrafts, sortedTrades],
  );

  useEffect(() => {
    if (sortedTrades.length === 0) {
      setSelectedGroupKey(null);
      return;
    }
    if (initialSelectedGroupKey && !sortedTrades.some((trade) => trade.groupKey === initialSelectedGroupKey)) {
      setSelectedGroupKey(null);
      return;
    }
    if (!sortedTrades.some((trade) => trade.groupKey === selectedGroupKey)) {
      setSelectedGroupKey(sortedTrades[0].groupKey);
    }
  }, [initialSelectedGroupKey, selectedGroupKey, sortedTrades]);

  useEffect(() => {
    if (initialSelectedGroupKey && sortedTrades.some((trade) => trade.groupKey === initialSelectedGroupKey)) {
      setSelectedGroupKey(initialSelectedGroupKey);
    }
  }, [initialSelectedGroupKey, sortedTrades]);

  useEffect(() => {
    if (!selectedGroupKey) return;
    if (routeSelectionAfterSaveRef.current === selectedGroupKey) {
      routeSelectionAfterSaveRef.current = null;
      router.replace(selectedGroupKeyHref(selectedGroupKey), { scroll: false });
      return;
    }
    replaceSelectedGroupKeyInUrl(selectedGroupKey);
  }, [router, selectedGroupKey]);

  useEffect(() => {
    const fieldKey = pendingReviewFocusFieldRef.current;
    if (!fieldKey) return;

    const frameId = window.requestAnimationFrame(() => {
      if (focusReviewField(fieldKey)) {
        pendingReviewFocusFieldRef.current = null;
      }
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [selectedGroupKey]);

  useEffect(() => {
    if (dirtyReviewGroupKeys.length === 0) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirtyReviewGroupKeys.length]);

  useWorkstationNavigationGuard((action) => {
    const reviewSave = reviewSaveActivityRef.current;
    if (reviewSave) {
      setWorkspaceNotice(reviewSave.message);
      return false;
    }

    const chartSave = chartSaveActivityRef.current;
    if (chartSave.blocking || chartSaveNeedsAttention(chartSave)) {
      setWorkspaceNotice(chartSave.message || CHART_SAVE_NEEDS_ATTENTION_NOTICE);
      return false;
    }

    const journalGroupKey = journalOpenRequestGroupKeyRef.current ?? pendingJournalOpenGroupKey;
    if (journalGroupKey) {
      setWorkspaceNotice("Journal review is opening. Wait for the request to finish before leaving this page.");
      return false;
    }

    if (dirtyReviewGroupKeys.length === 0) return true;
    const confirmed = window.confirm(
      `You have unsaved structured review changes for ${dirtyReviewGroupKeys.length} trade${dirtyReviewGroupKeys.length === 1 ? "" : "s"}. Save before you ${action}, or discard those drafts to continue.`,
    );
    if (!confirmed) {
      setWorkspaceNotice("Unsaved review changes preserved. Save before leaving the trade workstation.");
    }
    return confirmed;
  });

  const setActiveReviewSaveActivity = useCallback((activity: ReviewSaveActivity | null) => {
    reviewSaveActivityRef.current = activity;
    setReviewSaveActivity(activity);
  }, []);

  const clearReviewSaveActivity = useCallback((activityId: number) => {
    if (reviewSaveActivityRef.current?.id !== activityId) return;
    setActiveReviewSaveActivity(null);
  }, [setActiveReviewSaveActivity]);

  useEffect(() => {
    if (!chartSaveActivity.blocking && !chartSaveActionNeedsAttention && !reviewSaveActivity && workspaceNotice) {
      setWorkspaceNotice("");
    }
  }, [chartSaveActionNeedsAttention, chartSaveActivity.blocking, reviewSaveActivity, workspaceNotice]);

  useEffect(() => {
    if (!pendingReviewSwitchGroupKey) return;
    if (chartSaveActionNeedsAttention) {
      setPendingReviewSwitchGroupKey(null);
      pendingReviewFocusFieldRef.current = null;
      const activity = reviewSaveActivityRef.current;
      if (activity?.targetGroupKey === pendingReviewSwitchGroupKey) {
        setActiveReviewSaveActivity(null);
        setStatus((prev) => ({ ...prev, [activity.sourceGroupKey]: CHART_SAVE_NEEDS_ATTENTION_NOTICE }));
      }
      setWorkspaceNotice(CHART_SAVE_NEEDS_ATTENTION_NOTICE);
      return;
    }
    if (chartSaveActivity.blocking) return;
    setWorkspaceNotice("");
    routeSelectionAfterSaveRef.current = pendingReviewSwitchGroupKey;
    setSelectedGroupKey(pendingReviewSwitchGroupKey);
    setPendingReviewSwitchGroupKey(null);
    const activity = reviewSaveActivityRef.current;
    if (activity?.targetGroupKey === pendingReviewSwitchGroupKey) {
      setActiveReviewSaveActivity(null);
    }
  }, [chartSaveActionNeedsAttention, chartSaveActivity.blocking, pendingReviewSwitchGroupKey, setActiveReviewSaveActivity]);

  const selectedTrade = useMemo(() => {
    const selected = sortedTrades.find((trade) => trade.groupKey === selectedGroupKey);
    if (selected) return selected;
    return initialSelectedGroupKey ? null : sortedTrades[0] ?? null;
  }, [initialSelectedGroupKey, selectedGroupKey, sortedTrades]);
  const selectedIndex = selectedTrade ? sortedTrades.findIndex((trade) => trade.groupKey === selectedTrade.groupKey) : -1;
  const previousTrade = selectedIndex > 0 ? sortedTrades[selectedIndex - 1] : null;
  const nextTrade = selectedIndex >= 0 && selectedIndex < sortedTrades.length - 1 ? sortedTrades[selectedIndex + 1] : null;
  const selectedPositionLabel = selectedIndex >= 0 ? `Trade ${selectedIndex + 1} of ${sortedTrades.length}` : "";
  const showsChart = workstationMode !== "review";
  const showsInspector = workstationMode !== "chart";

  const handleChartSaveActivityChange = useCallback((activity: ChartWorkspaceSaveActivity) => {
    chartSaveActivityRef.current = activity;
    setChartSaveActivity(activity);
  }, []);

  const blockUnsafeChartSwitch = useCallback(() => {
    const activity = chartSaveActivityRef.current;
    if (!showsChart || !activity.blocking) return false;
    setWorkspaceNotice(activity.message);
    return true;
  }, [showsChart]);

  const blockUnsafeJournalOpen = useCallback(() => {
    const activity = chartSaveActivityRef.current;
    if (!activity.blocking) return false;
    setWorkspaceNotice(activity.message);
    return true;
  }, []);

  const blockReviewSaveSwitch = useCallback(() => {
    const activity = reviewSaveActivityRef.current;
    if (!activity) return false;
    setWorkspaceNotice(activity.message);
    return true;
  }, []);

  const confirmDirtyReviewSwitch = useCallback((action: string) => {
    if (!selectedGroupKey || !dirtyReviewGroupKeys.includes(selectedGroupKey)) return true;

    const trade = sortedTrades.find((candidate) => candidate.groupKey === selectedGroupKey);
    const label = trade ? `${trade.symbol} ${formatDateLabel(trade.tradeDate)}` : "the selected trade";
    const confirmed = window.confirm(
      `You have unsaved structured review changes for ${label}. Save Review before you ${action}, or continue with the draft kept only in this browser tab.`,
    );

    if (!confirmed) {
      setStatus((prev) => ({
        ...prev,
        [selectedGroupKey]: "Unsaved review changes preserved. Save before switching trades or leaving this review.",
      }));
    }

    return confirmed;
  }, [dirtyReviewGroupKeys, selectedGroupKey, sortedTrades]);

  const selectTradeSafely = useCallback((groupKey: string, options?: { skipReviewDirtyGuard?: boolean }) => {
    if (groupKey === selectedGroupKey) return;
    if (blockReviewSaveSwitch()) return;
    if (blockUnsafeChartSwitch()) return;
    if (!options?.skipReviewDirtyGuard && !confirmDirtyReviewSwitch("switch trades")) return;
    setWorkspaceNotice("");
    replaceSelectedGroupKeyInUrl(groupKey);
    setSelectedGroupKey(groupKey);
  }, [blockReviewSaveSwitch, blockUnsafeChartSwitch, confirmDirtyReviewSwitch, selectedGroupKey]);

  const setWorkstationModeSafely = useCallback((mode: WorkstationMode) => {
    if (mode === workstationMode) return;
    if (blockReviewSaveSwitch()) return;
    if (showsChart && mode === "review" && blockUnsafeChartSwitch()) return;
    setWorkspaceNotice("");
    setWorkstationMode(mode);
  }, [blockReviewSaveSwitch, blockUnsafeChartSwitch, showsChart, workstationMode]);

  const savedDraftFromTrade = useCallback((trade: ClosedTrade) => {
    return savedReviewDrafts[trade.groupKey] ?? draftFromTrade(trade);
  }, [savedReviewDrafts]);
  const reviewQueueItems = useMemo(
    () =>
      sortedTrades.map((trade) => {
        const savedDraft = savedDraftFromTrade(trade);
        const draft = reviewDrafts[trade.groupKey] ?? savedDraft;
        return reviewQueueItemFromTrade(trade, draft, savedDraft);
      }),
    [reviewDrafts, savedDraftFromTrade, sortedTrades],
  );
  const reviewQueueCounts = useMemo(() => reviewQueueCountsFromItems(reviewQueueItems), [reviewQueueItems]);
  const reviewQueueTargets = useMemo<ReviewQueueTargets>(
    () => ({
      incomplete: findNextReviewQueueGroupKey(reviewQueueItems, "incomplete", selectedTrade?.groupKey ?? null),
      unsaved: findNextReviewQueueGroupKey(reviewQueueItems, "unsaved", selectedTrade?.groupKey ?? null),
      noJournal: findNextReviewQueueGroupKey(reviewQueueItems, "noJournal", selectedTrade?.groupKey ?? null),
      complete: findNextReviewQueueGroupKey(reviewQueueItems, "complete", selectedTrade?.groupKey ?? null),
    }),
    [reviewQueueItems, selectedTrade?.groupKey],
  );
  const jumpToReviewQueue = useCallback((kind: ReviewQueueKind) => {
    const groupKey = reviewQueueTargets[kind];
    if (!groupKey) return;
    selectTradeSafely(groupKey);
  }, [reviewQueueTargets, selectTradeSafely]);

  function saveTradeNote(trade: ClosedTrade, options?: { onSuccess?: () => void; targetGroupKey?: string | null }) {
    if (trade.isStale || reviewConflicts[trade.groupKey] || reviewLocks[trade.groupKey]) return;
    if (reviewSaveActivityRef.current) {
      setWorkspaceNotice(reviewSaveActivityRef.current.message);
      return;
    }

    const draft = reviewDrafts[trade.groupKey] ?? savedDraftFromTrade(trade);
    const updatedAt = reviewUpdatedAt[trade.groupKey] ?? trade.reviewUpdatedAt;
    const activity: ReviewSaveActivity = {
      id: reviewSaveActivityIdRef.current + 1,
      message: options?.targetGroupKey ? "Saving review before moving to next trade..." : "Saving review...",
      sourceGroupKey: trade.groupKey,
      targetGroupKey: options?.targetGroupKey ?? null,
    };
    reviewSaveActivityIdRef.current = activity.id;
    setActiveReviewSaveActivity(activity);
    setStatus((prev) => ({ ...prev, [trade.groupKey]: activity.message }));
    void (async () => {
      try {
        const normalizedTags = parseTags(draft.tags);
        const res = await fetch("/api/notes/closed-trade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groupKey: trade.groupKey, ...draft, tags: normalizedTags, updatedAt }),
        });
        const payload = await res.json().catch(() => ({}));
        if (res.ok) {
          const savedDraft = { ...draft, tags: normalizedTags.join(", ") };
          const nextUpdatedAt = typeof payload.updatedAt === "string" ? payload.updatedAt : updatedAt;
          setSavedReviewDrafts((prev) => ({ ...prev, [trade.groupKey]: savedDraft }));
          setReviewDrafts((prev) => ({ ...prev, [trade.groupKey]: savedDraft }));
          setReviewUpdatedAt((prev) => ({ ...prev, [trade.groupKey]: nextUpdatedAt }));
          setReviewConflicts((prev) => ({ ...prev, [trade.groupKey]: false }));
          setReviewLocks((prev) => {
            const next = { ...prev };
            delete next[trade.groupKey];
            return next;
          });
          setStatus((prev) => ({ ...prev, [trade.groupKey]: "Saved." }));
          const currentActivity = reviewSaveActivityRef.current;
          const canCompleteIntent =
            currentActivity?.id === activity.id &&
            currentActivity.sourceGroupKey === trade.groupKey &&
            currentActivity.targetGroupKey === activity.targetGroupKey;
          if (canCompleteIntent && activity.targetGroupKey && options?.onSuccess) {
            options.onSuccess();
          } else {
            clearReviewSaveActivity(activity.id);
          }
        } else if (res.status === 409) {
          const message = typeof payload.error === "string" ? payload.error : "Changed in another tab. Reload before saving.";
          const isStaleConflict =
            payload.code === "STALE_CLOSED_TRADE" ||
            payload.isStale === true ||
            (typeof payload.code !== "string" && message.toLowerCase().includes("stale"));
          setReviewConflicts((prev) => ({ ...prev, [trade.groupKey]: !isStaleConflict }));
          setReviewLocks((prev) => ({ ...prev, [trade.groupKey]: message }));
          setStatus((prev) => ({ ...prev, [trade.groupKey]: message }));
          pendingReviewFocusFieldRef.current = null;
          clearReviewSaveActivity(activity.id);
        } else {
          setStatus((prev) => ({ ...prev, [trade.groupKey]: "Save failed." }));
          pendingReviewFocusFieldRef.current = null;
          clearReviewSaveActivity(activity.id);
        }
      } catch {
        setStatus((prev) => ({ ...prev, [trade.groupKey]: "Save failed." }));
        pendingReviewFocusFieldRef.current = null;
        clearReviewSaveActivity(activity.id);
      }
    })();
  }

  const openJournalReview = useCallback((trade: ClosedTrade, options?: { skipChartSaveGuard?: boolean }) => {
    if (reviewConflicts[trade.groupKey]) return;
    if ((trade.isStale || reviewLocks[trade.groupKey]) && !trade.journalEntryId) return;

    const draft = reviewDrafts[trade.groupKey] ?? savedDraftFromTrade(trade);
    const savedDraft = savedDraftFromTrade(trade);
    if (!draftsEqual(draft, savedDraft)) {
      setStatus((prev) => ({ ...prev, [trade.groupKey]: "Save review before creating or opening the journal entry." }));
      return;
    }

    if (!options?.skipChartSaveGuard && blockUnsafeJournalOpen()) {
      const message = "Chart workspace is still saving. Opening journal when chart save finishes.";
      setPendingJournalOpenGroupKey(trade.groupKey);
      setWorkspaceNotice(message);
      setStatus((prev) => ({ ...prev, [trade.groupKey]: message }));
      return;
    }

    journalOpenRequestGroupKeyRef.current = trade.groupKey;
    startTransition(async () => {
      try {
        const expectedReviewUpdatedAt = reviewUpdatedAt[trade.groupKey] ?? trade.reviewUpdatedAt;
        const res = await fetch(`/api/closed-trades/${encodeURIComponent(trade.groupKey)}/journal`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedReviewUpdatedAt }),
        });
        const payload = await res.json().catch(() => ({}));
        if (res.ok) {
          setStatus((prev) => ({ ...prev, [trade.groupKey]: payload.created ? "Created journal review." : "Opening journal review." }));
          const journalEntryId =
            typeof payload.journalEntryId === "string"
              ? payload.journalEntryId
              : payload.entry && typeof payload.entry === "object" && "id" in payload.entry && typeof payload.entry.id === "string"
                ? payload.entry.id
                : null;
          journalOpenRequestGroupKeyRef.current = null;
          window.location.assign(journalEntryId ? `/journal?entryId=${encodeURIComponent(journalEntryId)}` : "/journal");
          return;
        }

        const message = typeof payload.error === "string" ? payload.error : "Failed to create journal review.";
        const code = typeof payload.code === "string" ? payload.code : "";
        const isStaleConflict =
          code === "STALE_CLOSED_TRADE" ||
          payload.isStale === true ||
          (typeof payload.code !== "string" && message.toLowerCase().includes("stale"));
        const isReviewVersionConflict = code === "CLOSED_TRADE_REVIEW_CHANGED";
        if (isStaleConflict || isReviewVersionConflict) {
          setReviewConflicts((prev) => ({ ...prev, [trade.groupKey]: isReviewVersionConflict }));
          setReviewLocks((prev) => ({ ...prev, [trade.groupKey]: message }));
        }
        setStatus((prev) => ({ ...prev, [trade.groupKey]: message }));
      } catch {
        setStatus((prev) => ({ ...prev, [trade.groupKey]: "Failed to open journal review." }));
      } finally {
        if (journalOpenRequestGroupKeyRef.current === trade.groupKey) {
          journalOpenRequestGroupKeyRef.current = null;
        }
      }
    });
  }, [blockUnsafeJournalOpen, reviewConflicts, reviewDrafts, reviewLocks, reviewUpdatedAt, savedDraftFromTrade, startTransition]);

  const switchAfterReviewSave = useCallback((groupKey: string) => {
    if (blockUnsafeChartSwitch()) {
      setPendingReviewSwitchGroupKey(groupKey);
      const activity = reviewSaveActivityRef.current;
      if (activity?.targetGroupKey === groupKey) {
        setActiveReviewSaveActivity({
          ...activity,
          message: "Review saved. Waiting for chart workspace save before switching...",
        });
      }
      setWorkspaceNotice("Review saved. Waiting for chart workspace save before switching...");
      return;
    }
    setWorkspaceNotice("");
    routeSelectionAfterSaveRef.current = groupKey;
    setSelectedGroupKey(groupKey);
    const activity = reviewSaveActivityRef.current;
    if (activity?.targetGroupKey === groupKey) {
      setActiveReviewSaveActivity(null);
    }
  }, [blockUnsafeChartSwitch, setActiveReviewSaveActivity]);

  useEffect(() => {
    if (!pendingJournalOpenGroupKey) return;
    if (chartSaveActionNeedsAttention) {
      setPendingJournalOpenGroupKey(null);
      setWorkspaceNotice(CHART_SAVE_NEEDS_ATTENTION_NOTICE);
      setStatus((prev) => ({ ...prev, [pendingJournalOpenGroupKey]: CHART_SAVE_NEEDS_ATTENTION_NOTICE }));
      return;
    }
    if (chartSaveActivity.blocking) return;
    const trade = sortedTrades.find((candidate) => candidate.groupKey === pendingJournalOpenGroupKey);
    setPendingJournalOpenGroupKey(null);
    if (!trade) return;
    setWorkspaceNotice("");
    openJournalReview(trade, { skipChartSaveGuard: true });
  }, [chartSaveActionNeedsAttention, chartSaveActivity.blocking, openJournalReview, pendingJournalOpenGroupKey, sortedTrades]);

  if (sortedTrades.length === 0) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-semibold text-slate-900">No closed trades found.</p>
        <p className="mt-1 text-sm text-slate-500">Adjust the filters to review a different date range or symbol.</p>
      </section>
    );
  }

  if (!selectedTrade) {
    return (
      <section className="rounded-lg border border-amber-200 bg-amber-50 p-8 text-center shadow-sm">
        <p className="text-sm font-semibold text-amber-950">The requested closed trade is unavailable.</p>
        <p className="mt-1 text-sm text-amber-800">The deep link was preserved instead of opening a different trade.</p>
      </section>
    );
  }

  const selectedSavedDraft = savedDraftFromTrade(selectedTrade);
  const selectedReviewDraft = reviewDrafts[selectedTrade.groupKey] ?? selectedSavedDraft;
  const selectedReviewDirty = !draftsEqual(selectedReviewDraft, selectedSavedDraft);
  const selectedReviewConflict = reviewConflicts[selectedTrade.groupKey] ?? false;
  const selectedReadOnlyReason =
    reviewLocks[selectedTrade.groupKey] ??
    (selectedTrade.isStale ? "This materialized trade is stale. Review data is preserved read-only until you refresh or relink it." : "");
  const selectedReviewStatus =
    reviewSaveActivity?.sourceGroupKey === selectedTrade.groupKey ? reviewSaveActivity.message : status[selectedTrade.groupKey];
  const selectedReviewCompletion = reviewCompletionFromDraft(selectedReviewDraft);
  const journalOpenWaiting = pendingJournalOpenGroupKey === selectedTrade.groupKey;
  const showsChartReviewRail = workstationMode === "chart" && reviewDockOpen;
  const updateSelectedReviewDraft = (patch: Partial<ReviewDraft>) =>
    setReviewDrafts((prev) => ({
      ...prev,
      [selectedTrade.groupKey]: { ...(prev[selectedTrade.groupKey] ?? savedDraftFromTrade(selectedTrade)), ...patch },
    }));
  const saveSelectedTrade = () => saveTradeNote(selectedTrade);
  const saveSelectedTradeAndNext = () => {
    const nextGroupKey = nextTrade?.groupKey;
    pendingReviewFocusFieldRef.current = nextGroupKey ? activeReviewFieldKey() : null;
    saveTradeNote(selectedTrade, {
      targetGroupKey: nextGroupKey ?? null,
      onSuccess: () => {
        if (nextGroupKey) switchAfterReviewSave(nextGroupKey);
      },
    });
  };
  const previousSelectedTrade = previousTrade && !reviewSaveBlocking ? () => selectTradeSafely(previousTrade.groupKey) : undefined;
  const nextSelectedTrade = nextTrade && !reviewSaveBlocking ? () => selectTradeSafely(nextTrade.groupKey) : undefined;
  const openSelectedJournalReview = () => openJournalReview(selectedTrade);

  return (
    <section
      className={cn(
        "grid overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm xl:h-[calc(100vh-11.5rem)] xl:min-h-[720px]",
        workstationMode === "full" &&
          "xl:grid-cols-[300px_minmax(0,1fr)] xl:grid-rows-[minmax(220px,0.42fr)_minmax(0,0.58fr)] 2xl:grid-cols-[300px_minmax(0,1fr)_310px] 2xl:grid-rows-[minmax(0,1fr)]",
        workstationMode === "chart" && (showsChartReviewRail ? "xl:grid-cols-[minmax(0,1fr)]" : "xl:grid-cols-[260px_minmax(0,1fr)]"),
        workstationMode === "review" && "xl:grid-cols-[320px_minmax(0,1fr)]",
      )}
      data-workstation-mode={workstationMode}
      data-chart-save-blocking={chartSaveActivity.blocking ? "true" : "false"}
      data-chart-save-message={chartSaveActivity.message}
      data-testid="closed-trade-workstation"
    >
      <aside
        className={cn(
          "min-h-0 border-b border-slate-200 bg-white xl:border-b-0 xl:border-r",
          workstationMode === "full" && "xl:col-start-1 xl:row-start-1 2xl:row-span-1",
          workstationMode !== "full" && "xl:col-start-1",
          showsChartReviewRail && "xl:hidden",
        )}
      >
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">Closed Trades</p>
            <p className="text-sm font-semibold text-slate-950">{sortedTrades.length.toLocaleString()} entries</p>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1" data-testid="workstation-mode-controls">
            <ModeButton active={workstationMode === "full"} icon={LayoutDashboard} label="Full workstation" onClick={() => setWorkstationModeSafely("full")} />
            <ModeButton active={workstationMode === "review"} icon={BookOpen} label="Review focus" onClick={() => setWorkstationModeSafely("review")} />
            <ModeButton active={workstationMode === "chart"} icon={BarChart3} label="Chart focus" onClick={() => setWorkstationModeSafely("chart")} />
          </div>
        </div>
        {workspaceNotice ? (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-800" data-testid="chart-save-guard">
            {workspaceNotice}
          </div>
        ) : null}
        <div className="max-h-[460px] overflow-y-auto xl:h-[calc(100%-3.5rem)] xl:max-h-none">
          <ClosedTradeReviewQueueCommandBar
            counts={reviewQueueCounts}
            disabled={reviewSaveBlocking}
            onJump={jumpToReviewQueue}
            targets={reviewQueueTargets}
          />
          {sortedTrades.map((trade) => {
            const selected = trade.groupKey === selectedTrade.groupKey;
            const profitable = trade.realizedPnl > 0;
            const losing = trade.realizedPnl < 0;
            const resultLabel = profitable ? "Winner" : losing ? "Loser" : "Break-even";
            const resultClassName = profitable ? "text-emerald-600" : losing ? "text-red-600" : "text-slate-600";
            const savedDraft = savedDraftFromTrade(trade);
            const draft = reviewDrafts[trade.groupKey] ?? savedDraft;
            const dirty = !draftsEqual(draft, savedDraft);
            const completion = reviewCompletionFromDraft(draft);
            const tags = parseTags(savedDraft.tags);
            const reviewSaveLocked = reviewSaveBlocking;
            return (
              <button
                key={trade.groupKey}
                type="button"
                disabled={reviewSaveLocked}
                data-account-code={trade.accountCode}
                data-account-id={trade.accountId}
                data-group-key={trade.groupKey}
                aria-current={selected ? "true" : undefined}
                className={cn(
                  "block w-full border-b border-slate-200 border-l-4 px-3 py-3 text-left",
                  selected ? "border-l-teal-500 bg-cyan-50/80" : "border-l-transparent bg-white hover:bg-slate-50",
                  reviewSaveLocked && "cursor-not-allowed opacity-70 hover:bg-white",
                )}
                onClick={() => selectTradeSafely(trade.groupKey)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-base font-semibold tracking-tight text-slate-950">{trade.symbol}</p>
                      <Badge variant={trade.direction === "LONG" ? "success" : "danger"} className="px-2 py-0.5 tracking-normal">
                        {trade.direction}
                      </Badge>
                      {trade.isStale ? (
                        <Badge variant="outline" className="px-2 py-0.5 tracking-normal text-amber-700">
                          STALE
                        </Badge>
                      ) : null}
                      {dirty ? (
                        <Badge variant="outline" className="px-2 py-0.5 tracking-normal text-sky-700">
                          UNSAVED
                        </Badge>
                      ) : null}
                      {reviewSaveActivity?.sourceGroupKey === trade.groupKey ? (
                        <Badge variant="outline" className="px-2 py-0.5 tracking-normal text-amber-700">
                          SAVING
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <p className="text-xs text-slate-500">{formatDateLabel(trade.tradeDate)}</p>
                      <Badge
                        variant="outline"
                        className={cn("px-1.5 py-0 text-[10px] tracking-normal", reviewCompletionTone(completion))}
                        data-testid="review-completion-badge"
                        title={reviewCompletionTitle(completion)}
                      >
                        {reviewCompletionLabel(completion)}
                      </Badge>
                    </div>
                  </div>
                  <p className={cn("shrink-0 text-sm font-semibold", resultClassName)}>
                    {formatCurrency(trade.realizedPnl)}
                  </p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <Metric label="Entry / Exit" value={`${trade.avgEntryPrice.toFixed(2)} / ${trade.avgExitPrice.toFixed(2)}`} />
                  <Metric label="Executions" value={trade.executions.length.toString()} />
                  <Metric label="Return" value={formatPercent(trade.priceReturnPct)} valueClassName={metricTone(trade.priceReturnPct)} />
                  <Metric label="Result" value={resultLabel} valueClassName={resultClassName} />
                </div>
                {tags.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {tags.slice(0, 4).map((tag) => (
                      <Badge key={tag} variant="outline" className="px-1.5 py-0 text-[10px] tracking-normal text-slate-600">
                        #{tag}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      </aside>

      {showsChart ? (
        <main
          className={cn(
            "min-w-0 bg-white",
            showsChartReviewRail ? "overflow-hidden xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(24rem,30rem)]" : "overflow-auto",
            workstationMode === "full" && "xl:col-start-2 xl:row-span-2 xl:row-start-1 2xl:row-span-1",
            workstationMode !== "full" && !showsChartReviewRail && "xl:col-start-2",
          )}
          data-testid="closed-trade-chart-region"
        >
          <div
            className={cn(
              "h-full min-w-0 overflow-auto",
              workstationMode === "chart" && reviewDockOpen && "pb-[58vh] xl:pb-0",
            )}
            data-testid="closed-trade-chart-surface"
          >
            <ClosedTradeChartWorkspace onSaveActivityChange={handleChartSaveActivityChange} trade={selectedTrade} />
          </div>
          {workstationMode === "chart" ? (
            <ChartReviewDock
              conflict={selectedReviewConflict}
              draft={selectedReviewDraft}
              onDraftChange={updateSelectedReviewDraft}
              onNext={nextSelectedTrade}
              onOpenChange={setReviewDockOpen}
              onOpenJournal={openSelectedJournalReview}
              onPrevious={previousSelectedTrade}
              onSave={saveSelectedTrade}
              onSaveAndNext={saveSelectedTradeAndNext}
              open={reviewDockOpen}
              pending={pending || reviewSaveBlocking || journalOpenWaiting}
              positionLabel={selectedPositionLabel}
              readOnlyReason={selectedReadOnlyReason}
              reviewCompletion={selectedReviewCompletion}
              reviewDirty={selectedReviewDirty}
              status={selectedReviewStatus}
              trade={selectedTrade}
            />
          ) : null}
        </main>
      ) : null}

      {showsInspector ? (
        <TradeInspector
          className={cn(
            workstationMode === "full" &&
              "xl:col-start-1 xl:row-start-2 xl:border-l-0 xl:border-t 2xl:col-start-3 2xl:row-start-1 2xl:border-l 2xl:border-t-0",
          )}
          draft={selectedReviewDraft}
          onDraftChange={updateSelectedReviewDraft}
          onSave={saveSelectedTrade}
          onSaveAndNext={saveSelectedTradeAndNext}
          onPrevious={previousSelectedTrade}
          onNext={nextSelectedTrade}
          onOpenJournal={openSelectedJournalReview}
          pending={pending || reviewSaveBlocking || journalOpenWaiting}
          positionLabel={selectedPositionLabel}
          conflict={selectedReviewConflict}
          readOnlyReason={selectedReadOnlyReason}
          reviewCompletion={selectedReviewCompletion}
          reviewDirty={selectedReviewDirty}
          status={selectedReviewStatus}
          trade={selectedTrade}
        />
      ) : null}
    </section>
  );
}

function ModeButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof LayoutDashboard;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-white hover:text-slate-950",
        active && "bg-white text-slate-950 shadow-sm",
      )}
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function ClosedTradeReviewQueueCommandBar({
  counts,
  disabled,
  onJump,
  targets,
}: {
  counts: ReviewQueueCounts;
  disabled: boolean;
  onJump: (kind: ReviewQueueKind) => void;
  targets: ReviewQueueTargets;
}) {
  return (
    <div
      className="border-b border-slate-200 bg-slate-50/95 px-3 py-3 shadow-sm"
      data-testid="review-queue-command-bar"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Review Queue</p>
          <p className="text-xs text-slate-500">Jump to the next trade needing attention.</p>
        </div>
        <Badge
          variant="outline"
          className="shrink-0 bg-white px-2 py-0.5 text-[10px] tracking-normal text-slate-700"
          data-count={counts.total}
          data-testid="review-queue-count-total"
        >
          {counts.total}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <ReviewQueueActionButton
          count={counts.incomplete}
          countTestId="review-queue-count-incomplete"
          disabled={disabled}
          kind="incomplete"
          label="Needs Review"
          onJump={onJump}
          targetGroupKey={targets.incomplete}
          testId="review-queue-jump-next-incomplete"
          tone="amber"
        />
        <ReviewQueueActionButton
          count={counts.unsaved}
          countTestId="review-queue-count-unsaved"
          disabled={disabled}
          kind="unsaved"
          label="Unsaved"
          onJump={onJump}
          targetGroupKey={targets.unsaved}
          testId="review-queue-jump-unsaved"
          tone="sky"
        />
        <ReviewQueueActionButton
          count={counts.noJournal}
          countTestId="review-queue-count-no-journal"
          disabled={disabled}
          kind="noJournal"
          label="No Journal"
          onJump={onJump}
          targetGroupKey={targets.noJournal}
          testId="review-queue-jump-no-journal"
          tone="slate"
        />
        <ReviewQueueActionButton
          count={counts.complete}
          countTestId="review-queue-count-complete"
          disabled={disabled}
          kind="complete"
          label="Complete"
          onJump={onJump}
          targetGroupKey={targets.complete}
          testId="review-queue-jump-next"
          tone="emerald"
        />
      </div>
    </div>
  );
}

function ReviewQueueActionButton({
  count,
  countTestId,
  disabled,
  kind,
  label,
  onJump,
  targetGroupKey,
  testId,
  tone,
}: {
  count: number;
  countTestId: string;
  disabled: boolean;
  kind: ReviewQueueKind;
  label: string;
  onJump: (kind: ReviewQueueKind) => void;
  targetGroupKey: string | null;
  testId: string;
  tone: "amber" | "emerald" | "sky" | "slate";
}) {
  const disabledState = disabled || count === 0 || !targetGroupKey;
  const toneClassName =
    tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-800 hover:border-amber-300"
      : tone === "emerald"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:border-emerald-300"
        : tone === "sky"
          ? "border-sky-200 bg-sky-50 text-sky-800 hover:border-sky-300"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300";

  return (
    <button
      type="button"
      className={cn(
        "flex min-h-12 items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left text-xs font-semibold transition",
        toneClassName,
        disabledState && "cursor-not-allowed opacity-55 hover:border-slate-200",
      )}
      data-count={count}
      data-target-group-key={targetGroupKey ?? ""}
      data-testid={testId}
      disabled={disabledState}
      onClick={() => onJump(kind)}
      title={targetGroupKey ? `Jump to next ${label.toLowerCase()} trade` : `No ${label.toLowerCase()} trades`}
    >
      <span className="truncate">{label}</span>
      <span
        className="rounded-md bg-white/80 px-1.5 py-0.5 text-[11px] font-bold tabular-nums"
        data-count={count}
        data-testid={countTestId}
      >
        {count}
      </span>
    </button>
  );
}

function Metric({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] text-slate-500">{label}</p>
      <p className={cn("truncate font-medium text-slate-900", valueClassName)}>{value}</p>
    </div>
  );
}

function SummaryItem({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-2 text-sm">
      <p className="text-slate-500">{label}</p>
      <p className={cn("text-right font-medium text-slate-900", valueClassName)}>{value}</p>
    </div>
  );
}

type StructuredReviewEditorProps = {
  className?: string;
  conflict: boolean;
  draft: ReviewDraft;
  initialFieldGroup?: ReviewFieldGroup;
  onClose?: () => void;
  onDraftChange: (patch: Partial<ReviewDraft>) => void;
  onNext?: () => void;
  onOpenJournal: () => void;
  onPrevious?: () => void;
  onSave: () => void;
  onSaveAndNext: () => void;
  pending: boolean;
  positionLabel: string;
  readOnlyReason?: string;
  reviewCompletion: ReviewCompletion;
  reviewDirty: boolean;
  status?: string;
  trade: ClosedTrade;
};

function ChartReviewDock({
  open,
  onOpenChange,
  ...editorProps
}: StructuredReviewEditorProps & {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const stateLabel = editorProps.conflict ? "Conflict" : editorProps.reviewDirty ? "Unsaved" : editorProps.readOnlyReason ? "Read-only" : "Ready";

  if (!open) {
    return (
      <div className="fixed bottom-4 right-4 z-40" data-testid="chart-review-dock">
        <Button
          type="button"
          className="h-10 gap-2 rounded-lg shadow-lg"
          onClick={() => onOpenChange(true)}
          title="Open structured review"
        >
          <StickyNote className="h-4 w-4" />
          Review
          <Badge
            variant="outline"
            className={cn(
              "ml-1 bg-white/15 px-1.5 py-0 text-[10px] tracking-normal",
              (editorProps.conflict || editorProps.reviewDirty) && "border-amber-200 text-amber-700",
            )}
          >
            {stateLabel}
          </Badge>
          <Badge
            variant="outline"
            className={cn("ml-1 bg-white/15 px-1.5 py-0 text-[10px] tracking-normal", reviewCompletionTone(editorProps.reviewCompletion))}
            data-testid="chart-dock-review-completion"
            title={reviewCompletionTitle(editorProps.reviewCompletion)}
          >
            {editorProps.reviewCompletion.completed}/{editorProps.reviewCompletion.total}
          </Badge>
        </Button>
      </div>
    );
  }

  return (
    <div
      className="fixed bottom-4 right-4 z-40 w-[min(34rem,calc(100vw-2rem))] xl:static xl:z-auto xl:h-full xl:w-auto xl:self-stretch xl:p-3"
      data-testid="chart-review-dock"
    >
      <StructuredReviewEditor
        {...editorProps}
        className="max-h-[56vh] overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-2xl xl:h-full xl:max-h-none xl:shadow-none"
        initialFieldGroup="core"
        onClose={() => onOpenChange(false)}
      />
    </div>
  );
}

function StructuredReviewEditor({
  className,
  conflict,
  draft,
  initialFieldGroup = "all",
  onClose,
  onDraftChange,
  onNext,
  onOpenJournal,
  onPrevious,
  onSave,
  onSaveAndNext,
  pending,
  positionLabel,
  readOnlyReason,
  reviewCompletion,
  reviewDirty,
  status,
  trade,
}: StructuredReviewEditorProps) {
  const [fieldGroup, setFieldGroup] = useState<ReviewFieldGroup>(initialFieldGroup);
  const readOnly = Boolean(readOnlyReason) || conflict;
  const draftEditingDisabled = readOnly || pending;
  const journalActionDisabled = pending || conflict || reviewDirty || (!trade.journalEntryId && readOnly);
  const showsCore = fieldGroup === "core" || fieldGroup === "all";
  const showsExit = fieldGroup === "exit" || fieldGroup === "all";
  const showsLessons = fieldGroup === "lessons" || fieldGroup === "all";
  const showsTags = fieldGroup === "tags" || fieldGroup === "all";
  const saveAndNextDisabled = pending || readOnly || !onNext;
  const previousDisabled = pending || !onPrevious;
  const nextDisabled = pending || !onNext;
  const previousShortcut = "Alt+ArrowUp";
  const nextShortcut = "Alt+ArrowDown";

  return (
    <section
      className={cn("border-b border-slate-200 bg-white p-4", className)}
      data-testid="structured-review-editor"
      onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
        if (event.defaultPrevented || event.nativeEvent.isComposing) return;
        if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && !isEditableShortcutTarget(event.target)) {
          if (event.key === "ArrowUp" && onPrevious && !previousDisabled) {
            event.preventDefault();
            onPrevious();
            return;
          }
          if (event.key === "ArrowDown" && onNext && !nextDisabled) {
            event.preventDefault();
            onNext();
            return;
          }
        }
        if (event.defaultPrevented || event.nativeEvent.isComposing || saveAndNextDisabled) return;
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          onSaveAndNext();
        }
      }}
    >
      <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold uppercase text-slate-500">Structured Review</p>
              <Badge
                variant="outline"
                className={cn("px-1.5 py-0 text-[10px] tracking-normal", reviewCompletionTone(reviewCompletion))}
                data-testid="review-completion"
                title={reviewCompletionTitle(reviewCompletion)}
              >
                {reviewCompletionLabel(reviewCompletion)}
              </Badge>
            </div>
            {positionLabel ? (
              <p className="mt-0.5 text-xs font-medium text-slate-500" data-testid="review-position">
                {positionLabel}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1 rounded-lg"
              aria-keyshortcuts={previousShortcut}
              disabled={previousDisabled}
              onClick={onPrevious}
              title="Previous trade (Alt+Up)"
            >
              <ArrowUp className="h-3.5 w-3.5" />
              Previous
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1 rounded-lg"
              aria-keyshortcuts={nextShortcut}
              disabled={nextDisabled}
              onClick={onNext}
              title="Next trade (Alt+Down)"
            >
              Next
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
            {onClose ? (
              <Button type="button" size="sm" variant="outline" className="h-8 w-8 rounded-lg p-0" onClick={onClose} title="Close review">
                <X className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            className="h-8 gap-2 rounded-lg"
            disabled={pending || readOnly}
            onClick={onSave}
          >
            <Save className="h-3.5 w-3.5" />
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-lg"
            aria-keyshortcuts="Control+Enter Meta+Enter"
            disabled={saveAndNextDisabled}
            onClick={onSaveAndNext}
            title="Save and move to next trade"
          >
            Save & Next
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-2 rounded-lg"
            disabled={journalActionDisabled}
            onClick={onOpenJournal}
          >
            <BookOpen className="h-3.5 w-3.5" />
            {trade.journalEntryId ? "Open Journal" : "Create Journal"}
          </Button>
          {reviewDirty ? (
            <Badge variant="outline" className="tracking-normal text-amber-700">
              Unsaved
            </Badge>
          ) : null}
          {readOnly ? (
            <Badge variant="outline" className="tracking-normal text-amber-700">
              Read-only
            </Badge>
          ) : null}
        </div>
        <div className="mt-3 flex items-center gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-1" data-testid="review-field-groups">
          {REVIEW_FIELD_GROUPS.map((group) => (
            <button
              key={group.value}
              type="button"
              aria-pressed={fieldGroup === group.value}
              className={cn(
                "h-7 rounded-md px-2 text-xs font-semibold text-slate-600",
                fieldGroup === group.value && "bg-white text-slate-950 shadow-sm",
              )}
              onClick={() => setFieldGroup(group.value)}
            >
              {group.label}
            </button>
          ))}
        </div>
      </div>
      {reviewDirty ? (
        <p className="mb-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-800">
          Save this review before creating or opening a journal entry.
        </p>
      ) : null}
      {readOnlyReason ? (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          {readOnlyReason}
        </p>
      ) : null}
      {conflict ? (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <p className="font-semibold">This review changed elsewhere.</p>
          <p className="mt-1">Reload before continuing so another review is not copied or overwritten.</p>
          <Button type="button" size="sm" variant="outline" className="mt-2 h-8 rounded-lg" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      ) : null}
      <div className="space-y-3">
        {showsCore ? (
          <>
            <ReviewField
              disabled={draftEditingDisabled}
              fieldKey="setup"
              label="Setup"
              value={draft.setup}
              onChange={(value) => onDraftChange({ setup: value })}
            />
            <ReviewField
              disabled={draftEditingDisabled}
              fieldKey="thesis"
              label="Thesis"
              value={draft.thesis}
              onChange={(value) => onDraftChange({ thesis: value })}
            />
            <ReviewField
              disabled={draftEditingDisabled}
              fieldKey="entryReview"
              label="Entry"
              value={draft.entryReview}
              onChange={(value) => onDraftChange({ entryReview: value })}
            />
          </>
        ) : null}
        {showsExit ? (
          <ReviewField
            disabled={draftEditingDisabled}
            fieldKey="exitReview"
            label="Exit"
            value={draft.exitReview}
            onChange={(value) => onDraftChange({ exitReview: value })}
          />
        ) : null}
        {showsLessons ? (
          <>
            <ReviewField
              disabled={draftEditingDisabled}
              fieldKey="mistake"
              label="Mistake"
              value={draft.mistake}
              onChange={(value) => onDraftChange({ mistake: value })}
            />
            <ReviewField
              disabled={draftEditingDisabled}
              fieldKey="lesson"
              label="Lesson"
              value={draft.lesson}
              onChange={(value) => onDraftChange({ lesson: value })}
            />
            <ReviewField
              disabled={draftEditingDisabled}
              fieldKey="followUp"
              label="Follow Up"
              value={draft.followUp}
              onChange={(value) => onDraftChange({ followUp: value })}
            />
            <ReviewField
              disabled={draftEditingDisabled}
              fieldKey="content"
              label="Legacy / General Note"
              value={draft.content}
              onChange={(value) => onDraftChange({ content: value })}
            />
          </>
        ) : null}
        {showsTags ? (
          <label className="block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Tags
            <Input
              className="mt-1"
              data-review-field="tags"
              disabled={draftEditingDisabled}
              value={draft.tags}
              onChange={(event) => onDraftChange({ tags: event.target.value })}
              placeholder="breakout, late-entry, scale-out"
            />
          </label>
        ) : null}
      </div>
      {status && <p className="mt-3 text-xs text-slate-500">{status}</p>}
    </section>
  );
}

function TradeInspector({
  className,
  draft,
  onDraftChange,
  onNext,
  onOpenJournal,
  onPrevious,
  onSave,
  onSaveAndNext,
  pending,
  positionLabel,
  conflict,
  readOnlyReason,
  reviewCompletion,
  reviewDirty,
  status,
  trade,
}: {
  className?: string;
  draft: ReviewDraft;
  conflict: boolean;
  onDraftChange: (patch: Partial<ReviewDraft>) => void;
  onNext?: () => void;
  onOpenJournal: () => void;
  onPrevious?: () => void;
  onSave: () => void;
  onSaveAndNext: () => void;
  pending: boolean;
  positionLabel: string;
  readOnlyReason?: string;
  reviewCompletion: ReviewCompletion;
  reviewDirty: boolean;
  status?: string;
  trade: ClosedTrade;
}) {
  const executionRows = [...trade.executions].sort((left, right) => left.executedAt.localeCompare(right.executedAt));

  return (
    <aside className={cn("min-h-0 overflow-y-auto border-t border-slate-200 bg-white xl:border-l xl:border-t-0", className)}>
      <StructuredReviewEditor
        conflict={conflict}
        draft={draft}
        onDraftChange={onDraftChange}
        onNext={onNext}
        onOpenJournal={onOpenJournal}
        onPrevious={onPrevious}
        onSave={onSave}
        onSaveAndNext={onSaveAndNext}
        pending={pending}
        positionLabel={positionLabel}
        readOnlyReason={readOnlyReason}
        reviewCompletion={reviewCompletion}
        reviewDirty={reviewDirty}
        status={status}
        trade={trade}
      />

      <section className="border-b border-slate-200 p-4">
        <p className="text-xs font-semibold uppercase text-slate-500">Trade Summary</p>
        <div className="mt-3">
          <SummaryItem label="Symbol" value={trade.symbol} />
          <SummaryItem label="Direction" value={trade.direction} valueClassName={trade.direction === "LONG" ? "text-emerald-600" : "text-red-600"} />
          <SummaryItem label="Date" value={formatDateLabel(trade.tradeDate)} />
          <SummaryItem
            label="Realized P&L"
            value={formatCurrency(trade.realizedPnl)}
            valueClassName={trade.realizedPnl >= 0 ? "text-emerald-600" : "text-red-600"}
          />
          <SummaryItem label="Return" value={formatPercent(trade.priceReturnPct)} valueClassName={metricTone(trade.priceReturnPct)} />
          <SummaryItem label="Entry / Exit" value={`${trade.avgEntryPrice.toFixed(2)} / ${trade.avgExitPrice.toFixed(2)}`} />
          <SummaryItem label="Trade Time" value={`${formatTimeLabel(trade.openTime)} - ${formatTimeLabel(trade.closeTime)}`} />
          <SummaryItem label="Hold Time" value={formatHoldTime(trade.openTime, trade.closeTime)} />
          <SummaryItem label="Executions" value={trade.executions.length.toString()} />
          <SummaryItem label="Largest Size" value={formatQuantity(trade.largestExecutionQuantity)} />
          <SummaryItem label="Largest Notional" value={formatOptionalCurrency(trade.largestExecutionNotional)} />
          <SummaryItem label="Commission" value={formatCurrency(trade.totalCommission)} />
          <SummaryItem label="P&L / Equity" value={formatPercent(trade.equityReturnPct)} valueClassName={metricTone(trade.equityReturnPct)} />
          {trade.isStale ? (
            <SummaryItem label="Refresh Status" value={trade.staleReason ?? "Stale materialized trade"} valueClassName="text-amber-700" />
          ) : null}
        </div>
      </section>

      <section className="border-b border-slate-200 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase text-slate-500">Executions</p>
          <Clock3 className="h-4 w-4 text-slate-400" />
        </div>
        <div className="mt-3 space-y-3">
          {executionRows.map((execution) => (
            <div key={execution.id} className="grid grid-cols-[1rem_minmax(0,1fr)_auto] gap-3 text-sm">
              <span
                className={cn(
                  "mt-1.5 h-2.5 w-2.5 rounded-full",
                  execution.side === "BUY" ? "bg-emerald-500" : "bg-red-500",
                )}
              />
              <div className="min-w-0">
                <p className="font-medium text-slate-900">{formatDateTimeLabel(execution.executedAt)}</p>
                <p className="text-xs font-semibold text-slate-600">{execution.side}</p>
                <p className="text-xs text-slate-500">Qty: {formatQuantity(execution.quantity)}</p>
              </div>
              <div className="text-right">
                <Badge variant={sideBadgeVariant(execution.side)} className="justify-center px-2 py-0.5 tracking-normal">
                  {execution.side}
                </Badge>
                <p className="mt-1 text-sm font-semibold text-slate-950">{execution.price.toFixed(2)}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}

function ReviewField({
  disabled = false,
  fieldKey,
  label,
  onChange,
  value,
}: {
  disabled?: boolean;
  fieldKey: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
      {label}
      <Textarea
        className="mt-1 min-h-20"
        data-review-field={fieldKey}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

"use client";

/* eslint-disable @next/next/no-img-element */

import { useMemo, useState, useTransition } from "react";
import {
  BarChart3,
  BookOpenCheck,
  Filter,
  LinkIcon,
  Loader2,
  NotebookPen,
  RefreshCw,
  Save,
  Search,
  Tag,
  Trash2,
} from "lucide-react";
import { JournalChartEditor } from "@/components/journal-chart-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  JOURNAL_TAG_CATEGORIES,
  JOURNAL_TIMEFRAMES,
  normalizeJournalTags,
  type JournalTagCategoryValue,
  type JournalTimeframe,
} from "@/lib/journal/schema";
import { cn } from "@/lib/utils";

type TagsByCategory = Record<JournalTagCategoryValue, string[]>;
type JournalChart = {
  id: string;
  symbol: string;
  timeframe: string;
  screenshotUrl: string | null;
  caption: string;
  createdAt: string;
};
type JournalEntry = {
  id: string;
  symbol: string;
  ideaDate: string;
  direction: "LONG" | "SHORT";
  status: "DRAFT" | "WATCHING" | "MISSED" | "PASSED" | "INVALIDATED" | "PLAYBOOK" | "ARCHIVED";
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
  tags: TagsByCategory;
  charts: JournalChart[];
  contextSnapshots: Array<{ id: string; provider: string; kind: string; payloadJson: string; createdAt: string }>;
  links: Array<{ id: string; linkType: string; targetType: string; targetId: string | null; url: string | null; label: string | null }>;
  createdAt: string;
  updatedAt: string;
};
type JournalTagRow = { tagId: string; name: string; category: JournalTagCategoryValue; count: number };
type Tab = "journal" | "entry" | "visual";

const emptyTags = (): TagsByCategory => ({ SETUP: [], LESSON: [], MISTAKE: [], CONTEXT: [], CUSTOM: [] });

function blankForm(): Omit<JournalEntry, "id" | "charts" | "contextSnapshots" | "links" | "createdAt" | "updatedAt"> {
  return {
    symbol: "",
    ideaDate: new Date().toISOString(),
    direction: "LONG",
    status: "DRAFT",
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
    tags: emptyTags(),
  };
}

function dateInputValue(value: string) {
  return value.slice(0, 10);
}

function tagString(values: string[]) {
  return values.map((value) => `#${value}`).join(", ");
}

function parseTagInput(value: string) {
  return normalizeJournalTags(value.split(/[,\n\s]+/));
}

function coerceTimeframe(value: string): JournalTimeframe {
  return JOURNAL_TIMEFRAMES.includes(value as JournalTimeframe) ? (value as JournalTimeframe) : "1D";
}

function statusTone(status: JournalEntry["status"]) {
  if (status === "PLAYBOOK") return "success";
  if (status === "INVALIDATED" || status === "MISSED") return "danger";
  return "outline";
}

function sentimentClass(sentiment: JournalEntry["macroSentiment"]) {
  if (sentiment === "BULLISH") return "text-emerald-700";
  if (sentiment === "BEARISH") return "text-red-700";
  return "text-slate-700";
}

export function JournalWorkspace({
  initialEntries,
  initialTags,
}: {
  initialEntries: JournalEntry[];
  initialTags: JournalTagRow[];
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [tagRows, setTagRows] = useState(initialTags);
  const [activeTab, setActiveTab] = useState<Tab>("journal");
  const [form, setForm] = useState(blankForm());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [filterCategory, setFilterCategory] = useState<JournalTagCategoryValue | "">("");
  const [filterSentiment, setFilterSentiment] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [marketContext, setMarketContext] = useState<{
    peerGroupsUrl: string;
    metrics?: { rows?: Array<{ ticker: string; change1d: number | null; price: number | null; marketCap: number | null }> };
    detail?: { groups?: Array<{ id: string; name: string; members: Array<{ ticker: string; name: string | null }> }> };
    errors?: string[];
  } | null>(null);
  const [pending, startTransition] = useTransition();

  const selectedEntry = useMemo(() => entries.find((entry) => entry.id === selectedId) ?? null, [entries, selectedId]);
  const chartRows = useMemo(() => entries.flatMap((entry) => entry.charts.map((chart) => ({ entry, chart }))), [entries]);

  function selectEntry(entry: JournalEntry) {
    setSelectedId(entry.id);
    setForm({
      symbol: entry.symbol,
      ideaDate: entry.ideaDate,
      direction: entry.direction,
      status: entry.status,
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
      tags: entry.tags,
    });
    setMarketContext(null);
    setActiveTab("entry");
  }

  function newEntry() {
    setSelectedId(null);
    setForm(blankForm());
    setMarketContext(null);
    setActiveTab("entry");
  }

  async function reloadEntries(overrides?: {
    q?: string;
    tag?: string;
    category?: JournalTagCategoryValue | "";
    macroSentiment?: string;
    status?: string;
  }) {
    const params = new URLSearchParams();
    const nextQuery = overrides?.q ?? query;
    const nextTag = overrides?.tag ?? filterTag;
    const nextCategory = overrides?.category ?? filterCategory;
    const nextSentiment = overrides?.macroSentiment ?? filterSentiment;
    const nextStatus = overrides?.status ?? filterStatus;
    if (nextQuery) params.set("q", nextQuery);
    if (nextTag) params.set("tag", nextTag);
    if (nextCategory) params.set("category", nextCategory);
    if (nextSentiment) params.set("macroSentiment", nextSentiment);
    if (nextStatus) params.set("status", nextStatus);
    params.set("limit", "100");
    const [entryRes, tagRes] = await Promise.all([fetch(`/api/journal?${params.toString()}`), fetch("/api/journal/tags")]);
    if (!entryRes.ok) throw new Error("Failed to load journal entries.");
    const entryData = await entryRes.json();
    const tagData = tagRes.ok ? await tagRes.json() : { rows: tagRows };
    setEntries(entryData.rows ?? []);
    setTagRows(tagData.rows ?? []);
  }

  function saveEntry() {
    startTransition(async () => {
      try {
        setMessage("Saving journal entry...");
        const payload = {
          ...form,
          ideaDate: dateInputValue(form.ideaDate),
          symbol: form.symbol.trim().toUpperCase(),
          rating: form.rating ? Number(form.rating) : null,
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
        await reloadEntries();
        setMessage("Saved journal entry.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Failed to save journal entry.");
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
        setMessage("Deleted journal entry.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Failed to delete journal entry.");
      }
    });
  }

  function updateTags(category: JournalTagCategoryValue, value: string) {
    setForm((current) => ({ ...current, tags: { ...current.tags, [category]: parseTagInput(value) } }));
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

  return (
    <div className="space-y-5">
      <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-2 shadow-[0_18px_45px_-34px_rgba(15,23,42,0.32)]">
        <div className="flex flex-wrap gap-2">
          {[
            ["journal", "Journal", NotebookPen],
            ["entry", selectedId ? "Entry Detail" : "New Entry", Save],
            ["visual", "Visual Review", BarChart3],
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
            <NotebookPen className="h-4 w-4" />
            New
          </Button>
        </div>
      </div>

      {message && (
        <div className="rounded-2xl border border-slate-200/80 bg-white/85 px-4 py-3 text-sm text-slate-600">
          {pending && <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />}
          {message}
        </div>
      )}

      {activeTab === "journal" && (
        <div className="space-y-4">
          <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_12rem_12rem_12rem_12rem_auto]">
              <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Search
                <div className="relative mt-1">
                  <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} />
                </div>
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Tag
                <Input className="mt-1" value={filterTag} onChange={(event) => setFilterTag(event.target.value.replace(/^#+/, ""))} />
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Category
                <Select className="mt-1" value={filterCategory} onChange={(event) => setFilterCategory(event.target.value as JournalTagCategoryValue | "")}>
                  <option value="">Any</option>
                  {JOURNAL_TAG_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                </Select>
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Macro
                <Select className="mt-1" value={filterSentiment} onChange={(event) => setFilterSentiment(event.target.value)}>
                  <option value="">Any</option>
                  <option value="BULLISH">Bullish</option>
                  <option value="NEUTRAL">Neutral</option>
                  <option value="BEARISH">Bearish</option>
                </Select>
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Status
                <Select className="mt-1" value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}>
                  <option value="">Any</option>
                  {["DRAFT","WATCHING","MISSED","PASSED","INVALIDATED","PLAYBOOK","ARCHIVED"].map((status) => <option key={status} value={status}>{status}</option>)}
                </Select>
              </label>
              <div className="flex items-end gap-2">
                <Button onClick={() => startTransition(() => void reloadEntries())}>
                  <Filter className="h-4 w-4" />
                  Filter
                </Button>
              </div>
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
                      <Badge variant="outline" className={sentimentClass(entry.macroSentiment)}>{entry.macroSentiment}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{dateInputValue(entry.ideaDate)} | {entry.direction} | {entry.timeframe} | {entry.setup || "No setup"}</p>
                  </div>
                  <p className="text-sm font-semibold text-slate-700">{entry.rating ? `${entry.rating}/5` : "-"}</p>
                </div>
                <p className="mt-4 line-clamp-2 text-sm leading-6 text-slate-600">{entry.thesis || entry.lessonLearned || "No thesis yet."}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {JOURNAL_TAG_CATEGORIES.flatMap((category) => entry.tags[category].map((tag) => (
                    <span key={`${entry.id}-${category}-${tag}`} className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", category === "LESSON" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700")}>
                      #{tag}
                    </span>
                  )))}
                </div>
              </button>
            ))}
            {entries.length === 0 && <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-6 text-sm text-slate-500">No journal entries found.</div>}
          </div>
        </div>
      )}

      {activeTab === "entry" && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.4fr)]">
          <div className="space-y-4">
            <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Symbol<Input className="mt-1" value={form.symbol} onChange={(event) => setForm((current) => ({ ...current, symbol: event.target.value.toUpperCase() }))} /></label>
                <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Idea Date<Input className="mt-1" type="date" value={dateInputValue(form.ideaDate)} onChange={(event) => setForm((current) => ({ ...current, ideaDate: `${event.target.value}T00:00:00.000Z` }))} /></label>
                <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Direction<Select className="mt-1" value={form.direction} onChange={(event) => setForm((current) => ({ ...current, direction: event.target.value as JournalEntry["direction"] }))}><option value="LONG">Long</option><option value="SHORT">Short</option></Select></label>
                <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Status<Select className="mt-1" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as JournalEntry["status"] }))}>{["DRAFT","WATCHING","MISSED","PASSED","INVALIDATED","PLAYBOOK","ARCHIVED"].map((status) => <option key={status} value={status}>{status}</option>)}</Select></label>
                <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Setup<Input className="mt-1" value={form.setup ?? ""} onChange={(event) => setForm((current) => ({ ...current, setup: event.target.value }))} /></label>
                <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Timeframe<Select className="mt-1" value={form.timeframe} onChange={(event) => setForm((current) => ({ ...current, timeframe: event.target.value }))}>{JOURNAL_TIMEFRAMES.map((timeframe) => <option key={timeframe} value={timeframe}>{timeframe}</option>)}</Select></label>
                <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Macro Sentiment<Select className="mt-1" value={form.macroSentiment} onChange={(event) => setForm((current) => ({ ...current, macroSentiment: event.target.value as JournalEntry["macroSentiment"] }))}><option value="BULLISH">Bullish</option><option value="NEUTRAL">Neutral</option><option value="BEARISH">Bearish</option></Select></label>
                <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Rating<Input className="mt-1" min={1} max={5} type="number" value={form.rating ?? ""} onChange={(event) => setForm((current) => ({ ...current, rating: event.target.value ? Number(event.target.value) : null }))} /></label>
              </div>
              <div className="mt-4 grid gap-3">
                {[
                  ["Thesis", "thesis"],
                  ["Trigger", "trigger"],
                  ["Risk Plan", "riskPlan"],
                  ["Ideal Execution", "idealExecutionPlan"],
                  ["Missed / No-Trade Reason", "missedReason"],
                  ["Market Context", "marketContext"],
                  ["Peer Context", "peerContext"],
                  ["Lesson Learned", "lessonLearned"],
                ].map(([label, key]) => (
                  <label key={key} className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    {label}
                    <Textarea className="mt-1" value={String(form[key as keyof typeof form] ?? "")} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} />
                  </label>
                ))}
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {JOURNAL_TAG_CATEGORIES.map((category) => (
                  <label key={category} className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    {category === "LESSON" ? "Lesson Tags" : `${category} Tags`}
                    <Input className="mt-1" value={tagString(form.tags[category])} onChange={(event) => updateTags(category, event.target.value)} />
                  </label>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button disabled={pending || !form.symbol.trim()} onClick={saveEntry}><Save className="h-4 w-4" />Save Entry</Button>
                <Button variant="outline" disabled={pending || !form.symbol.trim()} onClick={loadMarketContext}><RefreshCw className="h-4 w-4" />Market Context</Button>
                {selectedId && <Button variant="destructive" disabled={pending} onClick={deleteEntry}><Trash2 className="h-4 w-4" />Delete</Button>}
              </div>
            </div>

            {marketContext && (
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
                {selectedId && <Button className="mt-4" size="sm" variant="outline" onClick={saveContextSnapshot}><BookOpenCheck className="h-4 w-4" />Save Snapshot</Button>}
              </div>
            )}
          </div>

          <div className="space-y-4">
            {selectedEntry ? (
              <>
                <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-5">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">Chart Capture</p>
                      <p className="text-sm text-slate-500">{selectedEntry.symbol} journal chart</p>
                    </div>
                  </div>
                  <JournalChartEditor entryId={selectedEntry.id} symbol={selectedEntry.symbol} initialTimeframe={coerceTimeframe(selectedEntry.timeframe)} onSaved={() => void reloadEntries()} />
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  {selectedEntry.charts.map((chart) => (
                    <div key={chart.id} className="rounded-[24px] border border-slate-200/80 bg-white/85 p-3">
                      {chart.screenshotUrl ? <img src={chart.screenshotUrl} alt={`${chart.symbol} saved chart`} className="aspect-[16/10] w-full rounded-2xl object-cover" /> : <div className="aspect-[16/10] rounded-2xl bg-slate-100" />}
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

      {activeTab === "visual" && (
        <div className="space-y-4">
          <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Tag className="h-4 w-4 text-slate-500" />
              {tagRows.map((row) => (
                <button key={`${row.category}-${row.name}`} className={cn("rounded-full px-3 py-1.5 text-xs font-medium", row.category === "LESSON" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700")} onClick={() => { setFilterTag(row.name); setFilterCategory(row.category); setActiveTab("journal"); startTransition(() => void reloadEntries({ tag: row.name, category: row.category })); }}>
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
                    <p className="text-xs text-slate-500">{chart.timeframe} | {dateInputValue(entry.ideaDate)}</p>
                  </div>
                  <Badge variant="outline">{entry.macroSentiment}</Badge>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-slate-600">{chart.caption || entry.lessonLearned || entry.thesis}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

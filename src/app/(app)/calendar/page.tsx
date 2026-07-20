import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  isSameUtcMonth,
  resolveUtcDateOnly,
  utcAddDays,
  utcAddMonths,
  utcAddYears,
  utcDateKey,
  utcEndOfMonth,
  utcStartOfMonth,
  utcStartOfWeekMonday,
  utcStartOfYear,
} from "@/lib/server/utc-date-range";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getCalendarPerformance } from "@/lib/server/queries";
import { cn, formatCurrency } from "@/lib/utils";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type CalendarView = "year" | "month" | "day";

const monthYearFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const shortMonthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
});

function parseDate(value?: string) {
  try {
    return resolveUtcDateOnly(value);
  } catch {
    notFound();
  }
}

function monthGrid(monthDate: Date) {
  const first = utcStartOfWeekMonday(utcStartOfMonth(monthDate));
  const last = utcEndOfMonth(monthDate);
  const weeks: Date[][] = [];
  let cursor = first;

  while (cursor <= last) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i += 1) {
      week.push(cursor);
      cursor = utcAddDays(cursor, 1);
    }
    weeks.push(week);
  }

  return weeks;
}

function weekGrid(day: Date) {
  const first = utcStartOfWeekMonday(day);
  return [Array.from({ length: 7 }, (_, index) => utcAddDays(first, index))];
}

function dailyPnlClass(total: number) {
  if (total > 0) return "border-emerald-200 bg-emerald-50/80 text-emerald-900";
  if (total < 0) return "border-rose-200 bg-rose-50/80 text-rose-900";
  return "border-slate-200 bg-white text-slate-900";
}

function compactCurrency(value: number) {
  if (!Number.isFinite(value) || value === 0) return "$0";
  const sign = value > 0 ? "+" : "-";
  const absolute = Math.abs(value);
  if (absolute >= 1000) {
    const digits = absolute >= 10_000 ? 0 : 1;
    return `${sign}$${(absolute / 1000).toFixed(digits)}k`;
  }
  return `${sign}$${Math.round(absolute)}`;
}

function viewHref(view: CalendarView, date: Date) {
  return `/calendar?view=${view}&date=${utcDateKey(date)}`;
}

export default async function CalendarPage(props: { searchParams: SearchParams }) {
  const searchParams = await props.searchParams;
  const selectedDate = parseDate(typeof searchParams.date === "string" ? searchParams.date : undefined);
  const selectedView = (typeof searchParams.view === "string" ? searchParams.view : "month") as CalendarView;
  const view: CalendarView = selectedView === "year" || selectedView === "month" || selectedView === "day" ? selectedView : "month";
  const selectedMonthKey = utcDateKey(selectedDate).slice(0, 7);
  const prevDate = view === "year" ? utcAddYears(selectedDate, -1) : utcAddMonths(selectedDate, -1);
  const nextDate = view === "year" ? utcAddYears(selectedDate, 1) : utcAddMonths(selectedDate, 1);
  const monthName = monthYearFormatter.format(selectedDate);
  const yearLabel = String(selectedDate.getUTCFullYear());

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Calendar Review"
        title="Scan performance by year, month, and day."
        description="This keeps your existing performance aggregation intact while turning the calendar into a cleaner planning and review surface."
      />
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-slate-200/80">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Performance Calendar</CardTitle>
            <div className="flex items-center gap-2">
              <Link href={viewHref("year", selectedDate)} className={view === "year" ? "rounded-2xl bg-slate-900 px-4 py-2 text-sm text-white" : "rounded-2xl border border-slate-200 bg-white/80 px-4 py-2 text-sm font-medium text-slate-700"}>
                Year
              </Link>
              <Link href={viewHref("month", selectedDate)} className={view === "month" ? "rounded-2xl bg-slate-900 px-4 py-2 text-sm text-white" : "rounded-2xl border border-slate-200 bg-white/80 px-4 py-2 text-sm font-medium text-slate-700"}>
                Month
              </Link>
              <Link href={viewHref("day", selectedDate)} className={view === "day" ? "rounded-2xl bg-slate-900 px-4 py-2 text-sm text-white" : "rounded-2xl border border-slate-200 bg-white/80 px-4 py-2 text-sm font-medium text-slate-700"}>
                Day
              </Link>
            </div>
          </div>
        </CardHeader>
        <Suspense fallback={<CalendarContentFallback />}>
          <CalendarContent
            selectedDate={selectedDate}
            selectedMonthKey={selectedMonthKey}
            view={view}
            prevDate={prevDate}
            nextDate={nextDate}
            yearLabel={yearLabel}
            monthName={monthName}
          />
        </Suspense>
      </Card>
    </div>
  );
}

async function CalendarContent({
  selectedDate,
  selectedMonthKey,
  view,
  prevDate,
  nextDate,
  yearLabel,
  monthName,
}: {
  selectedDate: Date;
  selectedMonthKey: string;
  view: CalendarView;
  prevDate: Date;
  nextDate: Date;
  yearLabel: string;
  monthName: string;
}) {
  const data = await getCalendarPerformance(selectedDate);
  const dayMap = new Map(data.days.map((row) => [row.date, row]));
  const monthlyTotals = new Map(data.monthlyTotals.map((row) => [row.month, row]));
  const selectedMonthTotals = monthlyTotals.get(selectedMonthKey) ?? { month: selectedMonthKey, realized: 0, mtm: 0, total: 0 };
  const selectedDay = dayMap.get(utcDateKey(selectedDate));
  const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const yearStart = utcStartOfYear(selectedDate);
  const months = Array.from({ length: 12 }, (_, index) => utcAddMonths(yearStart, index));

  return (
    <CardContent className="space-y-4 px-2 pt-4 sm:px-6 sm:pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200/80 bg-white/80 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] sm:rounded-[24px] sm:p-4">
        <div className="flex items-center gap-2">
          <Link href={viewHref(view, prevDate)} className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700">
            Prev
          </Link>
          <Link href={viewHref(view, nextDate)} className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700">
            Next
          </Link>
        </div>
        <div className="text-sm font-semibold text-slate-700">{view === "year" ? yearLabel : monthName}</div>
        <div className="text-right text-sm">
          <p className="text-slate-500">Monthly Total</p>
          <p
            className={selectedMonthTotals.total >= 0 ? "font-semibold text-emerald-700" : "font-semibold text-red-700"}
            data-testid="calendar-month-total"
          >
            {formatCurrency(selectedMonthTotals.total)}
          </p>
          <p className="text-xs text-slate-500">
            Realized {formatCurrency(selectedMonthTotals.realized)} | MTM {formatCurrency(selectedMonthTotals.mtm)}
          </p>
        </div>
      </div>

      {view === "year" && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {months.map((month) => {
            const grid = monthGrid(month);
            const monthKey = utcDateKey(month).slice(0, 7);
            const totals = monthlyTotals.get(monthKey) ?? { total: 0, realized: 0, mtm: 0 };
            return (
              <div key={monthKey} className="rounded-[24px] border border-slate-200/80 bg-white/85 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
                <div className="mb-2 flex items-center justify-between">
                  <Link className="text-sm font-semibold text-blue-700 hover:underline" href={viewHref("month", month)}>
                    {shortMonthFormatter.format(month)}
                  </Link>
                  <span className={totals.total >= 0 ? "text-xs font-semibold text-emerald-700" : "text-xs font-semibold text-red-700"}>
                    {formatCurrency(totals.total)}
                  </span>
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {weekDays.map((name) => (
                    <p key={`${monthKey}-${name}`} className="text-center text-[10px] text-slate-500">
                      {name.slice(0, 1)}
                    </p>
                  ))}
                  {grid.flat().map((date) => {
                    const key = utcDateKey(date);
                    const row = dayMap.get(key);
                    return (
                      <Link
                        key={`${monthKey}-${key}`}
                        href={viewHref("day", date)}
                        className={`${dailyPnlClass(row?.total ?? 0)} ${isSameUtcMonth(date, month) ? "" : "opacity-30"} rounded-xl border p-1.5 text-center text-[10px]`}
                      >
                        <p>{date.getUTCDate()}</p>
                        <p>{row ? `${Math.round(row.total)}` : "-"}</p>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view !== "year" && (
        <div className="space-y-3">
          <div className="grid grid-cols-7 gap-1 sm:gap-2" data-testid="calendar-day-grid">
            {weekDays.map((day) => (
              <p key={day} className="text-center text-xs font-medium text-slate-500">
                <span className="sm:hidden">{day.slice(0, 1)}</span>
                <span className="hidden sm:inline">{day}</span>
              </p>
            ))}

            {(view === "month" ? monthGrid(selectedDate) : weekGrid(selectedDate)).flat().map((date) => {
              const key = utcDateKey(date);
              const row = dayMap.get(key);
              const isCurrent = view === "day" ? true : isSameUtcMonth(date, selectedDate);
              return (
                <Link
                  key={key}
                  href={viewHref("day", date)}
                  className={`${dailyPnlClass(row?.total ?? 0)} ${isCurrent ? "" : "opacity-40"} min-h-16 min-w-0 overflow-hidden rounded-lg border p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] sm:min-h-24 sm:rounded-[20px] sm:p-3`}
                  data-date={key}
                  data-testid="calendar-day-cell"
                >
                  <p className="text-xs font-semibold">{date.getUTCDate()}</p>
                  <p
                    className={cn(
                      "mt-1 truncate text-[9px] font-semibold sm:hidden",
                      row && row.total < 0 ? "text-red-700" : row && row.total > 0 ? "text-emerald-700" : "text-slate-600",
                    )}
                    data-testid="calendar-day-compact-total"
                  >
                    {compactCurrency(row?.total ?? 0)}
                  </p>
                  <div className="hidden sm:block" data-testid="calendar-day-detail">
                    <p className="mt-2 text-xs">
                      Total:{" "}
                      <span className={row && row.total < 0 ? "font-semibold text-red-700" : "font-semibold text-emerald-700"}>
                        {formatCurrency(row?.total ?? 0)}
                      </span>
                    </p>
                    <p className="text-[11px] text-slate-600">Realized: {formatCurrency(row?.realized ?? 0)}</p>
                    <p className="text-[11px] text-slate-600">MTM: {formatCurrency(row?.mtm ?? 0)}</p>
                  </div>
                  {(row?.notes.length ?? 0) > 0 && (
                    <p className="mt-1 truncate text-[9px] text-slate-700 sm:text-[11px]">{row?.notes.length}<span className="hidden sm:inline"> note(s)</span></p>
                  )}
                </Link>
              );
            })}
          </div>

          {view === "day" && (
            <div className="rounded-[24px] border border-slate-200/80 bg-white/85 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-semibold">{utcDateKey(selectedDate)}</p>
                <p className={(selectedDay?.total ?? 0) >= 0 ? "font-semibold text-emerald-700" : "font-semibold text-red-700"}>
                  {formatCurrency(selectedDay?.total ?? 0)}
                </p>
              </div>
              <p className="text-sm text-slate-600">Realized: {formatCurrency(selectedDay?.realized ?? 0)}</p>
              <p className="text-sm text-slate-600">MTM: {formatCurrency(selectedDay?.mtm ?? 0)}</p>
              <div className="mt-3 space-y-2">
                {(selectedDay?.notes.length ?? 0) === 0 && <p className="text-sm text-slate-500">No day notes for this date.</p>}
                {selectedDay?.notes.map((note) => (
                  <div key={note.id} className="rounded-[18px] border border-slate-200/80 p-3">
                    <p className="text-xs font-semibold text-slate-500">{note.accountCode}</p>
                    <p className="text-sm text-slate-700">{note.content || "No note content."}</p>
                    <div className="mt-1 space-x-1">
                      {note.tags.map((tag) => (
                        <Badge key={`${note.id}-${tag}`} variant="outline">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </CardContent>
  );
}

function CalendarContentFallback() {
  return (
    <CardContent className="space-y-3">
      <div className="h-20 animate-pulse rounded-[24px] border border-slate-200/80 bg-white/85" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-52 animate-pulse rounded-[24px] border border-slate-200/80 bg-white/85" />
        ))}
      </div>
    </CardContent>
  );
}

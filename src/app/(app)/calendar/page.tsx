import Link from "next/link";
import {
  addDays,
  addMonths,
  addYears,
  endOfMonth,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
  subYears,
} from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCalendarPerformance } from "@/lib/server/queries";
import { formatCurrency } from "@/lib/utils";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type CalendarView = "year" | "month" | "day";

function parseDate(value?: string) {
  if (!value) return new Date();
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function monthGrid(monthDate: Date) {
  const first = startOfWeek(startOfMonth(monthDate), { weekStartsOn: 1 });
  const last = endOfMonth(monthDate);
  const weeks: Date[][] = [];
  let cursor = first;

  while (cursor <= last || weeks.length === 0 || weeks[weeks.length - 1].length < 7) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i += 1) {
      week.push(cursor);
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
    if (cursor > last && cursor.getDay() === 1) break;
  }

  return weeks;
}

function weekGrid(day: Date) {
  const first = startOfWeek(day, { weekStartsOn: 1 });
  return [Array.from({ length: 7 }, (_, index) => addDays(first, index))];
}

function dailyPnlClass(total: number) {
  if (total > 0) return "border-emerald-200 bg-emerald-50/80 text-emerald-900";
  if (total < 0) return "border-rose-200 bg-rose-50/80 text-rose-900";
  return "border-slate-200 bg-white text-slate-900";
}

function viewHref(view: CalendarView, date: Date) {
  return `/calendar?view=${view}&date=${format(date, "yyyy-MM-dd")}`;
}

export default async function CalendarPage(props: { searchParams: SearchParams }) {
  const searchParams = await props.searchParams;
  const selectedDate = parseDate(typeof searchParams.date === "string" ? searchParams.date : undefined);
  const selectedView = (typeof searchParams.view === "string" ? searchParams.view : "month") as CalendarView;
  const view: CalendarView = selectedView === "year" || selectedView === "month" || selectedView === "day" ? selectedView : "month";

  const data = await getCalendarPerformance(selectedDate);
  const dayMap = new Map(data.days.map((row) => [row.date, row]));
  const monthlyTotals = new Map(data.monthlyTotals.map((row) => [row.month, row]));
  const selectedMonthKey = format(selectedDate, "yyyy-MM");
  const selectedMonthTotals = monthlyTotals.get(selectedMonthKey) ?? { month: selectedMonthKey, realized: 0, mtm: 0, total: 0 };
  const selectedDay = dayMap.get(format(selectedDate, "yyyy-MM-dd"));
  const prevDate = view === "year" ? subYears(selectedDate, 1) : subMonths(selectedDate, 1);
  const nextDate = view === "year" ? addYears(selectedDate, 1) : addMonths(selectedDate, 1);
  const monthName = format(selectedDate, "MMMM yyyy");
  const yearLabel = format(selectedDate, "yyyy");
  const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const months = Array.from({ length: 12 }, (_, index) => new Date(selectedDate.getFullYear(), index, 1));

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Calendar Journal</h2>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Performance Calendar</CardTitle>
            <div className="flex items-center gap-2">
              <Link href={viewHref("year", selectedDate)} className={view === "year" ? "rounded-md bg-slate-900 px-3 py-1 text-sm text-white" : "rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700"}>
                Year
              </Link>
              <Link href={viewHref("month", selectedDate)} className={view === "month" ? "rounded-md bg-slate-900 px-3 py-1 text-sm text-white" : "rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700"}>
                Month
              </Link>
              <Link href={viewHref("day", selectedDate)} className={view === "day" ? "rounded-md bg-slate-900 px-3 py-1 text-sm text-white" : "rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700"}>
                Day
              </Link>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center gap-2">
              <Link href={viewHref(view, prevDate)} className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700">
                Prev
              </Link>
              <Link href={viewHref(view, nextDate)} className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700">
                Next
              </Link>
            </div>
            <div className="text-sm font-semibold text-slate-700">{view === "year" ? yearLabel : monthName}</div>
            <div className="text-right text-sm">
              <p className="text-slate-500">Monthly Total</p>
              <p className={selectedMonthTotals.total >= 0 ? "font-semibold text-emerald-700" : "font-semibold text-red-700"}>
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
                const monthKey = format(month, "yyyy-MM");
                const totals = monthlyTotals.get(monthKey) ?? { total: 0, realized: 0, mtm: 0 };
                return (
                  <div key={monthKey} className="rounded-md border border-slate-200 bg-white p-2">
                    <div className="mb-2 flex items-center justify-between">
                      <Link className="text-sm font-semibold text-blue-700 hover:underline" href={viewHref("month", month)}>
                        {format(month, "MMM")}
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
                        const key = format(date, "yyyy-MM-dd");
                        const row = dayMap.get(key);
                        return (
                          <Link
                            key={`${monthKey}-${key}`}
                            href={viewHref("day", date)}
                            className={`${dailyPnlClass(row?.total ?? 0)} ${isSameMonth(date, month) ? "" : "opacity-30"} rounded border p-1 text-center text-[10px]`}
                          >
                            <p>{format(date, "d")}</p>
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
              <div className="grid grid-cols-7 gap-2">
                {weekDays.map((day) => (
                  <p key={day} className="text-center text-xs font-medium text-slate-500">
                    {day}
                  </p>
                ))}

                {(view === "month" ? monthGrid(selectedDate) : weekGrid(selectedDate)).flat().map((date) => {
                  const key = format(date, "yyyy-MM-dd");
                  const row = dayMap.get(key);
                  const isCurrent = view === "day" ? true : isSameMonth(date, selectedDate);
                  return (
                    <Link
                      key={key}
                      href={viewHref("day", date)}
                      className={`${dailyPnlClass(row?.total ?? 0)} ${isCurrent ? "" : "opacity-40"} min-h-24 rounded border p-2`}
                    >
                      <p className="text-xs font-semibold">{format(date, "d")}</p>
                      <p className="mt-2 text-xs">
                        Total:{" "}
                        <span className={row && row.total < 0 ? "font-semibold text-red-700" : "font-semibold text-emerald-700"}>
                          {formatCurrency(row?.total ?? 0)}
                        </span>
                      </p>
                      <p className="text-[11px] text-slate-600">Realized: {formatCurrency(row?.realized ?? 0)}</p>
                      <p className="text-[11px] text-slate-600">MTM: {formatCurrency(row?.mtm ?? 0)}</p>
                      {(row?.notes.length ?? 0) > 0 && (
                        <p className="mt-1 text-[11px] text-slate-700">{row?.notes.length} note(s)</p>
                      )}
                    </Link>
                  );
                })}
              </div>

              {view === "day" && (
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="font-semibold">{format(selectedDate, "yyyy-MM-dd")}</p>
                    <p className={(selectedDay?.total ?? 0) >= 0 ? "font-semibold text-emerald-700" : "font-semibold text-red-700"}>
                      {formatCurrency(selectedDay?.total ?? 0)}
                    </p>
                  </div>
                  <p className="text-sm text-slate-600">Realized: {formatCurrency(selectedDay?.realized ?? 0)}</p>
                  <p className="text-sm text-slate-600">MTM: {formatCurrency(selectedDay?.mtm ?? 0)}</p>
                  <div className="mt-3 space-y-2">
                    {(selectedDay?.notes.length ?? 0) === 0 && <p className="text-sm text-slate-500">No day notes for this date.</p>}
                    {selectedDay?.notes.map((note) => (
                      <div key={note.id} className="rounded-md border border-slate-200 p-2">
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
      </Card>
    </div>
  );
}

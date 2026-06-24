"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { endOfDay, format, startOfDay, subDays, subMonths, subWeeks, subYears } from "date-fns";
import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type TradeFilters = {
  from?: string;
  to?: string;
  symbol?: string;
  side?: string;
  tag?: string;
  strategy?: string;
};

const QUICK_RANGES = [
  { key: "5d", label: "5D", days: 4 },
  { key: "2w", label: "2W", weeks: 2 },
  { key: "1m", label: "1M", months: 1 },
  { key: "1y", label: "1Y", years: 1 },
] as const;

function toDateParam(date: Date) {
  return format(date, "yyyy-MM-dd");
}

export function TradesFilters({ filters }: { filters: TradeFilters }) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [draftFrom, setDraftFrom] = useState(filters.from ?? "");
  const [draftTo, setDraftTo] = useState(filters.to ?? "");
  const today = useMemo(() => toDateParam(endOfDay(new Date())), []);

  useEffect(() => {
    setDraftFrom(filters.from ?? "");
    setDraftTo(filters.to ?? "");
  }, [filters.from, filters.to]);

  const activeQuickRange = useMemo(() => {
    if (!draftFrom || !draftTo) {
      return "all";
    }

    if (draftTo !== today) {
      return null;
    }

    const fiveDaysFrom = toDateParam(startOfDay(subDays(new Date(), 4)));
    if (draftFrom === fiveDaysFrom) return "5d";

    const twoWeeksFrom = toDateParam(startOfDay(subWeeks(new Date(), 2)));
    if (draftFrom === twoWeeksFrom) return "2w";

    const oneMonthFrom = toDateParam(startOfDay(subMonths(new Date(), 1)));
    if (draftFrom === oneMonthFrom) return "1m";

    const oneYearFrom = toDateParam(startOfDay(subYears(new Date(), 1)));
    if (draftFrom === oneYearFrom) return "1y";

    return null;
  }, [draftFrom, draftTo, today]);

  function applyFilters(overrides?: Partial<Record<keyof TradeFilters, string>>) {
    if (!formRef.current) return;

    const formData = new FormData(formRef.current);
    const params = new URLSearchParams();

    for (const [key, rawValue] of formData.entries()) {
      const value = String(rawValue).trim();
      const override = overrides?.[key as keyof TradeFilters];
      const nextValue = override ?? value;
      if (nextValue) {
        params.set(key, nextValue);
      }
    }

    for (const [key, value] of Object.entries(overrides ?? {})) {
      if (typeof value !== "string") continue;
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    }

    params.delete("page");
    const query = params.toString();
    const href = query ? `${pathname}?${query}` : pathname;
    startTransition(() => {
      router.replace(href);
    });
  }

  function applyQuickRange(range: (typeof QUICK_RANGES)[number]) {
    const now = new Date();
    const from =
      "days" in range
        ? startOfDay(subDays(now, range.days))
        : "weeks" in range
          ? startOfDay(subWeeks(now, range.weeks))
          : "months" in range
            ? startOfDay(subMonths(now, range.months))
            : startOfDay(subYears(now, range.years));

    const nextFrom = toDateParam(from);
    setDraftFrom(nextFrom);
    setDraftTo(today);
    applyFilters({
      from: nextFrom,
      to: today,
    });
  }

  useEffect(() => {
    if (draftFrom === (filters.from ?? "") && draftTo === (filters.to ?? "")) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (!formRef.current) return;

      const formData = new FormData(formRef.current);
      const params = new URLSearchParams();

      for (const [key, rawValue] of formData.entries()) {
        const value = String(rawValue).trim();
        if (value) {
          params.set(key, value);
        }
      }

      if (draftFrom) {
        params.set("from", draftFrom);
      } else {
        params.delete("from");
      }

      if (draftTo) {
        params.set("to", draftTo);
      } else {
        params.delete("to");
      }

      params.delete("page");
      const query = params.toString();
      const href = query ? `${pathname}?${query}` : pathname;
      startTransition(() => {
        router.replace(href);
      });
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [draftFrom, draftTo, filters.from, filters.to, pathname, router]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    applyFilters({
      from: draftFrom,
      to: draftTo,
    });
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <form
        ref={formRef}
        className="grid gap-3 md:grid-cols-2 xl:grid-cols-[10rem_10rem_10rem_10rem_10rem_10rem_auto]"
        method="get"
        onSubmit={handleSubmit}
      >
        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase text-slate-500">From</span>
          <Input
            className="h-9 rounded-lg px-3 text-xs"
            name="from"
            type="date"
            value={draftFrom}
            onChange={(event) => {
              setDraftFrom(event.target.value);
            }}
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase text-slate-500">To</span>
          <Input
            className="h-9 rounded-lg px-3 text-xs"
            name="to"
            type="date"
            value={draftTo}
            onChange={(event) => {
              setDraftTo(event.target.value);
            }}
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase text-slate-500">Symbol</span>
          <Input className="h-9 rounded-lg px-3 text-xs" name="symbol" placeholder="All symbols" defaultValue={filters.symbol} />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase text-slate-500">Side</span>
          <Select className="h-9 rounded-lg px-3 text-xs" name="side" defaultValue={filters.side ?? ""}>
            <option value="">All sides</option>
            <option value="BUY">BUY</option>
            <option value="SELL">SELL</option>
          </Select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase text-slate-500">Tag</span>
          <Input className="h-9 rounded-lg px-3 text-xs" name="tag" placeholder="All tags" defaultValue={filters.tag} />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase text-slate-500">Strategy</span>
          <Input className="h-9 rounded-lg px-3 text-xs" name="strategy" placeholder="All setups" defaultValue={filters.strategy} />
        </label>

        <div className="flex flex-wrap items-end gap-2 md:col-span-2 xl:col-span-1">
          <Button type="submit" size="sm" disabled={isPending} className="h-9 gap-2 rounded-lg">
            <SlidersHorizontal className="h-4 w-4" />
            Apply
          </Button>
          <Button
            type="button"
            size="sm"
            variant={activeQuickRange === "all" ? "default" : "outline"}
            disabled={isPending}
            className="h-9 rounded-lg"
            onClick={() => {
              setDraftFrom("");
              setDraftTo("");
              applyFilters({ from: "", to: "" });
            }}
          >
            All
          </Button>
          {QUICK_RANGES.map((range) => (
            <button
              key={range.key}
              type="button"
              disabled={isPending}
              className={cn(
                "h-9 rounded-lg border px-3 text-xs font-semibold",
                activeQuickRange === range.key
                  ? "border-slate-950 bg-slate-950 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
              )}
              onClick={() => applyQuickRange(range)}
            >
              {range.label}
            </button>
          ))}
        </div>
      </form>
    </section>
  );
}

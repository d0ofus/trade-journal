"use client";

import { endOfDay, format, startOfDay, subDays, subMonths, subWeeks, subYears } from "date-fns";
import { usePathname, useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type TradeFilters = {
  from?: string;
  to?: string;
  symbol?: string;
  side?: string;
  tag?: string;
  strategy?: string;
};

const QUICK_RANGES = [
  { key: "5d", label: "5 Days", days: 4 },
  { key: "2w", label: "2 Weeks", weeks: 2 },
  { key: "1m", label: "1 Month", months: 1 },
  { key: "1y", label: "1 Year", years: 1 },
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
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-slate-200/80 px-5 py-4">
        <CardTitle className="text-base">Filters</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 px-5 pb-5 pt-5">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={activeQuickRange === "all" ? "default" : "outline"}
            disabled={isPending}
            onClick={() => {
              setDraftFrom("");
              setDraftTo("");
              applyFilters({ from: "", to: "" });
            }}
          >
            All Time
          </Button>
          {QUICK_RANGES.map((range) => (
            <Button
              key={range.key}
              type="button"
              size="sm"
              variant={activeQuickRange === range.key ? "default" : "outline"}
              disabled={isPending}
              onClick={() => applyQuickRange(range)}
            >
              {range.label}
            </Button>
          ))}
        </div>
        <form ref={formRef} className="grid gap-3 md:grid-cols-2 xl:grid-cols-6" method="get" onSubmit={handleSubmit}>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">From</span>
            <Input
              name="from"
              type="date"
              value={draftFrom}
              onChange={(event) => {
                setDraftFrom(event.target.value);
              }}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">To</span>
            <Input
              name="to"
              type="date"
              value={draftTo}
              onChange={(event) => {
                setDraftTo(event.target.value);
              }}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Symbol</span>
            <Input name="symbol" placeholder="AAPL, TSLA..." defaultValue={filters.symbol} />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Side</span>
            <Select name="side" defaultValue={filters.side ?? ""}>
              <option value="">All sides</option>
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </Select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Tag</span>
            <Input name="tag" placeholder="Momentum, news..." defaultValue={filters.tag} />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Strategy</span>
            <Input name="strategy" placeholder="Opening drive..." defaultValue={filters.strategy} />
          </label>
          <Button type="submit" size="sm" disabled={isPending} className="md:col-span-2 xl:col-span-6 xl:justify-self-start">
            Apply Filters
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

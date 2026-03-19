"use client";

import { useRef } from "react";
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

export function TradesFilters({ filters }: { filters: TradeFilters }) {
  const formRef = useRef<HTMLFormElement | null>(null);

  function submitFilters() {
    formRef.current?.requestSubmit();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Filters</CardTitle>
      </CardHeader>
      <CardContent>
        <form ref={formRef} className="grid gap-3 md:grid-cols-6" method="get">
          <Input name="from" type="date" defaultValue={filters.from} onChange={submitFilters} />
          <Input name="to" type="date" defaultValue={filters.to} onChange={submitFilters} />
          <Input name="symbol" placeholder="Symbol" defaultValue={filters.symbol} />
          <Select name="side" defaultValue={filters.side ?? ""}>
            <option value="">All sides</option>
            <option value="BUY">BUY</option>
            <option value="SELL">SELL</option>
          </Select>
          <Input name="tag" placeholder="Tag" defaultValue={filters.tag} />
          <Input name="strategy" placeholder="Strategy" defaultValue={filters.strategy} />
          <button type="submit" className="hidden" aria-hidden />
        </form>
      </CardContent>
    </Card>
  );
}

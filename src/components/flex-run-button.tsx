"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

export function FlexRunButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string>("");

  function runNow() {
    startTransition(async () => {
      const res = await fetch("/api/flex/run", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMessage(data.error ?? "Flex import failed.");
        return;
      }
      setMessage(
        `Imported trades ${data.result.trades.rowsImported}, positions ${data.result.positions.rowsImported}, commissions rows ${data.result.commissionsSeen}`,
      );
    });
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" onClick={runNow} disabled={pending}>
        {pending ? "Running Flex import..." : "Run Flex Import Now"}
      </Button>
      {message && <p className="text-xs text-slate-600">{message}</p>}
    </div>
  );
}

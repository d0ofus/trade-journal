"use client";

import { useId, useState } from "react";
import { parseMovingAveragePeriods } from "@/lib/workstation/chart-preferences";

export function MovingAverageSettings({ periods, onChange }: { periods: number[]; onChange: (periods: number[]) => void }) {
  const [fields, setFields] = useState(() => Array.from({ length: 4 }, (_, i) => periods[i]?.toString() ?? ""));
  const [error, setError] = useState("");
  const messageId = useId();
  const commit = () => {
    const result = parseMovingAveragePeriods(fields);
    setError(result.error ?? "");
    if (result.periods) onChange(result.periods);
  };
  return <fieldset className="ws-moving-average-settings">
    <legend>Moving averages (SMA)</legend>
    <div className="ws-moving-average-fields">
      {fields.map((value, index) => <label key={index}>
        <span>SMA {index + 1}</span>
        <input type="number" min={1} max={500} step={1} aria-label={`Moving average ${index + 1} period`}
          aria-describedby={messageId} aria-invalid={!!error} placeholder="Off" value={value}
          onChange={event => setFields(current => current.map((field, i) => i === index ? event.target.value : field))}
          onBlur={commit} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />
      </label>)}
    </div>
    <p id={messageId} className={error ? "ws-average-error" : "ws-help"} role={error ? "alert" : undefined}>
      {error || "Use different periods from 1 to 500. Leave unused fields blank."}
    </p>
  </fieldset>;
}

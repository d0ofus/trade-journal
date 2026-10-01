"use client";
import { useCallback, useRef, useState, type SetStateAction } from "react";

/** Commands can read history immediately even while its toolbar render yields. */
export function useImmediateState<T>(initial: T) {
  const [value, render] = useState(initial), latest = useRef(value);
  const set = useCallback((update: SetStateAction<T>) => {
    const next = typeof update === "function" ? (update as (value: T) => T)(latest.current) : update;
    latest.current = next; render(next);
  }, []);
  return [value, set, latest] as const;
}

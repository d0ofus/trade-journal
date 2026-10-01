"use client";
import { useLayoutEffect, useMemo, useRef } from "react";

/** Keep memoized children current without changing their event handlers on each
 * parent render. Forward only committed callbacks, never a stale render closure. */
export function useStableCallbacks<T extends object>(props: T): T {
  const latest = useRef(props);
  useLayoutEffect(() => { latest.current = props; });
  const keys = Object.keys(props).filter(key => typeof props[key as keyof T] === "function").sort().join("|");
  const callbacks = useMemo(() => Object.fromEntries(keys.split("|").filter(Boolean).map(key => [key, (...args: unknown[]) => {
    const callback = latest.current[key as keyof T] as (...args: unknown[]) => unknown;
    return callback(...args);
  }])), [keys]);
  return { ...props, ...callbacks };
}

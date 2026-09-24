import { describe, expect, it } from "vitest";
import { exactStorageBytes, formatStorageBytes, formatStorageTime } from "./storage-format";
import { mergeStorageUsage, measurementIsStale, type StorageUsage } from "./storage-usage";

describe("storage display and per-group freshness", () => {
  it("uses decimal units, exposes exact bytes and never labels unavailable values as zero", () => {
    for (const [value, expected] of [[0, "0 B"], [999, "999 B"], [1000, "1.0 KB"], [1_000_000, "1.0 MB"], [111_476_736, "111.5 MB"], [7_166_679_120, "7.2 GB"]] as const) expect(formatStorageBytes(value)).toBe(expected);
    for (const value of [null, undefined, NaN, -1, Infinity]) expect(formatStorageBytes(value)).toBe("Unavailable");
    expect(exactStorageBytes(1000)).toContain("1,000 bytes");
    expect(formatStorageTime("bad")).toBe("Unavailable");
    expect(formatStorageTime(null)).toBe("—");
    expect(formatStorageTime("2026-09-24T00:00:00Z")).toMatch(/2026/);
  });
  it("keeps the previous value and measurement time only for failed groups", () => {
    const previous: StorageUsage = { measuredAt: "2026-09-24T00:00:00Z", database: { currentBytes: 100, branchBytes: 150, cacheBytes: 10, metricCacheBytes: 1 }, payloads: null, issues: [], groups: { database: { measuredAt: "2026-09-24T00:00:00Z", complete: true, error: null } } };
    const next: StorageUsage = { measuredAt: "2026-09-24T00:01:00Z", database: null, payloads: null, issues: ["offline"], groups: { database: { measuredAt: null, complete: false, error: "offline" } } };
    const merged = mergeStorageUsage(previous, next);
    expect(merged.database).toEqual(previous.database);
    expect(merged.groups!.database).toEqual({ measuredAt: previous.measuredAt, complete: false, error: "offline" });
    expect(previous.groups!.database!.complete).toBe(true);
    expect(mergeStorageUsage(null, next).database).toBeNull();
    expect(mergeStorageUsage(merged, previous).groups!.database!.error).toBeNull();
  });
  it("marks readings stale at two minutes without relying on another network request", () => {
    const state = { measuredAt: "2026-09-24T00:00:00Z", complete: true, error: null }, now = Date.parse(state.measuredAt);
    expect(measurementIsStale(state, now + 119_999)).toBe(false);
    expect(measurementIsStale(state, now + 120_000)).toBe(true);
    expect(measurementIsStale(undefined, now)).toBe(true);
  });
  it("preserves the last Cloudflare reading when only its stored snapshot becomes unavailable", () => {
    const account = { measuredAt: "2026-09-24T00:00:00Z", standardBytes: 123, otherClassBytes: null, stale: false, warning: null, estimatedMonthlyStorageUsd: 0 };
    const base: StorageUsage = { measuredAt: account.measuredAt, database: null, payloads: null, issues: [], evidence: { assets: 1, originals: 20, thumbnails: 1, pending: 0, account } };
    const next = { ...base, evidence: { ...base.evidence!, originals: 30, account: null, accountError: "Stored reading unavailable" } };
    const merged = mergeStorageUsage(base, next);
    expect(merged.evidence!.originals).toBe(30);
    expect(merged.evidence!.account).toEqual(account);
    expect(merged.evidence!.accountError).toBe("Stored reading unavailable");
  });
});

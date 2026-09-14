import assert from "node:assert/strict";
import { test } from "node:test";
import { CandleHistory, HistoryRange, HistoryState, initialHistoryRange, preloadHistoryRange, mergeHistory, preserveHistoryViewport } from "./history";
import { createDemoAdapter, demoCandles, demoTrades, initialDemoDocument } from "./demo";
import { Candle, CandleResult, WorkstationAdapter, intervals } from "./types";
import { createApplicationAdapter } from "./application-adapter";
import { executionBar } from "./math";
import { CandleMemory } from "./candle-memory";
import { missingRanges } from "./candle-ranges";
import { SharedRequests } from "./shared-requests";

test("hourly preload follows the final interpreted fill for 30 calendar days and preserves holdings", () => {
  for (const day of ["2024-03-11T14:00:00Z", "2024-11-04T15:00:00Z", "2024-09-09T13:30:00Z"]) {
    const last = Date.parse(day) / 1000;
    const value = { ...demoTrades[0], openTime: last - 3600, closeTime: last, executions: [{ ...demoTrades[0].executions[0], time: last + 7200 }] };
    const initial = initialHistoryRange(value, "1h"), preload = preloadHistoryRange(value, "1h");
    assert.equal(preload.from, last + 7200 - 30 * 86400);
    assert.equal(preload.to, initial.to);
    assert.equal(preloadHistoryRange({ ...value, executions: [] }, "1h").from, last - 30 * 86400);
    assert.ok(preloadHistoryRange({ ...value, openTime: last - 120 * 86400 }, "1h").from <= last - 121 * 86400);
    for (const interval of ["5m", "1d"] as const) {
      const before = initialHistoryRange(value, interval), after = preloadHistoryRange(value, interval);
      assert.equal(after.from, Math.floor(Math.min(before.from, value.openTime - 86400)));
      assert.equal(after.to, Math.ceil(Math.max(before.to, value.closeTime + 86400)));
    }
  }
});

test("context preload is bounded to its exact target and cancelled for explicit navigation", async () => {
  const initial = initialHistoryRange(demoTrades[0], "1h"), wanted = preloadHistoryRange(demoTrades[0], "1h");
  const requests: HistoryRange[] = [];
  let slow = false, cancelled = false;
  const adapter: WorkstationAdapter = { ...createDemoAdapter(), candles: async (_trade, _interval, signal, requested) => {
    requests.push(requested!);
    if (slow) {
      slow = false;
      await new Promise<void>((_resolve, reject) => signal!.addEventListener("abort", () => { cancelled = true; reject(signal!.reason); }, { once: true }));
    }
    return result([bar(requested!.from + 300), bar(requested!.to - 300)]);
  } };
  const history = new CandleHistory(adapter, demoTrades[0], "1h", initial, () => {});
  await history.start();
  await history.preload(wanted);
  assert.equal(history.state.range.from, wanted.from);
  assert.ok(requests.slice(1).every(r => r.to - r.from <= 14 * 86400 && r.from >= wanted.from));
  const before = history.state.range.from;
  slow = true;
  const preload = history.preload({ from: before - 86400, to: initial.to });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(await history.extend("older", true, 10), true);
  await preload;
  assert.equal(cancelled, true);
  assert.equal(history.state.failed, null);
  assert.equal(history.state.error, "");
  history.dispose();
});

test("shared transports retain live consumers and evict abandoned work", async () => {
  const requests = new SharedRequests<number>();
  const one = new AbortController(), two = new AbortController();
  let transport!: AbortSignal, finish!: (value: number) => void, calls = 0;
  const work = (signal: AbortSignal) => { calls++; transport = signal; return new Promise<number>((resolve, reject) => { finish = resolve; signal.addEventListener("abort", () => reject(signal.reason), { once: true }); }); };
  const first = requests.run("same", one.signal, work), second = requests.run("same", two.signal, work);
  const rejected = assert.rejects(first, { name: "AbortError" });
  await Promise.resolve(); one.abort(); await rejected;
  assert.equal(calls, 1); assert.equal(transport.aborted, false);
  finish(42); assert.equal(await second, 42);
  const departed = new AbortController(), pending = requests.run("abandoned", departed.signal, work);
  const cancelled = assert.rejects(pending, { name: "AbortError" });
  await Promise.resolve(); departed.abort(); await cancelled;
  assert.equal(transport.aborted, true);
  assert.equal(await requests.run("abandoned", undefined, async () => 7), 7);
});

const trade = demoTrades[0];
const bar = (time: number, close = 101): Candle => ({ time, open: 100, high: 105, low: 95, close, volume: 500 });
const range = { from: trade.openTime - 86400, to: trade.closeTime + 86400 };
const result = (candles: Candle[], source = "alpaca"): CandleResult => ({ candles, source, warning: "" });
const cachedResult = (candles: Candle[], covered = [{ from: range.from, to: range.to + .001 }], identity = "alpaca:sip:raw:extended"): CandleResult => ({ ...result(candles), identity, cache: { enabled: true, status: covered.length ? "partial" : "miss", covered, missing: missingRanges({ from: range.from, to: range.to + .001 }, covered), refresh: [], effectiveRange: { from: range.from, to: range.to + .001 } } });

test("storage-paused history renders temporary bars once without claiming durable coverage", async () => {
  let calls = 0;
  const value = cachedResult([bar(trade.openTime)], []);
  value.cache!.persistencePaused = true; value.cache!.temporary = [range]; value.warning = "Storage limit reached";
  const adapter = { ...createDemoAdapter(), cachedCandles: async () => cachedResult([], []), candles: async () => { calls++; return value; } };
  const history = new CandleHistory(adapter, trade, "5m", range, () => {});
  assert.equal(await history.start(), true);
  assert.equal(calls, 1); assert.equal(history.state.error, ""); assert.equal(history.state.loading, null);
  assert.equal(history.state.result.candles.length, 1); assert.deepEqual(history.state.result.cache?.covered, []);
  assert.equal(history.state.result.cache?.persistencePaused, true); history.dispose();
});

test("partial cached candles publish before provider completion, without advancing history or losing drawings", async () => {
  let finish!: (r: CandleResult) => void; const pending = new Promise<CandleResult>(resolve => { finish = resolve; });
  const updates: HistoryState[] = [];
  const adapter = { ...createDemoAdapter(), cachedCandles: async () => cachedResult([bar(trade.openTime)], [{ from: range.from, to: trade.openTime + 1 }]), candles: async () => pending };
  const history = new CandleHistory(adapter, trade, "5m", range, state => updates.push(state));
  const run = history.start(); await new Promise(r => setTimeout(r, 0));
  assert.equal(history.state.loading, "initial"); assert.equal(history.state.result.candles.length, 1); assert.deepEqual(history.state.range, range);
  finish(cachedResult([bar(trade.openTime), bar(trade.closeTime)])); await run;
  assert.equal(history.state.loading, null); assert.equal(history.state.result.candles.length, 2); assert.ok(updates.some(s => s.loading && s.result.candles.length));
});
test("fully covered cache including empty periods never invokes the fill adapter", async () => {
  let calls = 0;
  for (const candles of [[], [bar(trade.openTime)]]) {
    const history = new CandleHistory({ ...createDemoAdapter(), cachedCandles: async () => cachedResult(candles), candles: async () => { calls++; return result([]); } }, trade, "5m", range, () => {});
    assert.equal(await history.start(), true); assert.equal(calls, 0);
  }
});

test("progressive fills continue without timers, while contention backs off", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  for (const contended of [false, true]) {
    let calls = 0;
    const partial = cachedResult([bar(trade.openTime)], [{ from: range.from, to: trade.openTime + 1 }]);
    if (contended) partial.cache!.retryAfterMs = 1000;
    const history = new CandleHistory({ ...createDemoAdapter(), cachedCandles: async () => cachedResult([], []), candles: async () => ++calls === 1 ? partial : cachedResult([bar(trade.openTime), bar(trade.closeTime)]) }, trade, "5m", range, () => {});
    const pending = history.start();
    await flush();
    assert.equal(calls, contended ? 1 : 2);
    if (contended) {
      t.mock.timers.tick(999); await flush(); assert.equal(calls, 1);
      t.mock.timers.tick(1);
    }
    assert.equal(await pending, true);
    assert.equal(calls, 2);
    history.dispose();
  }
});
test("overlapping browser ranges keep provider identities isolated and expire without discarding verification semantics", () => {
  let now = 1; const memory = new CandleMemory(() => now);
  const a = { ...cachedResult([bar(trade.openTime)]), cache: { ...cachedResult([]).cache!, status: "hit" as const } };
  memory.put("MU:5m:extended", a);
  assert.equal(memory.get("MU:5m:extended", { from: trade.openTime, to: trade.openTime + 1 })?.cache?.status, "hit");
  assert.equal(memory.get("MU:5m:regular", range), null);
  memory.put("MU:5m:extended", { ...a, identity: "yahoo:unverified", candles: [bar(trade.openTime, 104)] });
  assert.equal(memory.get("MU:5m:extended", range, a.identity)?.candles[0].close, 101);
  assert.equal(memory.get("MU:5m:extended", range, "yahoo:unverified")?.candles[0].close, 104);
  now += 300001; assert.equal(memory.get("MU:5m:extended", range), null);
});
test("provider failure after a partial cache hit leaves usable cached bars available", async () => {
  const history = new CandleHistory({ ...createDemoAdapter(), cachedCandles: async () => cachedResult([bar(trade.openTime)], []), candles: async () => { throw new Error("Provider offline"); } }, trade, "5m", range, () => {});
  assert.equal(await history.start(), false); assert.equal(history.state.result.candles.length, 1); assert.match(history.state.error, /offline/);
});
function fixture(candles: WorkstationAdapter["candles"], callback: (state: HistoryState) => void = () => {}) {
  return new CandleHistory({ ...createDemoAdapter(), candles }, trade, "5m", range, callback, () => range.to + 86400 * 30);
}

test("5-minute panning loads over two years through bounded, overlapping requests", async () => {
  const adapter = createDemoAdapter(), requests: HistoryRange[] = [];
  const history = fixture(async (t, interval, signal, requested) => {
    requests.push(requested!);
    return adapter.candles(t, interval, signal, requested);
  });
  await history.start();
  const document = initialDemoDocument(trade), before = JSON.stringify(document);
  for (let i = 0; i < 53; i++) assert.equal(await history.extend("older"), true);
  assert.ok(history.state.result.candles.length > 40_000);
  assert.ok(history.state.result.candles[0].time < trade.openTime - 730 * 86400);
  assert.ok(requests.every(r => r.to - r.from <= 14 * 86400 + 600));
  assert.equal(new Set(history.state.result.candles.map(c => c.time)).size, history.state.result.candles.length);
  const expected = demoCandles(trade).filter(c => c.time >= history.state.range.from && c.time <= history.state.range.to);
  assert.deepEqual(history.state.result.candles, expected);
  for (const fill of trade.executions) assert.ok(executionBar(fill, history.state.result.candles, "5m"));
  assert.equal(JSON.stringify(document), before);
});

test("prepending keeps the same candle and fractional viewport position, even in blank overscroll", () => {
  const previous = [bar(100), bar(200), bar(300)], next = mergeHistory(previous, [bar(50), bar(200, 102)]);
  assert.deepEqual(preserveHistoryViewport(previous, next, { from: .25, to: 2.75 }), { from: 1.25, to: 3.75 });
  assert.deepEqual(preserveHistoryViewport(previous, next, { from: -8.5, to: 5.25 }), { from: -7.5, to: 6.25 });
  assert.equal(next[2].close, 102);
  assert.equal(previous[1].close, 101);
  assert.deepEqual(preserveHistoryViewport(previous, [...previous, bar(400)], { from: 0, to: 9 }), { from: 0, to: 9 });
});

test("requested history windows fill both edges in bounded pages and stop at missing coverage", async () => {
  const requests: HistoryRange[] = [];
  const history = fixture(async (_t, _i, _signal, requested) => {
    requests.push(requested!);
    return result([bar(requested!.from + 300), bar(requested!.to - 300)]);
  });
  await history.start();
  const desired = { from: range.from - 40 * 86400, to: range.to + 20 * 86400 };
  await history.cover(desired);
  assert.ok(history.state.range.from <= desired.from && history.state.range.to >= desired.to);
  assert.equal(requests.length, 6);
  assert.ok(requests.every(requested => requested.to - requested.from <= 14 * 86400 + 600));
  let calls = 0;
  const missing = fixture(async () => { calls++; return result(calls === 1 ? [bar(trade.openTime)] : []); });
  await missing.start();
  await missing.cover(desired);
  assert.equal(calls, 2);
  assert.match(missing.state.result.warning, /coverage is not confirmed/);
  assert.equal(missing.state.result.candles.length, 1);
});

test("only one request runs per chart; cancelled late responses cannot update the session", async () => {
  let resolve!: (result: CandleResult) => void, requests = 0, aborted: AbortSignal | undefined;
  const updates: HistoryState[] = [];
  const history = fixture(async (_t, _i, signal) => { requests++; aborted = signal; return new Promise(r => { resolve = r; }); }, s => updates.push(s));
  const initial = history.start();
  assert.equal(await history.extend("older"), false);
  assert.equal(requests, 1);
  history.dispose();
  assert.equal(aborted?.aborted, true);
  const updateCount = updates.length;
  resolve(result([bar(trade.openTime)]));
  assert.equal(await initial, false);
  assert.equal(updates.length, updateCount);
  assert.equal(history.state.result.candles.length, 0);
});

test("a failed page preserves data and retries the same window without skipping history", async () => {
  const requests: HistoryRange[] = [];
  let fail = true;
  const history = fixture(async (_t, _i, _s, r) => {
    requests.push(r!);
    if (requests.length === 1) return result([bar(trade.openTime)]);
    if (fail) throw new Error("Rate limit; retry later");
    return result([bar(r!.from + 300)]);
  });
  await history.start();
  const original = history.state.result.candles;
  assert.equal(await history.extend("older"), false);
  assert.equal(history.state.result.candles, original);
  assert.deepEqual(history.state.range, range);
  assert.equal(await history.extend("older"), false);
  assert.equal(requests.length, 2);
  fail = false;
  assert.equal(await history.retry(), true);
  assert.deepEqual(requests[1], requests[2]);
  assert.equal(history.state.error, "");
});

test("empty pages pause automatic fetching without inventing an end-of-history claim", async () => {
  const requests: HistoryRange[] = [];
  const history = fixture(async (_t, _i, _s, r) => { requests.push(r!); return result(requests.length === 1 ? [bar(trade.openTime)] : []); });
  await history.start();
  await history.extend("older");
  assert.match(history.state.messages.older, /may be unavailable/);
  assert.equal(await history.extend("older"), false);
  assert.equal(requests.length, 2);
  await history.extend("older", true);
  assert.ok(requests[2].from < requests[1].from);
  assert.equal(history.state.result.candles.length, 1);
});

test("truncated or invalid pages never advance the requested boundary or replace existing bars", async () => {
  for (const bad of [{ ...result([bar(range.from - 300)]), truncated: true }, result([{ ...bar(range.from - 300), high: 90 }])]) {
    let calls = 0;
    const history = fixture(async () => ++calls === 1 ? result([bar(trade.openTime)]) : bad);
    await history.start();
    assert.equal(await history.extend("older"), false);
    assert.deepEqual(history.state.range, range);
    assert.deepEqual(history.state.result.candles, [bar(trade.openTime)]);
    assert.ok(history.state.error);
  }
});

test("newer requests stop at the current date and retain provider provenance", async () => {
  let calls = 0;
  const history = fixture(async (_t, _i, _s, r) => result([bar(++calls === 1 ? trade.openTime : r!.to)], calls === 1 ? "cache" : "yahoo"));
  await history.start();
  for (let i = 0; i < 8; i++) await history.extend("newer");
  assert.equal(history.state.range.to, range.to + 86400 * 30);
  assert.equal(calls, 4);
  assert.match(history.state.result.source, /cache \/ yahoo/);
  assert.match(history.state.messages.newer, /current date/);
});

test("timeframe initialization preserves a panned historical context and bounds long trades", () => {
  const context = { from: trade.openTime - 740 * 86400, to: trade.openTime - 739 * 86400 };
  for (const interval of intervals) {
    const r = initialHistoryRange(trade, interval, context);
    assert.equal((r.from + r.to) / 2, (context.from + context.to) / 2);
    assert.ok(r.from < context.from && r.to > context.to);
  }
  const long = initialHistoryRange({ ...trade, openTime: trade.openTime - 730 * 86400 }, "5m");
  assert.ok(long.to - long.from <= 14 * 86400);
});

test("application history reuses successful pages and sends bounded, authenticated requests", async () => {
  const originalFetch = globalThis.fetch, calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ candles: [bar(trade.openTime)], source: "alpaca", metadata: { warnings: [], truncated: false } }));
  };
  try {
    const adapter = createApplicationAdapter();
    await adapter.candles(trade, "5m", undefined, range);
    await adapter.candles(trade, "5m", undefined, range);
    assert.equal(calls.length, 1);
    const url = new URL(calls[0].url, "http://localhost");
    assert.equal(url.pathname, "/api/workstation/candles");
    assert.equal(url.searchParams.get("from"), String(range.from));
    assert.equal(url.searchParams.get("limit"), "30000");
    assert.equal(calls[0].init?.credentials, "same-origin");
    await adapter.candles(trade, "15m", undefined, range);
    assert.equal(calls.length, 2);
  } finally { globalThis.fetch = originalFetch; }
});


test("history never splices a different provider, feed or adjustment basis into existing bars", async () => {
  let calls = 0;
  let receivedIdentity: string | undefined;
  const history = fixture(async (_trade, _interval, _signal, range, identity) => {
    receivedIdentity = identity;
    return { ...result([bar(++calls === 1 ? trade.openTime : range!.from)]), identity: calls === 1 ? "workstation:v1:alpaca:sip:raw" : "workstation:v1:yahoo:unverified" };
  });
  await history.start();
  const before = structuredClone(history.state.result);
  assert.equal(await history.extend("older"), false);
  assert.equal(receivedIdentity, "workstation:v1:alpaca:sip:raw");
  assert.deepEqual(history.state.result, before);
  assert.match(history.state.error, /provider, feed or price basis changed/);
});

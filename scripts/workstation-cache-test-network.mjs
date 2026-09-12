// Explicitly offline provider double for the loopback cache browser suite. Never use in deployment.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.ALLOW_TEST_DATABASE_MUTATIONS !== "1" || target.hostname !== "127.0.0.1" || target.port !== "55439" || target.pathname !== "/trades_workstation_auth_test" || process.env.TRADES_ALPACA_API_KEY_ID !== "isolated-dummy-key") throw new Error("Cache browser network double requires the isolated local database and dummy credentials.");
const original = globalThis.fetch;
const fixture = JSON.parse(readFileSync(process.env.WORKSTATION_TEST_CANDLES_FILE, "utf8"));
const steps = { "5Min": 300, "10Min": 600, "15Min": 900, "1Hour": 3600, "1Day": 86400, "1Week": 604800 };
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return original(input, init);
  if (url.hostname !== "data.alpaca.markets" || url.pathname !== "/v2/stocks/bars") throw new Error("External network disabled in isolated cache validation.");
  const symbol = url.searchParams.get("symbols"), timeframe = url.searchParams.get("timeframe"), step = steps[timeframe];
  appendFileSync(process.env.WORKSTATION_TEST_PROVIDER_LOG, JSON.stringify({ symbol, timeframe, from: url.searchParams.get("start"), to: url.searchParams.get("end") }) + "\n");
  await new Promise(resolve => setTimeout(resolve, 1200));
  if (existsSync(process.env.WORKSTATION_TEST_PROVIDER_LOG + ".offline")) return Response.json({}, { status: 503 });
  const from = Date.parse(url.searchParams.get("start")) / 1000, to = Date.parse(url.searchParams.get("end")) / 1000;
  const buckets = new Map();
  if (symbol === "MU") {
    for (const c of fixture.candles) {
      // This frozen September fixture is EDT. Coarse test bars use its provider session date.
      const origin = step === 86400 ? 4 * 3600 : step === 604800 ? 4 * 86400 + 4 * 3600 : 0;
      const time = Math.floor((c.time - origin) / step) * step + origin, prior = buckets.get(time);
      if (prior) { prior.h = Math.max(prior.h, c.high); prior.l = Math.min(prior.l, c.low); prior.c = c.close; prior.v += c.volume; }
      else buckets.set(time, { t: new Date(time * 1000).toISOString(), o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume });
    }
  } else {
    for (let t = Math.ceil(from / step) * step; t <= to; t += step) {
      const date = new Date(t * 1000); if ([0, 6].includes(date.getUTCDay())) continue;
      if (step < 86400 && (date.getUTCHours() < 13 || date.getUTCHours() >= 20)) continue;
      const price = 100 + Math.sin(t / 86400) * 5;
      buckets.set(t, { t: date.toISOString(), o: price, h: price + 2, l: price - 2, c: price + Math.sin(t / 3600), v: 10000 });
    }
  }
  const values = [...buckets.entries()].filter(([time]) => time >= from && time <= to).map(([, candle]) => candle);
  const offset = Number(url.searchParams.get("page_token") ?? 0);
  return Response.json({ bars: { [symbol]: values.slice(offset, offset + 10000) }, next_page_token: values.length > offset + 10000 ? String(offset + 10000) : null });
};

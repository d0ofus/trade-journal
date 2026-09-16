import { adjustSplitCandle, type SplitAdjustment } from "@/lib/workstation/split-adjustment";
import { loadWorkstationCandles, type WorkstationCandleInput, type WorkstationCandles } from "./workstation-candles";
import { workstationCandlePolicy } from "./workstation-candle-policy";
import { loadStockSplits } from "./workstation-stock-splits";
import { cacheHash, validateCandles } from "./workstation-cache-codec";

const separator = ":split-view:v1:";
/** Project durable raw history on read. Splits never rewrite accounting or the worker's raw cache. */
export async function loadSplitAdjustedWorkstationCandles(input: WorkstationCandleInput): Promise<WorkstationCandles & { splitAdjustment?: SplitAdjustment }> {
  const policy = workstationCandlePolicy();
  if (!policy.credentials || input.identity?.startsWith("workstation:v1:yahoo:")) return loadWorkstationCandles(input, policy);
  const rawIdentity = input.identity?.split(separator)[0];
  let adjustment: SplitAdjustment;
  try { adjustment = await loadStockSplits(input.symbol, policy.credentials, input.signal); }
  catch (error) {
    input.signal?.throwIfAborted();
    // Never append raw bars to a previously adjusted series, even during a provider outage.
    if (input.identity?.includes(separator)) throw error;
    const raw = await loadWorkstationCandles(input, policy);
    return { ...raw, warnings: [...(raw.warnings ?? []), "Split adjustment unavailable; showing the provider's original price basis. Reload the chart to retry split verification."] };
  }
  const revision = cacheHash(JSON.stringify(adjustment.splits)).slice(0, 20);
  if (input.identity && !input.identity.endsWith(`${separator}${revision}`)) throw new Error("Stock split history changed. Reload the chart to use the updated price basis.");
  // A week straddling a split cannot be repaired by multiplying its raw OHLC.
  // Ask Alpaca to aggregate adjusted prices for weekly bars and isolate that cache by split revision.
  const weekly = input.timeframe === "1wk" && adjustment.splits.length > 0;
  const effectivePolicy = weekly ? { ...policy, credentials: { ...policy.credentials, adjustment: "split" as const }, cacheSource: `workstation:v2:alpaca:${policy.credentials.feed}:split:${revision}` } : policy;
  const loaded = await loadWorkstationCandles({ ...input, identity: rawIdentity }, effectivePolicy);
  if (loaded.provider.provider !== "alpaca") return loaded;
  const candles = weekly ? loaded.candles : validateCandles(loaded.candles.map(candle => adjustSplitCandle(candle, adjustment)));
  return { ...loaded, candles, splitAdjustment: adjustment,
    provider: { ...loaded.provider, identity: `${loaded.provider.identity}${separator}${revision}`, adjustment: "split" },
    warnings: [...(loaded.warnings ?? []), "Split-adjusted prices and volume. Chart executions and drawing anchors use the same basis; original trade records are unchanged."] };
}

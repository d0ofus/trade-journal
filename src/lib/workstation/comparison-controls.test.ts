import { expect, it } from "vitest";
import { benchmarkColor, selectBenchmark, toggleBenchmark } from "./comparison";
import { tradeViewSchema, viewPreferences } from "./trade-view";
import type { ChartPanel } from "./types";

it("remembers the selected index through off and saved-view restoration", () => {
  let panel: ChartPanel = { id: "chart-1", interval: "5m" };
  expect(toggleBenchmark(panel).benchmark).toBe("SPY");
  panel = { ...panel, ...selectBenchmark(panel, "QQQ") };
  panel = { ...panel, ...toggleBenchmark(panel) };
  expect(panel).toMatchObject({ benchmark: "off", lastBenchmark: "QQQ" });
  const view = tradeViewSchema.parse({ version: 1, arrangement: "left", panels: [{ ...panel, session: "auto", range: null }] });
  expect(toggleBenchmark(viewPreferences(view).panels![0]).benchmark).toBe("QQQ");
});

it("validates custom colours and restores theme defaults", () => {
  expect(benchmarkColor(false, "#abcdef")).toBe("#abcdef");
  expect(benchmarkColor(true, "invalid")).toBe("#2563eb");
  expect(benchmarkColor(false)).toBe("#60a5fa");
});

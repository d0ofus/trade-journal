import assert from "node:assert/strict";
import { test } from "node:test";
import { paintChart, hitAt, type PaintOptions } from "../../components/workstation/chart-paint";
import { applyWorkspaceVisibility } from "../../components/workstation/workspace-layout";
import type { DockviewApi } from "dockview";
import { demoTrades, initialDemoDocument } from "./demo";
import { defaultPreferences, intervals, type Drawing } from "./types";
import { restoreChartDisplay } from "./chart-preferences";
import { volumeAppearance, volumeColor, restoreVolumeAppearance } from "./volume-style";
import { peerChartData, peerReplayRange, peerWarmupRange, type PeerView } from "./peers";
import { candlePeriod } from "./execution-diagnostics";
import { translateMeasurement } from "./measurement-drag";
import { workstationDocumentSchema } from "./schema";
import { defaultShortcuts, restoreShortcuts } from "./shortcuts";

test("volume overrides validate independently, preserve old defaults and reach all renderers", () => {
  assert.deepEqual(restoreVolumeAppearance({ up: { color: "red", transparency: -1 }, down: { color: "#010203", transparency: 0 }, average: { transparency: 100 } }), { down: { color: "#010203", transparency: 0 }, average: { transparency: 100 } });
  const override = { up: { color: "#112233", transparency: 25 } };
  for (const context of ["workspace", "capture", "peer"] as const) for (const light of [true, false]) assert.equal(volumeColor(override, "up", light, context), "rgba(17,34,51,0.75)");
  assert.equal(volumeAppearance(undefined, "average", true).color, "#96691e");
  assert.equal(volumeAppearance(undefined, "average", false).color, "#d4b477");
  assert.equal(volumeAppearance(undefined, "average", false, "peer").color, "#94a3b8");
  assert.equal(restoreChartDisplay({ capturePinNotes: true }).capturePinNotes, true);
  assert.equal(restoreChartDisplay({}).capturePinNotes, false);
});

function paint(drawing: Drawing, overrides: Partial<PaintOptions> = {}) {
  const texts: string[] = [];
  const ctx = new Proxy({ measureText: (text: string) => ({ width: text.length * 6 }), fillText: (text: string) => texts.push(text) }, { get: (target, key) => key in target ? target[key as keyof typeof target] : () => {}, set: () => true }) as unknown as CanvasRenderingContext2D;
  const hits = paintChart(ctx, { width: 500, height: 300, plotWidth: 460, plotHeight: 280, x: () => 200, y: () => 140, drawings: [drawing], trade: { ...demoTrades[0], executions: [] }, candles: [], interval: "5m", labels: "hidden", selected: null, selectedExecution: null, light: false, replay: null, ...overrides });
  return { hits, texts };
}

test("pins hide their wrapped text until previewed; capture notes are explicit and hit targets stay on the pin", () => {
  const pin: Drawing = { ...initialDemoDocument(demoTrades[0]).drawings[0], tool: "pin", text: "A long pin note that wraps to multiple lines without hiding its ending." };
  assert.deepEqual(paint(pin).texts, []);
  const shown = paint(pin, { pinPreview: pin.id });
  assert.ok(shown.texts.length > 1); assert.match(shown.texts.join(" "), /ending\./);
  assert.equal(hitAt(shown.hits, { x: 200, y: 128 })?.id, pin.id);
  assert.equal(hitAt(shown.hits, { x: 300, y: 160 }), undefined);
  assert.deepEqual(paint(pin, { export: true, pinPreview: pin.id }).texts, []);
  assert.deepEqual(paint(pin, { export: true, capturePinNotes: true }).texts, shown.texts);
  assert.deepEqual(paint(pin, { export: true, capturePinNotes: true, drawings: [] }).texts, []);
});

test("ray strokes and labels select narrowly and translate their original anchor", () => {
  const ray: Drawing = { ...initialDemoDocument(demoTrades[0]).drawings[0], tool: "ray", text: "Ray note" };
  const result = paint(ray);
  assert.equal(hitAt(result.hits, { x: 350, y: 140 })?.id, ray.id);
  assert.equal(hitAt(result.hits, { x: 350, y: 146 }), undefined);
  assert.equal(hitAt(result.hits, { x: 150, y: 140 }), undefined);
  assert.ok(result.hits.some(h => h.id === ray.id && !h.segment && h.h === 24));
  const bars = [100, 400, 10000].map(time => ({ time, open: 10, high: 12, low: 9, close: 11, volume: 100 }));
  assert.deepEqual(translateMeasurement([{ time: 400, price: 11 }], bars, "5m", 1, 2), [{ time: 10000, price: 13 }]);
  assert.deepEqual(translateMeasurement([{ time: 400, price: 11 }], bars, "5m", 10, 2, 10000), [{ time: 10000, price: 13 }]);
});

test("replay range targets and warmups cannot request beyond the frozen cutoff", () => {
  assert.deepEqual(peerReplayRange({ from: 900, to: 1100 }, 1000), { from: 800, to: 1000 });
  assert.deepEqual(peerReplayRange({ from: 900, to: 950 }, 1000), { from: 900, to: 950 });
  assert.equal(peerWarmupRange({ range: { from: 900, to: 1100 }, replayAt: 1000, interval: "1wk", session: "regular", adjustment: "raw", beforeEntry: false }, 20).to, 1000);
});

test("focus journal visibility is independent of normal panel preferences", () => {
  const groups = ["charts", "journal", "drawings", "executions"].map(id => ({ element: { style: { visibility: "" } }, panels: [{ id }], api: { isVisible: true, setVisible(value: boolean) { this.isVisible = value; } } }));
  const api = { groups } as unknown as DockviewApi;
  const prefs = { ...defaultPreferences(), focusMode: true, journal: true, bottomCollapsed: false };
  applyWorkspaceVisibility(api, prefs); assert.deepEqual(groups.map(g => g.api.isVisible), [true, false, false, false]);
  applyWorkspaceVisibility(api, prefs, true); assert.deepEqual(groups.map(g => g.api.isVisible), [true, true, false, false]);
  applyWorkspaceVisibility(api, { ...prefs, focusMode: false }); assert.deepEqual(groups.map(g => g.api.isVisible), [true, true, true, true]);
});

test("peer filtering uses completed exchange candles for every interval/session and intersects Before entry", () => {
  for (const interval of intervals) for (const session of ["regular", "extended"] as const) {
    const time = Date.parse(interval === "1wk" ? "2026-09-07T00:00:00Z" : interval === "1d" ? "2026-09-08T00:00:00Z" : "2026-09-08T13:30:00Z") / 1000;
    const source = [{ time, open: 100, high: 120, low: 90, close: 110, volume: 10 }];
    const view: PeerView = { range: { from: time - 86400, to: time + 86400 }, interval, session, adjustment: "split", beforeEntry: false };
    const basis = peerChartData(source, demoTrades[0], view).session;
    const period = candlePeriod(time, interval, basis);
    assert.deepEqual(peerChartData(source, demoTrades[0], { ...view, replayAt: period.end - 1 }).candles, []);
    assert.deepEqual(peerChartData(source, demoTrades[0], { ...view, replayAt: period.end }).candles, source);
    const first = { ...demoTrades[0].executions[0], time: period.start + 1 };
    const trade = { ...demoTrades[0], openTime: first.time, executions: [first] };
    assert.deepEqual(peerChartData(source, trade, { ...view, replayAt: period.end, beforeEntry: true }).candles, []);
  }
});

test("pin documents and replay evidence stay schema 1; new shortcuts never steal existing bindings", () => {
  const doc = initialDemoDocument(demoTrades[0]);
  doc.drawings[0].tool = "pin"; doc.drawings[0].points = doc.drawings[0].points.slice(0, 1);
  doc.evidence = [{ id: "replay", name: "frame.png", image: "data:image/png;base64,iVBORw0KGgo=", time: 10000, replayAt: 5000, timeframe: "5m", revision: 0 }];
  assert.equal(workstationDocumentSchema.parse(doc).evidence[0].replayAt, 5000);
  assert.equal(workstationDocumentSchema.safeParse({ ...doc, evidence: [{ ...doc.evidence[0], replayAt: -1 }] }).success, false);
  const shortcuts = defaultShortcuts(); shortcuts.bindings["panel.drawings"] = "Shift+D";
  assert.equal(restoreShortcuts(shortcuts).bindings["panel.drawings"], "Shift+D");
  assert.equal(defaultShortcuts().bindings["panel.evidence"], null);
  assert.equal(defaultShortcuts().bindings["tool.ray"], "R");
});

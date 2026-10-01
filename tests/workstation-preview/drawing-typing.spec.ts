import { expect, test } from "@playwright/test";
import { defaultPreferences, type TradeDocument } from "../../src/lib/workstation/types";
import { DEMO_PREFIX, demoTrades, initialDemoDocument } from "../../src/lib/workstation/demo";

type TypingMetrics = { input: number[]; measures: number; paints: Record<string, number>; commits: number; renderMs: number };
type Fiber = { actualDuration: number; flags: number; type?: { name?: string; displayName?: string }; child?: Fiber; sibling?: Fiber };
type ProfileWindow = Window & { typing: TypingMetrics; __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown };

test("annotation typing profile and persistence on main and peer charts", async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [], requests: string[] = [];
  page.on("pageerror", error => { errors.push(error.message); console.log("PAGE_ERROR", error.message); });
  page.on("request", request => { if (request.url().includes("/api/")) requests.push(request.url()); });
  await page.route("**/api/**", route => route.abort());
  const doc = initialDemoDocument(demoTrades[0]);
  doc.drawings = [];
  await page.addInitScript(({ doc, key, preferences }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(doc));
    if (!localStorage.getItem("execution-lab:workstation:preferences:demo:v1")) localStorage.setItem("execution-lab:workstation:preferences:demo:v1", JSON.stringify(preferences));
    const scope = window as unknown as ProfileWindow; // Browser instrumentation only.
    scope.typing = { input: [] as number[], measures: 0, paints: {} as Record<string, number>, commits: 0, renderMs: 0 };
    const renderers = new Map();
    scope.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { renderers, supportsFiber: true, inject: (renderer: unknown) => { renderers.set(1, renderer); return 1; }, onCommitFiberUnmount() {}, onCommitFiberRoot(_id: number, root: { current: Fiber }) {
      scope.typing.commits++; scope.typing.renderMs += root.current.actualDuration ?? 0;

    } };
    document.addEventListener("input", event => {
      if (!(event.target instanceof HTMLTextAreaElement)) return;
      const start = performance.now(); requestAnimationFrame(() => scope.typing.input.push(performance.now() - start));
    }, true);
    const proto = CanvasRenderingContext2D.prototype, measure = proto.measureText, clear = proto.clearRect;
    proto.measureText = function(text) { scope.typing.measures++; return measure.call(this, text); };
    proto.clearRect = function(...args) {
      if (this.canvas.classList.contains("ws-chart-overlay") || this.canvas.classList.contains("ws-peer-drawing-canvas")) {
        const name = this.canvas.closest("[data-peer-symbol]")?.getAttribute("data-peer-symbol") ?? "main";
        scope.typing.paints[name] = (scope.typing.paints[name] ?? 0) + 1;
      }
      return clear.apply(this, args);
    };
  }, { doc, key: DEMO_PREFIX + demoTrades[0].id, preferences: { ...defaultPreferences(), journal: true, magnet: false, panels: [{ id: "chart-1", interval: "1d", session: "regular" }] } });
  await page.goto("/preview/trades?groupKey=demo-nvda");
  const chart = page.locator(".ws-chart").first();
  await expect(chart).toHaveAttribute("data-visible-from", /\d+/, { timeout: 25000 });
  await chart.focus(); await page.keyboard.press("n");
  let box = (await chart.locator(".ws-chart-overlay").boundingBox())!;
  await page.mouse.click(box.x + box.width * .45, box.y + box.height * .45);
  const editor = page.getByLabel("Annotation text", { exact: true });
  await expect(editor).toBeFocused();
  await expect(page.getByLabel("Pre-trade metrics")).toContainText("SMA50 distance · ADR×");
  await expect(page.getByLabel("Pre-trade metrics")).toContainText("SMA50 distance · ATR×");
  const text = "A long multiline annotation with wrapping and intact caret.\nSecond line continues here.";
  const reports = [];

  for (const area of ["main", "peer"]) {
    if (area === "peer") {
      await page.locator("summary").filter({ hasText: /^Peers$/ }).click();
      await page.getByRole("button", { name: "Compare peers", exact: true }).click();
      const peer = page.locator('[data-peer-symbol="PEER01"]');
      await expect(peer.locator("[data-peer-canvas]")).toHaveAttribute("data-visible-from", /\d+/);
      await peer.locator("[data-peer-canvas]").click();
      await page.getByRole("button", { name: "Drawings", exact: true }).click();
      await page.getByRole("dialog", { name: "Peer comparison" }).getByRole("button", { name: "text", exact: true }).click();
      await page.getByRole("button", { name: "Close comparison controls" }).click();
      box = (await peer.locator("[data-peer-canvas]").boundingBox())!;
      await page.mouse.click(box.x + box.width * .45, box.y + box.height * .45);
      await expect(page.getByLabel("Annotation", { exact: true })).toBeFocused();
    }
    // Let chart loading and focus settle before measuring the same typing sequence.
    await page.waitForTimeout(1500);
    const beforeRequests = requests.length;
    const range = [await chart.getAttribute("data-visible-from"), await chart.getAttribute("data-visible-to")];
    await page.evaluate(() => { (window as unknown as ProfileWindow).typing = { input: [], measures: 0, paints: {}, commits: 0, renderMs: 0 }; });
    await page.keyboard.type(text, { delay: 8 });

    await expect(area === "main" ? editor : page.getByLabel("Annotation", { exact: true })).toHaveValue(text);
    const report = await page.evaluate(() => (window as unknown as ProfileWindow).typing);
    const sorted = report.input.sort((a: number, b: number) => a - b);
    reports.push({ area, ...report, input: undefined, p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)] });
    console.log("TYPING_SAMPLE", JSON.stringify(reports.at(-1)));
    if (area === "peer") expect(Object.keys(report.paints)).toEqual(["PEER01"]);
    expect(requests.length).toBe(beforeRequests);
    await expect.poll(() => page.evaluate(({ key, area, text }) => {
      const value = JSON.parse(localStorage.getItem(key)!) as TradeDocument;
      return (area === "main" ? value.drawings : value.comparison?.drawings.PEER01 ?? []).some(drawing => drawing.text === text);
    }, { key: DEMO_PREFIX + demoTrades[0].id, area, text })).toBe(true);
    expect([await chart.getAttribute("data-visible-from"), await chart.getAttribute("data-visible-to")]).toEqual(range);
    if (area === "main") {
      await editor.press("Home");
      await editor.dispatchEvent("compositionstart");
      await page.keyboard.insertText("雪");
      await editor.dispatchEvent("compositionend", { data: "雪" });
      await expect(editor).toHaveValue(text.replace("\n", "\n雪"));
      await editor.press("Backspace");
      await expect(editor).toHaveValue(text);
      await chart.focus(); await page.keyboard.press("Control+z");
      await page.keyboard.press("Control+Shift+z");
    }
  }
  await page.getByRole("button", { name: "Close peer comparison" }).click();
  await page.locator(".ws-trade-card-main").filter({ has: page.locator("strong", { hasText: /^AAPL$/ }) }).click();
  await expect(page.getByLabel("Choose trade")).toHaveValue("demo-aapl");
  await page.locator(".ws-trade-card-main").filter({ has: page.locator("strong", { hasText: /^NVDA$/ }) }).click();
  await expect(page.getByLabel("Choose trade")).toHaveValue("demo-nvda");
  await page.reload();
  await expect(chart).toHaveAttribute("data-visible-from", /\d+/);
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!) as TradeDocument, DEMO_PREFIX + demoTrades[0].id);
  expect(saved.drawings.at(-1)?.text).toBe(text); expect(saved.comparison?.drawings.PEER01.at(-1)?.text).toBe(text);
  await page.screenshot({ path: info.outputPath("metrics-and-drawings.png"), fullPage: true });
  await info.attach("typing-profile", { body: JSON.stringify(reports, null, 2), contentType: "application/json" });
  console.log("TYPING_PROFILE", JSON.stringify(reports));
  expect(errors).toEqual([]);
});

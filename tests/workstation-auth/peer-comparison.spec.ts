import { expect, test, type BrowserContext } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";
import { candleFixture } from "./candle-fixture";
import { defaultPreferences } from "../../src/lib/workstation/types";
import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";

let groupKey: string, symbol: string;
const endpoint = () => `/api/closed-trades/${encodeURIComponent(groupKey)}/workstation`;
async function login(context: BrowserContext) {
  const { csrfToken } = await (await context.request.get("/api/auth/csrf")).json();
  await context.request.post("/api/auth/callback/credentials", { form: { csrfToken, username: "phase2-reviewer", password: "phase2-local-test-only", json: "true" } });
}
test.beforeAll(async () => {
  const trade = await prisma.closedTrade.findFirstOrThrow({ where: { account: { ibkrAccount: "DEMO-WORKSTATION" }, isStale: false }, orderBy: { openTime: "desc" } });
  groupKey = trade.groupKey; symbol = trade.symbol;
});
test.afterAll(() => prisma.$disconnect());
test("authenticated peer captures persist, recover offline, export, and leave candle tables unchanged", async ({ page, context }) => {
  await login(context);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(prefs => localStorage.setItem("execution-lab:workstation:preferences:application:v1", JSON.stringify({ ...prefs, journal: true, panels: [{ id: "chart-1", interval: "1d", session: "regular" }] })), defaultPreferences());
  await context.route("**/api/workstation/candles?**", route => route.fulfill({ json: candleFixture(route.request().url()) }));
  let memberships = 0;
  await context.route("**/api/journal/market-context?**", route => { memberships++; return route.fulfill({ json: { detail: { groups: [{ id: "peer-auth", name: "Authenticated curated group", priority: 99, isActive: true, members: [symbol, "AAPL", "MSFT"].map(ticker => ({ ticker, exchange: "NASDAQ" })) }] }, metrics: null, errors: [] } }); });
  const batches: string[][] = [];
  await context.route("**/api/workstation/peer-candles?**", route => {
    const p = new URL(route.request().url()).searchParams, symbols = p.get("symbols")!.split(","); batches.push(symbols);
    const from = Number(p.get("from")), to = Number(p.get("to"));
    const series = symbols.map(ticker => ({ symbol: ticker, status: "ready", source: "Alpaca mocked", identity: "test", adjustment: p.get("adjustment"), feed: "sip", range: { from, to }, candles: Array.from({ length: Math.ceil((to - from) / 86400) }, (_, i) => ({ time: from + i * 86400, open: 100, close: 102, high: 103, low: 99, volume: 10000 })) }));
    return route.fulfill({ json: { series } });
  });
  const before = await (await context.request.get(endpoint())).json();
  const candleCounts = () => Promise.all([prisma.marketCandle.count(), prisma.workstationCandleChunk.count(), prisma.workstationCandleCoverage.count(), prisma.workstationCandleJob.count()]);
  const candlesBefore = await candleCounts();
  await page.goto(`/trades?account=DEMO-WORKSTATION&groupKey=${encodeURIComponent(groupKey)}`);
  await page.locator("summary").filter({ hasText: /^Peers$/ }).click();
  await page.getByRole("button", { name: "Compare peers", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Peer comparison", exact: true }), card = dialog.locator('[data-peer-symbol="AAPL"]');
  await expect(card.getByRole("button", { name: "Attach comparison", exact: true })).toBeEnabled();
  expect(memberships).toBe(2); expect(Math.max(...batches.map(b => b.length))).toBeLessThanOrEqual(8);
  await card.getByRole("button", { name: "Attach current chart", exact: true }).click();
  await expect.poll(async () => (await (await context.request.get(endpoint())).json()).evidence.length).toBe(before.evidence.length + 1);
  await expect(dialog.getByText("Saving chart to Peers…")).toHaveCount(0);
  // A failed save retains the new paired image in the existing recovery system.
  await page.route(`**${endpoint()}`, route => route.request().method() === "PATCH" ? route.abort() : route.continue());
  await card.getByRole("button", { name: "Attach comparison", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("recovery draft");
  await dialog.getByRole("button", { name: "Close peer comparison" }).click();
  await page.unroute(`**${endpoint()}`);
  await page.reload();
  await expect.poll(async () => (await (await context.request.get(endpoint())).json()).evidence.length).toBe(before.evidence.length + 2);
  const saved = await (await context.request.get(endpoint())).json();
  expect(saved.evidence.at(-1).peerCapture).toMatchObject({ symbols: [symbol, "AAPL"], groupId: "peer-auth" });
  await page.locator("summary").filter({ hasText: /^Takeaways$/ }).click();
  await page.getByRole("button", { name: "Show Evidence", exact: true }).click();
  await page.locator(".ws-evidence-sections").last().locator("summary").click();
  await page.locator(".ws-evidence-sections").last().getByLabel("Takeaways", { exact: true }).check();
  await expect.poll(async () => (await (await context.request.get(endpoint())).json()).review.notion.sectionEvidence?.takeaways).toContain(saved.evidence.at(-1).id);
  await page.getByRole("button", { name: "Export review for Notion", exact: true }).click();
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Review page ZIP", exact: true }).click();
  const files = unzipSync(readFileSync((await (await download).path())!));
  expect(Object.keys(files).filter(path => path.startsWith("assets/"))).toHaveLength(saved.evidence.length);
  const html = strFromU8(files["review.html"]);
  expect(html.slice(html.indexOf("<h2>Takeaways"))).toContain("<img");
  expect(await candleCounts()).toEqual(candlesBefore);
  expect(errors).toEqual([]);
});

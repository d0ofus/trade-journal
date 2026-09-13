import { expect, test, type BrowserContext } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";
import { listWorkstationTrades } from "../../src/lib/server/trade-workstation";
import { defaultPreferences } from "../../src/lib/workstation/types";
import { mkdirSync } from "node:fs";
let id: string;
const url = () => `/trades?account=DEMO-WORKSTATION&symbol=MU&groupKey=${encodeURIComponent(id)}`;
const endpoint = () => `/api/closed-trades/${encodeURIComponent(id)}/workstation/view`;
async function login(context: BrowserContext) {
  const csrf = await (await context.request.get("/api/auth/csrf")).json();
  expect((await context.request.post("/api/auth/callback/credentials", { form: { csrfToken: csrf.csrfToken, username: "phase2-reviewer", password: "phase2-local-test-only", json: "true", callbackUrl: "http://127.0.0.1:3101/trades" } })).ok()).toBe(true);
}
test.beforeAll(async () => { id = (await listWorkstationTrades({ account: "DEMO-WORKSTATION", symbol: "MU" }))[0].id; mkdirSync("screenshots/neon-personal-retention", { recursive: true }); });
test.afterAll(async () => { await prisma.$disconnect(); });
test("panned views survive reload independently of reviews; replay does not rewrite them", async ({ page, context }) => {
  await login(context); await prisma.workstationTradeView.deleteMany({ where: { groupKey: id } });
  await page.addInitScript(prefs => { localStorage.setItem("execution-lab:workstation:preferences:application:v1", JSON.stringify(prefs)); localStorage.setItem("execution-lab:backup-reminder:snoozed:v1", String(Date.now())); }, defaultPreferences());
  const before = await prisma.closedTradeNote.findUnique({ where: { groupKey: id } });
  await page.goto(url()); const chart = page.getByRole("region", { name: "MU 5m chart", exact: true });
  await expect(chart).toHaveAttribute("data-visible-bars", /[1-9]/);
  const original = await chart.getAttribute("data-visible-from");
  const rect = await chart.boundingBox(); await page.mouse.move(rect!.x + rect!.width * .5, rect!.y + 140); await page.mouse.wheel(0, -450);
  await expect(chart).not.toHaveAttribute("data-visible-from", original!);
  await page.waitForTimeout(1600);
  const saved = await (await context.request.get(endpoint())).json();
  expect(saved.view.panels).toHaveLength(3);
  const savedRange = saved.view.panels[0].range;
  await page.reload(); await expect(chart).toHaveAttribute("data-visible-bars", /[1-9]/);
  await expect.poll(async () => Number(await chart.getAttribute("data-visible-from"))).toBe(savedRange.from);
  await expect.poll(async () => Number(await chart.getAttribute("data-visible-to"))).toBe(savedRange.to);
  expect(await prisma.closedTradeNote.findUnique({ where: { groupKey: id } })).toEqual(before);
  const replayBefore = await (await context.request.get(endpoint())).json();
  await page.getByRole("button", { name: "Replay trade", exact: true }).click();
  await page.waitForTimeout(1600);
  expect((await (await context.request.get(endpoint())).json()).revision).toBe(replayBefore.revision);
  await page.screenshot({ path: "screenshots/neon-personal-retention/desktop-replay.png" });
});
test("stale tab views are retained locally and never overwrite a newer revision", async ({ page, context }) => {
  await login(context); await page.goto(url()); const chart = page.getByRole("region", { name: "MU 5m chart", exact: true });
  await expect(chart).toHaveAttribute("data-visible-bars", /[1-9]/); await page.waitForTimeout(1400);
  const old = await (await context.request.get(endpoint())).json();
  const newer = await context.request.patch(endpoint(), { data: { expectedRevision: old.revision, view: { ...old.view, arrangement: "top" } } }); expect(newer.ok()).toBe(true);
  const rect = await chart.boundingBox(); await page.mouse.move(rect!.x + rect!.width * .5, rect!.y + 140); await page.mouse.wheel(0, -300);
  await expect(page.getByRole("button", { name: "Use saved chart view" })).toBeVisible();
  const saved = await (await context.request.get(endpoint())).json(); expect(saved.view.arrangement).toBe("top"); expect(saved.revision).toBe(old.revision + 1);
  expect(await page.evaluate(key => !!localStorage.getItem(key), `execution-lab:trade-view:application:${id}:v1`)).toBe(true);
  await page.getByRole("button", { name: "Use saved chart view" }).click();
  await expect(page.getByRole("button", { name: "Use saved chart view" })).toHaveCount(0);
  await expect(chart).toHaveAttribute("data-visible-bars", /[1-9]/);
});
test("chart view endpoints enforce authentication, revision and payload bounds", async ({ context, browser }) => {
  const anonymous = await browser.newContext(); const denied = await anonymous.request.get('http://127.0.0.1:3101' + endpoint(), { maxRedirects: 0 }); expect(denied.status()).toBe(307); expect(denied.headers().location).toContain("/login"); await anonymous.close();
  await login(context); const current = await (await context.request.get(endpoint())).json();
  expect((await context.request.patch(endpoint(), { data: { expectedRevision: 0, view: current.view } })).status()).toBe(409);
  expect((await context.request.patch(endpoint(), { data: { expectedRevision: current.revision, view: { ...current.view, version: 2 } } })).status()).toBe(400);
  expect((await context.request.patch(endpoint(), { data: { junk: "x".repeat(17000) } })).status()).toBe(413);
});

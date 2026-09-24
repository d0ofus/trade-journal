import { expect, test, type BrowserContext } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";
import type { StorageUsage } from "../../src/lib/storage-usage";

async function login(context: BrowserContext) {
  const csrf = await (await context.request.get("/api/auth/csrf")).json();
  await context.request.post("/api/auth/callback/credentials", { form: { csrfToken: csrf.csrfToken, username: "phase2-reviewer", password: "phase2-local-test-only", json: "true" } });
}
test.afterAll(() => prisma.$disconnect());

test("unified metrics authenticate, refresh and retain failed groups without erasing values", async ({ page, context }) => {
  expect([401, 307]).toContain((await context.request.get("/api/settings/storage", { maxRedirects: 0 })).status());
  expect([401, 307]).toContain((await context.request.post("/api/settings/storage", { maxRedirects: 0 })).status());
  await login(context);
  const response = await context.request.get("/api/settings/storage"); expect(response.status()).toBe(200);
  const measurement = await response.json() as StorageUsage;
  expect(measurement.workstation?.drawings).toBeGreaterThanOrEqual(0);
  // Physical scanning of unrelated local test databases can time out. Use a deterministic
  // physical reading for the presentation/failure test; production comparison checks actual sizes.
  measurement.database = { currentBytes: 111_476_736, branchBytes: 135_593_984, cacheBytes: 39_895_040, metricCacheBytes: 106_496 };
  measurement.groups!.database = { measuredAt: new Date().toISOString(), complete: true, error: null };
  let fail = false, partial = false, requests = 0;
  await page.route("**/api/settings/storage", route => {
    if (route.request().method() === "POST") return route.fulfill({ json: { account: null, error: "Test account metrics unavailable", nextRefreshAt: new Date(Date.now() + 900_000).toISOString() } });
    requests++;
    const body = structuredClone(measurement);
    if (partial) { body.database = null; body.groups!.database = { measuredAt: null, complete: false, error: "Size permission denied" }; }
    return route.fulfill(fail ? { status: 503, json: { error: "Temporary failure" } } : { json: body });
  });
  await page.clock.install(); await page.goto("/settings#cloud-storage");
  const monitor = page.getByTestId("cloud-storage-monitor");
  await expect(page.getByText("Storage & Data Health", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Storage Health & Backup", { exact: true })).toHaveCount(0);
  await expect(monitor.getByRole("region", { name: "Workstation reviews", exact: true })).toBeVisible();
  await expect(monitor.getByTestId("metrics-status-database")).toContainText("Measured");
  const database = page.getByTestId("storage-health-db-size");
  const original = await database.locator("dd").innerText();
  partial = true; await monitor.getByRole("button", { name: "Refresh metrics" }).click();
  await expect(monitor.getByTestId("metrics-status-database")).toContainText("Stale or incomplete");
  await expect(database.locator("dd")).toHaveText(original);
  await expect(monitor.getByTestId("metrics-status-activity")).toContainText("Measured");
  partial = false; fail = true; await monitor.getByRole("button", { name: "Refresh metrics" }).click();
  await expect(monitor.getByRole("alert")).toContainText("previous readings");
  await expect(database.locator("dd")).toHaveText(original);
  fail = false; await monitor.getByRole("button", { name: "Refresh metrics" }).click();
  await expect(monitor.getByTestId("metrics-status-database")).not.toContainText("Stale");
  await database.getByText("Exact bytes", { exact: true }).click();
  await expect(database).toContainText("bytes (decimal KB/MB/GB)");
  const before = requests; await page.clock.fastForward(60_000);
  await expect.poll(() => requests).toBeGreaterThan(before);
  await expect(monitor.getByRole("button", { name: "Refresh metrics" })).toBeEnabled();
  await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }));
  const hiddenRequests = requests; await page.clock.fastForward(130_000);
  expect(requests).toBe(hiddenRequests);
  await expect(monitor.getByTestId("metrics-status-database")).toContainText("Stale");
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(() => requests).toBeGreaterThan(hiddenRequests);
  await expect(page.getByText("Backup status & downloads", { exact: true })).toBeVisible();
  await expect(page.getByText("These are metadata checks", { exact: false })).toBeVisible();
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await monitor.scrollIntoViewIfNeeded(); await monitor.screenshot({ path: test.info().outputPath(`unified-storage-${width}.png`) });
  }
});

test("provider refresh is bounded separately and shows stale Cloudflare readings", async ({ page, context }) => {
  await login(context);
  const measurement = await (await context.request.get("/api/settings/storage")).json() as StorageUsage;
  const base = Date.now(); let gets = 0, posts = 0, nextAt = 0;
  const account = { measuredAt: new Date(base - 3600_000).toISOString(), standardBytes: 7_000_000_000, otherClassBytes: 0, stale: true, warning: null, estimatedMonthlyStorageUsd: 0 };
  await page.route("**/api/settings/storage", route => {
    if (route.request().method() === "POST") {
      posts++; nextAt = base + posts * 900_000;
      return route.fulfill({ json: { account, error: "Cloudflare requested a cooldown; previous reading retained.", nextRefreshAt: new Date(nextAt).toISOString() } });
    }
    gets++; return route.fulfill({ json: { ...measurement, evidence: { ...measurement.evidence, account, accountError: null, accountNextRefreshAt: nextAt ? new Date(nextAt).toISOString() : null } } });
  });
  await page.clock.install({ time: base }); await page.goto("/settings");
  await expect.poll(() => posts).toBe(1);
  await expect(page.getByText(/Stale account reading/)).toBeVisible();
  const refresh = page.getByRole("button", { name: "Refresh metrics" });
  await expect(refresh).toBeEnabled(); await refresh.click();
  await expect.poll(() => gets).toBeGreaterThan(1); expect(posts).toBe(1);
  await page.clock.fastForward(14 * 60_000); await expect(refresh).toBeEnabled(); expect(posts).toBe(1);
  await page.clock.fastForward(60_000); await expect.poll(() => posts).toBe(2);
  await expect(page.getByText(/not the provider's measurement time/)).toBeVisible();
});

test("leaving Settings cancels the pending metrics request and stops polling", async ({ page, context }) => {
  await login(context);
  let calls = 0;
  await page.route("**/api/settings/storage", route => { calls++; return route.abort("aborted"); });
  await page.clock.install(); await page.goto("/settings");
  await expect(page.getByRole("alert").filter({ hasText: /fetch|measurements|readings/i })).toBeVisible();
  await page.goto("/login"); const stopped = calls;
  await page.clock.fastForward(180_000); expect(calls).toBe(stopped);
});

test("client-side navigation aborts an in-flight measurement", async ({ page, context }) => {
  await login(context);
  let aborted = 0;
  await page.exposeFunction("reportStorageAbort", () => { aborted++; });
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (String(input) === "/api/settings/storage") return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          void (window as unknown as { reportStorageAbort: () => Promise<void> }).reportStorageAbort();
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
      return original(input, init);
    };
  });
  await page.goto("/settings");
  await expect(page.getByTestId("cloud-storage-monitor")).toHaveAttribute("aria-busy", "true");
  await page.getByRole("link", { name: "Dashboard", exact: true }).first().click();
  await expect.poll(() => aborted).toBe(1);
});

test("saved synthetic reviews and evidence update the same dashboard without object downloads", async ({ page, context }) => {
  await login(context);
  const key = `browser-metrics-${crypto.randomUUID()}`;
  const baseline = await (await context.request.get("/api/settings/storage")).json() as StorageUsage;
  try {
    await prisma.closedTradeNote.create({ data: { groupKey: key, content: "", workstationJson: JSON.stringify({ schema: 1, drawings: [{ id: "visible" }, { id: "hidden", hidden: true }], evidence: [] }) } });
    await page.goto("/settings");
    const section = page.getByRole("region", { name: "Workstation reviews", exact: true });
    const drawings = section.locator("div").filter({ has: page.locator("dt", { hasText: /^Workspace drawings$/ }) }).last();
    await expect(drawings.locator("dd")).toHaveText((baseline.workstation!.drawings + 2).toLocaleString());
    await prisma.closedTradeNote.update({ where: { groupKey: key }, data: { workstationJson: JSON.stringify({ schema: 1, drawings: [], evidence: [{ id: "inline", image: "data:image/png;base64,aGVsbG8=" }] }) } });
    await page.getByRole("button", { name: "Refresh metrics" }).click();
    await expect(drawings.locator("dd")).toHaveText(baseline.workstation!.drawings.toLocaleString());
    const fresh = await (await context.request.get("/api/settings/storage")).json() as StorageUsage;
    expect(fresh.workstation!.evidenceEntries).toBe(baseline.workstation!.evidenceEntries + 1);
    expect(fresh.workstation!.inlineImages).toBe(baseline.workstation!.inlineImages + 1);
    await expect(page.getByRole("button", { name: "Complete database + images backup", exact: true })).toBeVisible();
  } finally { await prisma.closedTradeNote.deleteMany({ where: { groupKey: key } }); }
});

test("database backup verification refreshes the summary without reloading Settings", async ({ page, context }) => {
  await login(context);
  let auditId: string | undefined;
  let measurements = 0;
  let releaseMeasurement: (() => void) | undefined;
  page.on("request", request => { if (request.method() === "GET" && request.url().endsWith("/api/settings/storage")) measurements++; });
  try {
    await page.goto("/settings");
    await expect(page.getByTestId("metrics-status-backup")).toContainText("Measured");
    await expect(page.getByRole("button", { name: "Refresh metrics", exact: true })).toBeEnabled();
    const initialRequests = measurements;
    // Freeze one pre-backup reading so verification completes while a refresh is pending.
    await page.route("**/api/settings/storage", async route => {
      if (route.request().method() !== "GET" || releaseMeasurement) return route.continue();
      const response = await route.fetch();
      await new Promise<void>(resolve => { releaseMeasurement = resolve; });
      await route.fulfill({ response });
    });
    await page.getByRole("button", { name: "Refresh metrics", exact: true }).click();
    await expect.poll(() => !!releaseMeasurement).toBe(true);
    await page.evaluate(() => { (window as unknown as { storageTestSentinel: boolean }).storageTestSentinel = true; });
    const verification = page.waitForResponse(response => response.url().endsWith("/api/admin/backup/verify"));
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("backup-action-download-verify").click()]);
    const response = await verification;
    expect(response.status()).toBe(200);
    auditId = (await response.json()).audit.id;
    releaseMeasurement?.();
    expect(download.suggestedFilename()).toMatch(/^trade-journal-backup-.*\.json$/);
    expect(await download.failure()).toBeNull();
    await expect(page.getByTestId("backup-verify-status")).toContainText("Database verified");
    await expect.poll(() => measurements).toBeGreaterThan(initialRequests + 1);
    await expect(page.getByTestId("backup-freshness-status")).toContainText("Current", { timeout: 30_000 });
    expect(await page.evaluate(() => (window as unknown as { storageTestSentinel: boolean }).storageTestSentinel)).toBe(true);
    await expect(page.getByText("These are metadata checks", { exact: false })).toBeVisible();
    await expect(page.getByTestId("backup-readiness")).not.toContainText("all images verified");
  } finally { releaseMeasurement?.(); if (auditId) await prisma.backupAudit.deleteMany({ where: { id: auditId } }); }
});

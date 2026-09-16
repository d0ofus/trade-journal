import { expect, test } from "@playwright/test";
import type { StorageUsage } from "../../src/lib/storage-usage";

test("storage API requires authentication and the card retains stale values when refresh fails", async ({ page, context }) => {
  const unauthenticated = await context.request.get("/api/settings/storage", { maxRedirects: 0 });
  expect([401, 307]).toContain(unauthenticated.status());
  const csrf = await (await context.request.get("/api/auth/csrf")).json();
  await context.request.post("/api/auth/callback/credentials", { form: { csrfToken: csrf.csrfToken, username: "phase2-reviewer", password: "phase2-local-test-only", json: "true" } });
  const real = await context.request.get("/api/settings/storage"); expect(real.status()).toBe(200);
  const measurement = await real.json() as StorageUsage;
  expect(measurement.database?.currentBytes).toBeGreaterThan(0);
  expect(measurement.payloads?.inlineCount).toBeGreaterThanOrEqual(0);
  let fail = false, requests = 0;
  await page.route("**/api/settings/storage", route => {
    requests++;
    return route.fulfill(fail ? { status: 503, json: { error: "Temporary measurement failure" } } : { json: measurement });
  });
  await page.clock.install();
  await page.goto("/settings");
  const monitor = page.getByTestId("cloud-storage-monitor");
  await expect(monitor.getByText("Current database:", { exact: false })).toBeVisible();
  await expect(monitor.getByText(/Measured/)).toBeVisible();
  fail = true; await monitor.getByRole("button", { name: "Refresh storage" }).click();
  await expect(monitor.getByText(/Stale reading/)).toBeVisible();
  await expect(monitor.getByText("Current database:", { exact: false })).toBeVisible();
  await expect(monitor.getByRole("alert")).toHaveText("Temporary measurement failure");
  fail = false; await monitor.getByRole("button", { name: "Refresh storage" }).click();
  await expect(monitor.getByText(/Stale reading/)).toHaveCount(0);
  expect(requests).toBeGreaterThanOrEqual(3);
  const beforeTimer = requests; await page.clock.fastForward(60_000);
  await expect.poll(() => requests).toBeGreaterThan(beforeTimer);
  await expect(monitor.getByRole("button", { name: "Refresh storage" })).toBeEnabled();
  await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }));
  const hiddenRequests = requests; await page.clock.fastForward(60_000); expect(requests).toBe(hiddenRequests);
  await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }));
  measurement.database!.branchBytes = 399_000_000; measurement.database!.cacheBytes = 99_000_000;
  await monitor.getByRole("button", { name: "Refresh storage" }).click();
  await expect(monitor.getByText(/MB · Paused/)).toHaveCount(2);
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await monitor.scrollIntoViewIfNeeded();
    expect(await monitor.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await monitor.screenshot({ path: test.info().outputPath(`storage-${width}.png`) });
  }
});

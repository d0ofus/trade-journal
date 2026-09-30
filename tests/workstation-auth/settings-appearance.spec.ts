import { expect, test, type Locator } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";
import type { StorageUsage } from "../../src/lib/storage-usage";

const importIds = ["FAILED", "SUCCEEDED"].map(() => `settings-appearance-${crypto.randomUUID()}`);
test.beforeAll(async () => {
  for (const [index, status] of (["FAILED", "SUCCEEDED"] as const).entries()) await prisma.importBatch.create({ data: {
    id: importIds[index], filename: `Settings appearance ${status.toLowerCase()}.csv`, fileType: "CSV", status,
    rowsSeen: 2, rowsImported: status === "SUCCEEDED" ? 2 : 0, rowsSkipped: status === "FAILED" ? 2 : 0,
    ...(status === "FAILED" ? { errorMessage: "Synthetic parser failure", rowErrors: { create: { code: "TEST_ROW", rowNumber: 1, message: "Synthetic invalid row" } } } : {}),
  } });
});
test.afterAll(async () => { await prisma.importBatch.deleteMany({ where: { id: { in: importIds } } }); await prisma.$disconnect(); });
const background = (locator: Locator) => locator.evaluate(element => getComputedStyle(element).backgroundColor);
test("Settings follows shared dark/light appearance across sections and narrow screens", async ({ page, context }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const csrf = await (await context.request.get("/api/auth/csrf")).json();
  await context.request.post("/api/auth/callback/credentials", { form: { csrfToken: csrf.csrfToken, username: "phase2-reviewer", password: "phase2-local-test-only", json: "true" } });
  let failStorage = false;
  const measurement: StorageUsage = { measuredAt: new Date().toISOString(), issues: [],
    database: { currentBytes: 111_476_736, branchBytes: 135_593_984, cacheBytes: 39_895_040, metricCacheBytes: 106_496 }, payloads: null,
    backup: { latestDataChangeAt: null, tableCount: 20, totalRows: 500, requiredR2Originals: 2, databaseFreshness: "needs-backup", latestAudit: null },
  };
  await page.route("**/api/settings/storage", async route => {
    if (route.request().method() === "POST") return route.fulfill({ json: { account: null, error: "Provider temporarily unavailable", nextRefreshAt: null } });
    if (failStorage) return route.fulfill({ status: 503, json: { error: "Storage temporarily unavailable" } });
    return route.fulfill({ json: measurement });
  });
  await page.route("**/api/workstation/market-data", route => route.fulfill({ status: 503, json: { error: "Market data temporarily unavailable" } }));
  await page.goto("/settings");
  const shell = page.locator(".application-shell"), workspace = page.locator(".settings-workspace");
  await expect(workspace.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByText("Operations", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Configuration and import controls in one polished workspace.")).toHaveCount(0);
  for (const theme of ["dark", "light"] as const) {
    if (await shell.getAttribute("data-theme") !== theme) await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await expect(shell).toHaveAttribute("data-theme", theme);
    const expected = theme === "dark" ? "rgb(16, 21, 31)" : "rgb(255, 255, 255)";
    for (const id of ["workstation-shortcuts", "timestamp-interpretation", "market-data", "cloud-storage", "storage-backup"]) {
      await expect.poll(() => background(page.locator(`#${id}`))).toBe(expected);
    }
    expect(await background(page.locator(".application-content"))).toBe(theme === "dark" ? "rgb(11, 16, 25)" : "rgb(240, 243, 248)");
    await expect.poll(() => background(page.getByLabel("Source timezone", { exact: true }))).toBe(theme === "dark" ? "rgb(19, 26, 38)" : "rgb(247, 249, 252)");
    const database = page.getByTestId("storage-health-db-size");
    await database.getByText("Exact bytes", { exact: true }).click();
    await expect(database).toContainText("111,476,736");
    for (const id of importIds) {
      const record = page.getByTestId(`import-history-batch-${id}`);
      await expect(record).toBeVisible();
      await record.screenshot({ path: test.info().outputPath(`settings-import-${theme}-${id === importIds[0] ? "error" : "success"}.png`) });
    }
    await page.locator("#workstation-shortcuts").screenshot({ path: test.info().outputPath(`settings-shortcuts-${theme}.png`) });
    await page.locator("#storage-backup").screenshot({ path: test.info().outputPath(`settings-backups-${theme}.png`) });
    for (const width of [1366, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: test.info().outputPath(`settings-${theme}-${width}.png`) });
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.reload(); await expect(shell).toHaveAttribute("data-theme", theme);
  }
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(shell).toHaveAttribute("data-theme", "dark");
  failStorage = true;
  await page.getByRole("button", { name: "Refresh metrics", exact: true }).click();
  await expect(page.locator("#cloud-storage").getByRole("alert")).toBeVisible();
  await expect(page.locator("#market-data").getByRole("alert")).toHaveText("Market data temporarily unavailable");
  await page.getByPlaceholder("Search actions or keys…").fill("Horizontal");
  await expect(page.locator(".ws-key-row")).toHaveCount(2);
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator("#workstation-shortcuts").scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`settings-${width}.png`) });
  }
  expect(errors).toEqual([]);
});

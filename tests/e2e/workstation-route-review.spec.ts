import fs from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  IMPORT_FAILURE_DIRECT_MARKER,
  IMPORT_FAILURE_ROLLED_BACK_MARKER,
} from "../../src/lib/import/import-history";
import { rawImportArchiveIdentity } from "../../src/lib/import/raw-archive";
import { serializeImportAccounting, type ImportAccounting } from "../../src/lib/import/import-accounting";
import { prisma } from "../../src/lib/prisma";

function readDotEnv() {
  const file = path.join(process.cwd(), ".env");
  if (!fs.existsSync(file)) return {} as Record<string, string>;

  return Object.fromEntries(
    fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
        return [key, value];
      }),
  );
}

const localEnv = readDotEnv();
const username = process.env.AUTH_USERNAME ?? localEnv.AUTH_USERNAME;
const password = process.env.AUTH_PASSWORD ?? localEnv.AUTH_PASSWORD;
const demoAccountCode = "DEMO-WORKSTATION";
const backupFreshnessSentinelSymbol = "E2ESTALE";
const failedImportBatchId = "e2e-phase4-direct-failure";
const rolledBackImportBatchId = "e2e-phase4-sibling-rollback";
const failedImportRawContent = "phase4 deterministic failed import cohort\n";
const failedImportArtifact = rawImportArchiveIdentity(failedImportRawContent);
const reconciliationBatchId = "e2e-phase5-reconciliation";
const reconciliationRawContent = "phase5 deterministic mixed reconciliation\n";
const reconciliationArtifact = rawImportArchiveIdentity(reconciliationRawContent);
const reconciliationAccounting: ImportAccounting = {
  version: 1,
  kind: "executions",
  primary: {
    parserRejected: 1,
    idealFxExcluded: 1,
    unresolvedReference: 0,
    executionInserted: 1,
    executionChargeUpdated: 1,
    unchangedDuplicate: 1,
    positionApplied: 0,
    dailySnapshotApplied: 0,
  },
  flexCommissions: { seen: 3, matched: 2, excluded: 0, unmatched: 1, ambiguous: 0 },
};

const ROUTE_READY_HEADINGS: Record<string, { name: string; exact?: boolean }> = {
  "/dashboard": { name: "Trading analytics, framed like a premium desk platform." },
  "/trades": { name: "Trades", exact: true },
  "/journal": { name: "Review ideas before they become executions." },
  "/positions": { name: "Monitor open positions with cleaner risk visibility." },
  "/calendar": { name: "Scan performance by year, month, and day." },
  "/import": { name: "Import IBKR files through a polished review workflow." },
  "/settings": { name: "Configuration and import controls in one polished workspace." },
};

function collectBrowserErrors(page: Page, ignoredStatusErrors: string[] = []) {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    const thirdPartyNoise =
      text.includes("s3.tradingview.com/conversions_en.json") ||
      text.includes("/support/support-portal-problems/") ||
      text.includes("Cannot listen to the event from the provided iframe, contentWindow is not available");
    if (message.type() === "error" && (thirdPartyNoise || ignoredStatusErrors.some((status) => text.includes(status)))) return;
    if (message.type() === "error") browserErrors.push(text);
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  return browserErrors;
}

async function expectNoFrameworkOverlay(page: Page) {
  await expect(page.locator("[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay")).toHaveCount(0);
}

async function signIn(page: Page) {
  if (!username || !password) {
    throw new Error("AUTH_USERNAME and AUTH_PASSWORD are required for e2e route review tests.");
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto("/login", { waitUntil: "load" });
    const usernameInput = page.getByPlaceholder("Username");
    const passwordInput = page.getByPlaceholder("Password");
    await expect(usernameInput).toBeEditable();
    await expect(passwordInput).toBeEditable();
    await usernameInput.fill(username);
    await passwordInput.fill(password);
    await expect(usernameInput).toHaveValue(username);
    await expect(passwordInput).toHaveValue(password);
    await page.getByRole("button", { name: "Sign In" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 20_000 }).catch(() => undefined);
    if (new URL(page.url()).pathname === "/dashboard") break;
  }

  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
  await expect(page.getByRole("heading", { name: ROUTE_READY_HEADINGS["/dashboard"].name })).toBeVisible();
  await expect
    .poll(async () => {
      const session = await page.request.get("/api/auth/session");
      if (!session.ok()) return false;
      const payload = (await session.json()) as { user?: { name?: string | null; email?: string | null } };
      return Boolean(payload.user?.name || payload.user?.email);
    })
    .toBe(true);
}

async function gotoReady(page: Page, target: string) {
  await page.goto(target, { waitUntil: "domcontentloaded" });
  const pathname = new URL(target, "http://localhost").pathname;
  const heading = ROUTE_READY_HEADINGS[pathname];
  if (heading) {
    await expect(page.getByRole("heading", { name: heading.name, exact: heading.exact })).toBeVisible();
  }
  await expectNoFrameworkOverlay(page);
}

async function expectChartPanelWithSeededCandles(panel: Locator) {
  await expect(panel.getByTestId("closed-trade-chart-plot")).toHaveAttribute("data-candle-fresh", "true", { timeout: 15_000 });
  const barCount = Number((await panel.getByTestId("chart-panel-bar-count").getAttribute("data-candle-count")) ?? "0");
  expect(barCount).toBeGreaterThan(0);
  await expect(panel).not.toContainText(/\bDATA\s+0 bars\b/);
}

async function recordCurrentBackupAudit(page: Page) {
  const backupResponse = await page.request.get("/api/admin/backup");
  expect(backupResponse.status()).toBe(200);
  const backupPayload = await backupResponse.json();
  const verifyResponse = await page.request.post("/api/admin/backup/verify", { data: backupPayload });
  expect(verifyResponse.status()).toBe(200);
  const verifyPayload = await verifyResponse.json() as { audit?: { sourceSignature?: string | null } };
  expect(verifyPayload.audit?.sourceSignature).toMatch(/^[a-f0-9]{64}$/);
}

async function cleanupBackupFreshnessSentinel() {
  await prisma.journalEntry.deleteMany({ where: { symbol: backupFreshnessSentinelSymbol } });
}

async function cleanupFailedImportHistoryCohort() {
  await prisma.importBatch.deleteMany({
    where: { id: { in: [failedImportBatchId, rolledBackImportBatchId] } },
  });
  await prisma.importArtifact.deleteMany({ where: { storageKey: failedImportArtifact.rawStorageKey } });
}

async function cleanupReconciliationHistory() {
  await prisma.importBatch.deleteMany({ where: { id: reconciliationBatchId } });
  await prisma.importArtifact.deleteMany({ where: { storageKey: reconciliationArtifact.rawStorageKey } });
}

async function seedReconciliationHistory() {
  await cleanupReconciliationHistory();
  await prisma.importArtifact.create({
    data: {
      storageKey: reconciliationArtifact.rawStorageKey,
      rawSha256: reconciliationArtifact.rawSha256,
      rawBytes: reconciliationArtifact.rawBytes,
      content: reconciliationRawContent,
    },
  });
  await prisma.importBatch.create({
    data: {
      id: reconciliationBatchId,
      filename: "phase5-mixed-reconciliation-review.csv",
      fileType: "flex-trades",
      status: "MATERIALIZED",
      rowsSeen: 5,
      rowsImported: 2,
      rowsSkipped: 3,
      rawSha256: reconciliationArtifact.rawSha256,
      rawBytes: reconciliationArtifact.rawBytes,
      rawStorageKey: reconciliationArtifact.rawStorageKey,
      parserVersion: "phase5-reconciliation-v1",
      notes: serializeImportAccounting(reconciliationAccounting, "Deterministic Phase 5 reconciliation review."),
      rowErrors: {
        create: {
          rowNumber: 5,
          severity: "ERROR",
          code: "EXECUTION_ROW_INVALID",
          message: "Quantity is invalid in the deterministic review fixture.",
          rawJson: JSON.stringify({ Quantity: "bad" }),
        },
      },
    },
  });
}

async function seedFailedImportHistoryCohort() {
  await cleanupFailedImportHistoryCohort();
  const importedAt = new Date();
  const cohortId = "e2e-phase4-cohort";
  const directFilename = "positions-invalid-full-snapshot-with-a-very-long-audit-name-phase4.csv";
  const siblingFilename = "executions-valid-but-rolled-back-with-a-very-long-audit-name-phase4.csv";

  await prisma.$transaction(async (tx) => {
    await tx.importArtifact.create({
      data: {
        storageKey: failedImportArtifact.rawStorageKey,
        rawSha256: failedImportArtifact.rawSha256,
        rawBytes: failedImportArtifact.rawBytes,
        content: failedImportRawContent,
      },
    });
    await tx.importBatch.create({
      data: {
        id: failedImportBatchId,
        filename: directFilename,
        fileType: "positions",
        status: "FAILED",
        importedAt,
        rowsSeen: 1,
        rowsImported: 0,
        rowsSkipped: 1,
        rawSha256: failedImportArtifact.rawSha256,
        rawBytes: failedImportArtifact.rawBytes,
        rawStorageKey: failedImportArtifact.rawStorageKey,
        parserVersion: "phase4-e2e",
        positionSnapshotMode: "FULL",
        cohortId,
        sourceId: "e2e-phase6-source-positions",
        sourceFilename: directFilename,
        cohortRole: "DIRECT_FAILURE",
        errorMessage: "Full position snapshot failed because one source quantity was invalid.",
        notes: `${IMPORT_FAILURE_DIRECT_MARKER} cohort=${cohortId}; stage=preflight; causes=${encodeURIComponent(directFilename)}\nImport failed during preflight before rows could be committed.`,
        rowErrors: {
          create: {
            rowNumber: 2,
            severity: "ERROR",
            code: "POSITION_ROW_INVALID_WITH_LONG_AUDIT_CODE",
            message: "The source quantity could not be parsed and the complete snapshot was rejected without changing positions.",
            rawJson: JSON.stringify({ Quantity: "not-a-number" }),
          },
        },
      },
    });
    await tx.importBatch.create({
      data: {
        id: rolledBackImportBatchId,
        filename: siblingFilename,
        fileType: "executions",
        status: "FAILED",
        importedAt,
        rowsSeen: 1,
        rowsImported: 0,
        rowsSkipped: 1,
        rawSha256: failedImportArtifact.rawSha256,
        rawBytes: failedImportArtifact.rawBytes,
        rawStorageKey: failedImportArtifact.rawStorageKey,
        parserVersion: "phase4-e2e",
        cohortId,
        sourceId: "e2e-phase6-source-executions",
        sourceFilename: siblingFilename,
        cohortRole: "ROLLED_BACK",
        errorMessage: `Rolled back because a sibling import failed. No rows from ${siblingFilename} were committed.`,
        notes: `${IMPORT_FAILURE_ROLLED_BACK_MARKER} cohort=${cohortId}; stage=preflight; causes=${encodeURIComponent(directFilename)}\nRolled back because "${directFilename}" failed. No rows from this file were committed.`,
      },
    });
  });
}

async function makeBackupFreshnessStale(page: Page) {
  await cleanupBackupFreshnessSentinel();
  await recordCurrentBackupAudit(page);
  await prisma.journalEntry.create({
    data: {
      symbol: backupFreshnessSentinelSymbol,
      tradeTitle: "E2E backup freshness sentinel",
      ideaDate: new Date("2026-06-30T14:30:00.000Z"),
      thesis: "Temporary test row used to prove backup freshness transitions.",
    },
  });
}

test("login preserves protected review deep links", async ({ page }) => {
  if (!username || !password) {
    throw new Error("AUTH_USERNAME and AUTH_PASSWORD are required for e2e route review tests.");
  }

  const browserErrors = collectBrowserErrors(page);

  await page.goto(`/trades?account=${demoAccountCode}`, { waitUntil: "load" });
  const redirectedUrl = new URL(page.url());
  expect(redirectedUrl.pathname).toBe("/login");
  expect(redirectedUrl.searchParams.get("callbackUrl")).toBe(`/trades?account=${demoAccountCode}`);

  await page.getByPlaceholder("Username").fill(username);
  await page.getByPlaceholder("Password").fill(password);
  await Promise.all([
    page.waitForURL(
      (url) => url.pathname === "/trades" && url.searchParams.get("account") === demoAccountCode,
      { timeout: 30_000 },
    ),
    page.getByRole("button", { name: "Sign In" }).click(),
  ]);

  await expect(page.getByRole("heading", { name: ROUTE_READY_HEADINGS["/trades"].name, exact: true })).toBeVisible();
  await expect(page.getByText(demoAccountCode).first()).toBeVisible();
  await expectNoFrameworkOverlay(page);
  expect(browserErrors).toEqual([]);
});

test("login repairs encoded protected review deep links", async ({ page }) => {
  if (!username || !password) {
    throw new Error("AUTH_USERNAME and AUTH_PASSWORD are required for e2e route review tests.");
  }

  const browserErrors = collectBrowserErrors(page);

  await page.goto(`/trades%3Faccount%3D${demoAccountCode}`, { waitUntil: "load" });
  const redirectedUrl = new URL(page.url());
  expect(redirectedUrl.pathname).toBe("/login");
  expect(redirectedUrl.searchParams.get("callbackUrl")).toBe(`/trades?account=${demoAccountCode}`);

  await page.getByPlaceholder("Username").fill(username);
  await page.getByPlaceholder("Password").fill(password);
  await Promise.all([
    page.waitForURL(
      (url) => url.pathname === "/trades" && url.searchParams.get("account") === demoAccountCode,
      { timeout: 30_000 },
    ),
    page.getByRole("button", { name: "Sign In" }).click(),
  ]);

  await expect(page.getByRole("heading", { name: ROUTE_READY_HEADINGS["/trades"].name, exact: true })).toBeVisible();
  await expect(page.getByText(demoAccountCode).first()).toBeVisible();
  await expectNoFrameworkOverlay(page);
  expect(browserErrors).toEqual([]);
});

test("login decodes stale encoded callback urls", async ({ page }) => {
  if (!username || !password) {
    throw new Error("AUTH_USERNAME and AUTH_PASSWORD are required for e2e route review tests.");
  }

  const browserErrors = collectBrowserErrors(page);

  await page.goto(`/login?callbackUrl=%2Ftrades%253Faccount%253D${demoAccountCode}`, { waitUntil: "load" });
  await page.getByPlaceholder("Username").fill(username);
  await page.getByPlaceholder("Password").fill(password);
  await Promise.all([
    page.waitForURL(
      (url) => url.pathname === "/trades" && url.searchParams.get("account") === demoAccountCode,
      { timeout: 30_000 },
    ),
    page.getByRole("button", { name: "Sign In" }).click(),
  ]);

  await expect(page.getByRole("heading", { name: ROUTE_READY_HEADINGS["/trades"].name, exact: true })).toBeVisible();
  await expect(page.getByText(demoAccountCode).first()).toBeVisible();
  await expectNoFrameworkOverlay(page);
  expect(browserErrors).toEqual([]);
});

test("login ignores unsafe external callback urls", async ({ page }) => {
  if (!username || !password) {
    throw new Error("AUTH_USERNAME and AUTH_PASSWORD are required for e2e route review tests.");
  }

  const browserErrors = collectBrowserErrors(page);

  await page.goto("/login?callbackUrl=https%3A%2F%2Fevil.example%2Ftrades", { waitUntil: "load" });
  await page.getByPlaceholder("Username").fill(username);
  await page.getByPlaceholder("Password").fill(password);
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/dashboard", { timeout: 30_000 }),
    page.getByRole("button", { name: "Sign In" }).click(),
  ]);

  await expect(page.getByRole("heading", { name: ROUTE_READY_HEADINGS["/dashboard"].name })).toBeVisible();
  await expectNoFrameworkOverlay(page);
  expect(browserErrors).toEqual([]);
});

test("sidebar navigation reaches every workstation route", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  await signIn(page);

  for (const [label, route] of [
    ["Trades", "/trades"],
    ["Journal", "/journal"],
    ["Positions", "/positions"],
    ["Calendar", "/calendar"],
    ["Import", "/import"],
    ["Settings", "/settings"],
    ["Dashboard", "/dashboard"],
  ] as const) {
    await page.getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(new RegExp(`${route.replace("/", "\\/")}(\\?|$)`));
    const heading = ROUTE_READY_HEADINGS[route];
    await expect(page.getByRole("heading", { name: heading.name, exact: heading.exact })).toBeVisible();
    await expectNoFrameworkOverlay(page);
  }

  expect(browserErrors).toEqual([]);
});

test("dashboard route exposes custom range controls and chart panels", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  await signIn(page);
  await gotoReady(page, "/dashboard?preset=custom&from=2026-06-17&to=2026-06-22");

  await expect(page.locator('input[name="from"]')).toHaveValue("2026-06-17");
  await expect(page.locator('input[name="to"]')).toHaveValue("2026-06-22");
  await expect(page.getByTestId("dashboard-card-total-trades")).toContainText("Total Trades");
  await expect(page.getByTestId("dashboard-card-win-rate")).toContainText("Win Rate");
  await expect(page.getByText("Gross Daily P&L")).toBeVisible();
  await expect(page.getByText("Gross Cumulative P&L")).toBeVisible();
  await expect(page.getByText("Cumulative Net P&L")).toBeVisible();
  await page.getByRole("link", { name: "YTD" }).click();
  await expect(page).toHaveURL(/preset=ytd/);
  await expect(page.getByRole("heading", { name: ROUTE_READY_HEADINGS["/dashboard"].name })).toBeVisible();

  expect(browserErrors).toEqual([]);
});

test("trades route covers filters, execution table, and detail navigation", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  const candleRequestCounts = new Map<string, number>();
  await page.route("**/api/market/candles**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const key = requestUrl.searchParams.toString();
    candleRequestCounts.set(key, (candleRequestCounts.get(key) ?? 0) + 1);
    await route.continue();
  });
  await signIn(page);
  await gotoReady(page, `/trades?account=${demoAccountCode}&symbol=DEMOA`);

  await expect(page.locator('input[name="symbol"]')).toHaveValue("DEMOA");
  await expect(page.getByRole("button", { name: /DEMOA LONG/ }).first()).toBeVisible();
  await expect(page.getByTitle("1+2")).toBeVisible();
  await expect(page.getByTestId("closed-trade-chart-panel")).toHaveCount(3);
  await expect(page.locator('[data-testid="closed-trade-chart-panel"][data-timeframe="5m"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="closed-trade-chart-panel"][data-timeframe="1h"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="closed-trade-chart-panel"][data-timeframe="1d"]')).toHaveCount(1);
  const panelGeometry = await page.getByTestId("closed-trade-chart-panel").evaluateAll((panels) =>
    panels.map((panel) => ({
      id: (panel as HTMLElement).dataset.panelId,
      timeframe: (panel as HTMLElement).dataset.timeframe,
      bottom: Math.round(panel.getBoundingClientRect().bottom),
      height: Math.round(panel.getBoundingClientRect().height),
      left: Math.round(panel.getBoundingClientRect().left),
      plotHeight: Math.round(panel.querySelector('[data-testid="closed-trade-chart-plot"]')?.getBoundingClientRect().height ?? 0),
      right: Math.round(panel.getBoundingClientRect().right),
      top: Math.round(panel.getBoundingClientRect().top),
      width: Math.round(panel.getBoundingClientRect().width),
    })),
  );
  expect(panelGeometry.map((panel) => `${panel.id}:${panel.timeframe}`)).toEqual(["panel-1:5m", "panel-2:1h", "panel-3:1d"]);
  expect(panelGeometry[0].width).toBeGreaterThan(panelGeometry[1].width);
  expect(panelGeometry[0].height).toBeGreaterThan(panelGeometry[1].height);
  const secondaryStackHeight = Math.max(panelGeometry[1].bottom, panelGeometry[2].bottom) - Math.min(panelGeometry[1].top, panelGeometry[2].top);
  expect(Math.abs(panelGeometry[0].height - secondaryStackHeight)).toBeLessThanOrEqual(6);
  expect(panelGeometry[0].plotHeight).toBeGreaterThan(panelGeometry[1].plotHeight);
  for (let leftIndex = 0; leftIndex < panelGeometry.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < panelGeometry.length; rightIndex += 1) {
      const left = panelGeometry[leftIndex];
      const right = panelGeometry[rightIndex];
      const overlaps = left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
      expect(overlaps).toBe(false);
    }
  }

  await expect(page.getByText("Layout ready.").first()).toBeVisible();
  await expect(page.getByText("Drawings ready.").first()).toBeVisible();
  const firstPanel = page.locator('[data-testid="closed-trade-chart-panel"][data-panel-id="panel-1"]');
  const secondPanel = page.locator('[data-testid="closed-trade-chart-panel"][data-panel-id="panel-2"]');
  const thirdPanel = page.locator('[data-testid="closed-trade-chart-panel"][data-panel-id="panel-3"]');
  await expect(firstPanel.getByTestId("range-preset-controls").getByRole("button")).toHaveCount(7);
  await expect(secondPanel.getByTestId("compact-range-preset")).toBeVisible();
  await expect(thirdPanel.getByTestId("compact-range-preset")).toBeVisible();
  await expect(page.getByText(/Preparing chart|Loading bars/)).toHaveCount(0, { timeout: 15_000 });
  await expectChartPanelWithSeededCandles(firstPanel);
  await expectChartPanelWithSeededCandles(secondPanel);
  await expectChartPanelWithSeededCandles(thirdPanel);
  const layoutPuts: Array<{ layoutMode?: string; panels?: Array<Record<string, unknown>> }> = [];
  await page.route("**/api/closed-trades/*/chart-layout", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.continue();
      return;
    }
    const body = route.request().postDataJSON() as { layoutMode?: string; panels?: Array<Record<string, unknown>> };
    layoutPuts.push(body);
    await route.fulfill({
      body: JSON.stringify({
        layout: {
          groupKey: "compact-range-test",
          id: "compact-range-test",
          layoutMode: body.layoutMode ?? "one-plus-two",
          panels: body.panels ?? [],
          version: 900 + layoutPuts.length,
        },
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  const currentSecondRange = await secondPanel.getByTestId("compact-range-preset").inputValue();
  const nextSecondRange = currentSecondRange === "3m" ? "1m" : "3m";
  await secondPanel.getByTestId("compact-range-preset").selectOption(nextSecondRange);
  await expect.poll(() => layoutPuts.length).toBe(1);
  expect(layoutPuts[0].panels?.[1]).toMatchObject({
    id: "panel-2",
    rangePreset: nextSecondRange,
    timeframe: "1h",
    visibleFrom: null,
    visibleTo: null,
  });
  await expect(secondPanel).toHaveAttribute("data-timeframe", "1h");
  await expect(page.getByText(/Layout saved\.|Layout ready\./).first()).toBeVisible();
  await expect(page.getByText(/Preparing chart|Loading bars/)).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(() => candleRequestCounts.size, { timeout: 10_000 }).toBeGreaterThanOrEqual(3);
  const requestedTimeframes = Array.from(new Set(
    Array.from(candleRequestCounts.keys()).map((query) => new URLSearchParams(query).get("timeframe")),
  ));
  expect(requestedTimeframes).toEqual(expect.arrayContaining(["5m", "1h", "1d"]));
  await page.evaluate(() => {
    const panels = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="closed-trade-chart-panel"]'));
    const canvases = panels.map((panel) => Array.from(panel.querySelectorAll("canvas")));
    const root = document.querySelector('[data-testid="closed-trade-chart-region"]');
    if (!root || canvases.some((panelCanvases) => panelCanvases.length === 0)) {
      throw new Error("Chart lifecycle probe requires three mounted panels with canvases.");
    }
    const probe = {
      canvasMutations: 0,
      canvases,
      observer: new MutationObserver((records) => {
        for (const record of records) {
          const changedNodes = [...record.addedNodes, ...record.removedNodes];
          for (const node of changedNodes) {
            if (!(node instanceof Element)) continue;
            if (node.matches("canvas") || node.querySelector("canvas")) probe.canvasMutations += 1;
          }
        }
      }),
    };
    probe.observer.observe(root, { childList: true, subtree: true });
    (window as typeof window & { __chartFocusLifecycleProbe?: typeof probe }).__chartFocusLifecycleProbe = probe;
  });
  const candleRequestsBeforeFocus = Array.from(candleRequestCounts.entries()).sort();
  const layoutPutsBeforeFocus = layoutPuts.length;
  await secondPanel.evaluate((panel) => (panel as HTMLElement).focus());
  await page.getByTitle("Focus active chart panel").click();
  await expect(page.getByTestId("focused-chart-panel-view")).toBeVisible();
  await expect(page.getByTestId("closed-trade-chart-panel")).toHaveCount(3);
  await expect(page.locator('[data-testid="closed-trade-chart-panel"]:visible')).toHaveCount(1);
  await expect(page.locator('[data-testid="closed-trade-chart-panel"][data-panel-id="panel-2"][data-timeframe="1h"]')).toBeVisible();
  const focusedPanelGeometry = await page.locator('[data-testid="closed-trade-chart-panel"][data-panel-id="panel-2"]').evaluate((panel) => ({
    height: Math.round(panel.getBoundingClientRect().height),
    plotHeight: Math.round(panel.querySelector('[data-testid="closed-trade-chart-plot"]')?.getBoundingClientRect().height ?? 0),
    width: Math.round(panel.getBoundingClientRect().width),
  }));
  expect(focusedPanelGeometry.width).toBeGreaterThan(panelGeometry[1].width);
  expect(focusedPanelGeometry.plotHeight).toBeGreaterThan(panelGeometry[1].plotHeight);
  await expect.poll(async () => {
    return page.locator('[data-testid="closed-trade-chart-panel"][data-panel-id="panel-2"] canvas').evaluateAll((canvases) =>
      canvases.some((canvas) => {
        const context = (canvas as HTMLCanvasElement).getContext("2d");
        if (!context || canvas.width === 0 || canvas.height === 0) return false;
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let index = 3; index < pixels.length; index += 4) {
          if (pixels[index] !== 0) return true;
        }
        return false;
      }),
    );
  }).toBe(true);
  await page.getByTitle("Show all chart panels").click();
  await expect(page.getByTestId("focused-chart-panel-view")).toHaveCount(0);
  await expect(page.getByTestId("closed-trade-chart-panel")).toHaveCount(3);
  await expect(page.locator('[data-testid="closed-trade-chart-panel"]:visible')).toHaveCount(3);
  await expect(page.getByText(/Preparing chart|Loading bars/)).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(250);
  const restoredPanelOrder = await page.getByTestId("closed-trade-chart-panel").evaluateAll((panels) =>
    panels.map((panel) => `${(panel as HTMLElement).dataset.panelId}:${(panel as HTMLElement).dataset.timeframe}`),
  );
  expect(restoredPanelOrder).toEqual(["panel-1:5m", "panel-2:1h", "panel-3:1d"]);
  const lifecycleResult = await page.evaluate(() => {
    const target = window as typeof window & {
      __chartFocusLifecycleProbe?: {
        canvasMutations: number;
        canvases: HTMLCanvasElement[][];
        observer: MutationObserver;
      };
    };
    const probe = target.__chartFocusLifecycleProbe;
    if (!probe) throw new Error("Chart lifecycle probe was not installed.");
    probe.observer.disconnect();
    const panels = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="closed-trade-chart-panel"]'));
    const currentCanvases = panels.map((panel) => Array.from(panel.querySelectorAll("canvas")));
    const sameCanvasNodes = probe.canvases.every((before, panelIndex) =>
      before.length === currentCanvases[panelIndex]?.length
      && before.every((canvas, canvasIndex) => canvas === currentCanvases[panelIndex][canvasIndex]),
    );
    const allOriginalCanvasesConnected = probe.canvases.flat().every((canvas) => canvas.isConnected);
    delete target.__chartFocusLifecycleProbe;
    return {
      allOriginalCanvasesConnected,
      canvasMutations: probe.canvasMutations,
      sameCanvasNodes,
    };
  });
  expect(lifecycleResult).toEqual({
    allOriginalCanvasesConnected: true,
    canvasMutations: 0,
    sameCanvasNodes: true,
  });
  expect(Array.from(candleRequestCounts.entries()).sort()).toEqual(candleRequestsBeforeFocus);
  await page.waitForTimeout(800);
  expect(layoutPuts.length).toBe(layoutPutsBeforeFocus);
  await page.unroute("**/api/closed-trades/*/chart-layout");
  await page.unroute("**/api/market/candles**");

  await expect(page.getByRole("button", { name: "Markers" })).toBeVisible();
  const executionTable = page.locator("#trades-list-section");
  await expect(executionTable).toContainText("DEMO-WORKSTATION");
  await expect(executionTable).toContainText("DEMOA");
  await executionTable.getByRole("link", { name: "Open" }).first().click();
  await expect(page).toHaveURL(/\/trade\//);
  await expect(page.getByText("Execution Snapshot")).toBeVisible();
  await expect(page.getByText("Related Executions")).toBeVisible();

  expect(browserErrors).toEqual([]);
});

test("journal route hydrates selected demo entry, analytics, and closed-trade link", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  await signIn(page);
  await gotoReady(page, "/journal?entryId=demo-journal-a");

  await expect(page.getByRole("button", { name: "Save Entry" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "DEMOA" })).toBeVisible();
  await expect(page.getByText("2026-06-17 | LONG | 5min | Opening drive | Fit 100%")).toBeVisible();
  await page.getByRole("button", { name: "Thesis", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Thesis" })).toHaveValue("DEMOA held the first pullback while the market stayed supportive.");
  await expect(page.locator('input[style*="caret-color"], textarea[style*="caret-color"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Notion" }).click();
  await expect(page.getByText("Bias", { exact: true })).toBeVisible();
  await expect(page.getByText("Bais", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Dashboard" }).click();
  await expect(page.getByText("Setup Health")).toBeVisible();
  await expect(page.getByText("Outcome Mix")).toBeVisible();

  expect(browserErrors).toEqual([]);
});

test("positions route shows seeded exposure and account filtering", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  await signIn(page);
  await gotoReady(page, "/positions?account=all");

  await expect(page.getByRole("heading", { name: "Open Positions", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /All \(/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("columnheader", { name: "Account" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Symbol" })).toBeVisible();
  const accountButtons = page.getByRole("button").filter({ hasText: /\([1-9]\d*\)/ });
  const accountButtonCount = await accountButtons.count();
  if (accountButtonCount > 1) {
    const firstAccountButton = accountButtons.nth(1);
    const buttonText = (await firstAccountButton.textContent()) ?? "";
    const accountCode = buttonText.replace(/\s*\(\d+\)\s*$/, "").trim();
    await firstAccountButton.click();
    await expect.poll(() => new URL(page.url()).searchParams.get("account")).toBe(accountCode);
  } else {
    await expect(page.getByText("No open positions found.")).toBeVisible();
  }

  expect(browserErrors).toEqual([]);
});

test("calendar route covers month/day navigation and seeded day-note context", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  await signIn(page);
  await gotoReady(page, "/calendar?view=month&date=2026-06-18");

  await expect(page.getByText("Performance Calendar")).toBeVisible();
  await expect(page.getByText("June 2026")).toBeVisible();
  await expect(page.getByText("Monthly Total")).toBeVisible();
  await page.locator('a[href="/calendar?view=day&date=2026-06-18"]').filter({ hasText: /^Day$/ }).click();
  await expect(page).toHaveURL(/view=day/);
  await expect(page.getByText("2026-06-18")).toBeVisible();
  await expect(page.getByText("Demo day note: mixed tape, lower confidence after first failed breakout.")).toBeVisible();

  expect(browserErrors).toEqual([]);
});

test("import route exposes upload controls and durable import history", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  await signIn(page);
  await gotoReady(page, "/import");

  await expect(page.locator('input[type="file"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Validate & Import" })).toBeDisabled();
  await expect(page.getByText("Recent Import History")).toBeVisible();
  await expect(page.getByText("demo-workstation-seed.json", { exact: true })).toBeVisible();
  await expect(page.getByText("Completed").first()).toBeVisible();
  await expect(page.getByLabel("Timezone")).toHaveValue("UTC");
  await page.getByLabel("Timezone").selectOption("Australia/Melbourne");
  await expect(page.getByText("Showing Melbourne")).toBeVisible();

  expect(browserErrors).toEqual([]);
});

test("import and settings show the same failed cohort with truthful rollback roles", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page);
  let importMutationRequests = 0;
  page.on("request", (request) => {
    if (request.method() !== "GET" && /\/api\/(import|flex)/.test(request.url())) {
      importMutationRequests += 1;
    }
  });

  try {
    await seedFailedImportHistoryCohort();
    await gotoReady(page, "/import");

    const importDirect = page.getByTestId(`import-history-batch-${failedImportBatchId}`);
    const importSibling = page.getByTestId(`import-history-batch-${rolledBackImportBatchId}`);
    await expect(page.getByTestId(`import-history-status-${failedImportBatchId}`)).toHaveText("Failed");
    await expect(page.getByTestId(`import-history-status-${rolledBackImportBatchId}`)).toHaveText("Rolled back");
    await expect(importDirect).toContainText("POSITION_ROW_INVALID_WITH_LONG_AUDIT_CODE");
    await expect(importSibling).toContainText("Rolled back because");
    await expect(importSibling).not.toContainText("parser row error");
    await expect(importSibling).not.toContainText(IMPORT_FAILURE_ROLLED_BACK_MARKER);
    const importText = {
      direct: (await importDirect.innerText()).replace(/\s+/g, " ").trim(),
      sibling: (await importSibling.innerText()).replace(/\s+/g, " ").trim(),
    };
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(await importDirect.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await importSibling.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

    await gotoReady(page, "/settings");
    const settingsDirect = page.getByTestId(`import-history-batch-${failedImportBatchId}`);
    const settingsSibling = page.getByTestId(`import-history-batch-${rolledBackImportBatchId}`);
    await expect(page.getByTestId(`import-history-status-${failedImportBatchId}`)).toHaveText("Failed");
    await expect(page.getByTestId(`import-history-status-${rolledBackImportBatchId}`)).toHaveText("Rolled back");
    expect((await settingsDirect.innerText()).replace(/\s+/g, " ").trim()).toBe(importText.direct);
    expect((await settingsSibling.innerText()).replace(/\s+/g, " ").trim()).toBe(importText.sibling);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(await settingsDirect.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await settingsSibling.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expectNoFrameworkOverlay(page);

    expect(importMutationRequests).toBe(0);
    expect(browserErrors).toEqual([]);
  } finally {
    await cleanupFailedImportHistoryCohort();
  }
});

test("import and settings paginate identical complete cohorts on desktop and mobile", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  await signIn(page);
  let importMutationRequests = 0;
  page.on("request", (request) => {
    if (request.method() !== "GET" && /\/api\/(import|flex)/.test(request.url())) importMutationRequests += 1;
  });
  const visibleBatchIds = async () =>
    page.locator('[data-testid^="import-history-batch-"]').evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-testid")?.replace("import-history-batch-", "") ?? ""),
    );
  const expectHistoryFits = async () => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(
      await page.locator('[data-testid^="import-history-batch-"]').evaluateAll((elements) =>
        elements.every((element) => element.scrollWidth <= element.clientWidth),
      ),
    ).toBe(true);
  };

  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoReady(page, "/import");
  await expect(page.getByTestId("import-history-cohort-cohort:demo-import-cohort-flex")).toContainText(
    "2 records | 1 source | 2 sections",
  );
  await expect(page.getByText("demo-flex-statement.csv::trades", { exact: true })).toBeVisible();
  await expect(page.getByText("demo-flex-statement.csv::positions", { exact: true })).toBeVisible();
  await expect(page.getByText("Legacy source provenance unavailable.")).toHaveCount(0);
  const importFirstPage = await visibleBatchIds();
  await expect(page.getByTestId("import-history-older")).toBeVisible();
  await page.getByTestId("import-history-older").click();
  await expect(page).toHaveURL(/historyCursor=/);
  const olderCursor = new URL(page.url()).searchParams.get("historyCursor");
  expect(olderCursor).toBeTruthy();
  const importOlderPage = await visibleBatchIds();
  expect(importOlderPage.some((id) => importFirstPage.includes(id))).toBe(false);
  await expect(page.getByText("Legacy source provenance unavailable.")).toBeVisible();
  await expectHistoryFits();

  await page.setViewportSize({ width: 390, height: 844 });
  await gotoReady(page, "/settings");
  expect(await visibleBatchIds()).toEqual(importFirstPage);
  await expectHistoryFits();
  await gotoReady(page, `/settings?historyCursor=${encodeURIComponent(olderCursor!)}`);
  expect(await visibleBatchIds()).toEqual(importOlderPage);
  await expect(page.getByText("Legacy archive metadata unavailable.")).toBeVisible();
  await expectHistoryFits();
  await expectNoFrameworkOverlay(page);

  expect(importMutationRequests).toBe(0);
  expect(browserErrors).toEqual([]);
});

test("import and settings show the same successful reconciliation on desktop and mobile", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  await signIn(page);
  let importMutationRequests = 0;
  page.on("request", (request) => {
    if (request.method() !== "GET" && /\/api\/(import|flex)/.test(request.url())) importMutationRequests += 1;
  });

  try {
    await seedReconciliationHistory();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoReady(page, "/import");
    const importBatch = page.getByTestId(`import-history-batch-${reconciliationBatchId}`);
    await expect(page.getByTestId(`import-history-status-${reconciliationBatchId}`)).toHaveText("Completed");
    await expect(importBatch).toContainText("seen 5, applied 2, not applied 3");
    await expect(importBatch).toContainText("1 executions inserted");
    await expect(importBatch).toContainText("1 charge corrections");
    await expect(importBatch).toContainText("1 unchanged duplicates");
    await expect(importBatch).toContainText("1 IDEALFX excluded");
    await expect(importBatch).toContainText("1 parser rejected");
    await expect(importBatch).toContainText("1 commission details unmatched");
    await expect(importBatch).not.toContainText("[import-accounting:v1]");
    const importText = (await importBatch.innerText()).replace(/\s+/g, " ").trim();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await page.setViewportSize({ width: 390, height: 844 });
    await gotoReady(page, "/settings");
    const settingsBatch = page.getByTestId(`import-history-batch-${reconciliationBatchId}`);
    await expect(settingsBatch).toBeVisible();
    expect((await settingsBatch.innerText()).replace(/\s+/g, " ").trim()).toBe(importText);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(await settingsBatch.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expectNoFrameworkOverlay(page);

    expect(importMutationRequests).toBe(0);
    expect(browserErrors).toEqual([]);
  } finally {
    await cleanupReconciliationHistory();
  }
});

test("import preview blocks impossible dates from full-snapshot pruning", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  await signIn(page);
  await gotoReady(page, "/import");

  let commitRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/import") && (request.postData() ?? "").includes("commit")) {
      commitRequests += 1;
    }
  });
  const csv = [
    "Positions",
    "ClientAccountID,Symbol,Exchange,AssetClass,ReportDate,Quantity,AvgCost,UnrealizedPnl,Currency",
    "DEMO-WORKSTATION,DEMOZ,NASDAQ,STK,2026-02-31,2,100,12,USD",
  ].join("\n");

  await page.locator('input[type="file"]').setInputFiles({
    name: "positions-invalid-date.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByText("positions-invalid-date.csv :: Positions")).toBeVisible();
  await expect(page.getByText("Detected type: positions")).toBeVisible();
  await page.getByRole("button", { name: "Full snapshot" }).click();
  await expect(page.getByText(/Full snapshot blocked: 1 invalid position row/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Validate & Import" })).toBeDisabled();
  await expect(page.getByLabel(/I confirm this is the complete open-position list/)).toHaveCount(0);

  const viewportFits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(viewportFits).toBe(true);
  expect(commitRequests).toBe(0);
  expect(browserErrors).toEqual([]);
});

test("settings route covers accounts, Flex status, health, backup, and import history", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  await signIn(page);
  await gotoReady(page, "/settings");

  await expect(page.getByText("Accounts")).toBeVisible();
  await expect(page.getByText("DEMO-WORKSTATION", { exact: true })).toBeVisible();
  await expect(page.getByText("IBKR Flex Auto Import")).toBeVisible();
  await expect(page.getByText(/Status: Configured|Status: Missing IBKR_FLEX_TOKEN/)).toBeVisible();
  await expect(page.getByTestId("settings-storage-health")).toBeVisible();
  await expect(page.getByText("Storage Health & Backup")).toBeVisible();
  await expect(page.getByTestId("storage-health-db-size")).toContainText(/B|Unavailable/);
  await expect(page.getByTestId("storage-health-inline-screenshot-bytes")).toContainText(/B/);
  await expect(page.getByTestId("storage-health-import-artifact-bytes")).toContainText(/B/);
  await expect(page.getByTestId("storage-health-candle-rows")).toContainText(/\d/);
  await expect(page.getByTestId("storage-health-stale-closed-trades")).toContainText(/\d/);
  await expect(page.getByTestId("storage-health-latest-change")).toBeVisible();
  await expect(page.getByTestId("backup-readiness-status")).toContainText("Complete");
  await expect(page.getByTestId("backup-freshness-status")).toContainText(/Current|Needs Backup|No Verified Backup/);
  await expect(page.getByTestId("backup-latest-verified")).toBeVisible();
  await expect(page.getByTestId("backup-latest-sha")).toBeVisible();
  await expect(page.getByTestId("backup-latest-payload-bytes")).toBeVisible();
  const reviewArtifactReadiness = page.getByTestId("backup-review-artifacts");
  await expect(reviewArtifactReadiness).toContainText("Review Notes");
  await expect(reviewArtifactReadiness).toContainText("Chart Layouts");
  await expect(reviewArtifactReadiness).toContainText("Drawing States");
  await expect(reviewArtifactReadiness).toContainText("Drawings");
  await expect(reviewArtifactReadiness).toContainText("Review Tags");
  await expect(reviewArtifactReadiness).toContainText("Linked Executions");
  await expect(reviewArtifactReadiness).toContainText("Journal Links");
  await expect(page.getByTestId("backup-action-download-verify")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Import History" })).toBeVisible();
  await expect(page.getByText("demo-workstation-seed.json", { exact: true })).toBeVisible();

  expect(browserErrors).toEqual([]);
});

test("settings backup freshness transitions to Current after Download & Verify", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  await signIn(page);

  try {
    await makeBackupFreshnessStale(page);
    await gotoReady(page, "/settings");

    await expect(page.getByTestId("backup-freshness-status")).toContainText("Needs Backup");
    await expect(page.getByTestId("backup-freshness-detail")).toContainText(
      "Data changed after the last verified backup export.",
    );

    const [backupDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("backup-action-download-verify").click(),
    ]);
    expect(backupDownload.suggestedFilename()).toMatch(/^trade-journal-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(await backupDownload.failure()).toBeNull();

    await expect(page.getByTestId("backup-verify-status")).toContainText("Verified", { timeout: 30_000 });
    await expect(page.getByTestId("backup-verify-sha256")).toContainText(/[a-f0-9]{64}/);
    await expect(page.getByTestId("backup-verify-total-rows")).toContainText(/\d/);
    await expect(page.getByTestId("backup-verify-table-count")).toContainText(/\d/);
    await expect
      .poll(() => new URL(page.url()).searchParams.has("backupVerified"), { timeout: 30_000 })
      .toBe(true);
    await expect(page.getByTestId("backup-freshness-status")).toContainText("Current", { timeout: 30_000 });
    await expect(page.getByTestId("backup-freshness-detail")).toContainText(
      "Last verified backup covers the latest tracked data change.",
    );
    await expect(page.getByTestId("backup-latest-verified")).not.toContainText("-");
    await expect(page.getByTestId("backup-latest-sha")).toContainText(/[a-f0-9]{12}/);
    await expect(page.getByTestId("backup-latest-payload-bytes")).toContainText(/B|KB|MB|GB/);
    await expect(page.getByTestId("backup-covers-through")).not.toContainText("-");
  } finally {
    await cleanupBackupFreshnessSentinel();
  }

  expect(browserErrors).toEqual([]);
});

test("settings backup verification failure is readable and blocks download", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page, ["422"]);
  await signIn(page);
  await gotoReady(page, "/settings");

  await page.route("**/api/admin/backup/verify", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }

    await route.fulfill({
      body: "Backup manifest mismatch.",
      contentType: "text/plain",
      status: 422,
    });
  });

  try {
    const downloadProbe = page.waitForEvent("download", { timeout: 1_000 }).then(() => true).catch(() => false);
    await page.getByTestId("backup-action-download-verify").click();
    await expect(page.getByTestId("backup-verify-status")).toContainText("Backup manifest mismatch.", { timeout: 30_000 });
    await expect(page.getByTestId("backup-verify-sha256")).toContainText("-");
    await expect(downloadProbe).resolves.toBe(false);
  } finally {
    await page.unroute("**/api/admin/backup/verify");
  }

  expect(browserErrors).toEqual([]);
});

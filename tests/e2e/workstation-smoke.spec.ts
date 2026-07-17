import fs from "node:fs";
import path from "node:path";
import { expect, test, type Dialog, type Page } from "@playwright/test";

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
const layoutSaveBusyPattern = /Layout save queued\.|Layout save pending\.|Saving layout\./;
const drawingSaveBusyPattern = /Drawing save queued\.|Drawing save pending\.|Saving drawings\./;
const preLayoutSaveGuardPattern = /Chart range save pending\.|Chart workspace changes are waiting to save\.|Layout save pending\.|Saving layout\./;

async function signIn(page: Page) {
  if (!username || !password) {
    throw new Error("AUTH_USERNAME and AUTH_PASSWORD are required for e2e smoke tests.");
  }

  const providers = await page.request.get("/api/auth/providers");
  expect(providers.status()).toBe(200);
  expect(providers.headers()["content-type"]).toContain("application/json");

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
  await expect(page.getByRole("heading", { name: "Trading analytics, framed like a premium desk platform." })).toBeVisible();
  await expect
    .poll(async () => {
      const session = await page.request.get("/api/auth/session");
      if (!session.ok()) return false;
      const payload = (await session.json()) as { user?: { name?: string | null; email?: string | null } };
      return Boolean(payload.user?.name || payload.user?.email);
    })
    .toBe(true);
}

const ROUTE_READY_HEADINGS: Array<{ path: string; name: string; exact?: boolean }> = [
  { path: "/dashboard", name: "Trading analytics, framed like a premium desk platform." },
  { path: "/trades", name: "Trades", exact: true },
  { path: "/journal", name: "Review ideas before they become executions." },
  { path: "/positions", name: "Monitor open positions with cleaner risk visibility." },
  { path: "/calendar", name: "Scan performance by year, month, and day." },
  { path: "/import", name: "Import IBKR files through a polished review workflow." },
  { path: "/settings", name: "Configuration and import controls in one polished workspace." },
];

async function expectNoFrameworkOverlay(page: Page) {
  await expect(page.locator("[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay")).toHaveCount(0);
}

async function gotoAndSettle(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  const pathname = new URL(path, "http://localhost").pathname;
  const ready = ROUTE_READY_HEADINGS.find((route) => route.path === pathname);
  if (ready) {
    await expect(page.getByRole("heading", { name: ready.name, exact: ready.exact })).toBeVisible();
  }
  await expectNoFrameworkOverlay(page);
}

async function expectFirstCanvasPainted(page: Page) {
  await expect.poll(() => firstCanvasPaintedPixelCount(page)).toBeGreaterThan(100);
}

async function firstCanvasPaintedPixelCount(page: Page) {
  const chartCanvas = page.locator("canvas").first();
  await expect(chartCanvas).toBeVisible();
  return chartCanvas.evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const context = canvas.getContext("2d");
    if (!context || canvas.width === 0 || canvas.height === 0) return 0;

    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = canvas.width * canvas.height;
    const stride = Math.max(1, Math.floor(pixels / 4000));
    let painted = 0;

    for (let index = 0; index < pixels; index += stride) {
      if (image.data[index * 4 + 3] > 0) painted += 1;
    }

    return painted;
  });
}

async function panFirstChart(page: Page) {
  const firstPanel = page.getByTestId("closed-trade-chart-panel").first();
  await expect(firstPanel).toBeVisible();
  const firstPlot = firstPanel.getByTestId("closed-trade-chart-plot");
  await firstPlot.scrollIntoViewIfNeeded();
  await expect(firstPlot).toBeVisible();
  await expect.poll(async () => (await firstPanelVisibleRange(page)).ready).toBe(true);
  const initialRange = await firstPanelVisibleRange(page);
  const box = await firstPlot.boundingBox();
  expect(box).toBeTruthy();
  const centerX = box!.x + box!.width * 0.58;
  const centerY = box!.y + box!.height * 0.52;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX - 220, centerY, { steps: 8 });
  await page.mouse.up();
  await page.mouse.wheel(0, -420);
  await expect
    .poll(async () => !visibleRangesClose(await firstPanelVisibleRange(page), initialRange, 1))
    .toBe(true);
}

type ChartPanelLayout = {
  id: string;
  symbol: string;
  timeframe: string;
  compareSymbol?: string | null;
  rangePreset: string;
  visibleFrom?: number | null;
  visibleTo?: number | null;
};

type ChartLayoutPayload = {
  layout?: {
    id?: string;
    groupKey?: string;
    layoutMode: string;
    panels: ChartPanelLayout[];
    version: number;
  } | null;
};

function expectedDemoSymbolForGroupKey(groupKey: string) {
  if (groupKey.includes(":demo-inst-a:")) return "DEMOA";
  if (groupKey.includes(":demo-inst-b:")) return "DEMOB";
  if (groupKey.includes(":demo-inst-c:")) return "DEMOC";
  return null;
}

type VisibleRangeSnapshot = { ready: boolean; from: number | null; to: number | null };

async function firstPanelVisibleRange(page: Page): Promise<VisibleRangeSnapshot> {
  return page
    .getByTestId("closed-trade-chart-panel")
    .first()
    .getByTestId("closed-trade-chart-plot")
    .evaluate((node) => {
      const element = node as HTMLElement;
      const from = Number(element.dataset.visibleTimeRangeFrom);
      const to = Number(element.dataset.visibleTimeRangeTo);
      return {
        ready: element.dataset.visibleTimeRangeReady === "true",
        from: Number.isFinite(from) ? from : null,
        to: Number.isFinite(to) ? to : null,
      };
    });
}

function visibleRangesClose(left: VisibleRangeSnapshot, right: { visibleFrom?: number | null; visibleTo?: number | null }, toleranceSeconds = 900) {
  if (!left.ready || left.from == null || left.to == null || right.visibleFrom == null || right.visibleTo == null) return false;
  return Math.abs(left.from - right.visibleFrom) <= toleranceSeconds && Math.abs(left.to - right.visibleTo) <= toleranceSeconds;
}

async function expectChartSavesSettled(page: Page) {
  await expect(page.getByText(layoutSaveBusyPattern)).toHaveCount(0);
  await expect(page.getByText(drawingSaveBusyPattern)).toHaveCount(0);
}

async function chartWorkstationGeometry(page: Page) {
  return page.evaluate(() => {
    const workstation = document.querySelector('[data-testid="closed-trade-workstation"]');
    const chartRegion = document.querySelector('[data-testid="closed-trade-chart-region"]');
    const firstPanel = document.querySelector('[data-testid="closed-trade-chart-panel"]');
    const widthOf = (node: Element | null) => Math.round(node?.getBoundingClientRect().width ?? 0);

    return {
      chartRegionWidth: widthOf(chartRegion),
      firstPanelWidth: widthOf(firstPanel),
      workstationWidth: widthOf(workstation),
    };
  });
}

function rectanglesOverlap(
  left: { left: number; right: number; top: number; bottom: number },
  right: { left: number; right: number; top: number; bottom: number },
) {
  return left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
}

async function chartDockPanelGeometry(page: Page) {
  return page.evaluate(() => {
    const rectFor = (node: Element) => {
      const rect = node.getBoundingClientRect();
      return {
        bottom: Math.round(rect.bottom),
        height: Math.round(rect.height),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
      };
    };
    const dock = document.querySelector('[data-testid="chart-review-dock"]');
    const surface = document.querySelector('[data-testid="closed-trade-chart-surface"]');
    return {
      dock: dock ? rectFor(dock) : null,
      surface: surface ? rectFor(surface) : null,
      panels: Array.from(document.querySelectorAll('[data-testid="closed-trade-chart-panel"]')).map(rectFor),
    };
  });
}

async function executionOverlaySnapshot(page: Page) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-testid="execution-overlay-label"]'))
      .filter((node) => (node as HTMLElement).dataset.panelId === "panel-1")
      .map((node) => {
        const element = node as HTMLElement;
        const rect = element.getBoundingClientRect();
        return {
          text: element.innerText.replace(/\s+/g, " ").trim(),
          visible: rect.width > 0 && rect.height > 0,
        };
      })
      .sort((left, right) => left.text.localeCompare(right.text));
  });
}

async function executionOverlayGeometrySnapshot(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector('[data-testid="closed-trade-chart-panel"][data-panel-id="panel-1"]');
    const plotRect = panel?.querySelector('[data-testid="closed-trade-chart-plot"]')?.getBoundingClientRect() ?? null;
    const lines = Array.from(document.querySelectorAll('[data-testid="execution-overlay-line"]'))
      .filter((node) => (node as SVGLineElement).dataset.panelId === "panel-1") as SVGLineElement[];

    return Array.from(document.querySelectorAll('[data-testid="execution-overlay-label"]'))
      .filter((node) => (node as HTMLElement).dataset.panelId === "panel-1")
      .map((node) => {
        const element = node as HTMLElement;
        const rect = element.getBoundingClientRect();
        const executionId = element.dataset.executionId ?? "";
        const line = lines.find((candidate) => candidate.dataset.executionId === executionId) ?? null;
        return {
          executionId,
          text: element.innerText.replace(/\s+/g, " ").trim(),
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          transform: window.getComputedStyle(element).transform,
          visible: rect.width > 0 && rect.height > 0,
          insidePlot: plotRect
            ? rect.right > plotRect.left && rect.left < plotRect.right && rect.bottom > plotRect.top && rect.top < plotRect.bottom
            : false,
          line: line
            ? {
                x1: Math.round(Number(line.getAttribute("x1") ?? 0)),
                x2: Math.round(Number(line.getAttribute("x2") ?? 0)),
                y1: Math.round(Number(line.getAttribute("y1") ?? 0)),
                y2: Math.round(Number(line.getAttribute("y2") ?? 0)),
              }
            : null,
        };
      })
      .sort((left, right) => left.text.localeCompare(right.text));
  });
}

type ExecutionOverlayGeometrySnapshot = Awaited<ReturnType<typeof executionOverlayGeometrySnapshot>>;

function executionOverlayGeometryMoved(before: ExecutionOverlayGeometrySnapshot, after: ExecutionOverlayGeometrySnapshot) {
  if (before.length === 0 || before.length !== after.length) return false;
  return after.every((item) => item.visible && item.insidePlot && item.line) && after.some((item) => {
    const previous = before.find((candidate) => candidate.executionId === item.executionId);
    if (!previous || previous.text !== item.text || !previous.line || !item.line) return false;
    const labelDelta = Math.abs(previous.left - item.left) + Math.abs(previous.top - item.top);
    const lineDelta =
      Math.abs(previous.line.x1 - item.line.x1) +
      Math.abs(previous.line.x2 - item.line.x2) +
      Math.abs(previous.line.y1 - item.line.y1) +
      Math.abs(previous.line.y2 - item.line.y2);
    return labelDelta + lineDelta >= 3 || previous.transform !== item.transform;
  });
}

function executionOverlayGeometryReady(snapshot: ExecutionOverlayGeometrySnapshot) {
  return snapshot.length > 0 && snapshot.every((item) => item.visible && item.insidePlot && item.line);
}

async function expectDashboardCard(page: Page, id: string, label: string, value: string) {
  const card = page.getByTestId(`dashboard-card-${id}`);
  await expect(card).toContainText(label);
  await expect(card).toContainText(value);
}

async function expectDashboardChartSummary(
  page: Page,
  id: string,
  summary: { firstValue: string; lastValue: string; pointCount: string },
) {
  const chart = page.getByTestId(`dashboard-chart-${id}`);
  await expect(chart).toHaveAttribute("data-first-value", summary.firstValue);
  await expect(chart).toHaveAttribute("data-last-value", summary.lastValue);
  await expect(chart).toHaveAttribute("data-point-count", summary.pointCount);
}

function isNullableIsoDate(value: unknown) {
  return value === null || (typeof value === "string" && !Number.isNaN(Date.parse(value)));
}

function backupRows(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  expect(Array.isArray(value), key).toBe(true);
  return value as Array<Record<string, unknown>>;
}

function numericBackupValue(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function backupDateValue(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`Expected ${key} to be an ISO date string.`);
  return new Date(value);
}

function localDayStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function localDayEnd(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function localWeekStartMonday(date: Date) {
  const day = localDayStart(date);
  const mondayOffset = (day.getDay() + 6) % 7;
  day.setDate(day.getDate() - mondayOffset);
  return day;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number) {
  return `${value.toFixed(2)}%`;
}

function formatChartValue(value: number) {
  return value.toFixed(2);
}

function formatLargestPair(gain: number, loss: number, winCount: number, lossCount: number) {
  return `${winCount > 0 ? formatCurrency(gain) : "No wins"} / ${lossCount > 0 ? formatCurrency(loss) : "No losses"}`;
}

function formatAveragePair(avgWin: number, avgLoss: number, winCount: number, lossCount: number) {
  return `${winCount > 0 ? formatCurrency(avgWin) : "No wins"} / ${lossCount > 0 ? formatCurrency(avgLoss) : "No losses"}`;
}

function formatProfitFactor(value: number, lossCount: number) {
  if (lossCount === 0 || !Number.isFinite(value)) return "No losses";
  return value.toFixed(2);
}

function unixSeconds(iso: string) {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function expectedDashboardCardsFromBackup(payload: Record<string, unknown>, from: string, to: string) {
  const rangeStart = localDayStart(new Date(`${from}T00:00:00`));
  const rangeEnd = localDayEnd(to);
  const closedTrades = backupRows(payload, "closedTrades")
    .filter((row) => row.isStale !== true)
    .sort((a, b) => {
      const closeDiff = backupDateValue(a, "closeTime").getTime() - backupDateValue(b, "closeTime").getTime();
      if (closeDiff !== 0) return closeDiff;
      return String(a.groupKey ?? "").localeCompare(String(b.groupKey ?? ""));
    });
  const filtered = closedTrades.filter((row) => {
    const closeTime = backupDateValue(row, "closeTime");
    return closeTime >= rangeStart && closeTime <= rangeEnd;
  });
  const wins = filtered.filter((row) => numericBackupValue(row, "realizedPnl") > 0);
  const losses = filtered.filter((row) => numericBackupValue(row, "realizedPnl") < 0);
  const grossProfit = wins.reduce((sum, row) => sum + numericBackupValue(row, "realizedPnl"), 0);
  const grossLoss = losses.reduce((sum, row) => sum + Math.abs(numericBackupValue(row, "realizedPnl")), 0);
  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? -grossLoss / losses.length : 0;
  const winRate = filtered.length > 0 ? (wins.length / filtered.length) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const expectancy = filtered.length > 0 ? (wins.length / filtered.length) * avgWin + (losses.length / filtered.length) * avgLoss : 0;
  const dayStart = localDayStart(rangeEnd);
  const weekStart = localWeekStartMonday(rangeEnd);
  const monthStart = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), 1);
  const sumRealizedSince = (start: Date) =>
    filtered.reduce((sum, row) => {
      const closeTime = backupDateValue(row, "closeTime");
      return closeTime >= start ? sum + numericBackupValue(row, "realizedPnl") : sum;
    }, 0);
  const firstFilteredCloseTime = filtered.length > 0 ? backupDateValue(filtered[0], "closeTime") : undefined;
  let equity = firstFilteredCloseTime
    ? closedTrades
        .filter((row) => backupDateValue(row, "closeTime") < firstFilteredCloseTime)
        .reduce((sum, row) => sum + numericBackupValue(row, "realizedPnl"), 0)
    : 0;
  let grossEquity = firstFilteredCloseTime
    ? closedTrades
        .filter((row) => backupDateValue(row, "closeTime") < firstFilteredCloseTime)
        .reduce((sum, row) => sum + numericBackupValue(row, "grossRealizedPnl"), 0)
    : 0;
  let peak = equity;
  let maxDrawdown = 0;
  const netCumulativeValues: number[] = [];
  for (const row of filtered) {
    equity += numericBackupValue(row, "realizedPnl");
    netCumulativeValues.push(equity);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  const grossDaily = new Map<string, number>();
  for (const row of filtered) {
    const date = backupDateValue(row, "tradeDate").toISOString().slice(0, 10);
    grossDaily.set(date, (grossDaily.get(date) ?? 0) + numericBackupValue(row, "grossRealizedPnl"));
  }
  const grossCumulativeValues = [...grossDaily.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, pnl]) => {
      grossEquity += pnl;
      return grossEquity;
    });

  return {
    totalTrades: filtered.length.toLocaleString("en-US"),
    largestGainLoss: formatLargestPair(
      wins.length > 0 ? Math.max(...wins.map((row) => numericBackupValue(row, "realizedPnl"))) : 0,
      losses.length > 0 ? Math.min(...losses.map((row) => numericBackupValue(row, "realizedPnl"))) : 0,
      wins.length,
      losses.length,
    ),
    realizedDay: formatCurrency(sumRealizedSince(dayStart)),
    realizedWeek: formatCurrency(sumRealizedSince(weekStart)),
    realizedMonth: formatCurrency(sumRealizedSince(monthStart)),
    winRate: formatPercent(winRate),
    profitFactor: formatProfitFactor(profitFactor, losses.length),
    avgWinLoss: formatAveragePair(avgWin, avgLoss, wins.length, losses.length),
    expectancy: formatCurrency(expectancy),
    maxDrawdown: formatCurrency(maxDrawdown),
    commissions: formatCurrency(filtered.reduce((sum, row) => sum + numericBackupValue(row, "totalCommission"), 0)),
    grossCumulativeChart: {
      firstValue: grossCumulativeValues.length > 0 ? formatChartValue(grossCumulativeValues[0]) : "",
      lastValue: grossCumulativeValues.length > 0 ? formatChartValue(grossCumulativeValues.at(-1) ?? 0) : "",
      pointCount: String(grossCumulativeValues.length),
    },
    netCumulativeChart: {
      firstValue: netCumulativeValues.length > 0 ? formatChartValue(netCumulativeValues[0]) : "",
      lastValue: netCumulativeValues.length > 0 ? formatChartValue(netCumulativeValues.at(-1) ?? 0) : "",
      pointCount: String(netCumulativeValues.length),
    },
  };
}

function collectBrowserErrors(page: Page, ignoredStatusErrors: string[] = ["409 (Conflict)", "403 ()", "403 (Forbidden)"]) {
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

test("demo workstation flow loads, saves, filters, and protects mutation APIs", async ({ page, baseURL }) => {
  const browserErrors = collectBrowserErrors(page);
  await signIn(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  await gotoAndSettle(page, "/trades?symbol=DEMOA");
  await expect(page.getByRole("heading", { name: "Trades", exact: true })).toBeVisible();
  await expect(page.getByText("Closed Trades").first()).toBeVisible();
  const demoClosedTrade = page.getByRole("button", { name: /DEMOA LONG/ }).first();
  await expect(demoClosedTrade).toBeVisible();
  await expect(demoClosedTrade).toHaveAttribute("data-account-code", demoAccountCode);
  await expect(demoClosedTrade).toHaveAttribute("data-group-key", /demo-account-workstation/);
  const demoGroupKey = await demoClosedTrade.getAttribute("data-group-key");
  expect(demoGroupKey).toBeTruthy();
  const selectedTradeRow = page.locator(`button[data-group-key="${demoGroupKey}"]`);
  await demoClosedTrade.click();
  const tradeSummary = page.locator("aside").filter({ hasText: "Trade Summary" }).last();
  const structuredReview = page.locator("aside").filter({ hasText: "Structured Review" }).last();
  await expect(tradeSummary.getByText("DEMOA").first()).toBeVisible();
  await expect(structuredReview.getByTestId("review-completion")).toHaveText("Review 7/7");
  await expect(selectedTradeRow.getByTestId("review-completion-badge")).toHaveText("Review 7/7");
  await expectFirstCanvasPainted(page);
  const workstation = page.getByTestId("closed-trade-workstation");
  await expect(workstation).toHaveAttribute("data-workstation-mode", "full");
  await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", demoGroupKey!);
  await expect.poll(() => new URL(page.url()).searchParams.get("groupKey")).toBe(demoGroupKey);
  const fullGeometry = await chartWorkstationGeometry(page);
  expect(fullGeometry.workstationWidth).toBeGreaterThan(900);
  expect(fullGeometry.chartRegionWidth / fullGeometry.workstationWidth).toBeGreaterThan(0.58);
  expect(fullGeometry.firstPanelWidth).toBeGreaterThan(360);
  await page.getByRole("button", { name: "Review focus" }).click();
  await expect(workstation).toHaveAttribute("data-workstation-mode", "review");
  await expect(page.getByTestId("closed-trade-chart-region")).toHaveCount(0);
  await expect(page.locator("aside").filter({ hasText: "Structured Review" }).last()).toBeVisible();
  await page.getByRole("button", { name: "Chart focus" }).click();
  await expect(workstation).toHaveAttribute("data-workstation-mode", "chart");
  await expect(page.getByTestId("closed-trade-chart-region")).toBeVisible();
  await expect(page.locator("aside").filter({ hasText: "Structured Review" })).toHaveCount(0);
  await expect(page.locator("aside").filter({ hasText: "Trade Summary" })).toHaveCount(0);
  await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", demoGroupKey!);
  await expect.poll(() => new URL(page.url()).searchParams.get("groupKey")).toBe(demoGroupKey);
  const chartFocusGeometry = await chartWorkstationGeometry(page);
  expect(chartFocusGeometry.chartRegionWidth).toBeGreaterThan(fullGeometry.chartRegionWidth);
  const chartDock = page.getByTestId("chart-review-dock");
  await expect(chartDock.getByRole("button", { name: /Review/ })).toBeVisible();
  await chartDock.getByRole("button", { name: /Review/ }).click();
  await expect(chartDock.getByTestId("structured-review-editor")).toBeVisible();
  await expect(chartDock.getByTestId("review-completion")).toHaveText("Review 7/7");
  await expect(page.getByTestId("closed-trade-chart-region")).toBeVisible();
  await expect(chartDock.getByRole("button", { name: "Core" })).toHaveAttribute("aria-pressed", "true");
  await expect(chartDock.getByRole("textbox", { name: "Setup", exact: true })).toBeVisible();
  await expect(chartDock.getByRole("textbox", { name: "Lesson", exact: true })).toHaveCount(0);
  const compactDockHeight = await chartDock.evaluate((node) => Math.round(node.getBoundingClientRect().height));
  expect(compactDockHeight).toBeLessThan(760);
  const dockGeometry = await chartDockPanelGeometry(page);
  expect(dockGeometry.dock).not.toBeNull();
  const dockRect = dockGeometry.dock!;
  expect(dockGeometry.surface).not.toBeNull();
  expect(dockRect.width).toBeGreaterThan(360);
  expect(dockGeometry.surface!.width).toBeGreaterThan(640);
  expect(dockGeometry.panels[0]?.width).toBeGreaterThan(320);
  expect(dockGeometry.panels.every((panel) => !rectanglesOverlap(panel, dockRect))).toBe(true);
  await chartDock.getByRole("button", { name: "Lessons" }).click();
  await expect(chartDock.getByRole("button", { name: "Lessons" })).toHaveAttribute("aria-pressed", "true");
  await expect(chartDock.getByRole("textbox", { name: "Lesson", exact: true })).toBeVisible();
  const followUpField = chartDock.getByRole("textbox", { name: "Follow Up", exact: true });
  const originalFollowUp = await followUpField.inputValue();
  await followUpField.fill("");
  await expect(chartDock.getByTestId("review-completion")).toHaveText("Review 6/7");
  await expect(chartDock.getByTestId("review-completion")).toHaveAttribute("title", /Follow Up/);
  await expect(selectedTradeRow.getByTestId("review-completion-badge")).toHaveText("Review 6/7");
  await followUpField.fill(originalFollowUp);
  await expect(chartDock.getByTestId("review-completion")).toHaveText("Review 7/7");
  await expect(selectedTradeRow.getByTestId("review-completion-badge")).toHaveText("Review 7/7");
  const dockLesson = `Chart-focus review dock smoke note ${Date.now()}.`;
  await chartDock.getByRole("textbox", { name: "Lesson", exact: true }).fill(dockLesson);
  await chartDock.getByRole("button", { name: "Core" }).click();
  await expect(chartDock.getByRole("textbox", { name: "Lesson", exact: true })).toHaveCount(0);
  await chartDock.getByRole("button", { name: "Lessons" }).click();
  await expect(chartDock.getByRole("textbox", { name: "Lesson", exact: true })).toHaveValue(dockLesson);
  await expect(chartDock.getByText("Unsaved", { exact: true }).first()).toBeVisible();
  await expect(chartDock.getByRole("button", { name: /Open Journal|Create Journal/ })).toBeDisabled();
  await expect(chartDock.getByText("Save this review before creating or opening a journal entry.")).toBeVisible();
  const dockSaveRequest = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/api/notes/closed-trade"));
  await chartDock.getByRole("button", { name: "Save", exact: true }).click();
  const dockSavePayload = dockSaveRequest.then(
    (request) =>
      request.postDataJSON() as {
        content?: string;
        entryReview?: string;
        exitReview?: string;
        followUp?: string;
        groupKey?: string;
        lesson?: string;
        mistake?: string;
        setup?: string;
        tags?: string[];
        thesis?: string;
        updatedAt?: string | null;
      },
  );
  await expect(chartDock.getByText("Saved.", { exact: true })).toBeVisible();
  const savedDockPayload = await dockSavePayload;
  expect(savedDockPayload).toMatchObject({ groupKey: demoGroupKey });
  expect(savedDockPayload.lesson).toBe(dockLesson);
  for (const key of ["content", "entryReview", "exitReview", "followUp", "mistake", "setup", "thesis"] as const) {
    expect(typeof savedDockPayload[key]).toBe("string");
  }
  expect(Array.isArray(savedDockPayload.tags)).toBe(true);
  expect(Object.hasOwn(savedDockPayload, "updatedAt")).toBe(true);
  await expect(chartDock.getByText("Unsaved", { exact: true })).toHaveCount(0);
  await chartDock.getByTitle("Close review").click();
  await expect(chartDock.getByRole("button", { name: /Review/ })).toBeVisible();
  await expect(demoClosedTrade.getByText("UNSAVED", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Full workstation" }).click();
  await expect(workstation).toHaveAttribute("data-workstation-mode", "full");
  await expect(page.getByTestId("closed-trade-chart-region")).toBeVisible();
  await expect(page.locator("aside").filter({ hasText: "Trade Summary" }).last()).toBeVisible();
  await expect(page.locator("aside").filter({ hasText: "Structured Review" }).last()).toBeVisible();

  const compareInput = page.getByLabel("Compare symbol").first();
  if ((await compareInput.inputValue()).toUpperCase() !== "DEMOB") {
    const compareResponse = page.waitForResponse(
      (response) => response.url().includes("/api/market/candles") && response.url().includes("symbol=DEMOB") && response.ok(),
    );
    await compareInput.fill("DEMOB");
    await compareInput.blur();
    await compareResponse;
  }
  await expect(page.getByText("Compare DEMOB %").first()).toBeVisible();
  await compareInput.fill("BAD SYMBOL");
  await compareInput.blur();
  await expect(page.getByText("Invalid compare symbol.").first()).toBeVisible();
  await expect(page.getByText("Compare DEMOB %").first()).toBeVisible();
  const invalidCompare = await page.request.get("/api/market/candles?symbol=DEMOA&compare=BAD%20SYMBOL");
  expect(invalidCompare.status()).toBe(400);

  const fullThesis = `Opening drive continuation confirmed during smoke review ${Date.now()}.`;
  await page.getByLabel("Thesis").fill(fullThesis);
  await page.getByLabel("Tags").fill("smoke-reviewed");
  await expect(demoClosedTrade.getByText("UNSAVED", { exact: true })).toBeVisible();
  await expect(page.getByText("Save this review before creating or opening a journal entry.").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Create Journal|Open Journal/ })).toBeDisabled();
  const fullSaveRequest = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/api/notes/closed-trade"));
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const fullSavePayload = fullSaveRequest.then((request) => request.postDataJSON() as { groupKey?: string; tags?: string[]; updatedAt?: string | null });
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  const savedFullPayload = await fullSavePayload;
  expect(savedFullPayload).toMatchObject({ groupKey: demoGroupKey, tags: ["smoke-reviewed"] });
  expect(Object.hasOwn(savedFullPayload, "updatedAt")).toBe(true);
  await expect(demoClosedTrade.getByText("UNSAVED", { exact: true })).toHaveCount(0);
  await expect(page.getByText("#smoke-reviewed").first()).toBeVisible();
  const journalAction = page.getByRole("button", { name: /Create Journal|Open Journal/ });
  const createsNewJournal = (await journalAction.textContent())?.includes("Create Journal") ?? false;
  const journalRequestPromise = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().includes("/api/closed-trades/") &&
      request.url().endsWith("/journal"),
  );
  await journalAction.click();
  const journalRequest = await journalRequestPromise;
  expect(journalRequest.headers()["content-type"]).toContain("application/json");
  const journalPayload = journalRequest.postDataJSON() as { expectedReviewUpdatedAt?: unknown };
  expect(isNullableIsoDate(journalPayload.expectedReviewUpdatedAt)).toBe(true);
  await expect(page).toHaveURL(/\/journal\?entryId=/);
  await expect(page.getByRole("button", { name: "Save Entry" })).toBeVisible();
  await expect(page.getByText(/LONG \| 5min \| Opening drive/).first()).toBeVisible();
  if (createsNewJournal) {
    await page.getByRole("button", { name: "Thesis", exact: true }).click();
    await expect(page.locator("aside textarea").first()).toHaveValue(fullThesis);
  }
  const journalRowsResponse = await page.request.get("/api/journal?symbol=DEMOA&limit=20");
  expect(journalRowsResponse.status()).toBe(200);
  const journalRowsPayload = await journalRowsResponse.json();
  expect(
    journalRowsPayload.rows.some((row: { links: Array<{ targetType: string; targetId: string | null }> }) =>
      row.links.some((link) => link.targetType === "CLOSED_TRADE" && link.targetId === demoGroupKey),
    ),
  ).toBe(true);
  await expect(page.getByTestId("source-closed-trade-link").first()).toBeVisible();
  await page.getByTestId("source-closed-trade-link").first().click();
  await expect(page).toHaveURL(/\/trades\?/);
  await expect.poll(() => new URL(page.url()).searchParams.get("groupKey")).toBe(demoGroupKey);
  const linkedDemoClosedTrade = page.getByRole("button", { name: /DEMOA LONG/ }).first();
  await expect(linkedDemoClosedTrade).toBeVisible();
  await expect(linkedDemoClosedTrade).toHaveAttribute("data-group-key", demoGroupKey!);
  await linkedDemoClosedTrade.click();
  await expect(page.getByRole("button", { name: "Open Journal" })).toBeVisible();

  await test.step("stale closed-trade review conflicts lock the editor", async () => {
    await page.route("**/api/notes/closed-trade", async (route) => {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ code: "STALE_CLOSED_TRADE", error: "Cannot edit a stale closed trade.", isStale: true }),
      });
    });
    await page.getByLabel("Tags").fill("stale-lock-check");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Cannot edit a stale closed trade.").first()).toBeVisible();
    await expect(page.getByLabel("Tags")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await page.unroute("**/api/notes/closed-trade");
  });

  await page.locator('input[name="tag"]').fill("#Smoke-Reviewed");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/tag=%23Smoke-Reviewed|tag=%23smoke-reviewed/i);
  await expect(page.getByText("#smoke-reviewed").first()).toBeVisible();
  await expect(page.getByText("No closed trades found.")).toBeHidden();

  await gotoAndSettle(page, "/journal");
  await expect(page.getByText("Trade-Idea Journal")).toBeVisible();
  await expect(page.getByRole("button", { name: /DEMOA \| Opening drive/ })).toBeVisible();

  const dashboardBackupResponse = await page.request.get("/api/admin/backup");
  expect(dashboardBackupResponse.status()).toBe(200);
  const dashboardBackupPayload = (await dashboardBackupResponse.json()) as Record<string, unknown>;
  const expectedDashboard = expectedDashboardCardsFromBackup(dashboardBackupPayload, "2026-06-17", "2026-06-22");
  const demoDashboardTrades = backupRows(dashboardBackupPayload, "closedTrades").filter(
    (row) => row.accountId === "demo-account-workstation" && row.isStale !== true,
  );
  expect(demoDashboardTrades.map((row) => Number(numericBackupValue(row, "realizedPnl").toFixed(2))).sort((a, b) => a - b)).toEqual([
    -122.1,
    293.9,
    419.6,
  ]);
  await gotoAndSettle(page, "/dashboard?preset=custom&from=2026-06-17&to=2026-06-22");
  await expectDashboardCard(page, "total-trades", "Total Trades", expectedDashboard.totalTrades);
  await expectDashboardCard(page, "largest-gain-loss", "Largest Gain / Largest Loss", expectedDashboard.largestGainLoss);
  await expectDashboardCard(page, "realized-day", "Realized PnL (Day)", expectedDashboard.realizedDay);
  await expectDashboardCard(page, "realized-week", "Realized PnL (Week)", expectedDashboard.realizedWeek);
  await expectDashboardCard(page, "realized-month", "Realized PnL (Month)", expectedDashboard.realizedMonth);
  await expectDashboardCard(page, "win-rate", "Win Rate", expectedDashboard.winRate);
  await expectDashboardCard(page, "profit-factor", "Profit Factor", expectedDashboard.profitFactor);
  await expectDashboardCard(page, "avg-win-loss", "Avg Win / Avg Loss", expectedDashboard.avgWinLoss);
  await expectDashboardCard(page, "expectancy", "Expectancy", expectedDashboard.expectancy);
  await expectDashboardCard(page, "max-drawdown", "Max Drawdown", expectedDashboard.maxDrawdown);
  await expectDashboardCard(page, "commissions", "Commissions", expectedDashboard.commissions);
  await expect(page.getByText("Cumulative Net P&L")).toBeVisible();
  await expectDashboardChartSummary(page, "gross-cumulative-pnl", expectedDashboard.grossCumulativeChart);
  await expectDashboardChartSummary(page, "net-cumulative-pnl", expectedDashboard.netCumulativeChart);

  await gotoAndSettle(page, "/import");
  await expect(page.getByText("Import IBKR files through a polished review workflow.")).toBeVisible();
  let blockedCommitRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/import") && (request.postData() ?? "").includes("commit")) {
      blockedCommitRequests += 1;
    }
  });
  const stalePositionImportCsv = [
    "Positions",
    "ClientAccountID,Symbol,Exchange,AssetClass,ReportDate,Quantity,AvgCost,UnrealizedPnl,Currency",
    "DEMO-WORKSTATION,DEMOZ,NASDAQ,STK,2026-06-17,2,100,12,USD",
  ].join("\n");
  await page.locator('input[type="file"]').setInputFiles({
    name: "positions-stale-mode.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(stalePositionImportCsv),
  });
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByText("positions-stale-mode.csv :: Positions")).toBeVisible();
  await page.getByRole("button", { name: "Full snapshot" }).click();
  await expect(page.getByText(/Full snapshot blocked: DEMO-WORKSTATION snapshot date 2026-06-17 is older than latest known position date 2026-06-18/)).toBeVisible();
  await expect(page.getByText("Missing positions for accounts in this file will be removed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Validate & Import" })).toBeDisabled();
  expect(blockedCommitRequests).toBe(0);

  const positionImportCsv = [
    "Positions",
    "ClientAccountID,Symbol,Exchange,AssetClass,ReportDate,Quantity,AvgCost,UnrealizedPnl,Currency",
    "DEMO-WORKSTATION,DEMOZ,NASDAQ,STK,2026-06-22,2,100,12,USD",
  ].join("\n");
  await page.locator('input[type="file"]').setInputFiles({
    name: "positions-mode.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(positionImportCsv),
  });
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByText("positions-mode.csv :: Positions")).toBeVisible();
  await expect(page.getByText("Position import mode")).toBeVisible();
  await expect(page.getByRole("button", { name: "Partial update" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("keep other open positions unchanged")).toBeVisible();
  await page.getByRole("button", { name: "Full snapshot" }).click();
  await expect(page.getByRole("button", { name: "Full snapshot" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Missing positions for accounts in this file will be removed")).toBeVisible();
  await expect(page.getByText("DEMO-WORKSTATION snapshot date 2026-06-22; latest known position date 2026-06-18.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Validate & Import" })).toBeDisabled();
  await page.getByLabel(/I confirm this is the complete open-position list for DEMO-WORKSTATION as of 2026-06-22/).check();
  await expect(page.getByRole("button", { name: "Validate & Import" })).toBeEnabled();
  let importCommitPayload = "";
  await page.route("**/api/import", async (route) => {
    if (route.request().method() === "POST" && (route.request().postData() ?? "").includes('name="action"')) {
      const postData = route.request().postData() ?? "";
      if (postData.includes("commit")) {
        importCommitPayload = postData;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            results: [
              {
                filename: "positions-mode.csv :: Positions",
                batchId: "e2e-position-mode",
                rowsSeen: 1,
                rowsImported: 1,
                rowsSkipped: 0,
                rowErrors: 0,
                durationMs: 25,
                rowsPerSecond: 40,
                positionSnapshotMode: "full",
              },
            ],
            summary: {
              totalRowsSeen: 1,
              totalRowsImported: 1,
              totalRowsSkipped: 0,
              totalDurationMs: 25,
              totalRowsPerSecond: 40,
            },
          }),
        });
        return;
      }
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Validate & Import" }).click();
  await expect(page.getByText("Import complete. Seen 1, applied 1, not applied 0.")).toBeVisible();
  await expect(page.getByText("Full snapshot").last()).toBeVisible();
  expect(importCommitPayload).toContain("positionSnapshotModeByFile");
  expect(importCommitPayload).toContain('"positions-mode.csv :: Positions":"full"');
  await page.unroute("**/api/import");

  await gotoAndSettle(page, "/settings");
  await expect(page.getByText("Storage Health")).toBeVisible();
  await expect(page.getByTestId("settings-storage-health")).toBeVisible();
  await expect(page.getByTestId("storage-health-db-size")).toContainText(/B|Unavailable/);
  await expect(page.getByTestId("storage-health-inline-screenshot-bytes")).toContainText(/B/);
  await expect(page.getByTestId("storage-health-candle-rows")).toContainText(/\d/);
  await expect(page.getByTestId("storage-health-import-artifact-bytes")).toContainText(/B/);
  await expect(page.getByTestId("storage-health-stale-closed-trades")).toContainText(/\d/);
  const backupReadiness = page.getByTestId("backup-readiness");
  await expect(backupReadiness).toContainText("Backup Readiness");
  await expect(backupReadiness).toContainText("Backup Status");
  await expect(backupReadiness).toContainText("Complete");
  await expect(backupReadiness).toContainText("Manifest Warnings");
  await expect(backupReadiness).toContainText("0");
  await expect(page.getByTestId("backup-readiness-status")).toContainText("Complete");
  await expect(page.getByTestId("backup-readiness-freshness")).not.toContainText("-");
  await expect(page.getByTestId("backup-readiness-warnings")).toContainText("0");
  await expect(page.getByTestId("backup-freshness-status")).toContainText(/Current|Needs Backup|No Verified Backup/);
  await expect(page.getByTestId("backup-freshness-detail")).toBeVisible();
  const reviewArtifactReadiness = page.getByTestId("backup-review-artifacts");
  await expect(reviewArtifactReadiness).toContainText("Review Notes");
  await expect(reviewArtifactReadiness).toContainText("Chart Layouts");
  await expect(reviewArtifactReadiness).toContainText("Drawing States");
  await expect(reviewArtifactReadiness).toContainText("Journal Links");
  await expect(page.getByTestId("backup-action-download-verify")).toBeVisible();
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
  await expect(page.getByTestId("backup-freshness-status")).toContainText("Current", { timeout: 30_000 });
  await expect(page.getByTestId("backup-latest-sha")).toContainText(/[a-f0-9]{12}/);
  await expect(page.getByTestId("backup-latest-payload-bytes")).toContainText(/B|KB|MB|GB/);

  const backupResponse = await page.request.get("/api/admin/backup");
  expect(backupResponse.status()).toBe(200);
  expect(backupResponse.headers()["content-type"]).toContain("application/json");
  const backupPayload = (await backupResponse.json()) as Record<string, unknown>;
  const manifest = backupPayload.manifest as {
    assets?: {
      journalScreenshots?: { complete?: boolean };
      importArtifacts?: { complete?: boolean };
    };
    source?: { latestDataChangeAt?: string; rowCounts?: Record<string, number>; signature?: string };
    tables?: { complete?: boolean; rowCounts?: Record<string, number> };
  };
  expect(manifest.assets?.journalScreenshots?.complete).toBe(true);
  expect(manifest.assets?.importArtifacts?.complete).toBe(true);
  expect(manifest.tables?.complete).toBe(true);
  expect(manifest.source?.signature).toMatch(/^[a-f0-9]{64}$/);
  expect(manifest.source?.rowCounts?.backupAudits).toBeUndefined();

  const backupVerifyResponse = await page.request.post("/api/admin/backup/verify", { data: backupPayload });
  expect(backupVerifyResponse.status()).toBe(200);
  const backupVerifyPayload = (await backupVerifyResponse.json()) as {
    ok?: boolean;
    sha256?: string;
    totalRows?: number;
    tableCount?: number;
    strippedFieldCount?: number;
    tables?: unknown[];
    audit?: { sourceSignature?: string | null };
  };
  expect(backupVerifyPayload.ok).toBe(true);
  expect(backupVerifyPayload.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(backupVerifyPayload.totalRows).toBe(manifest.tables?.rowCounts ? Object.values(manifest.tables.rowCounts).reduce((sum, count) => sum + count, 0) : undefined);
  expect(backupVerifyPayload.tableCount).toBe(Object.keys(manifest.tables?.rowCounts ?? {}).length);
  expect(backupVerifyPayload.strippedFieldCount).toBeGreaterThan(0);
  expect(backupVerifyPayload.tables?.length).toBe(backupVerifyPayload.tableCount);
  expect(backupVerifyPayload.audit?.sourceSignature).toBe(manifest.source?.signature);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("backup-freshness-status")).toContainText("Current");
  await expect(page.getByTestId("backup-latest-verified")).not.toContainText("-");
  await expect(page.getByTestId("backup-latest-sha")).toContainText(/[a-f0-9]{12}/);
  await expect(page.getByTestId("backup-latest-payload-bytes")).toContainText(/B|KB|MB|GB/);
  await expect(page.getByTestId("backup-covers-through")).not.toContainText("-");

  const importBatches = backupRows(backupPayload, "importBatches");
  const importArtifacts = backupRows(backupPayload, "importArtifacts");
  const demoImportBatch = importBatches.find((row) => row.id === "demo-import-batch");
  expect(demoImportBatch).toBeTruthy();
  const rawStorageKey = typeof demoImportBatch?.rawStorageKey === "string" ? demoImportBatch.rawStorageKey : "";
  expect(rawStorageKey).toBeTruthy();
  expect(importArtifacts.some((row) => row.storageKey === rawStorageKey && typeof row.content === "string")).toBe(true);

  const demoClosedTradeKeys = new Set(
    backupRows(backupPayload, "closedTrades")
      .filter((row) => row.accountId === "demo-account-workstation")
      .map((row) => row.groupKey)
      .filter((groupKey): groupKey is string => typeof groupKey === "string"),
  );
  expect(demoClosedTradeKeys.size).toBe(3);
  expect(backupRows(backupPayload, "closedTradeNotes").filter((row) => demoClosedTradeKeys.has(String(row.groupKey))).length).toBe(3);
  expect(backupRows(backupPayload, "closedTradeLayouts").filter((row) => demoClosedTradeKeys.has(String(row.closedTradeGroupKey))).length).toBe(3);
  expect(backupRows(backupPayload, "closedTradeAnnotationStates").filter((row) => demoClosedTradeKeys.has(String(row.closedTradeGroupKey))).length).toBe(3);
  expect(backupRows(backupPayload, "closedTradeAnnotations").filter((row) => demoClosedTradeKeys.has(String(row.closedTradeGroupKey))).length).toBeGreaterThan(0);
  expect(backupRows(backupPayload, "closedTradeTags").filter((row) => demoClosedTradeKeys.has(String(row.closedTradeGroupKey))).length).toBeGreaterThan(0);
  expect(backupRows(backupPayload, "closedTradeExecutions").filter((row) => demoClosedTradeKeys.has(String(row.closedTradeGroupKey))).length).toBeGreaterThan(0);
  expect(
    backupRows(backupPayload, "journalLinks").some((row) => row.targetType === "CLOSED_TRADE" && row.targetId === demoGroupKey),
  ).toBe(true);

  await test.step("e2e demo-only mode blocks authenticated live import mutations", async () => {
    const flexResponse = await page.request.post("/api/flex/run");
    expect(flexResponse.status()).toBe(403);

    const importResponse = await page.request.post("/api/import", {
      multipart: {
        action: "commit",
      },
    });
    expect(importResponse.status()).toBe(403);
  });

  await test.step("anonymous mutation and data APIs are rejected", async () => {
    if (!baseURL) throw new Error("Playwright baseURL is required for anonymous API checks.");
    const anonymousUrl = (pathname: string) => new URL(pathname, baseURL).toString();
    const anonymousFetch = (pathname: string, init?: RequestInit) =>
      fetch(anonymousUrl(pathname), {
        ...init,
        headers: {
          Cookie: "",
          ...(init?.headers ?? {}),
        },
        redirect: "manual",
      });
    const protectedRequests: Array<{ label: string; run: () => Promise<Response> }> = [
      { label: "admin backup", run: () => anonymousFetch("/api/admin/backup") },
      {
        label: "admin backup verify",
        run: () =>
          anonymousFetch("/api/admin/backup/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          }),
      },
      { label: "market candles", run: () => anonymousFetch("/api/market/candles?symbol=DEMOA") },
      { label: "flex run", run: () => anonymousFetch("/api/flex/run", { method: "POST" }) },
      { label: "import", run: () => anonymousFetch("/api/import", { method: "POST" }) },
      {
        label: "closed-trade note",
        run: () =>
          anonymousFetch("/api/notes/closed-trade", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ groupKey: "demo-closed-trade-a", content: "anonymous write", tags: ["anonymous"] }),
        }),
      },
      {
        label: "closed-trade layout",
        run: () =>
          anonymousFetch("/api/closed-trades/demo-closed-trade-a/chart-layout", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ layoutMode: "single", panels: [{ id: "panel-1", symbol: "DEMOA", timeframe: "5m" }], version: 1 }),
        }),
      },
      {
        label: "closed-trade annotations",
        run: () =>
          anonymousFetch("/api/closed-trades/demo-closed-trade-a/annotations", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ annotations: [], version: 1 }),
        }),
      },
      {
        label: "closed-trade journal bridge",
        run: () => anonymousFetch("/api/closed-trades/demo-closed-trade-a/journal", { method: "POST" }),
      },
      {
        label: "journal create",
        run: () =>
          anonymousFetch("/api/journal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ symbol: "DEMOA" }),
          }),
      },
      {
        label: "journal tag rename",
        run: () =>
          anonymousFetch("/api/journal/tags/rename", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ category: "LESSON", from: "old", to: "new" }),
          }),
      },
    ];

    for (const protectedRequest of protectedRequests) {
      const response = await protectedRequest.run();
      expect([401, 307], protectedRequest.label).toContain(response.status);
    }
  });

  expect(browserErrors).toEqual([]);
});

test("journal workspace preserves unsaved edits and pending charts when discard is canceled", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);

  await signIn(page);
  await page.goto("/journal?entryId=demo-journal-a");
  await expect(page.getByRole("button", { name: "Save Entry" })).toBeVisible();
  await expect(page.getByText("DEMOA").first()).toBeVisible();

  await page.getByRole("button", { name: "Thesis", exact: true }).click();
  const draftThesis = "Guarded unsaved thesis from journal durability smoke.";
  const thesisField = page.getByRole("textbox", { name: "Thesis" });
  await thesisField.fill(draftThesis);
  const unsavedBadge = page.getByText("UNSAVED", { exact: true });
  await expect(unsavedBadge).toBeVisible();

  await expectFirstCanvasPainted(page);
  await page.getByRole("button", { name: "Attach Chart" }).click();
  await expect(page.getByText("Attached chart. Save Entry to persist it.")).toBeVisible();
  await expect(page.getByText("Pending", { exact: true }).first()).toBeVisible();

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("unsaved journal changes");
    expect(dialog.message()).toContain("pending chart");
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "New Idea" }).click();

  await expect(page.getByText("Unsaved journal changes preserved.")).toBeVisible();
  await expect(thesisField).toHaveValue(draftThesis);
  await expect(page.getByText("Pending", { exact: true }).first()).toBeVisible();
  await expect(unsavedBadge).toBeVisible();

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("unsaved journal changes");
    await dialog.accept();
  });
  await page.getByRole("button", { name: "New Idea" }).click();
  await expect(page.getByRole("heading", { name: "New journal entry" })).toBeVisible();
  await expect(page.getByText("Pending", { exact: true })).toHaveCount(0);

  expect(browserErrors).toEqual([]);
});

test("journal workspace blocks outcome calculation while current entry has unsaved work", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  let calculateRequests = 0;
  let calculatePayload: { expectedUpdatedAt?: unknown } | null = null;
  await page.route("**/api/journal/demo-journal-a/outcome/calculate", async (route) => {
    calculateRequests += 1;
    calculatePayload = route.request().postDataJSON() as typeof calculatePayload;
    await route.continue();
  });

  try {
    await signIn(page);
    await page.goto("/journal?entryId=demo-journal-a");
    await expect(page.getByRole("button", { name: "Save Entry" })).toBeVisible();
    await expect(page.getByText("DEMOA").first()).toBeVisible();

    await page.getByRole("button", { name: "Thesis", exact: true }).click();
    const draftThesis = `Outcome calculate guard keeps this draft ${Date.now()}.`;
    const thesisField = page.getByRole("textbox", { name: "Thesis" });
    await thesisField.fill(draftThesis);
    await expect(page.getByText("UNSAVED", { exact: true })).toBeVisible();

    await expectFirstCanvasPainted(page);
    await page.getByRole("button", { name: "Attach Chart" }).click();
    await expect(page.getByText("Attached chart. Save Entry to persist it.")).toBeVisible();
    await expect(page.getByText("Pending", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Calculate", exact: true }).click();
    await expect(page.getByText("Save Entry before calculating outcome. Pending charts must be saved first.")).toBeVisible();
    await page.waitForTimeout(250);
    expect(calculateRequests).toBe(0);
    await expect(thesisField).toHaveValue(draftThesis);
    await expect(page.getByText("Pending", { exact: true }).first()).toBeVisible();

    const saveResponse = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith("/api/journal/demo-journal-a"));
    await page.getByRole("button", { name: "Save Entry" }).click();
    expect((await saveResponse).ok()).toBeTruthy();
    await expect(page.getByText("Pending", { exact: true })).toHaveCount(0);
    await expect(page.getByText("UNSAVED", { exact: true })).toHaveCount(0);

    const calculateResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/journal/demo-journal-a/outcome/calculate"));
    await page.getByRole("button", { name: "Calculate", exact: true }).click();
    expect((await calculateResponse).ok()).toBeTruthy();
    await expect.poll(() => Promise.resolve(calculateRequests)).toBe(1);
    expect(isNullableIsoDate(calculatePayload?.expectedUpdatedAt)).toBe(true);
  } finally {
    await page.unroute("**/api/journal/demo-journal-a/outcome/calculate");
  }

  expect(browserErrors).toEqual([]);
});

test("journal workspace keeps pending charts and skips uploads when entry save conflicts", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page, ["409 (Conflict)", "403 ()"]);

  await signIn(page);
  await page.goto("/journal?entryId=demo-journal-a");
  await expect(page.getByRole("button", { name: "Save Entry" })).toBeVisible();

  await page.getByRole("button", { name: "Thesis", exact: true }).click();
  const draftThesis = "Conflicted journal save should keep this draft text.";
  const thesisField = page.getByRole("textbox", { name: "Thesis" });
  await thesisField.fill(draftThesis);

  await expectFirstCanvasPainted(page);
  await page.getByRole("button", { name: "Attach Chart" }).click();
  await expect(page.getByText("Attached chart. Save Entry to persist it.")).toBeVisible();
  await expect(page.getByText("Pending", { exact: true }).first()).toBeVisible();

  let chartUploadRequests = 0;
  await page.route("**/api/journal/demo-journal-a", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Journal entry changed in another tab.",
        currentUpdatedAt: "2026-06-26T00:00:00.000Z",
      }),
    });
  });
  await page.route("**/api/journal/demo-journal-a/charts", async (route) => {
    if (route.request().method() === "POST") chartUploadRequests += 1;
    await route.continue();
  });

  await page.getByRole("button", { name: "Save Entry" }).click();
  await expect(page.getByText("Journal entry changed in another tab.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload latest" })).toBeVisible();
  await expect(thesisField).toHaveValue(draftThesis);
  await expect(page.getByText("Pending", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("UNSAVED", { exact: true })).toBeVisible();
  expect(chartUploadRequests).toBe(0);

  await page.unroute("**/api/journal/demo-journal-a");
  await page.unroute("**/api/journal/demo-journal-a/charts");
  expect(browserErrors).toEqual([]);
});

test("journal workspace keeps local work when stale delete is rejected", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page, ["409 (Conflict)", "403 ()"]);

  await signIn(page);
  await page.goto("/journal?entryId=demo-journal-a");
  await expect(page.getByRole("button", { name: "Save Entry" })).toBeVisible();

  await page.getByRole("button", { name: "Thesis", exact: true }).click();
  const draftThesis = "Stale delete should keep this draft thesis.";
  const thesisField = page.getByRole("textbox", { name: "Thesis" });
  await thesisField.fill(draftThesis);

  await expectFirstCanvasPainted(page);
  await page.getByRole("button", { name: "Attach Chart" }).click();
  await expect(page.getByAltText("DEMOA pending chart").first()).toBeVisible();

  let deletePayload: { expectedUpdatedAt?: unknown } | null = null;
  await page.route("**/api/journal/demo-journal-a", async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.continue();
      return;
    }

    deletePayload = route.request().postDataJSON() as typeof deletePayload;
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Journal entry changed in another tab. Refresh before deleting.",
        currentUpdatedAt: "2026-06-26T00:10:00.000Z",
      }),
    });
  });

  const dialogs: string[] = [];
  const acceptDialog = async (dialog: Dialog) => {
    dialogs.push(dialog.message());
    await dialog.accept();
  };
  page.on("dialog", acceptDialog);

  try {
    await page.getByRole("button", { name: "Delete" }).click();

    await expect.poll(() => isNullableIsoDate(deletePayload?.expectedUpdatedAt)).toBe(true);
    expect(dialogs.some((message) => message.includes("unsaved journal changes"))).toBe(true);
    expect(dialogs.some((message) => message.includes("Delete this journal entry permanently?"))).toBe(true);
    await expect(page.getByText("Journal entry changed in another tab. Refresh before deleting.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reload latest" })).toBeVisible();
    await expect(thesisField).toHaveValue(draftThesis);
    await expect(page.getByAltText("DEMOA pending chart").first()).toBeVisible();
    await expect(page.getByText("UNSAVED", { exact: true })).toBeVisible();
  } finally {
    page.off("dialog", acceptDialog);
    await page.unroute("**/api/journal/demo-journal-a");
  }

  expect(browserErrors).toEqual([]);
});

test("journal workspace keeps pending charts when parent version rejects chart attach", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page, ["409 (Conflict)", "403 ()"]);

  await signIn(page);
  await page.goto("/journal?entryId=demo-journal-a");
  await expect(page.getByRole("button", { name: "Save Entry" })).toBeVisible();

  await page.getByRole("button", { name: "Thesis", exact: true }).click();
  const draftThesis = "Chart attach conflict should keep this saved thesis.";
  const thesisField = page.getByRole("textbox", { name: "Thesis" });
  await thesisField.fill(draftThesis);

  await expectFirstCanvasPainted(page);
  await page.getByRole("button", { name: "Attach Chart" }).click();
  await expect(page.getByAltText("DEMOA pending chart").first()).toBeVisible();

  let chartPayload: { expectedUpdatedAt?: unknown } | null = null;
  let chartPostRequests = 0;
  await page.route("**/api/journal/demo-journal-a/charts", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }

    chartPostRequests += 1;
    chartPayload = route.request().postDataJSON() as typeof chartPayload;
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Journal entry changed in another tab before chart upload.",
        currentUpdatedAt: "2026-06-26T00:15:00.000Z",
      }),
    });
  });

  try {
    await page.getByRole("button", { name: "Save Entry" }).click();

    await expect.poll(() => chartPostRequests).toBe(1);
    await expect.poll(() => isNullableIsoDate(chartPayload?.expectedUpdatedAt)).toBe(true);
    await expect(page.getByText("Journal entry changed in another tab before chart upload.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reload latest" })).toBeVisible();
    await expect(thesisField).toHaveValue(draftThesis);
    await expect(page.getByAltText("DEMOA pending chart").first()).toBeVisible();
    await expect(page.getByText("UNSAVED", { exact: true })).toBeVisible();
  } finally {
    await page.unroute("**/api/journal/demo-journal-a/charts");
  }

  expect(browserErrors).toEqual([]);
});

test("journal workspace locks navigation and chart staging while entry save is in flight", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);

  await signIn(page);
  await page.goto("/journal?entryId=demo-journal-a");
  await expect(page.getByRole("button", { name: "Save Entry" })).toBeVisible();

  await page.getByRole("button", { name: "Thesis", exact: true }).click();
  const thesisField = page.getByRole("textbox", { name: "Thesis" });
  await thesisField.fill(`In-flight journal save lock ${Date.now()}.`);

  await expectFirstCanvasPainted(page);
  await page.getByRole("button", { name: "Attach Chart" }).click();
  await expect(page.getByAltText("DEMOA pending chart").first()).toBeVisible();

  let releaseSave: (() => void) | null = null;
  let markSaveStarted: (() => void) | null = null;
  const routedSaveStarted = new Promise<void>((resolve) => {
    markSaveStarted = resolve;
  });
  await page.route("**/api/journal/demo-journal-a", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }

    markSaveStarted?.();
    await new Promise<void>((release) => {
      releaseSave = release;
    });
    const response = await route.fetch();
    await route.fulfill({ response });
  });

  try {
    await page.getByRole("button", { name: "Save Entry" }).click();
    await routedSaveStarted;

    const workspace = page.getByTestId("journal-workspace");
    await expect(workspace).toHaveAttribute("data-entry-save-in-flight", "true");
    await expect(page.getByRole("button", { name: "Save Entry" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Delete" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "New Idea" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Ideas" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Attach Chart" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Remove Pending Chart" })).toBeDisabled();
    const sourceClosedTradeLink = page.getByTestId("source-closed-trade-link").first();
    if ((await sourceClosedTradeLink.count()) > 0) {
      await expect(sourceClosedTradeLink).toHaveAttribute("aria-disabled", "true");
    }

    expect(releaseSave).toBeTruthy();
    releaseSave?.();
    await expect(workspace).toHaveAttribute("data-entry-save-in-flight", "false");
    await expect(page.getByRole("button", { name: "Attach Chart" })).toBeEnabled();
    await expect(page.getByText(/Saved entry/)).toBeVisible();
  } finally {
    releaseSave?.();
    await page.unroute("**/api/journal/demo-journal-a");
  }

  expect(browserErrors).toEqual([]);
});

test("closed-trade review queue command bar updates counts and honors dirty guards", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  let noteSaveRequests = 0;
  const layoutWrites: Array<{ groupKey: string; panelSymbols: string[] }> = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/notes/closed-trade")) {
      noteSaveRequests += 1;
    }
    if (request.method() === "PUT" && request.url().includes("/api/closed-trades/") && request.url().endsWith("/chart-layout")) {
      const match = /\/api\/closed-trades\/([^/]+)\/chart-layout$/.exec(new URL(request.url()).pathname);
      const payload = request.postDataJSON() as { panels?: Array<{ symbol?: string | null }> } | null;
      if (match && Array.isArray(payload?.panels)) {
        layoutWrites.push({
          groupKey: decodeURIComponent(match[1]),
          panelSymbols: payload.panels.map((panel) => String(panel.symbol ?? "").toUpperCase()),
        });
      }
    }
  });
  const expectPanelSymbols = async (symbol: string) => {
    await expect
      .poll(async () =>
        page
          .getByTestId("closed-trade-chart-panel")
          .getByLabel("Symbol", { exact: true })
          .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value)),
      )
      .toEqual([symbol, symbol, symbol]);
  };

  await signIn(page);
  await gotoAndSettle(page, "/trades?account=DEMO-WORKSTATION");
  await expect(page.locator('input[name="account"]')).toHaveValue("DEMO-WORKSTATION");

  const queue = page.getByTestId("review-queue-command-bar");
  await expect(queue).toBeVisible();
  await expect(page.getByTestId("review-queue-count-total")).toHaveAttribute("data-count", "3");
  await expect(page.getByTestId("review-queue-count-complete")).toHaveAttribute("data-count", "3");
  await expect(page.getByTestId("review-queue-count-incomplete")).toHaveAttribute("data-count", "0");
  await expect(page.getByTestId("review-queue-count-unsaved")).toHaveAttribute("data-count", "0");

  const demoATrade = page.getByRole("button", { name: /DEMOA LONG/ }).first();
  await expect(demoATrade).toBeVisible();
  const demoAGroupKey = await demoATrade.getAttribute("data-group-key");
  expect(demoAGroupKey).toBeTruthy();
  await demoATrade.click();
  await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", demoAGroupKey!);
  await expectPanelSymbols("DEMOA");

  const inspector = page.locator("aside").filter({ hasText: "Structured Review" }).last();
  await expect(inspector.getByTestId("review-completion")).toHaveText("Review 7/7");
  const followUp = inspector.getByRole("textbox", { name: "Follow Up", exact: true });
  const originalFollowUp = await followUp.inputValue();
  await followUp.fill("");
  await expect(inspector.getByTestId("review-completion")).toHaveText("Review 6/7");
  await expect(demoATrade.getByTestId("review-completion-badge")).toHaveText("Review 6/7");
  await expect(page.getByTestId("review-queue-count-incomplete")).toHaveAttribute("data-count", "1");
  await expect(page.getByTestId("review-queue-count-complete")).toHaveAttribute("data-count", "2");
  await expect(page.getByTestId("review-queue-count-unsaved")).toHaveAttribute("data-count", "1");
  expect(noteSaveRequests).toBe(0);

  await followUp.fill(originalFollowUp);
  const dirtyLesson = `Review queue command bar dirty guard ${Date.now()}.`;
  await inspector.getByRole("textbox", { name: "Lesson", exact: true }).fill(dirtyLesson);
  await expect(inspector.getByTestId("review-completion")).toHaveText("Review 7/7");
  await expect(page.getByTestId("review-queue-count-incomplete")).toHaveAttribute("data-count", "0");
  await expect(page.getByTestId("review-queue-count-complete")).toHaveAttribute("data-count", "3");
  await expect(page.getByTestId("review-queue-count-unsaved")).toHaveAttribute("data-count", "1");

  const completeJump = page.getByTestId("review-queue-jump-next");
  const completeTargetGroupKey = await completeJump.getAttribute("data-target-group-key");
  expect(completeTargetGroupKey).toBeTruthy();
  expect(completeTargetGroupKey).not.toBe(demoAGroupKey);
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("unsaved structured review changes");
    await dialog.dismiss();
  });
  await completeJump.click();
  await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", demoAGroupKey!);
  expect(noteSaveRequests).toBe(0);

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("unsaved structured review changes");
    await dialog.accept();
  });
  await completeJump.click();
  await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", completeTargetGroupKey!);
  expect(noteSaveRequests).toBe(0);
  await expectChartSavesSettled(page);

  const unsavedJump = page.getByTestId("review-queue-jump-unsaved");
  await expect(unsavedJump).toHaveAttribute("data-target-group-key", demoAGroupKey!);
  await unsavedJump.click();
  await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", demoAGroupKey!);
  await expectPanelSymbols("DEMOA");
  const saveResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/notes/closed-trade"));
  await inspector.getByRole("button", { name: "Save", exact: true }).click();
  expect((await saveResponse).ok()).toBeTruthy();
  await expect(page.getByTestId("review-queue-count-unsaved")).toHaveAttribute("data-count", "0");
  expect(noteSaveRequests).toBe(1);
  for (const write of layoutWrites) {
    const expectedSymbol = expectedDemoSymbolForGroupKey(write.groupKey);
    if (expectedSymbol) expect(write.panelSymbols.every((symbol) => symbol === expectedSymbol)).toBe(true);
  }

  expect(browserErrors).toEqual([]);
});

test("closed-trade review navigation guards dirty drafts and resumes selected trade", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);

  await signIn(page);
  await gotoAndSettle(page, "/trades?account=DEMO-WORKSTATION");
  await expect(page.locator('input[name="account"]')).toHaveValue("DEMO-WORKSTATION");

  const tradeButtons = page.locator('button[data-account-code="DEMO-WORKSTATION"]');
  await expect.poll(() => tradeButtons.count()).toBeGreaterThanOrEqual(2);

  const firstTrade = tradeButtons.nth(0);
  const secondTrade = tradeButtons.nth(1);
  const firstGroupKey = await firstTrade.getAttribute("data-group-key");
  const secondGroupKey = await secondTrade.getAttribute("data-group-key");
  expect(firstGroupKey).toBeTruthy();
  expect(secondGroupKey).toBeTruthy();

  await firstTrade.click();
  await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", firstGroupKey!);
  await expect.poll(() => new URL(page.url()).searchParams.get("groupKey")).toBe(firstGroupKey);

  const inspector = page.locator("aside").filter({ hasText: "Structured Review" }).last();
  await expect(inspector.getByTestId("review-position")).toHaveText(/Trade 1 of \d+/);
  await expect(inspector.getByRole("button", { name: "Previous", exact: true })).toHaveAttribute("aria-keyshortcuts", "Alt+ArrowUp");
  await expect(inspector.getByRole("button", { name: "Next", exact: true })).toHaveAttribute("aria-keyshortcuts", "Alt+ArrowDown");
  const dirtyLesson = `Unsaved review navigation guard smoke ${Date.now()}.`;
  await inspector.getByLabel("Lesson").fill(dirtyLesson);
  await expect(firstTrade.getByText("UNSAVED", { exact: true })).toBeVisible();

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("unsaved structured review changes");
    await dialog.dismiss();
  });
  await inspector.getByRole("button", { name: "Next", exact: true }).focus();
  await page.keyboard.press("Alt+ArrowDown");

  await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", firstGroupKey!);
  await expect.poll(() => new URL(page.url()).searchParams.get("groupKey")).toBe(firstGroupKey);
  await expect(inspector.getByLabel("Lesson")).toHaveValue(dirtyLesson);

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("unsaved structured review changes");
    await dialog.dismiss();
  });
  await inspector.getByRole("button", { name: "Next", exact: true }).click();

  await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", firstGroupKey!);
  await expect.poll(() => new URL(page.url()).searchParams.get("groupKey")).toBe(firstGroupKey);
  await expect(inspector.getByLabel("Lesson")).toHaveValue(dirtyLesson);
  await expect(page.getByText("Unsaved review changes preserved.").first()).toBeVisible();

  await expectChartSavesSettled(page);
  const saveAndNextButton = inspector.getByRole("button", { name: "Save & Next" });
  await expect(saveAndNextButton).toHaveAttribute("aria-keyshortcuts", "Control+Enter Meta+Enter");
  const saveAndNextResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/notes/closed-trade"));
  await inspector.getByLabel("Lesson").press("Control+Enter");
  expect((await saveAndNextResponse).ok()).toBeTruthy();
  await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", secondGroupKey!);
  await expect.poll(() => new URL(page.url()).searchParams.get("groupKey")).toBe(secondGroupKey);
  await expect(inspector.getByLabel("Lesson")).toBeFocused();

  await page.reload();
  await expectNoFrameworkOverlay(page);
  await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", secondGroupKey!);
  await expect.poll(() => new URL(page.url()).searchParams.get("groupKey")).toBe(secondGroupKey);
  const reloadedInspector = page.locator("aside").filter({ hasText: "Structured Review" }).last();
  await expect(reloadedInspector.getByTestId("review-position")).toHaveText(/Trade 2 of \d+/);
  await reloadedInspector.getByRole("button", { name: "Previous", exact: true }).focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", firstGroupKey!);
  await expect.poll(() => new URL(page.url()).searchParams.get("groupKey")).toBe(firstGroupKey);

  expect(browserErrors).toEqual([]);
});

test("closed-trade Save & Next locks trade navigation while review save is in flight", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);

  await signIn(page);
  await gotoAndSettle(page, "/trades?account=DEMO-WORKSTATION");
  await expect(page.locator('input[name="account"]')).toHaveValue("DEMO-WORKSTATION");

  const tradeButtons = page.locator('button[data-account-code="DEMO-WORKSTATION"]');
  await expect.poll(() => tradeButtons.count()).toBeGreaterThanOrEqual(3);

  const alternateTrade = tradeButtons.nth(0);
  const currentTrade = tradeButtons.nth(1);
  const intendedNextTrade = tradeButtons.nth(2);
  const alternateGroupKey = await alternateTrade.getAttribute("data-group-key");
  const currentGroupKey = await currentTrade.getAttribute("data-group-key");
  const intendedNextGroupKey = await intendedNextTrade.getAttribute("data-group-key");
  expect(alternateGroupKey).toBeTruthy();
  expect(currentGroupKey).toBeTruthy();
  expect(intendedNextGroupKey).toBeTruthy();

  await currentTrade.click();
  await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", currentGroupKey!);
  await expect.poll(() => new URL(page.url()).searchParams.get("groupKey")).toBe(currentGroupKey);

  const inspector = page.locator("aside").filter({ hasText: "Structured Review" }).last();
  const inFlightLesson = `Save and next in-flight lock smoke ${Date.now()}.`;
  await inspector.getByLabel("Lesson").fill(inFlightLesson);
  await expect(currentTrade.getByText("UNSAVED", { exact: true })).toBeVisible();

  let releaseReviewSave!: () => void;
  const reviewSaveRelease = new Promise<void>((resolve) => {
    releaseReviewSave = resolve;
  });
  let savePayload: { groupKey?: string; lesson?: string } | null = null;
  await page.route("**/api/notes/closed-trade", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    savePayload = route.request().postDataJSON() as typeof savePayload;
    await reviewSaveRelease;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ updatedAt: "2026-06-29T00:00:00.000Z" }),
    });
  });

  const saveAndNextButton = inspector.getByRole("button", { name: "Save & Next" });
  const saveResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/notes/closed-trade"));
  await saveAndNextButton.click();

  await expect(currentTrade.getByText("SAVING", { exact: true })).toBeVisible();
  await expect(saveAndNextButton).toBeDisabled();
  await expect(alternateTrade).toBeDisabled();
  await expect(intendedNextTrade).toBeDisabled();
  await expect(inspector.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  await inspector.getByRole("button", { name: "Core", exact: true }).focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", currentGroupKey!);
  await alternateTrade.evaluate((node) => (node as HTMLButtonElement).click());
  await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", currentGroupKey!);
  await expect.poll(() => new URL(page.url()).searchParams.get("groupKey")).toBe(currentGroupKey);

  releaseReviewSave();
  expect((await saveResponse).ok()).toBeTruthy();
  expect(savePayload).toMatchObject({ groupKey: currentGroupKey, lesson: inFlightLesson });
  await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", intendedNextGroupKey!);
  await expect.poll(() => new URL(page.url()).searchParams.get("groupKey")).toBe(intendedNextGroupKey);
  await expect(currentTrade.getByText("SAVING", { exact: true })).toHaveCount(0);
  await page.unroute("**/api/notes/closed-trade");

  expect(browserErrors).toEqual([]);
});

test("chart layout errors cancel deferred closed-trade Save & Next switches", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page, ["503 (Service Unavailable)"]);

  await signIn(page);
  await gotoAndSettle(page, "/trades?account=DEMO-WORKSTATION");
  await expect(page.locator('input[name="account"]')).toHaveValue("DEMO-WORKSTATION");

  const tradeButtons = page.locator('button[data-account-code="DEMO-WORKSTATION"]');
  await expect.poll(() => tradeButtons.count()).toBeGreaterThanOrEqual(3);

  const currentTrade = tradeButtons.nth(1);
  const intendedNextTrade = tradeButtons.nth(2);
  const currentGroupKey = await currentTrade.getAttribute("data-group-key");
  const intendedNextGroupKey = await intendedNextTrade.getAttribute("data-group-key");
  expect(currentGroupKey).toBeTruthy();
  expect(intendedNextGroupKey).toBeTruthy();
  const currentLayoutPath = `/api/closed-trades/${encodeURIComponent(currentGroupKey!)}/chart-layout`;

  await currentTrade.click();
  await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", currentGroupKey!);
  await expect.poll(() => new URL(page.url()).searchParams.get("groupKey")).toBe(currentGroupKey);
  await expectFirstCanvasPainted(page);
  await expect(page.getByText("Layout ready.").first()).toBeVisible();
  await expect(page.getByText("Drawings ready.").first()).toBeVisible();

  let releaseLayoutSave!: () => void;
  const layoutSaveRelease = new Promise<void>((resolve) => {
    releaseLayoutSave = resolve;
  });
  let layoutPutCount = 0;
  await page.route("**/api/closed-trades/*/chart-layout", async (route) => {
    if (route.request().method() !== "PUT" || !route.request().url().includes(currentLayoutPath)) {
      await route.continue();
      return;
    }
    layoutPutCount += 1;
    const requestBody = route.request().postDataJSON() as { layoutMode?: string; panels?: unknown[]; version?: number };
    if (layoutPutCount === 1) {
      await layoutSaveRelease;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Layout save failed. Retry." }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        layout: {
          id: "retried-layout-save",
          groupKey: currentGroupKey,
          layoutMode: requestBody.layoutMode,
          panels: requestBody.panels,
          version: (requestBody.version ?? 1) + 1,
        },
      }),
    });
  });
  await page.route("**/api/notes/closed-trade", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ updatedAt: "2026-06-29T00:00:00.000Z" }),
    });
  });

  try {
    const layoutSaveRequest = page.waitForRequest((request) => request.method() === "PUT" && request.url().includes(currentLayoutPath));
    const inactiveTimeframe = page
      .getByTestId("closed-trade-chart-panel")
      .first()
      .locator('button[title^="Switch to"][aria-pressed="false"]')
      .first();
    await expect(inactiveTimeframe).toBeVisible();
    await inactiveTimeframe.click();
    await layoutSaveRequest;
    await expect(page.getByTestId("closed-trade-workstation")).toHaveAttribute("data-chart-save-blocking", "true");

    const inspector = page.locator("aside").filter({ hasText: "Structured Review" }).last();
    const deferredLesson = `Save and next canceled after chart error ${Date.now()}.`;
    await inspector.getByLabel("Lesson").fill(deferredLesson);
    const saveAndNextButton = inspector.getByRole("button", { name: "Save & Next" });
    const saveResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/notes/closed-trade"));
    await saveAndNextButton.click();
    expect((await saveResponse).ok()).toBeTruthy();
    await expect(page.getByTestId("chart-save-guard")).toContainText("Review saved. Waiting for chart workspace save before switching...");
    await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", currentGroupKey!);
    await expect(inspector.getByLabel("Lesson")).toBeDisabled();
    await expect(inspector.getByLabel("Tags")).toBeDisabled();
    await expect(inspector.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await expect(saveAndNextButton).toBeDisabled();
    await expect(inspector.getByRole("button", { name: /Create Journal|Open Journal/ })).toBeDisabled();

    const layoutErrorResponse = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().includes(currentLayoutPath));
    releaseLayoutSave();
    expect((await layoutErrorResponse).status()).toBe(503);
    await expect(page.getByTestId("chart-save-guard")).toContainText("Chart save needs attention.");
    await expect(page.getByText("Layout save failed. Retry.").first()).toBeVisible();
    await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", currentGroupKey!);
    await expect.poll(() => new URL(page.url()).searchParams.get("groupKey")).toBe(currentGroupKey);
    await expect(saveAndNextButton).toBeEnabled();
    await expect(inspector.getByLabel("Lesson")).toBeEnabled();
    await expect(inspector.getByLabel("Tags")).toBeEnabled();

    const retryResponse = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().includes(currentLayoutPath));
    await page.getByRole("button", { name: /retry layout save/i }).click();
    expect((await retryResponse).ok()).toBeTruthy();
    await expect(page.getByText("Layout save failed. Retry.")).toHaveCount(0);
    await expect(page.getByTestId("chart-save-guard")).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(layoutPutCount).toBe(2);
    await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", currentGroupKey!);
    await expect.poll(() => new URL(page.url()).searchParams.get("groupKey")).toBe(currentGroupKey);

    await intendedNextTrade.click();
    await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", intendedNextGroupKey!);
  } finally {
    await page.unroute("**/api/closed-trades/*/chart-layout");
    await page.unroute("**/api/notes/closed-trade");
  }

  expect(browserErrors).toEqual([]);
});

test("create journal conflicts lock first-time closed-trade journal creation", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);

  await signIn(page);

  await test.step("review version conflict shows reload state and disables creation", async () => {
    await gotoAndSettle(page, "/trades?symbol=DEMOB");
    const demoClosedTrade = page.getByRole("button", { name: /DEMOB LONG/ }).first();
    await expect(demoClosedTrade).toBeVisible();
    const groupKey = await demoClosedTrade.getAttribute("data-group-key");
    expect(groupKey).toBeTruthy();
    await demoClosedTrade.click();

    const journalBridgeRoute = `**/api/closed-trades/${encodeURIComponent(groupKey!)}/journal`;
    let journalPayload: { expectedReviewUpdatedAt?: unknown } | null = null;
    await page.route(journalBridgeRoute, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }

      journalPayload = route.request().postDataJSON() as typeof journalPayload;
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          code: "CLOSED_TRADE_REVIEW_CHANGED",
          error: "Closed-trade review changed in another tab. Reload before creating a journal review.",
          currentReviewUpdatedAt: "2026-06-26T00:00:00.000Z",
        }),
      });
    });

    try {
      const createJournal = page.getByRole("button", { name: "Create Journal" });
      await expect(createJournal).toBeEnabled();
      await createJournal.click();

      await expect.poll(() => isNullableIsoDate(journalPayload?.expectedReviewUpdatedAt)).toBe(true);
      await expect(page).toHaveURL(/\/trades\?symbol=DEMOB/);
      await expect(page.getByText("Closed-trade review changed in another tab. Reload before creating a journal review.").first()).toBeVisible();
      await expect(page.getByText("This review changed elsewhere.")).toBeVisible();
      await expect(page.getByText("Reload before continuing so another review is not copied or overwritten.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
      await expect(page.getByLabel("Thesis")).toBeDisabled();
      await expect(page.getByLabel("Tags")).toBeDisabled();
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Create Journal" })).toBeDisabled();
    } finally {
      await page.unroute(journalBridgeRoute);
    }
  });

  await test.step("stale conflict locks first-time creation without opening journal", async () => {
    await gotoAndSettle(page, "/trades?symbol=DEMOC");
    const demoClosedTrade = page.getByRole("button", { name: /DEMOC SHORT/ }).first();
    await expect(demoClosedTrade).toBeVisible();
    const groupKey = await demoClosedTrade.getAttribute("data-group-key");
    expect(groupKey).toBeTruthy();
    await demoClosedTrade.click();

    const journalBridgeRoute = `**/api/closed-trades/${encodeURIComponent(groupKey!)}/journal`;
    let journalPayload: { expectedReviewUpdatedAt?: unknown } | null = null;
    await page.route(journalBridgeRoute, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }

      journalPayload = route.request().postDataJSON() as typeof journalPayload;
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          code: "STALE_CLOSED_TRADE",
          error: "Cannot create a journal review for a stale closed trade.",
          isStale: true,
        }),
      });
    });

    try {
      const createJournal = page.getByRole("button", { name: "Create Journal" });
      await expect(createJournal).toBeEnabled();
      await createJournal.click();

      await expect.poll(() => isNullableIsoDate(journalPayload?.expectedReviewUpdatedAt)).toBe(true);
      await expect(page).toHaveURL(/\/trades\?symbol=DEMOC/);
      await expect(page.getByText("Cannot create a journal review for a stale closed trade.").first()).toBeVisible();
      await expect(page.getByLabel("Thesis")).toBeDisabled();
      await expect(page.getByLabel("Tags")).toBeDisabled();
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Create Journal" })).toBeDisabled();
    } finally {
      await page.unroute(journalBridgeRoute);
    }
  });

  expect(browserErrors).toEqual([]);
});

test("chart workstation surfaces execution labels and candle diagnostics", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  const fixtureStart = unixSeconds("2026-06-17T13:00:00.000Z");
  const fixtureCandles = Array.from({ length: 31 }, (_, index) => {
    const time = fixtureStart + index * 300;
    const base = 100 + index * 0.16;
    return {
      time,
      open: Number(base.toFixed(2)),
      high: Number((base + 0.55).toFixed(2)),
      low: Number((base - 0.45).toFixed(2)),
      close: Number((base + 0.22).toFixed(2)),
      volume: 1200 + index * 10,
    };
  });
  fixtureCandles[7] = {
    time: unixSeconds("2026-06-17T13:35:00.000Z"),
    open: 100.9,
    high: 101.19,
    low: 100.75,
    close: 101.05,
    volume: 1200,
  };
  fixtureCandles[16] = {
    time: unixSeconds("2026-06-17T14:20:00.000Z"),
    open: 104.2,
    high: 105.1,
    low: 104.0,
    close: 104.8,
    volume: 1400,
  };

  await page.route("**/api/market/candles**", async (route) => {
    const url = new URL(route.request().url());
    const symbol = (url.searchParams.get("symbol") ?? "DEMOA").toUpperCase();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        symbol,
        source: "cache",
        candles: fixtureCandles,
        metadata: {
          requestedRange: null,
          returnedRange: { from: fixtureCandles[0].time, to: fixtureCandles.at(-1)?.time ?? fixtureCandles[0].time },
          barIntervalSeconds: 300,
          limit: 30000,
          truncated: true,
          warnings: [
            "Candle response reached the bar limit.",
            "Yahoo candle provider unavailable; showing cached candles.",
          ],
        },
      }),
    });
  });

  try {
    await signIn(page);
    await gotoAndSettle(page, "/trades?symbol=DEMOA");
    const demoClosedTrade = page.getByRole("button", { name: /DEMOA LONG/ }).first();
    await expect(demoClosedTrade).toBeVisible();
    await demoClosedTrade.click();
    await expectFirstCanvasPainted(page);

    await expect(page.getByTestId("execution-overlay-label").filter({ hasText: "BUY 1" }).first()).toContainText("100 @ 101.20");
    await expect(page.getByTestId("execution-overlay-label").filter({ hasText: "SELL 2" }).first()).toContainText("50 @ 104.60");
    await expect(page.getByTestId("execution-overlay-label").filter({ hasText: "SELL 3" })).toHaveCount(0);

    const expected = [
      { text: "BUY 1 100 @ 101.20", visible: true },
      { text: "SELL 2 50 @ 104.60", visible: true },
    ];

    await test.step("execution overlays survive same-trade clicks and redraws", async () => {
      await expect.poll(() => executionOverlaySnapshot(page)).toEqual(expected);
      await demoClosedTrade.click();
      await expect.poll(() => executionOverlaySnapshot(page)).toEqual(expected);
      await page.setViewportSize({ width: 1180, height: 840 });
      await expect.poll(() => executionOverlaySnapshot(page)).toEqual(expected);
    });

    await test.step("execution overlays move with the chart during pan and zoom", async () => {
      const before = await executionOverlayGeometrySnapshot(page);
      expect(before.map((item) => ({ text: item.text, visible: item.visible, insidePlot: item.insidePlot }))).toEqual([
        { text: "BUY 1 100 @ 101.20", visible: true, insidePlot: true },
        { text: "SELL 2 50 @ 104.60", visible: true, insidePlot: true },
      ]);

      await panFirstChart(page);
      await expect.poll(async () => executionOverlayGeometryMoved(before, await executionOverlayGeometrySnapshot(page))).toBe(true);
      await expect.poll(() => executionOverlaySnapshot(page)).toEqual(expected);
      await expectChartSavesSettled(page);
    });

    const warning = page.getByTestId("chart-warning").filter({ hasText: "fill outside execution candle" }).first();
    await expect(warning).toContainText("1 fill outside execution candle");
    await expect(warning).toContainText("1 fill has no matching candle");
    await expect(warning).toContainText("Candle response reached the bar limit.");
    await expect(warning).toContainText("Yahoo candle provider unavailable; showing cached candles.");
    await expect(page.getByRole("button", { name: "Markers" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Markers" })).toHaveAttribute("title", /matching candles on every fill/);
  } finally {
    await page.unroute("**/api/market/candles**");
  }

  expect(browserErrors).toEqual([]);
});

test("chart workstation retries empty provider responses after a timeframe round trip", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  const recoveredCandles = Array.from({ length: 40 }, (_, index) => {
    const base = 100 + index * 0.15;
    return {
      time: unixSeconds("2026-06-17T12:00:00.000Z") + index * 300,
      open: Number(base.toFixed(2)),
      high: Number((base + 1).toFixed(2)),
      low: Number((base - 0.8).toFixed(2)),
      close: Number((base + 0.2).toFixed(2)),
      volume: 1_000 + index * 10,
    };
  });
  let fiveMinuteRequestCount = 0;

  await page.route("**/api/market/candles**", async (route) => {
    const url = new URL(route.request().url());
    const symbol = (url.searchParams.get("symbol") ?? "DEMOA").toUpperCase();
    const timeframe = url.searchParams.get("timeframe") ?? "5m";
    if (timeframe === "5m") fiveMinuteRequestCount += 1;
    const emptyResponse = timeframe === "5m" && fiveMinuteRequestCount === 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        symbol,
        timeframe,
        source: emptyResponse ? null : "cache",
        candles: emptyResponse ? [] : recoveredCandles,
        metadata: {
          requestedRange: null,
          returnedRange: emptyResponse
            ? null
            : { from: recoveredCandles[0].time, to: recoveredCandles.at(-1)?.time ?? recoveredCandles[0].time },
          barIntervalSeconds: timeframe === "1d" ? 86_400 : timeframe === "1h" ? 3_600 : 300,
          limit: 30000,
          truncated: false,
          warnings: emptyResponse ? ["Yahoo candle provider unavailable; no candle data returned."] : [],
        },
      }),
    });
  });

  try {
    await signIn(page);
    await gotoAndSettle(page, "/trades?symbol=DEMOA");
    const demoClosedTrade = page.getByRole("button", { name: /DEMOA LONG/ }).first();
    await expect(demoClosedTrade).toBeVisible();
    await demoClosedTrade.click();

    const warning = page
      .getByTestId("chart-warning")
      .filter({ hasText: "Yahoo candle provider unavailable; no candle data returned." })
      .first();
    await expect(warning).toBeVisible();
    await expect(page.getByText("Unable to load candles.")).toHaveCount(0);
    await expect(page.getByText("No candle data found.")).toHaveCount(0);

    const firstPanel = page.getByTestId("closed-trade-chart-panel").first();
    await firstPanel.locator('button[title="Switch to 1H"]').click();
    await expect(firstPanel).toHaveAttribute("data-timeframe", "1h");
    await expect.poll(async () => Number(await firstPanel.getByTestId("chart-panel-bar-count").getAttribute("data-candle-count"))).toBeGreaterThan(0);
    await firstPanel.locator('button[title="Switch to 5M"]').click();
    await expect(firstPanel).toHaveAttribute("data-timeframe", "5m");
    await expect.poll(async () => Number(await firstPanel.getByTestId("chart-panel-bar-count").getAttribute("data-candle-count"))).toBeGreaterThan(0);
    await expect(warning).toBeHidden();
    expect(fiveMinuteRequestCount).toBeGreaterThanOrEqual(2);
    await expectChartSavesSettled(page);
  } finally {
    await page.unroute("**/api/market/candles**");
  }

  expect(browserErrors).toEqual([]);
});

test("chart workstation stores demo fills as aligned execution-line annotations", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  const fixtureCandles = [
    {
      time: unixSeconds("2026-06-17T13:35:00.000Z"),
      open: 100.9,
      high: 101.5,
      low: 100.75,
      close: 101.25,
      volume: 1200,
    },
    {
      time: unixSeconds("2026-06-17T14:20:00.000Z"),
      open: 104.2,
      high: 104.95,
      low: 104.0,
      close: 104.7,
      volume: 1400,
    },
    {
      time: unixSeconds("2026-06-17T16:45:00.000Z"),
      open: 105.8,
      high: 106.7,
      low: 105.65,
      close: 106.35,
      volume: 1800,
    },
  ];
  const existingTarget = {
    id: "existing-target",
    groupKey: "demo-closed-trade-a",
    panelId: "panel-1",
    symbol: "DEMOA",
    timeframe: "5m",
    scope: "TRADE",
    type: "target",
    points: [{ time: fixtureCandles[2].time, price: 106.25 }],
    price: 106.25,
    text: "Existing target",
    style: { color: "#2563eb" },
    createdAt: "2026-06-26T00:00:00.000Z",
    updatedAt: "2026-06-26T00:00:00.000Z",
  };
  let putBody: {
    version?: number;
    annotations?: Array<{
      id?: string;
      panelId?: string | null;
      symbol?: string;
      timeframe?: string | null;
      scope?: string;
      type?: string;
      points?: Array<{ time?: number; price?: number }>;
      price?: number | null;
      text?: string | null;
      style?: Record<string, unknown>;
    }>;
  } | null = null;
  const candleRequests: Array<{ symbol: string; timeframe: string | null; from: number; to: number }> = [];

  await page.route("**/api/closed-trades/*/chart-layout", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          layout: {
            id: "marker-alignment-layout",
            groupKey: "demo-closed-trade-a",
            layoutMode: "one-plus-two",
            panels: [
              { id: "panel-1", symbol: "DEMOA", timeframe: "5m", rangePreset: "trade", visibleFrom: null, visibleTo: null },
              { id: "panel-2", symbol: "DEMOA", timeframe: "1h", rangePreset: "post", visibleFrom: null, visibleTo: null },
              { id: "panel-3", symbol: "DEMOA", timeframe: "1d", rangePreset: "trade", visibleFrom: null, visibleTo: null },
            ],
            version: 8,
          },
        }),
      });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/closed-trades/*/annotations", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ annotations: [], version: 1, updatedAt: "2026-06-26T00:00:00.000Z" }),
      });
      return;
    }
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as { annotations?: unknown[] };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ annotations: body.annotations ?? [], version: 2, updatedAt: "2026-06-26T00:01:00.000Z" }),
      });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/market/candles**", async (route) => {
    const url = new URL(route.request().url());
    const symbol = (url.searchParams.get("symbol") ?? "DEMOA").toUpperCase();
    const from = Number(url.searchParams.get("from") ?? "");
    const to = Number(url.searchParams.get("to") ?? "");
    candleRequests.push({ symbol, timeframe: url.searchParams.get("timeframe"), from, to });
    const requestedRange = Number.isFinite(from) && Number.isFinite(to) && to > from ? { from, to } : null;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        symbol,
        source: "yahoo",
        candles: fixtureCandles,
        metadata: {
          requestedRange,
          returnedRange: { from: fixtureCandles[0].time, to: fixtureCandles.at(-1)?.time ?? fixtureCandles[0].time },
          barIntervalSeconds: 300,
          limit: 30000,
          truncated: false,
          warnings: [],
        },
      }),
    });
  });
  await page.route("**/api/closed-trades/*/annotations", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ annotations: [existingTarget], version: 8, updatedAt: existingTarget.updatedAt }),
      });
      return;
    }
    if (route.request().method() === "PUT") {
      putBody = route.request().postDataJSON() as typeof putBody;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ annotations: putBody?.annotations ?? [], version: 9, updatedAt: "2026-06-26T00:01:00.000Z" }),
      });
      return;
    }
    await route.continue();
  });

  try {
    await signIn(page);
    await gotoAndSettle(page, "/trades?symbol=DEMOA");
    const demoClosedTrade = page.getByRole("button", { name: /DEMOA LONG/ }).first();
    await expect(demoClosedTrade).toBeVisible();
    await demoClosedTrade.click();
    await expectFirstCanvasPainted(page);
    await expect(page.getByText("Drawings ready.").first()).toBeVisible();
    await expect(page.getByTestId("execution-overlay-label").filter({ hasText: "BUY 1" }).first()).toContainText("100 @ 101.20");
    await expect(page.getByTestId("execution-overlay-label").filter({ hasText: "SELL 2" }).first()).toContainText("50 @ 104.60");
    await expect(page.getByTestId("execution-overlay-label").filter({ hasText: "SELL 3" }).first()).toContainText("50 @ 106.25");
    expect(
      candleRequests.some(
        (request) =>
          request.symbol === "DEMOA" &&
          request.timeframe === "5m" &&
          request.from < unixSeconds("2026-06-17T13:35:00.000Z") &&
          request.to > unixSeconds("2026-06-17T16:45:00.000Z"),
      ),
    ).toBe(true);
    await expect(page.getByTestId("closed-trade-chart-panel").first().getByTestId("chart-warning").filter({ hasText: "has no matching candle" })).toHaveCount(0);

    await expect(page.getByTitle("Store execution markers")).toBeEnabled();
    await page.getByTitle("Store execution markers").click();
    await expect.poll(() => putBody?.version).toBe(8);
    await expect(page.getByText(/Drawings saved\.|Drawings ready\./).first()).toBeVisible();

    const annotations = putBody?.annotations ?? [];
    expect(annotations.some((annotation) => annotation.id === "existing-target")).toBe(true);
    const lines = annotations.filter((annotation) => annotation.type === "execution-line");
    expect(lines).toHaveLength(3);

    const expectedLines = [
      {
        executionId: "demo-exec-a-entry",
        text: "BUY 1 100 @ 101.20",
        price: 101.2,
        time: unixSeconds("2026-06-17T13:35:00.000Z"),
        color: "#16a34a",
        direction: "up",
      },
      {
        executionId: "demo-exec-a-scale",
        text: "SELL 2 50 @ 104.60",
        price: 104.6,
        time: unixSeconds("2026-06-17T14:20:00.000Z"),
        color: "#dc2626",
        direction: "down",
      },
      {
        executionId: "demo-exec-a-exit",
        text: "SELL 3 50 @ 106.25",
        price: 106.25,
        time: unixSeconds("2026-06-17T16:45:00.000Z"),
        color: "#dc2626",
        direction: "down",
      },
    ] as const;

    for (const expected of expectedLines) {
      const line = lines.find((annotation) => annotation.style?.sourceExecutionId === expected.executionId);
      expect(line).toBeTruthy();
      expect(line).toMatchObject({
        panelId: "panel-1",
        symbol: "DEMOA",
        timeframe: "5m",
        scope: "TRADE",
        type: "execution-line",
        price: expected.price,
        text: expected.text,
        style: expect.objectContaining({ color: expected.color, sourceKind: "line" }),
      });
      expect(line?.points).toHaveLength(2);
      expect(line?.points?.[0]).toMatchObject({ time: expected.time, price: expected.price });
      expect(line?.points?.[1]?.time ?? 0).toBeGreaterThan(expected.time);
      if (expected.direction === "up") {
        expect(line?.points?.[1]?.price ?? 0).toBeGreaterThan(expected.price);
      } else {
        expect(line?.points?.[1]?.price ?? Number.POSITIVE_INFINITY).toBeLessThan(expected.price);
      }
    }
  } finally {
    await page.unroute("**/api/closed-trades/*/chart-layout");
    await page.unroute("**/api/market/candles**");
    await page.unroute("**/api/closed-trades/*/annotations");
  }

  expect(browserErrors).toEqual([]);
});

test("chart workstation blocks execution markers until current timeframe candles load", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  const fiveMinuteCandles = [
    {
      time: unixSeconds("2026-06-17T13:35:00.000Z"),
      open: 100.9,
      high: 101.5,
      low: 100.75,
      close: 101.25,
      volume: 1200,
    },
    {
      time: unixSeconds("2026-06-17T14:20:00.000Z"),
      open: 104.2,
      high: 104.95,
      low: 104.0,
      close: 104.7,
      volume: 1400,
    },
    {
      time: unixSeconds("2026-06-17T16:45:00.000Z"),
      open: 105.8,
      high: 106.7,
      low: 105.65,
      close: 106.35,
      volume: 1800,
    },
  ];
  const oneHourCandles = [
    {
      time: unixSeconds("2026-06-17T13:00:00.000Z"),
      open: 100.2,
      high: 101.6,
      low: 99.9,
      close: 101.25,
      volume: 3200,
    },
    {
      time: unixSeconds("2026-06-17T14:00:00.000Z"),
      open: 103.8,
      high: 105.0,
      low: 103.4,
      close: 104.7,
      volume: 4100,
    },
    {
      time: unixSeconds("2026-06-17T16:00:00.000Z"),
      open: 105.5,
      high: 106.8,
      low: 105.1,
      close: 106.35,
      volume: 5200,
    },
  ];
  let releaseOneHourCandles!: () => void;
  const oneHourCandlesRelease = new Promise<void>((resolve) => {
    releaseOneHourCandles = resolve;
  });
  const annotationPutBodies: Array<{
    annotations?: Array<{
      timeframe?: string | null;
      type?: string;
      points?: Array<{ time?: number; price?: number }>;
      style?: Record<string, unknown>;
    }>;
  }> = [];
  await page.route("**/api/closed-trades/*/chart-layout", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          layout: {
            id: "marker-freshness-layout",
            groupKey: "demo-closed-trade-a",
            layoutMode: "one-plus-two",
            panels: [
              { id: "panel-1", symbol: "DEMOA", timeframe: "5m", rangePreset: "trade", visibleFrom: null, visibleTo: null },
              { id: "panel-2", symbol: "DEMOA", timeframe: "1h", rangePreset: "post", visibleFrom: null, visibleTo: null },
              { id: "panel-3", symbol: "DEMOA", timeframe: "1d", rangePreset: "trade", visibleFrom: null, visibleTo: null },
            ],
            version: 3,
          },
        }),
      });
      return;
    }
    if (route.request().method() === "PUT") {
      const putBody = route.request().postDataJSON() as { layoutMode?: string; panels?: unknown[] };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          layout: {
            id: "marker-freshness-layout",
            groupKey: "demo-closed-trade-a",
            layoutMode: putBody.layoutMode ?? "one-plus-two",
            panels: putBody.panels ?? [],
            version: 4,
          },
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.route("**/api/market/candles**", async (route) => {
    const url = new URL(route.request().url());
    const symbol = (url.searchParams.get("symbol") ?? "DEMOA").toUpperCase();
    const timeframe = url.searchParams.get("timeframe") ?? "5m";
    if (timeframe === "1h") await oneHourCandlesRelease;
    const candles = timeframe === "1h" ? oneHourCandles : fiveMinuteCandles;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        symbol,
        timeframe,
        source: "cache",
        candles,
        metadata: {
          requestedRange: null,
          returnedRange: { from: candles[0].time, to: candles.at(-1)?.time ?? candles[0].time },
          barIntervalSeconds: timeframe === "1h" ? 3600 : 300,
          limit: 30000,
          truncated: false,
          warnings: [],
        },
      }),
    });
  });
  await page.route("**/api/closed-trades/*/annotations", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ annotations: [], version: 3, updatedAt: "2026-06-26T00:00:00.000Z" }),
      });
      return;
    }
    if (route.request().method() === "PUT") {
      const putBody = route.request().postDataJSON() as typeof annotationPutBodies[number];
      annotationPutBodies.push(putBody);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ annotations: putBody.annotations ?? [], version: 4, updatedAt: "2026-06-26T00:01:00.000Z" }),
      });
      return;
    }
    await route.continue();
  });

  try {
    await signIn(page);
    await gotoAndSettle(page, "/trades?symbol=DEMOA");
    const demoClosedTrade = page.getByRole("button", { name: /DEMOA LONG/ }).first();
    await expect(demoClosedTrade).toBeVisible();
    await demoClosedTrade.click();
    await expectFirstCanvasPainted(page);
    await expect(page.getByTitle("Store execution markers")).toBeEnabled();

    await page
      .getByTestId("closed-trade-chart-panel")
      .first()
      .locator('button[title="Switch to 1H"]')
      .click();
    await expect(page.getByTitle("Wait for matching candles on every fill before storing execution markers")).toBeDisabled();
    expect(annotationPutBodies).toHaveLength(0);

    releaseOneHourCandles();
    await expect(page.getByTitle("Store execution markers")).toBeEnabled();
    await page.getByTitle("Store execution markers").click();
    await expect.poll(() => annotationPutBodies.length).toBe(1);

    const annotations = annotationPutBodies[0].annotations ?? [];
    const generatedLines = annotations.filter((annotation) => annotation.type === "execution-line");
    expect(generatedLines).toHaveLength(3);
    expect(generatedLines.every((annotation) => annotation.timeframe === "1h")).toBe(true);
    expect(generatedLines.map((annotation) => annotation.points?.[0]?.time).sort()).toEqual([
      unixSeconds("2026-06-17T13:00:00.000Z"),
      unixSeconds("2026-06-17T14:00:00.000Z"),
      unixSeconds("2026-06-17T16:00:00.000Z"),
    ]);
  } finally {
    await page.unroute("**/api/closed-trades/*/chart-layout");
    await page.unroute("**/api/market/candles**");
    await page.unroute("**/api/closed-trades/*/annotations");
  }

  expect(browserErrors).toEqual([]);
});

test("chart workstation keeps candles painted and avoids drawing saves while timeframe candles reload", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  const fiveMinuteCandles = Array.from({ length: 80 }, (_, index) => {
    const base = 100 + index * 0.08;
    return {
      time: unixSeconds("2026-06-17T12:00:00.000Z") + index * 300,
      open: Number(base.toFixed(2)),
      high: Number((base + 0.9).toFixed(2)),
      low: Number((base - 0.8).toFixed(2)),
      close: Number((base + (index % 2 === 0 ? 0.2 : -0.14)).toFixed(2)),
      volume: 1200 + index * 13,
    };
  });
  const oneHourCandles = Array.from({ length: 36 }, (_, index) => {
    const base = 99 + index * 0.28;
    return {
      time: unixSeconds("2026-06-16T12:00:00.000Z") + index * 3600,
      open: Number(base.toFixed(2)),
      high: Number((base + 1.4).toFixed(2)),
      low: Number((base - 1.1).toFixed(2)),
      close: Number((base + 0.35).toFixed(2)),
      volume: 6200 + index * 97,
    };
  });
  let releaseOneHourCandles!: () => void;
  const oneHourCandlesRelease = new Promise<void>((resolve) => {
    releaseOneHourCandles = resolve;
  });
  const annotationPutBodies: Array<{
    annotations?: Array<{ timeframe?: string | null; type?: string }>;
  }> = [];

  await page.route("**/api/closed-trades/*/chart-layout", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      const groupKey = decodeURIComponent(new URL(request.url()).pathname.split("/").at(-2) ?? "reload-smoothness-group");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          layout: {
            id: "reload-smoothness-layout",
            groupKey,
            layoutMode: "single",
            version: 5,
            panels: [{ id: "panel-1", symbol: "DEMOA", timeframe: "5m", rangePreset: "trade", visibleFrom: null, visibleTo: null }],
          },
        }),
      });
      return;
    }
    if (request.method() === "PUT") {
      const putBody = request.postDataJSON() as { layoutMode?: string; panels?: unknown[] };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          layout: {
            id: "reload-smoothness-layout",
            groupKey: "reload-smoothness-group",
            layoutMode: putBody.layoutMode ?? "single",
            panels: putBody.panels ?? [],
            version: 6,
          },
        }),
      });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/market/candles**", async (route) => {
    const url = new URL(route.request().url());
    const timeframe = url.searchParams.get("timeframe") ?? "5m";
    if (timeframe === "1h") await oneHourCandlesRelease;
    const candles = timeframe === "1h" ? oneHourCandles : fiveMinuteCandles;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        symbol: (url.searchParams.get("symbol") ?? "DEMOA").toUpperCase(),
        timeframe,
        source: "cache",
        candles,
        metadata: {
          requestedRange: null,
          returnedRange: { from: candles[0].time, to: candles.at(-1)?.time ?? candles[0].time },
          barIntervalSeconds: timeframe === "1h" ? 3600 : 300,
          limit: 30000,
          truncated: false,
          warnings: [],
        },
      }),
    });
  });
  await page.route("**/api/closed-trades/*/annotations", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ annotations: [], version: 5, updatedAt: "2026-06-26T00:00:00.000Z" }),
      });
      return;
    }
    if (route.request().method() === "PUT") {
      const putBody = route.request().postDataJSON() as typeof annotationPutBodies[number];
      annotationPutBodies.push(putBody);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ annotations: putBody.annotations ?? [], version: 6, updatedAt: "2026-06-26T00:01:00.000Z" }),
      });
      return;
    }
    await route.continue();
  });

  try {
    await signIn(page);
    await gotoAndSettle(page, "/trades?symbol=DEMOA");
    const demoClosedTrade = page.getByRole("button", { name: /DEMOA LONG/ }).first();
    await expect(demoClosedTrade).toBeVisible();
    await demoClosedTrade.click();
    await expectFirstCanvasPainted(page);
    const paintedBeforeReload = await firstCanvasPaintedPixelCount(page);

    const firstPanel = page.getByTestId("closed-trade-chart-panel").first();
    const firstPlot = firstPanel.getByTestId("closed-trade-chart-plot");
    await expect(firstPlot).toHaveAttribute("data-candle-fresh", "true");
    await firstPanel.locator('button[title="Switch to 1H"]').click();
    await expect(firstPlot).toHaveAttribute("data-candle-fresh", "false");
    await expect(page.getByText("Loading bars...").first()).toBeVisible();
    await expect.poll(() => firstCanvasPaintedPixelCount(page)).toBeGreaterThan(Math.max(100, paintedBeforeReload * 0.7));

    const plotBox = await firstPlot.boundingBox();
    expect(plotBox).toBeTruthy();
    await page.getByTitle("Horizontal").click();
    await page.mouse.click(plotBox!.x + plotBox!.width * 0.62, plotBox!.y + plotBox!.height * 0.45);
    await page.waitForTimeout(800);
    expect(annotationPutBodies).toHaveLength(0);

    releaseOneHourCandles();
    await expect(firstPlot).toHaveAttribute("data-candle-fresh", "true");
    expect(annotationPutBodies).toHaveLength(0);
  } finally {
    await page.unroute("**/api/closed-trades/*/chart-layout");
    await page.unroute("**/api/market/candles**");
    await page.unroute("**/api/closed-trades/*/annotations");
  }

  expect(browserErrors).toEqual([]);
});

test("chart workstation cancels shared candle work only after its final owner releases", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  const candleRequests: string[] = [];
  const gates = new Map<string, { promise: Promise<void>; resolve: () => void }>();
  const allowFulfillFailure = new Set<string>();
  let layoutVersion = 20;

  function gateFor(key: string) {
    const existing = gates.get(key);
    if (existing) return existing;
    let resolve!: () => void;
    const promise = new Promise<void>((nextResolve) => {
      resolve = nextResolve;
    });
    const gate = { promise, resolve };
    gates.set(key, gate);
    return gate;
  }

  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    const aborts: string[] = [];
    Object.defineProperty(window, "__phase9CandleAborts", { value: aborts });
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/api/market/candles") && init?.signal) {
        init.signal.addEventListener("abort", () => aborts.push(url), { once: true });
      }
      return originalFetch(input, init);
    };
  });

  const candleAbortUrls = () => page.evaluate(() =>
    ((window as typeof window & { __phase9CandleAborts?: string[] }).__phase9CandleAborts ?? []).slice(),
  );

  await page.route("**/api/closed-trades/*/chart-layout", async (route) => {
    const request = route.request();
    const groupKey = decodeURIComponent(new URL(request.url()).pathname.split("/").at(-2) ?? "phase9-owner-group");
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          layout: {
            id: "phase9-owner-layout",
            groupKey,
            layoutMode: "two-vertical",
            version: layoutVersion,
            panels: [
              { id: "panel-1", symbol: "DEMOA", timeframe: "5m", rangePreset: "trade", visibleFrom: null, visibleTo: null },
              { id: "panel-2", symbol: "DEMOA", timeframe: "5m", rangePreset: "trade", visibleFrom: null, visibleTo: null },
            ],
          },
        }),
      });
      return;
    }
    if (request.method() === "PUT") {
      const body = request.postDataJSON() as { layoutMode?: string; panels?: ChartPanelLayout[] };
      layoutVersion += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          layout: {
            id: "phase9-owner-layout",
            groupKey,
            layoutMode: body.layoutMode ?? "two-vertical",
            panels: body.panels ?? [],
            version: layoutVersion,
          },
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.route("**/api/market/candles**", async (route) => {
    const url = new URL(route.request().url());
    const symbol = (url.searchParams.get("symbol") ?? "DEMOA").toUpperCase();
    const timeframe = url.searchParams.get("timeframe") ?? "5m";
    const key = `${symbol}:${timeframe}`;
    candleRequests.push(key);

    if (key === "DEMOA:1h") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          symbol,
          timeframe,
          source: null,
          candles: [],
          metadata: {
            requestedRange: null,
            returnedRange: null,
            barIntervalSeconds: null,
            limit: 30000,
            truncated: false,
            warnings: ["Forced provider failure; no candle data returned."],
          },
        }),
      });
      return;
    }

    await gateFor(key).promise;
    const interval = timeframe === "15m" ? 900 : timeframe === "1h" ? 3600 : 300;
    const candles = Array.from({ length: 60 }, (_, index) => {
      const base = 100 + index * 0.12;
      return {
        time: unixSeconds("2026-06-17T12:00:00.000Z") + index * interval,
        open: base,
        high: base + 0.8,
        low: base - 0.7,
        close: base + 0.2,
        volume: 1000 + index,
      };
    });
    try {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          symbol,
          timeframe,
          source: timeframe === "15m" ? "cache" : "yahoo",
          cacheKind: timeframe === "15m" ? "derived-5m" : "native",
          candles,
          metadata: {
            requestedRange: null,
            returnedRange: { from: candles[0].time, to: candles.at(-1)?.time ?? candles[0].time },
            barIntervalSeconds: interval,
            limit: 30000,
            truncated: false,
            warnings: [],
          },
        }),
      });
    } catch (error) {
      if (!allowFulfillFailure.has(key)) throw error;
    }
  });

  try {
    await signIn(page);
    await gotoAndSettle(page, "/trades?symbol=DEMOA");
    const trade = page.getByRole("button", { name: /DEMOA LONG/ }).first();
    await expect(trade).toBeVisible();
    await trade.click();

    const panels = page.getByTestId("closed-trade-chart-panel");
    await expect(panels).toHaveCount(2);
    await expect.poll(() => candleRequests.filter((key) => key === "DEMOA:5m").length).toBe(1);
    await page.waitForTimeout(350);

    await panels.nth(0).locator('button[title="Switch to 15M"]').click();
    await expect.poll(() => candleRequests.filter((key) => key === "DEMOA:15m").length).toBe(1);
    await page.waitForTimeout(250);
    expect((await candleAbortUrls()).filter((url) => url.includes("timeframe=5m"))).toHaveLength(0);

    await panels.nth(1).locator('button[title="Switch to 15M"]').click();
    await expect.poll(async () => (await candleAbortUrls()).filter((url) => url.includes("timeframe=5m")).length).toBe(1);
    allowFulfillFailure.add("DEMOA:5m");
    gateFor("DEMOA:5m").resolve();
    await page.waitForTimeout(150);
    await expect(panels.nth(0)).toHaveAttribute("data-timeframe", "15m");
    await expect(panels.nth(0).getByTestId("closed-trade-chart-plot")).toHaveAttribute("data-candle-fresh", "false");

    const compareInput = panels.nth(0).getByLabel("Compare symbol");
    await compareInput.fill("DEMOB");
    await compareInput.blur();
    await expect.poll(() => candleRequests.filter((key) => key === "DEMOB:15m").length).toBe(1);
    await compareInput.fill("");
    await compareInput.blur();
    await expect.poll(async () => (await candleAbortUrls()).filter((url) => url.includes("symbol=DEMOB")).length).toBe(1);
    expect((await candleAbortUrls()).filter((url) => url.includes("symbol=DEMOA") && url.includes("timeframe=15m"))).toHaveLength(0);
    allowFulfillFailure.add("DEMOB:15m");
    gateFor("DEMOB:15m").resolve();

    const symbolInput = panels.nth(0).getByRole("textbox", { name: "Symbol", exact: true });
    await symbolInput.fill("DEMOC");
    await symbolInput.press("Enter");
    await expect.poll(() => candleRequests.filter((key) => key === "DEMOC:15m").length).toBe(1);
    await symbolInput.fill("DEMOA");
    await symbolInput.press("Enter");
    await expect.poll(async () => (await candleAbortUrls()).filter((url) => url.includes("symbol=DEMOC")).length).toBe(1);
    expect(candleRequests.filter((key) => key === "DEMOA:15m")).toHaveLength(1);
    allowFulfillFailure.add("DEMOC:15m");
    gateFor("DEMOC:15m").resolve();

    gateFor("DEMOA:15m").resolve();
    for (let index = 0; index < 2; index += 1) {
      const plot = panels.nth(index).getByTestId("closed-trade-chart-plot");
      await expect(plot).toHaveAttribute("data-candle-fresh", "true");
      await expect.poll(async () => Number(await panels.nth(index).getByTestId("chart-panel-bar-count").getAttribute("data-candle-count"))).toBeGreaterThan(0);
    }
    await expect(panels.nth(0).getByTestId("chart-panel-source")).toHaveText("5M-DERIVED");

    const retainedCount = await panels.nth(0).getByTestId("chart-panel-bar-count").getAttribute("data-candle-count");
    await panels.nth(0).locator('button[title="Switch to 1H"]').click();
    await expect(panels.nth(0).getByTestId("closed-trade-chart-plot")).toHaveAttribute("data-candle-fresh", "false");
    await expect(panels.nth(0).getByTestId("chart-panel-bar-count")).toHaveAttribute("data-candle-count", retainedCount ?? "60");
    await expect(panels.nth(0).getByTestId("chart-warning")).toContainText("Forced provider failure; no candle data returned.");
    await expectFirstCanvasPainted(page);

    await panels.nth(0).locator('button[title="Switch to 15M"]').click();
    await expect(panels.nth(0).getByTestId("closed-trade-chart-plot")).toHaveAttribute("data-candle-fresh", "true");
    await expectChartSavesSettled(page);
  } finally {
    for (const [key, gate] of gates) {
      allowFulfillFailure.add(key);
      gate.resolve();
    }
    await page.unroute("**/api/closed-trades/*/chart-layout");
    await page.unroute("**/api/market/candles**");
  }

  expect(browserErrors).toEqual([]);
});

test("chart workstation waits for saved layout before loading candles", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  const fixtureCandles = [
    {
      time: unixSeconds("2026-06-17T13:35:00.000Z"),
      open: 100.9,
      high: 101.5,
      low: 100.75,
      close: 101.05,
      volume: 1200,
    },
    {
      time: unixSeconds("2026-06-17T13:40:00.000Z"),
      open: 101.05,
      high: 103.2,
      low: 100.95,
      close: 102.8,
      volume: 1600,
    },
  ];
  let releaseLayout!: () => void;
  const layoutGate = new Promise<void>((resolve) => {
    releaseLayout = resolve;
  });
  let layoutGetCount = 0;
  const candleRequests: string[] = [];

  await page.route("**/api/closed-trades/*/chart-layout", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    layoutGetCount += 1;
    const groupKey = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-2) ?? "delayed-layout-group");
    await layoutGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        layout: {
          id: "delayed-layout",
          groupKey,
          layoutMode: "single",
          version: 17,
          panels: [{ id: "panel-1", symbol: "DEMOA", timeframe: "15m", rangePreset: "trade", visibleFrom: null, visibleTo: null }],
        },
      }),
    });
  });

  await page.route("**/api/market/candles**", async (route) => {
    candleRequests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        symbol: "DEMOA",
        source: "cache",
        candles: fixtureCandles,
        metadata: {
          requestedRange: null,
          returnedRange: { from: fixtureCandles[0].time, to: fixtureCandles.at(-1)?.time ?? fixtureCandles[0].time },
          barIntervalSeconds: 300,
          limit: 30000,
          truncated: false,
          warnings: [],
        },
      }),
    });
  });

  try {
    await signIn(page);
    await page.goto("/trades?symbol=DEMOA", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /DEMOA LONG/ }).first()).toBeVisible();
    await expect.poll(() => layoutGetCount).toBe(1);
    await page.waitForTimeout(500);
    expect(candleRequests).toEqual([]);

    releaseLayout();
    await expect(page.getByLabel("Timeframe").first()).toHaveValue("15M");
    await expect.poll(() => candleRequests.length).toBe(1);
    expect(new URL(candleRequests[0]).searchParams.get("timeframe")).toBe("15m");
    await expectFirstCanvasPainted(page);
  } finally {
    await page.unroute("**/api/closed-trades/*/chart-layout");
    await page.unroute("**/api/market/candles**");
  }

  expect(browserErrors).toEqual([]);
});

test("chart workstation derives 15M candles from the seeded 5M cache", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  let layoutVersion = 40;
  let layoutMode = "one-plus-two";
  let layoutPanels: ChartPanelLayout[] = [
    { id: "panel-1", symbol: "DEMOA", timeframe: "5m", rangePreset: "trade", visibleFrom: null, visibleTo: null },
    { id: "panel-2", symbol: "DEMOA", timeframe: "1h", rangePreset: "post", visibleFrom: null, visibleTo: null },
    { id: "panel-3", symbol: "DEMOA", timeframe: "1d", rangePreset: "trade", visibleFrom: null, visibleTo: null },
  ];

  await page.route("**/api/closed-trades/*/chart-layout", async (route) => {
    const request = route.request();
    const groupKey = decodeURIComponent(new URL(request.url()).pathname.split("/").at(-2) ?? "derived-15m-group");
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          layout: {
            id: "derived-15m-layout",
            groupKey,
            layoutMode,
            panels: layoutPanels,
            version: layoutVersion,
          },
        }),
      });
      return;
    }
    if (request.method() === "PUT") {
      const body = request.postDataJSON() as { layoutMode?: string; panels?: ChartPanelLayout[] };
      layoutMode = body.layoutMode ?? layoutMode;
      layoutPanels = body.panels ?? layoutPanels;
      layoutVersion += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          layout: {
            id: "derived-15m-layout",
            groupKey,
            layoutMode,
            panels: layoutPanels,
            version: layoutVersion,
          },
        }),
      });
      return;
    }
    await route.continue();
  });

  try {
    await signIn(page);
    await gotoAndSettle(page, `/trades?account=${demoAccountCode}&symbol=DEMOA`);
    const trade = page.locator('button[data-account-code="DEMO-WORKSTATION"]').filter({ hasText: /DEMOA/ }).first();
    const groupKey = await trade.getAttribute("data-group-key");
    expect(groupKey).toBeTruthy();
    await trade.click();
    await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", groupKey!);

    const panel = page.getByTestId("closed-trade-chart-panel").first();
    const plot = panel.getByTestId("closed-trade-chart-plot");
    await expect(panel).toHaveAttribute("data-timeframe", "5m");
    await expect(plot).toHaveAttribute("data-candle-fresh", "true", { timeout: 15_000 });
    const responsePromise = page.waitForResponse(
      (response) => response.url().includes("/api/market/candles") && response.url().includes("timeframe=15m"),
    );

    await panel.locator('button[title="Switch to 15M"]').click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const payload = await response.json() as {
      candles?: Array<{ time?: number }>;
      metadata?: {
        barIntervalSeconds?: number | null;
        coverage?: { status?: string; profile?: string | null; missingBars?: number; scanExhausted?: boolean } | null;
        warnings?: string[];
      };
      source?: string | null;
      cacheKind?: string | null;
      timeframe?: string;
    };
    expect(payload.timeframe).toBe("15m");
    expect(payload.source).toBe("cache");
    expect(payload.cacheKind).toBe("derived-5m");
    expect(payload.candles?.length ?? 0).toBeGreaterThan(0);
    expect(payload.metadata?.barIntervalSeconds).toBe(15 * 60);
    expect(payload.metadata?.coverage).toMatchObject({
      status: "complete",
      profile: "US_EQUITIES_CORE_V1",
      missingBars: 0,
      scanExhausted: false,
    });
    expect(payload.metadata?.warnings ?? []).not.toEqual(expect.arrayContaining([
      expect.stringContaining("missing"),
      expect.stringContaining("provider"),
      expect.stringContaining("requested range"),
    ]));
    await expect(panel).toHaveAttribute("data-timeframe", "15m");
    await expect(plot).toHaveAttribute("data-candle-fresh", "true");
    await expect(panel.getByTestId("chart-panel-source")).toHaveText("5M-DERIVED");
    await expect.poll(async () => Number(await panel.getByTestId("chart-panel-bar-count").getAttribute("data-candle-count"))).toBeGreaterThan(0);
    await expect(panel.getByTestId("chart-warning")).not.toContainText("No candles returned");
    await expectFirstCanvasPainted(page);
    await expectChartSavesSettled(page);

    await panel.locator('button[title="Switch to 1H"]').click();
    await expect(panel).toHaveAttribute("data-timeframe", "1h");
    await expect(plot).toHaveAttribute("data-candle-fresh", "true");
    await panel.locator('button[title="Switch to 15M"]').click();
    await expect(panel).toHaveAttribute("data-timeframe", "15m");
    await expect(plot).toHaveAttribute("data-candle-fresh", "true");
    await panel.getByRole("button", { name: "1M", exact: true }).click();
    await expect(panel.getByRole("button", { name: "1M", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(plot).toHaveAttribute("data-candle-fresh", "true");
    await expectChartSavesSettled(page);

    const barCountBeforeFocus = Number(await panel.getByTestId("chart-panel-bar-count").getAttribute("data-candle-count"));
    const overlayCountBeforeFocus = await page.locator('[data-testid="execution-overlay-label"][data-panel-id="panel-1"]').count();
    expect(barCountBeforeFocus).toBeGreaterThan(0);
    expect(overlayCountBeforeFocus).toBeGreaterThan(0);
    const focusToggle = page.getByTestId("chart-panel-focus-toggle");
    await focusToggle.click();
    await expect(focusToggle).toContainText("Show all");
    await expect(panel.getByTestId("chart-panel-bar-count")).toHaveAttribute("data-candle-count", String(barCountBeforeFocus));
    await focusToggle.click();
    await expect(focusToggle).toContainText("Focus");

    await gotoAndSettle(page, `/trades?account=${demoAccountCode}&symbol=DEMOA&groupKey=${encodeURIComponent(groupKey!)}`);
    const reloadedPanel = page.getByTestId("closed-trade-chart-panel").first();
    await expect(reloadedPanel).toHaveAttribute("data-timeframe", "15m");
    await expect(reloadedPanel.getByRole("button", { name: "1M", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(reloadedPanel.getByTestId("closed-trade-chart-plot")).toHaveAttribute("data-candle-fresh", "true");
    await expect(reloadedPanel.getByTestId("chart-panel-source")).toHaveText("5M-DERIVED");
    await expect(reloadedPanel.getByTestId("chart-panel-bar-count")).toHaveAttribute("data-candle-count", String(barCountBeforeFocus));
    await expect(page.locator('[data-testid="execution-overlay-label"][data-panel-id="panel-1"]')).toHaveCount(overlayCountBeforeFocus);
    await expectFirstCanvasPainted(page);

    await gotoAndSettle(page, `/trades?account=${demoAccountCode}`);
    const demoCTrade = page.locator('button[data-account-code="DEMO-WORKSTATION"]').filter({ hasText: /DEMOC/ }).first();
    await expect(demoCTrade).toBeVisible();
    const demoCGroupKey = await demoCTrade.getAttribute("data-group-key");
    expect(demoCGroupKey).toBeTruthy();
    layoutPanels = [
      { id: "panel-1", symbol: "DEMOC", timeframe: "5m", rangePreset: "trade", visibleFrom: null, visibleTo: null },
      { id: "panel-2", symbol: "DEMOC", timeframe: "1h", rangePreset: "post", visibleFrom: null, visibleTo: null },
      { id: "panel-3", symbol: "DEMOC", timeframe: "1d", rangePreset: "trade", visibleFrom: null, visibleTo: null },
    ];
    await demoCTrade.click();
    await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", demoCGroupKey!);
    const demoCPanel = page.getByTestId("closed-trade-chart-panel").first();
    const demoCSymbolInput = demoCPanel.getByRole("textbox", { name: "Symbol", exact: true });
    await expect(demoCSymbolInput).toBeEnabled();
    await demoCSymbolInput.fill("DEMOC");
    await demoCSymbolInput.press("Enter");
    await expect(demoCSymbolInput).toHaveValue("DEMOC");
    const demoCResponsePromise = page.waitForResponse(
      (candidate) => candidate.url().includes("/api/market/candles") && candidate.url().includes("symbol=DEMOC") && candidate.url().includes("timeframe=15m"),
    );
    await demoCPanel.locator('button[title="Switch to 15M"]').click();
    const demoCResponse = await demoCResponsePromise;
    const demoCPayload = await demoCResponse.json() as {
      cacheKind?: string | null;
      candles?: unknown[];
      source?: string | null;
      metadata?: {
        coverage?: { status?: string; profile?: string | null; missingBars?: number; scanExhausted?: boolean } | null;
        warnings?: string[];
      };
    };
    expect(demoCPayload).toMatchObject({ source: "cache", cacheKind: "derived-5m" });
    expect(demoCPayload.candles?.length ?? 0).toBeGreaterThan(0);
    expect(demoCPayload.metadata?.coverage).toMatchObject({
      status: "complete",
      profile: "US_EQUITIES_CORE_V1",
      missingBars: 0,
      scanExhausted: false,
    });
    expect(demoCPayload.metadata?.warnings ?? []).not.toEqual(expect.arrayContaining([
      expect.stringContaining("missing"),
      expect.stringContaining("provider"),
      expect.stringContaining("requested range"),
    ]));
    await expect(demoCPanel).toHaveAttribute("data-timeframe", "15m");
    await expect(demoCPanel.getByTestId("closed-trade-chart-plot")).toHaveAttribute("data-candle-fresh", "true");
    await expect(demoCPanel.getByTestId("chart-panel-source")).toHaveText("5M-DERIVED");
    await expect.poll(async () => Number(await demoCPanel.getByTestId("chart-panel-bar-count").getAttribute("data-candle-count"))).toBeGreaterThan(0);
    const demoCOverlays = page.locator('[data-testid="execution-overlay-label"][data-panel-id="panel-1"]');
    await expect(demoCOverlays).toHaveCount(3);
    await demoCPanel.locator('button[title="Switch to 1H"]').click();
    await expect(demoCPanel).toHaveAttribute("data-timeframe", "1h");
    await expect(demoCPanel.getByTestId("closed-trade-chart-plot")).toHaveAttribute("data-candle-fresh", "true");
    await expect(demoCOverlays).toHaveCount(3);
    await demoCPanel.locator('button[title="Switch to 5M"]').click();
    await expect(demoCPanel).toHaveAttribute("data-timeframe", "5m");
    await expect(demoCPanel.getByTestId("closed-trade-chart-plot")).toHaveAttribute("data-candle-fresh", "true");
    await expect(demoCOverlays).toHaveCount(3);
    await expectFirstCanvasPainted(page);
    await expectChartSavesSettled(page);
  } finally {
    await page.unroute("**/api/closed-trades/*/chart-layout");
  }

  expect(browserErrors).toEqual([]);
});

test("chart workstation persists layout reset state and locks drawings on stale conflicts", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  const demoBCandles = [
    {
      time: unixSeconds("2026-06-18T13:00:00.000Z"),
      open: 63.2,
      high: 63.6,
      low: 62.2,
      close: 62.4,
      volume: 2400,
    },
    {
      time: unixSeconds("2026-06-18T15:00:00.000Z"),
      open: 61.4,
      high: 61.8,
      low: 60.7,
      close: 60.9,
      volume: 2600,
    },
  ];
  await page.route("**/api/market/candles**", async (route) => {
    const url = new URL(route.request().url());
    const symbol = (url.searchParams.get("symbol") ?? "DEMOB").toUpperCase();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        symbol,
        source: "cache",
        candles: demoBCandles,
        metadata: {
          requestedRange: null,
          returnedRange: { from: demoBCandles[0].time, to: demoBCandles.at(-1)?.time ?? demoBCandles[0].time },
          barIntervalSeconds: 3600,
          limit: 30000,
          truncated: false,
          warnings: [],
        },
      }),
    });
  });

  await signIn(page);
  await gotoAndSettle(page, "/trades?symbol=DEMOB");
  const demoClosedTrade = page.getByRole("button", { name: /DEMOB LONG/ }).first();
  await expect(demoClosedTrade).toBeVisible();
  const groupKey = await demoClosedTrade.getAttribute("data-group-key");
  expect(groupKey).toBeTruthy();
  await demoClosedTrade.click();
  await expectFirstCanvasPainted(page);

  const layoutPath = `/api/closed-trades/${encodeURIComponent(groupKey!)}/chart-layout`;
  await page.getByTitle("1+2").click();
  await page.getByTitle("Switch to 1H").first().click();
  await expect
    .poll(async () => {
      const response = await page.request.get(layoutPath);
      const payload = await response.json();
      return `${payload.layout?.layoutMode ?? ""}:${payload.layout?.panels?.[0]?.timeframe ?? ""}`;
    })
    .toBe("one-plus-two:1h");

  await gotoAndSettle(page, "/trades?symbol=DEMOB");
  const reloadedTrade = page.getByRole("button", { name: /DEMOB LONG/ }).first();
  await expect(reloadedTrade).toBeVisible();
  await reloadedTrade.click();
  await expect(page.getByLabel("Timeframe").first()).toHaveValue("1H");

  const layoutResponse = await page.request.get(layoutPath);
  const layoutPayload = await layoutResponse.json();
  const seededPanels = layoutPayload.layout.panels.map((panel: Record<string, unknown>, index: number) => ({
    ...panel,
    compareSymbol: null,
    symbol: "DEMOB",
    visibleFrom: index === 0 ? 1_000 : panel.visibleFrom,
    visibleTo: index === 0 ? 2_000 : panel.visibleTo,
  }));
  const seedResponse = await page.request.put(layoutPath, {
    data: {
      layoutMode: layoutPayload.layout.layoutMode,
      panels: seededPanels,
      version: layoutPayload.layout.version,
    },
  });
  expect(seedResponse.ok()).toBe(true);

  await gotoAndSettle(page, "/trades?symbol=DEMOB");
  const resetTrade = page.getByRole("button", { name: /DEMOB LONG/ }).first();
  await expect(resetTrade).toBeVisible();
  await resetTrade.click();
  await page.getByRole("button", { name: "Reset" }).click();
  await expect
    .poll(async () => {
      const response = await page.request.get(layoutPath);
      const payload = await response.json();
      const firstPanel = payload.layout?.panels?.[0];
      return `${firstPanel?.visibleFrom ?? "null"}:${firstPanel?.visibleTo ?? "null"}`;
    })
    .toBe("null:null");

  await page.route("**/api/closed-trades/*/annotations", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "Cannot edit a stale closed trade." }),
    });
  });
  await expect(page.getByTitle("Store execution markers")).toBeEnabled();
  await page.getByTitle("Store execution markers").click();
  await expect(page.getByText("Stale trade: drawings read-only.").first()).toBeVisible();
  await expect(page.getByText("Read-only").first()).toBeVisible();
  await expect(page.getByTitle("Horizontal")).toBeDisabled();
  await page.unroute("**/api/closed-trades/*/annotations");
  await page.unroute("**/api/market/candles**");

  expect(browserErrors).toEqual([]);
});

test("chart workstation persists panned visible range, restores it, and keeps it through Focus/Show all", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  const fiveMinuteCandles = Array.from({ length: 120 }, (_, index) => {
    const base = 100 + index * 0.11;
    return {
      time: unixSeconds("2026-06-17T12:00:00.000Z") + index * 300,
      open: Number(base.toFixed(2)),
      high: Number((base + 1.1).toFixed(2)),
      low: Number((base - 1).toFixed(2)),
      close: Number((base + (index % 2 === 0 ? 0.18 : -0.12)).toFixed(2)),
      volume: 1400 + index * 7,
    };
  });
  const oneHourCandles = Array.from({ length: 72 }, (_, index) => {
    const base = 96 + index * 0.35;
    return {
      time: unixSeconds("2026-06-15T00:00:00.000Z") + index * 3600,
      open: Number(base.toFixed(2)),
      high: Number((base + 1.7).toFixed(2)),
      low: Number((base - 1.5).toFixed(2)),
      close: Number((base + 0.4).toFixed(2)),
      volume: 7000 + index * 31,
    };
  });
  const dailyCandles = Array.from({ length: 90 }, (_, index) => {
    const base = 80 + index * 0.42;
    return {
      time: unixSeconds("2026-03-30T00:00:00.000Z") + index * 86_400,
      open: Number(base.toFixed(2)),
      high: Number((base + 2.8).toFixed(2)),
      low: Number((base - 2.2).toFixed(2)),
      close: Number((base + 0.7).toFixed(2)),
      volume: 85_000 + index * 250,
    };
  });
  const layoutPanels: ChartPanelLayout[] = [
    { id: "panel-1", symbol: "DEMOA", timeframe: "5m", compareSymbol: null, rangePreset: "trade", visibleFrom: null, visibleTo: null },
    { id: "panel-2", symbol: "DEMOA", timeframe: "1h", compareSymbol: null, rangePreset: "post", visibleFrom: null, visibleTo: null },
    { id: "panel-3", symbol: "DEMOA", timeframe: "1d", compareSymbol: null, rangePreset: "trade", visibleFrom: null, visibleTo: null },
  ];
  const firstPanelHasVisibleRange = (body: { panels?: Array<{ id?: string; visibleFrom?: unknown; visibleTo?: unknown }> }) => {
    const firstPanel = body.panels?.find((panel) => panel.id === "panel-1") ?? body.panels?.[0];
    return typeof firstPanel?.visibleFrom === "number" && typeof firstPanel.visibleTo === "number";
  };
  let visibleRangeLayoutPutCount = 0;

  await signIn(page);
  await gotoAndSettle(page, `/trades?account=${demoAccountCode}&symbol=DEMOA`);
  const demoClosedTrade = page.getByRole("button", { name: /DEMOA LONG/ }).first();
  await expect(demoClosedTrade).toBeVisible();
  const groupKey = await demoClosedTrade.getAttribute("data-group-key");
  expect(groupKey).toBeTruthy();
  const layoutPath = `/api/closed-trades/${encodeURIComponent(groupKey!)}/chart-layout`;
  const existingLayoutResponse = await page.request.get(layoutPath);
  expect(existingLayoutResponse.ok()).toBe(true);
  const existingLayout = (await existingLayoutResponse.json()) as ChartLayoutPayload;
  const resetLayoutResponse = await page.request.put(layoutPath, {
    data: {
      layoutMode: "one-plus-two",
      panels: layoutPanels,
      version: existingLayout.layout?.version ?? 1,
    },
  });
  expect(resetLayoutResponse.ok()).toBe(true);

  await page.route("**/api/market/candles**", async (route) => {
    const url = new URL(route.request().url());
    const symbol = (url.searchParams.get("symbol") ?? "DEMOA").toUpperCase();
    const timeframe = url.searchParams.get("timeframe") ?? "5m";
    const candles = timeframe === "1h" ? oneHourCandles : timeframe === "1d" ? dailyCandles : fiveMinuteCandles;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        symbol,
        timeframe,
        source: "cache",
        candles,
        metadata: {
          requestedRange: null,
          returnedRange: { from: candles[0].time, to: candles.at(-1)?.time ?? candles[0].time },
          barIntervalSeconds: timeframe === "1h" ? 3600 : timeframe === "1d" ? 86_400 : 300,
          limit: 30000,
          truncated: false,
          warnings: [],
        },
      }),
    });
  });
  await page.route("**/api/closed-trades/*/chart-layout", async (route) => {
    if (route.request().method() === "PUT" && route.request().url().includes(layoutPath)) {
      const body = route.request().postDataJSON() as { panels?: Array<{ id?: string; visibleFrom?: unknown; visibleTo?: unknown }> };
      if (firstPanelHasVisibleRange(body)) {
        visibleRangeLayoutPutCount += 1;
      }
    }
    await route.continue();
  });

  try {
    await gotoAndSettle(page, `/trades?account=${demoAccountCode}&symbol=DEMOA&groupKey=${encodeURIComponent(groupKey!)}`);
    const selectedTrade = page.locator(`button[data-group-key="${groupKey}"]`).first();
    await expect(selectedTrade).toBeVisible();
    await selectedTrade.click();
    await expectFirstCanvasPainted(page);
    await expect.poll(async () => (await firstPanelVisibleRange(page)).ready).toBe(true);
    await expect(page.getByText(layoutSaveBusyPattern)).toHaveCount(0);

    const initialRange = await firstPanelVisibleRange(page);
    const initialGeometry = await executionOverlayGeometrySnapshot(page);
    expect(initialRange.from).not.toBeNull();
    expect(initialRange.to).not.toBeNull();
    expect(executionOverlayGeometryReady(initialGeometry)).toBe(true);

    const visibleRangeSaveRequest = page.waitForRequest((request) => {
      if (request.method() !== "PUT" || !request.url().includes(layoutPath)) return false;
      return firstPanelHasVisibleRange(request.postDataJSON() as { panels?: Array<{ id?: string; visibleFrom?: unknown; visibleTo?: unknown }> });
    });
    const visibleRangeSaveResponse = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().includes(layoutPath));
    await panFirstChart(page);
    const workspace = page.getByTestId("closed-trade-chart-workspace");
    const firstPlot = page.getByTestId("closed-trade-chart-panel").first().getByTestId("closed-trade-chart-plot");
    const firstPlotBox = await firstPlot.boundingBox();
    expect(firstPlotBox).toBeTruthy();
    await page.getByTitle("Horizontal").click();
    await page.mouse.click(firstPlotBox!.x + firstPlotBox!.width * 0.2, firstPlotBox!.y + firstPlotBox!.height * 0.4);
    await expect(workspace).toHaveAttribute("data-annotation-save-state", "queued");
    await page.waitForTimeout(250);
    await expect(workspace).toHaveAttribute("data-layout-save-state", "clean");

    const saveRequest = await visibleRangeSaveRequest;
    const saveBody = saveRequest.postDataJSON() as { panels?: ChartPanelLayout[] };
    const savedFirstPanel = saveBody.panels?.find((panel) => panel.id === "panel-1") ?? saveBody.panels?.[0];
    expect(savedFirstPanel?.visibleFrom).toEqual(expect.any(Number));
    expect(savedFirstPanel?.visibleTo).toEqual(expect.any(Number));
    expect(`${savedFirstPanel?.visibleFrom}:${savedFirstPanel?.visibleTo}`).not.toBe(`${initialRange.from}:${initialRange.to}`);
    await expect.poll(async () => visibleRangesClose(await firstPanelVisibleRange(page), savedFirstPanel ?? {})).toBe(true);
    const saveResponse = await visibleRangeSaveResponse;
    expect(saveResponse.ok()).toBe(true);
    await expectChartSavesSettled(page);
    await expect.poll(() => visibleRangeLayoutPutCount).toBe(1);
    await page.waitForTimeout(900);
    expect(visibleRangeLayoutPutCount).toBe(1);

    await expect
      .poll(async () => {
        const response = await page.request.get(layoutPath);
        const payload = (await response.json()) as ChartLayoutPayload;
        const firstPanel = payload.layout?.panels.find((panel) => panel.id === "panel-1");
        return `${firstPanel?.visibleFrom ?? "null"}:${firstPanel?.visibleTo ?? "null"}`;
      })
      .toBe(`${savedFirstPanel?.visibleFrom}:${savedFirstPanel?.visibleTo}`);
    await expect.poll(async () => visibleRangesClose(await firstPanelVisibleRange(page), savedFirstPanel ?? {})).toBe(true);

    await gotoAndSettle(page, `/trades?account=${demoAccountCode}&symbol=DEMOA&groupKey=${encodeURIComponent(groupKey!)}`);
    const reloadedTrade = page.locator(`button[data-group-key="${groupKey}"]`).first();
    await expect(reloadedTrade).toBeVisible();
    await reloadedTrade.click();
    await expectFirstCanvasPainted(page);
    await expect.poll(async () => visibleRangesClose(await firstPanelVisibleRange(page), savedFirstPanel ?? {})).toBe(true);

    const focusToggle = page.getByTestId("chart-panel-focus-toggle");
    await expect(focusToggle).toBeEnabled();
    await focusToggle.click();
    await expect(focusToggle).toContainText("Show all");
    await expect.poll(async () => visibleRangesClose(await firstPanelVisibleRange(page), savedFirstPanel ?? {})).toBe(true);
    await focusToggle.click();
    await expect(focusToggle).toContainText("Focus");
    await expect.poll(async () => visibleRangesClose(await firstPanelVisibleRange(page), savedFirstPanel ?? {})).toBe(true);
    await expectChartSavesSettled(page);
    await expect
      .poll(async () => {
        const response = await page.request.get(layoutPath);
        const payload = (await response.json()) as ChartLayoutPayload;
        const firstPanel = payload.layout?.panels.find((panel) => panel.id === "panel-1");
        return `${firstPanel?.visibleFrom ?? "null"}:${firstPanel?.visibleTo ?? "null"}`;
      })
      .toBe(`${savedFirstPanel?.visibleFrom}:${savedFirstPanel?.visibleTo}`);

    const flushedRangeBeforeLayoutRequest = page.waitForRequest((request) => {
      if (request.method() !== "PUT" || !request.url().includes(layoutPath)) return false;
      const body = request.postDataJSON() as { layoutMode?: string; panels?: Array<{ id?: string; visibleFrom?: unknown; visibleTo?: unknown }> };
      return body.layoutMode === "single" && firstPanelHasVisibleRange(body);
    });
    const flushedRangeBeforeLayoutResponse = page.waitForResponse(
      (response) => response.request().method() === "PUT" && response.url().includes(layoutPath),
    );
    await panFirstChart(page);
    await page.locator('button[title="1"]').click();
    const flushedRequest = await flushedRangeBeforeLayoutRequest;
    const flushedBody = flushedRequest.postDataJSON() as { layoutMode?: string; panels?: ChartPanelLayout[] };
    const flushedFirstPanel = flushedBody.panels?.find((panel) => panel.id === "panel-1") ?? flushedBody.panels?.[0];
    expect(flushedBody.layoutMode).toBe("single");
    expect(flushedFirstPanel?.visibleFrom).toEqual(expect.any(Number));
    expect(flushedFirstPanel?.visibleTo).toEqual(expect.any(Number));
    expect(`${flushedFirstPanel?.visibleFrom}:${flushedFirstPanel?.visibleTo}`).not.toBe(
      `${savedFirstPanel?.visibleFrom}:${savedFirstPanel?.visibleTo}`,
    );
    expect((await flushedRangeBeforeLayoutResponse).ok()).toBe(true);
    await expectChartSavesSettled(page);
  } finally {
    await page.unroute("**/api/market/candles**");
    await page.unroute("**/api/closed-trades/*/chart-layout");
    await page.unroute("**/api/closed-trades/*/annotations");
  }

  expect(browserErrors).toEqual([]);
});

test("chart workstation does not snap back while panning during focused resize restore", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  const fiveMinuteCandles = Array.from({ length: 120 }, (_, index) => {
    const base = 100 + index * 0.12;
    return {
      time: unixSeconds("2026-06-17T12:00:00.000Z") + index * 300,
      open: Number(base.toFixed(2)),
      high: Number((base + 1.1).toFixed(2)),
      low: Number((base - 1).toFixed(2)),
      close: Number((base + (index % 2 === 0 ? 0.22 : -0.16)).toFixed(2)),
      volume: 1400 + index * 9,
    };
  });
  const oneHourCandles = Array.from({ length: 72 }, (_, index) => {
    const base = 96 + index * 0.4;
    return {
      time: unixSeconds("2026-06-15T00:00:00.000Z") + index * 3600,
      open: Number(base.toFixed(2)),
      high: Number((base + 1.7).toFixed(2)),
      low: Number((base - 1.5).toFixed(2)),
      close: Number((base + 0.4).toFixed(2)),
      volume: 7000 + index * 31,
    };
  });
  const dailyCandles = Array.from({ length: 90 }, (_, index) => {
    const base = 80 + index * 0.45;
    return {
      time: unixSeconds("2026-03-30T00:00:00.000Z") + index * 86_400,
      open: Number(base.toFixed(2)),
      high: Number((base + 2.8).toFixed(2)),
      low: Number((base - 2.2).toFixed(2)),
      close: Number((base + 0.7).toFixed(2)),
      volume: 85_000 + index * 250,
    };
  });
  const visibleRangeLayoutBodies: Array<{ panels?: ChartPanelLayout[] }> = [];
  const firstPanelHasVisibleRange = (body: { panels?: Array<{ id?: string; visibleFrom?: unknown; visibleTo?: unknown }> }) => {
    const firstPanel = body.panels?.find((panel) => panel.id === "panel-1") ?? body.panels?.[0];
    return typeof firstPanel?.visibleFrom === "number" && typeof firstPanel.visibleTo === "number";
  };

  await page.route("**/api/closed-trades/*/chart-layout", async (route) => {
    const request = route.request();
    const groupKey = decodeURIComponent(new URL(request.url()).pathname.split("/").at(-2) ?? "focused-resize-group");
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          layout: {
            id: "focused-resize-layout",
            groupKey,
            layoutMode: "one-plus-two",
            version: 14,
            panels: [
              { id: "panel-1", symbol: "DEMOA", timeframe: "5m", compareSymbol: null, rangePreset: "trade", visibleFrom: null, visibleTo: null },
              { id: "panel-2", symbol: "DEMOA", timeframe: "1h", compareSymbol: null, rangePreset: "post", visibleFrom: null, visibleTo: null },
              { id: "panel-3", symbol: "DEMOA", timeframe: "1d", compareSymbol: null, rangePreset: "trade", visibleFrom: null, visibleTo: null },
            ],
          },
        }),
      });
      return;
    }
    if (request.method() === "PUT") {
      const putBody = request.postDataJSON() as { layoutMode?: string; panels?: ChartPanelLayout[] };
      if (firstPanelHasVisibleRange(putBody)) visibleRangeLayoutBodies.push(putBody);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          layout: {
            id: "focused-resize-layout",
            groupKey,
            layoutMode: putBody.layoutMode ?? "one-plus-two",
            panels: putBody.panels ?? [],
            version: 15 + visibleRangeLayoutBodies.length,
          },
        }),
      });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/market/candles**", async (route) => {
    const url = new URL(route.request().url());
    const timeframe = url.searchParams.get("timeframe") ?? "5m";
    const candles = timeframe === "1h" ? oneHourCandles : timeframe === "1d" ? dailyCandles : fiveMinuteCandles;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        symbol: (url.searchParams.get("symbol") ?? "DEMOA").toUpperCase(),
        timeframe,
        source: "cache",
        candles,
        metadata: {
          requestedRange: null,
          returnedRange: { from: candles[0].time, to: candles.at(-1)?.time ?? candles[0].time },
          barIntervalSeconds: timeframe === "1h" ? 3600 : timeframe === "1d" ? 86_400 : 300,
          limit: 30000,
          truncated: false,
          warnings: [],
        },
      }),
    });
  });
  await page.route("**/api/closed-trades/*/annotations", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ annotations: [], version: 14, updatedAt: "2026-06-26T00:00:00.000Z" }),
      });
      return;
    }
    await route.continue();
  });

  try {
    await signIn(page);
    await gotoAndSettle(page, `/trades?account=${demoAccountCode}&symbol=DEMOA`);
    const demoClosedTrade = page.getByRole("button", { name: /DEMOA LONG/ }).first();
    await expect(demoClosedTrade).toBeVisible();
    await demoClosedTrade.click();
    await expectFirstCanvasPainted(page);
    await expect.poll(async () => (await firstPanelVisibleRange(page)).ready).toBe(true);
    const initialRange = await firstPanelVisibleRange(page);

    const focusToggle = page.getByTestId("chart-panel-focus-toggle");
    await expect(focusToggle).toBeEnabled();
    await focusToggle.click();
    await expect(focusToggle).toContainText("Show all");
    await panFirstChart(page);
    await expect
      .poll(async () => !visibleRangesClose(await firstPanelVisibleRange(page), initialRange, 60))
      .toBe(true);

    await expect.poll(() => visibleRangeLayoutBodies.length).toBe(1);
    const savedFirstPanel = visibleRangeLayoutBodies[0].panels?.find((panel) => panel.id === "panel-1") ?? visibleRangeLayoutBodies[0].panels?.[0];
    expect(savedFirstPanel?.visibleFrom).toEqual(expect.any(Number));
    expect(savedFirstPanel?.visibleTo).toEqual(expect.any(Number));
    await page.waitForTimeout(400);
    const afterDeferredRestores = await firstPanelVisibleRange(page);
    expect(visibleRangesClose(afterDeferredRestores, savedFirstPanel ?? {}, 300)).toBe(true);
    expect(visibleRangesClose(afterDeferredRestores, initialRange, 60)).toBe(false);
  } finally {
    await page.unroute("**/api/closed-trades/*/chart-layout");
    await page.unroute("**/api/market/candles**");
    await page.unroute("**/api/closed-trades/*/annotations");
  }

  expect(browserErrors).toEqual([]);
});

test("chart workstation blocks trade switches while layout saves are pending", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);

  await signIn(page);
  await gotoAndSettle(page, "/trades");
  const demoTradeButtons = page.locator('button[data-account-code="DEMO-WORKSTATION"]');
  const firstTrade = demoTradeButtons.filter({ hasText: /DEMOC/ }).first();
  const secondTrade = demoTradeButtons.filter({ hasText: /DEMOB/ }).first();
  await expect(firstTrade).toBeVisible();
  await expect(secondTrade).toBeVisible();
  const firstGroupKey = await firstTrade.getAttribute("data-group-key");
  const secondGroupKey = await secondTrade.getAttribute("data-group-key");
  expect(firstGroupKey).toBeTruthy();
  expect(secondGroupKey).toBeTruthy();
  const firstLayoutPath = `/api/closed-trades/${encodeURIComponent(firstGroupKey!)}/chart-layout`;

  await firstTrade.click();
  await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", firstGroupKey!);
  await expect.poll(() => new URL(page.url()).searchParams.get("groupKey")).toBe(firstGroupKey);
  await expectFirstCanvasPainted(page);
  await expect(page.getByText(layoutSaveBusyPattern)).toHaveCount(0);

  let releaseLayoutSave!: () => void;
  const layoutSaveRelease = new Promise<void>((resolve) => {
    releaseLayoutSave = resolve;
  });

  await page.route("**/api/closed-trades/*/chart-layout", async (route) => {
    if (route.request().method() !== "PUT" || !route.request().url().includes(firstLayoutPath)) {
      await route.continue();
      return;
    }
    const requestBody = route.request().postDataJSON() as { layoutMode?: string; panels?: unknown[] };
    await layoutSaveRelease;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        layout: {
          id: "delayed-layout-save",
          groupKey: firstGroupKey,
          layoutMode: requestBody.layoutMode,
          panels: requestBody.panels,
          version: 101,
        },
      }),
    });
  });

  const currentTimeframe = await page.getByLabel("Timeframe").first().inputValue();
  await page.getByTitle(currentTimeframe === "1H" ? "Switch to 5M" : "Switch to 1H").first().click();
  await expect(page.getByText(layoutSaveBusyPattern).first()).toBeVisible();
  await expect(page.getByTestId("chart-panel-focus-toggle")).toBeDisabled();
  const inspector = page.locator("aside").filter({ hasText: "Structured Review" }).last();
  await inspector.getByRole("button", { name: "Next", exact: true }).focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(page.getByTestId("chart-save-guard")).toContainText(/layout/i);
  await expect(page.locator(`button[data-group-key="${firstGroupKey}"]`)).toHaveClass(/bg-cyan/);
  await secondTrade.click();
  await expect(page.getByTestId("chart-save-guard")).toContainText(/layout/i);
  await expect(page.locator(`button[data-group-key="${firstGroupKey}"]`)).toHaveClass(/bg-cyan/);

  const layoutSaveResponse = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().includes(firstLayoutPath));
  releaseLayoutSave();
  const saveResponse = await layoutSaveResponse;
  expect(saveResponse.ok()).toBeTruthy();
  await expect(page.getByTestId("chart-save-guard")).toHaveCount(0);
  await expect(page.getByText(layoutSaveBusyPattern)).toHaveCount(0);
  await expect(page.getByText("Layout ready.").first()).toBeVisible();

  const releasedSecondTrade = page.locator(`button[data-group-key="${secondGroupKey}"]`);
  await releasedSecondTrade.scrollIntoViewIfNeeded();
  await expect(releasedSecondTrade).toBeEnabled();
  await expect(async () => {
    await releasedSecondTrade.click();
    await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", secondGroupKey!, { timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", secondGroupKey!);
  await expect.poll(() => new URL(page.url()).searchParams.get("groupKey")).toBe(secondGroupKey);
  await page.unroute("**/api/closed-trades/*/chart-layout");

  expect(browserErrors).toEqual([]);
});

test("chart workstation persists an in-flight layout reversion as the latest intent", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  const layoutPutBodies: Array<{ layoutMode?: string; panels?: ChartPanelLayout[]; version?: number }> = [];
  let firstReleased = false;
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const firstRelease = new Promise<void>((resolve) => {
    releaseFirst = () => {
      firstReleased = true;
      resolve();
    };
  });
  const secondRelease = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  let serverLayout: { layoutMode: string; panels: ChartPanelLayout[]; version: number } = {
    layoutMode: "single",
    panels: [{ id: "panel-1", symbol: "DEMOC", timeframe: "5m", rangePreset: "trade", visibleFrom: null, visibleTo: null }],
    version: 10,
  };

  await signIn(page);
  await page.route("**/api/closed-trades/*/chart-layout", async (route) => {
    const request = route.request();
    const routeMatch = new URL(request.url()).pathname.match(/\/api\/closed-trades\/([^/]+)\/chart-layout$/);
    if (!routeMatch) {
      await route.continue();
      return;
    }
    const routeGroupKey = decodeURIComponent(routeMatch[1]);
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ layout: { id: "layout-reversion", groupKey: routeGroupKey, ...serverLayout } }),
      });
      return;
    }
    if (request.method() !== "PUT") {
      await route.continue();
      return;
    }

    const body = request.postDataJSON() as { layoutMode?: string; panels?: ChartPanelLayout[]; version?: number };
    layoutPutBodies.push(body);
    if (layoutPutBodies.length === 1) await firstRelease;
    if (layoutPutBodies.length === 2) {
      expect(firstReleased).toBe(true);
      await secondRelease;
    }
    const version = 10 + layoutPutBodies.length;
    serverLayout = {
      layoutMode: body.layoutMode ?? "single",
      panels: body.panels ?? [],
      version,
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ layout: { id: "layout-reversion", groupKey: routeGroupKey, ...serverLayout } }),
    });
  });

  try {
    await gotoAndSettle(page, `/trades?account=${demoAccountCode}`);
    const tradeButtons = page.locator('button[data-account-code="DEMO-WORKSTATION"]');
    const firstTrade = tradeButtons.filter({ hasText: /DEMOC/ }).first();
    const secondTrade = tradeButtons.filter({ hasText: /DEMOB/ }).first();
    const firstGroupKey = await firstTrade.getAttribute("data-group-key");
    expect(firstGroupKey).toBeTruthy();
    await firstTrade.click();
    await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", firstGroupKey!);
    await expectFirstCanvasPainted(page);
    await expectChartSavesSettled(page);

    const workspace = page.getByTestId("closed-trade-chart-workspace");
    const firstPanel = page.getByTestId("closed-trade-chart-panel").first();
    await firstPanel.locator('button[title="Switch to 1H"]').click();
    await expect.poll(() => layoutPutBodies.length).toBe(1);
    expect(layoutPutBodies[0].version).toBe(10);
    expect(layoutPutBodies[0].panels?.[0]?.timeframe).toBe("1h");
    await expect(workspace).toHaveAttribute("data-layout-save-state", "saving");

    await firstPanel.locator('button[title="Switch to 5M"]').click();
    await expect(workspace).toHaveAttribute("data-layout-save-state", "queued");
    await secondTrade.click();
    await expect(page.getByTestId("chart-save-guard")).toContainText(/layout/i);
    await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", firstGroupKey!);

    releaseFirst();
    await expect.poll(() => layoutPutBodies.length).toBe(2);
    expect(layoutPutBodies[1].version).toBe(11);
    expect(layoutPutBodies[1].panels?.[0]?.timeframe).toBe("5m");
    await expect(workspace).toHaveAttribute("data-layout-save-state", "saving");
    await expect(page.getByTestId("chart-save-guard")).toBeVisible();

    releaseSecond();
    await expectChartSavesSettled(page);
    await expect(page.getByTestId("chart-save-guard")).toHaveCount(0);
    expect(serverLayout.version).toBe(12);
    expect(serverLayout.panels[0]?.timeframe).toBe("5m");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByLabel("Timeframe").first()).toHaveValue("5M");
    await page.waitForTimeout(800);
    expect(layoutPutBodies).toHaveLength(2);
  } finally {
    await page.unroute("**/api/closed-trades/*/chart-layout");
  }

  expect(browserErrors).toEqual([]);
});

test("chart workstation cancels and persists annotation reversions", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  const annotationPutBodies: Array<{ annotations?: Array<{ type?: string }>; version?: number }> = [];
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const firstRelease = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const secondRelease = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  let serverAnnotations: Array<{ type?: string }> = [];
  let serverVersion = 20;

  await signIn(page);
  await page.route("**/api/closed-trades/*/chart-layout", async (route) => {
    const request = route.request();
    const routeMatch = new URL(request.url()).pathname.match(/\/api\/closed-trades\/([^/]+)\/chart-layout$/);
    if (!routeMatch || request.method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        layout: {
          id: "annotation-reversion-layout",
          groupKey: decodeURIComponent(routeMatch[1]),
          layoutMode: "single",
          panels: [{ id: "panel-1", symbol: "DEMOA", timeframe: "5m", rangePreset: "trade", visibleFrom: null, visibleTo: null }],
          version: 30,
        },
      }),
    });
  });
  await page.route("**/api/closed-trades/*/annotations", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ annotations: serverAnnotations, version: serverVersion, updatedAt: "2026-06-26T00:00:00.000Z" }),
      });
      return;
    }
    if (request.method() !== "PUT") {
      await route.continue();
      return;
    }

    const body = request.postDataJSON() as { annotations?: Array<{ type?: string }>; version?: number };
    annotationPutBodies.push(body);
    if (annotationPutBodies.length === 1) await firstRelease;
    if (annotationPutBodies.length === 2) await secondRelease;
    serverVersion = 20 + annotationPutBodies.length;
    serverAnnotations = body.annotations ?? [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ annotations: serverAnnotations, version: serverVersion, updatedAt: "2026-06-26T00:01:00.000Z" }),
    });
  });

  try {
    await gotoAndSettle(page, `/trades?account=${demoAccountCode}&symbol=DEMOA`);
    const firstTrade = page.locator('button[data-account-code="DEMO-WORKSTATION"]').filter({ hasText: /DEMOA/ }).first();
    await expect(firstTrade).toBeVisible();
    const firstGroupKey = await firstTrade.getAttribute("data-group-key");
    expect(firstGroupKey).toBeTruthy();
    await firstTrade.click();
    await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", firstGroupKey!);
    await expectFirstCanvasPainted(page);
    await expect(page.getByText("Drawings ready.").first()).toBeVisible();

    const workspace = page.getByTestId("closed-trade-chart-workspace");
    const firstPlot = page.getByTestId("closed-trade-chart-panel").first().getByTestId("closed-trade-chart-plot");
    await firstPlot.scrollIntoViewIfNeeded();
    await expect(firstPlot).toHaveAttribute("data-candle-fresh", "true");
    const box = await firstPlot.boundingBox();
    expect(box).toBeTruthy();
    await page.getByTitle("Horizontal").click();

    await page.mouse.click(box!.x + box!.width * 0.1, box!.y + box!.height * 0.42);
    await expect(page.getByTitle("Undo")).toBeEnabled();
    await page.getByTitle("Undo").click();
    await page.waitForTimeout(850);
    expect(annotationPutBodies).toHaveLength(0);
    await expect(workspace).toHaveAttribute("data-annotation-save-state", "clean");

    await page.mouse.click(box!.x + box!.width * 0.18, box!.y + box!.height * 0.56);
    await expect.poll(() => annotationPutBodies.length).toBe(1);
    expect(annotationPutBodies[0].version).toBe(20);
    expect(annotationPutBodies[0].annotations?.filter((annotation) => annotation.type === "horizontal")).toHaveLength(1);
    await page.getByTitle("Undo").click();
    await expect(workspace).toHaveAttribute("data-annotation-save-state", "queued");

    releaseFirst();
    await expect.poll(() => annotationPutBodies.length).toBe(2);
    expect(annotationPutBodies[1].version).toBe(21);
    expect(annotationPutBodies[1].annotations).toEqual([]);
    await expect(workspace).toHaveAttribute("data-annotation-save-state", "saving");

    releaseSecond();
    await expectChartSavesSettled(page);
    expect(serverVersion).toBe(22);
    expect(serverAnnotations).toEqual([]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText("Drawings ready.").first()).toBeVisible();
    await page.waitForTimeout(850);
    expect(annotationPutBodies).toHaveLength(2);
  } finally {
    await page.unroute("**/api/closed-trades/*/chart-layout");
    await page.unroute("**/api/closed-trades/*/annotations");
  }

  expect(browserErrors).toEqual([]);
});

test("chart workstation retries the latest layout reversion after a failed save", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page, ["503"]);
  const layoutPutBodies: Array<{ layoutMode?: string; panels?: ChartPanelLayout[]; version?: number }> = [];
  let releaseFailure!: () => void;
  const failureRelease = new Promise<void>((resolve) => {
    releaseFailure = resolve;
  });

  await signIn(page);
  await page.route("**/api/closed-trades/*/chart-layout", async (route) => {
    const request = route.request();
    const routeMatch = new URL(request.url()).pathname.match(/\/api\/closed-trades\/([^/]+)\/chart-layout$/);
    if (!routeMatch) {
      await route.continue();
      return;
    }
    const groupKey = decodeURIComponent(routeMatch[1]);
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          layout: {
            id: "failed-layout-reversion",
            groupKey,
            layoutMode: "single",
            panels: [{ id: "panel-1", symbol: "DEMOC", timeframe: "5m", rangePreset: "trade", visibleFrom: null, visibleTo: null }],
            version: 10,
          },
        }),
      });
      return;
    }
    if (request.method() !== "PUT") {
      await route.continue();
      return;
    }

    const body = request.postDataJSON() as { layoutMode?: string; panels?: ChartPanelLayout[]; version?: number };
    layoutPutBodies.push(body);
    if (layoutPutBodies.length === 1) {
      await failureRelease;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Layout save failed." }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ layout: { id: "failed-layout-reversion", groupKey, layoutMode: body.layoutMode, panels: body.panels, version: 11 } }),
    });
  });

  try {
    await gotoAndSettle(page, `/trades?account=${demoAccountCode}`);
    const trades = page.locator('button[data-account-code="DEMO-WORKSTATION"]');
    const firstTrade = trades.filter({ hasText: /DEMOC/ }).first();
    const secondTrade = trades.filter({ hasText: /DEMOB/ }).first();
    const firstGroupKey = await firstTrade.getAttribute("data-group-key");
    await firstTrade.click();
    await expectFirstCanvasPainted(page);

    const firstPanel = page.getByTestId("closed-trade-chart-panel").first();
    await firstPanel.locator('button[title="Switch to 1H"]').click();
    await expect.poll(() => layoutPutBodies.length).toBe(1);
    await firstPanel.locator('button[title="Switch to 5M"]').click();
    releaseFailure();
    await expect(page.getByText("Layout save failed. Retry.").first()).toBeVisible();
    await expect(page.getByTestId("closed-trade-chart-workspace")).toHaveAttribute("data-layout-save-state", "error");
    await secondTrade.click();
    await expect(page.getByTestId("chart-save-guard")).toContainText(/layout/i);
    await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", firstGroupKey!);

    await page.getByRole("button", { name: "Retry layout save" }).click();
    await expect.poll(() => layoutPutBodies.length).toBe(2);
    expect(layoutPutBodies[1].version).toBe(10);
    expect(layoutPutBodies[1].panels?.[0]?.timeframe).toBe("5m");
    await expectChartSavesSettled(page);
  } finally {
    await page.unroute("**/api/closed-trades/*/chart-layout");
  }

  expect(browserErrors).toEqual([]);
});

test("chart workstation uses server-returned layout version for queued layout saves", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);

  await signIn(page);
  let releaseLayoutSave!: () => void;
  let releasedFirstLayoutSave = false;
  const layoutSaveRelease = new Promise<void>((resolve) => {
    releaseLayoutSave = () => {
      releasedFirstLayoutSave = true;
      resolve();
    };
  });
  const layoutPutBodies: Array<{ layoutMode?: string; panels?: ChartPanelLayout[]; version?: number }> = [];
  let secondArrivedBeforeFirstRelease = false;

  await page.route("**/api/closed-trades/*/chart-layout", async (route) => {
    const request = route.request();
    const routeMatch = new URL(request.url()).pathname.match(/\/api\/closed-trades\/([^/]+)\/chart-layout$/);
    if (!routeMatch) {
      await route.continue();
      return;
    }
    const routeGroupKey = decodeURIComponent(routeMatch[1]);
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          layout: {
            id: "queued-layout-version",
            groupKey: routeGroupKey,
            layoutMode: "single",
            panels: [{ id: "panel-1", symbol: "DEMOC", timeframe: "5m", rangePreset: "trade", visibleFrom: null, visibleTo: null }],
            version: 10,
          },
        }),
      });
      return;
    }
    if (request.method() !== "PUT") {
      await route.continue();
      return;
    }
    const requestBody = request.postDataJSON() as { layoutMode?: string; panels?: ChartPanelLayout[]; version?: number };
    layoutPutBodies.push(requestBody);
    if (layoutPutBodies.length === 1) {
      await layoutSaveRelease;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          layout: {
            id: "queued-layout-version",
            groupKey: routeGroupKey,
            layoutMode: requestBody.layoutMode,
            panels: requestBody.panels,
            version: 11,
          },
        }),
      });
      return;
    }
    if (!releasedFirstLayoutSave) secondArrivedBeforeFirstRelease = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        layout: {
          id: "queued-layout-version",
          groupKey: routeGroupKey,
          layoutMode: requestBody.layoutMode,
          panels: requestBody.panels,
          version: 12,
        },
      }),
    });
  });

  try {
    await gotoAndSettle(page, `/trades?account=${demoAccountCode}&symbol=DEMOC`);
    const firstTrade = page.locator('button[data-account-code="DEMO-WORKSTATION"]').filter({ hasText: /DEMOC/ }).first();
    await expect(firstTrade).toBeVisible();
    const firstGroupKey = await firstTrade.getAttribute("data-group-key");
    expect(firstGroupKey).toBeTruthy();
    await firstTrade.click();
    await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", firstGroupKey!);
    await expectFirstCanvasPainted(page);
    await expectChartSavesSettled(page);

    const firstPanel = page.getByTestId("closed-trade-chart-panel").first();
    await firstPanel.locator('button[title="Switch to 1H"]').click();
    await expect.poll(() => layoutPutBodies.length).toBe(1);
    expect(layoutPutBodies[0].version).toBe(10);
    await expect(page.getByText(layoutSaveBusyPattern).first()).toBeVisible();

    await firstPanel.locator('button[title="Switch to 1D"]').click();
    await expect(page.getByText(layoutSaveBusyPattern).first()).toBeVisible();

    releaseLayoutSave();
    await expect.poll(() => layoutPutBodies.length).toBe(2);
    expect(secondArrivedBeforeFirstRelease).toBe(false);
    expect(layoutPutBodies[1].version).toBe(11);
    expect(layoutPutBodies[1].panels?.find((panel) => panel.id === "panel-1")?.timeframe).toBe("1d");
    await expect(page.getByText("Layout changed in another tab.")).toHaveCount(0);
    await expectChartSavesSettled(page);
    await page.waitForTimeout(800);
    expect(layoutPutBodies).toHaveLength(2);
  } finally {
    await page.unroute("**/api/closed-trades/*/chart-layout");
  }

  expect(browserErrors).toEqual([]);
});

test("chart workstation uses server-returned drawing version for queued annotation saves", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  const fixtureCandles = [
    { time: unixSeconds("2026-06-17T13:30:00.000Z"), open: 100.5, high: 101.8, low: 100.2, close: 101.2, volume: 1200 },
    { time: unixSeconds("2026-06-17T13:35:00.000Z"), open: 101.2, high: 102.4, low: 100.9, close: 101.9, volume: 1500 },
    { time: unixSeconds("2026-06-17T13:40:00.000Z"), open: 101.9, high: 103.2, low: 101.5, close: 102.8, volume: 1800 },
    { time: unixSeconds("2026-06-17T13:45:00.000Z"), open: 102.8, high: 104.1, low: 102.2, close: 103.6, volume: 2100 },
    { time: unixSeconds("2026-06-17T13:50:00.000Z"), open: 103.6, high: 104.8, low: 103.1, close: 104.2, volume: 1900 },
  ];

  await signIn(page);
  let releaseAnnotationSave!: () => void;
  let releasedFirstAnnotationSave = false;
  const annotationSaveRelease = new Promise<void>((resolve) => {
    releaseAnnotationSave = () => {
      releasedFirstAnnotationSave = true;
      resolve();
    };
  });
  const annotationPutBodies: Array<{ annotations?: Array<{ type?: string }>; version?: number }> = [];
  let secondArrivedBeforeFirstRelease = false;

  await page.route("**/api/closed-trades/*/chart-layout", async (route) => {
    const request = route.request();
    const routeMatch = new URL(request.url()).pathname.match(/\/api\/closed-trades\/([^/]+)\/chart-layout$/);
    if (!routeMatch) {
      await route.continue();
      return;
    }
    const routeGroupKey = decodeURIComponent(routeMatch[1]);
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          layout: {
            id: "queued-annotation-layout",
            groupKey: routeGroupKey,
            layoutMode: "single",
            panels: [{ id: "panel-1", symbol: "DEMOA", timeframe: "5m", rangePreset: "trade", visibleFrom: null, visibleTo: null }],
            version: 30,
          },
        }),
      });
      return;
    }
    if (request.method() === "PUT") {
      const requestBody = request.postDataJSON() as { layoutMode?: string; panels?: ChartPanelLayout[] };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          layout: {
            id: "queued-annotation-layout",
            groupKey: routeGroupKey,
            layoutMode: requestBody.layoutMode,
            panels: requestBody.panels,
            version: 31,
          },
        }),
      });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/market/candles**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        symbol: (url.searchParams.get("symbol") ?? "DEMOA").toUpperCase(),
        timeframe: url.searchParams.get("timeframe") ?? "5m",
        source: "cache",
        candles: fixtureCandles,
        metadata: {
          requestedRange: null,
          returnedRange: { from: fixtureCandles[0].time, to: fixtureCandles.at(-1)?.time ?? fixtureCandles[0].time },
          barIntervalSeconds: 300,
          limit: Number(url.searchParams.get("limit") ?? 1200),
          truncated: false,
          warnings: [],
        },
      }),
    });
  });
  await page.route("**/api/closed-trades/*/annotations", async (route) => {
    const request = route.request();
    const routeMatch = new URL(request.url()).pathname.match(/\/api\/closed-trades\/([^/]+)\/annotations$/);
    if (!routeMatch) {
      await route.continue();
      return;
    }
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ annotations: [], version: 20, updatedAt: "2026-06-26T00:00:00.000Z" }),
      });
      return;
    }
    if (request.method() !== "PUT") {
      await route.continue();
      return;
    }
    const requestBody = request.postDataJSON() as { annotations?: Array<{ type?: string }>; version?: number };
    annotationPutBodies.push(requestBody);
    if (annotationPutBodies.length === 1) {
      await annotationSaveRelease;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ annotations: requestBody.annotations ?? [], version: 21, updatedAt: "2026-06-26T00:01:00.000Z" }),
      });
      return;
    }
    if (!releasedFirstAnnotationSave) secondArrivedBeforeFirstRelease = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ annotations: requestBody.annotations ?? [], version: 22, updatedAt: "2026-06-26T00:02:00.000Z" }),
    });
  });

  try {
    await gotoAndSettle(page, `/trades?account=${demoAccountCode}&symbol=DEMOA`);
    const firstTrade = page.locator('button[data-account-code="DEMO-WORKSTATION"]').filter({ hasText: /DEMOA/ }).first();
    await expect(firstTrade).toBeVisible();
    const firstGroupKey = await firstTrade.getAttribute("data-group-key");
    expect(firstGroupKey).toBeTruthy();
    await firstTrade.click();
    await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", firstGroupKey!);
    await expectFirstCanvasPainted(page);
    await expect(page.getByText("Drawings ready.").first()).toBeVisible();

    const firstPanel = page.getByTestId("closed-trade-chart-panel").first();
    const firstPlot = firstPanel.getByTestId("closed-trade-chart-plot");
    await firstPlot.scrollIntoViewIfNeeded();
    const chartCanvas = firstPlot.locator("canvas").first();
    await expect(chartCanvas).toBeVisible();
    const canvasBox = await chartCanvas.boundingBox();
    expect(canvasBox).toBeTruthy();

    await page.getByTitle("Horizontal").click();
    await page.mouse.click(canvasBox!.x + canvasBox!.width * 0.1, canvasBox!.y + canvasBox!.height * 0.42);
    await expect.poll(() => annotationPutBodies.length).toBe(1);
    expect(annotationPutBodies[0].version).toBe(20);
    await expect(page.getByText(drawingSaveBusyPattern).first()).toBeVisible();

    await page.mouse.click(canvasBox!.x + canvasBox!.width * 0.18, canvasBox!.y + canvasBox!.height * 0.56);
    await expect(page.getByText(drawingSaveBusyPattern).first()).toBeVisible();

    releaseAnnotationSave();
    await expect.poll(() => annotationPutBodies.length).toBe(2);
    expect(secondArrivedBeforeFirstRelease).toBe(false);
    expect(annotationPutBodies[1].version).toBe(21);
    expect(annotationPutBodies[1].annotations?.filter((annotation) => annotation.type === "horizontal")).toHaveLength(2);
    await expect(page.getByText("Drawings changed in another tab.")).toHaveCount(0);
    await expectChartSavesSettled(page);
    await page.waitForTimeout(850);
    expect(annotationPutBodies).toHaveLength(2);
  } finally {
    await page.unroute("**/api/closed-trades/*/chart-layout");
    await page.unroute("**/api/market/candles**");
    await page.unroute("**/api/closed-trades/*/annotations");
  }

  expect(browserErrors).toEqual([]);
});

test("closed-trade journal waits for pending chart layout saves", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);

  await signIn(page);
  await gotoAndSettle(page, `/trades?account=${demoAccountCode}`);
  const demoTradeButtons = page.locator('button[data-account-code="DEMO-WORKSTATION"]');
  const firstTrade = demoTradeButtons.filter({ hasText: /DEMOC/ }).first();
  await expect(firstTrade).toBeVisible();
  const firstGroupKey = await firstTrade.getAttribute("data-group-key");
  expect(firstGroupKey).toBeTruthy();
  const firstLayoutPath = `/api/closed-trades/${encodeURIComponent(firstGroupKey!)}/chart-layout`;

  await firstTrade.click();
  await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", firstGroupKey!);
  await expectFirstCanvasPainted(page);
  await expect(page.getByText(layoutSaveBusyPattern)).toHaveCount(0);
  await expect(page.getByText("Layout ready.").first()).toBeVisible();

  let releaseLayoutSave!: () => void;
  const layoutSaveRelease = new Promise<void>((resolve) => {
    releaseLayoutSave = resolve;
  });
  let journalBridgeRequests = 0;

  await page.route("**/api/closed-trades/*/chart-layout", async (route) => {
    if (route.request().method() !== "PUT" || !route.request().url().includes(firstLayoutPath)) {
      await route.continue();
      return;
    }
    const requestBody = route.request().postDataJSON() as { layoutMode?: string; panels?: unknown[] };
    await layoutSaveRelease;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        layout: {
          id: "delayed-journal-layout-save",
          groupKey: firstGroupKey,
          layoutMode: requestBody.layoutMode,
          panels: requestBody.panels,
          version: 103,
        },
      }),
    });
  });
  await page.route("**/api/closed-trades/*/journal", async (route) => {
    journalBridgeRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ created: false, journalEntryId: "demo-journal-a" }),
    });
  });

  try {
    const layoutSaveRequest = page.waitForRequest((request) => request.method() === "PUT" && request.url().includes(firstLayoutPath));
    const inactiveTimeframe = page
      .getByTestId("closed-trade-chart-panel")
      .first()
      .locator('button[title^="Switch to"][aria-pressed="false"]')
      .first();
    await expect(inactiveTimeframe).toBeVisible();
    await inactiveTimeframe.click();
    await layoutSaveRequest;
    await expect(page.getByTestId("closed-trade-workstation")).toHaveAttribute("data-chart-save-blocking", "true");

    const journalAction = page.getByRole("button", { name: /Create Journal|Open Journal/ }).first();
    await expect(journalAction).toBeEnabled();
    const journalBridgeRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().includes("/api/closed-trades/") &&
        request.url().endsWith("/journal"),
    );
    await journalAction.click();
    await expect(page.getByTestId("chart-save-guard")).toContainText("Opening journal when chart save finishes.");
    const inspector = page.locator("aside").filter({ hasText: "Structured Review" }).last();
    await expect(inspector.getByLabel("Thesis")).toBeDisabled();
    await expect(inspector.getByLabel("Tags")).toBeDisabled();
    await expect(inspector.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await expect(inspector.getByRole("button", { name: "Save & Next" })).toBeDisabled();
    await expect(journalAction).toBeDisabled();
    await page.waitForTimeout(300);
    expect(journalBridgeRequests).toBe(0);
    expect(new URL(page.url()).pathname).toBe("/trades");

    releaseLayoutSave();
    await journalBridgeRequest;
    await expect(page).toHaveURL(/\/journal\?entryId=demo-journal-a/);
  } finally {
    await page.unroute("**/api/closed-trades/*/chart-layout");
    await page.unroute("**/api/closed-trades/*/journal");
  }

  expect(browserErrors).toEqual([]);
});

test("chart drawing conflicts cancel deferred closed-trade journal opens", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page, ["409 (Conflict)"]);

  await signIn(page);
  await gotoAndSettle(page, `/trades?account=${demoAccountCode}`);
  const demoTradeButtons = page.locator('button[data-account-code="DEMO-WORKSTATION"]');
  const firstTrade = demoTradeButtons.filter({ hasText: /DEMOA/ }).first();
  await expect(firstTrade).toBeVisible();
  const firstGroupKey = await firstTrade.getAttribute("data-group-key");
  expect(firstGroupKey).toBeTruthy();
  const firstAnnotationsPath = `/api/closed-trades/${encodeURIComponent(firstGroupKey!)}/annotations`;

  await firstTrade.click();
  await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", firstGroupKey!);
  await expectFirstCanvasPainted(page);
  await expect(page.getByText(drawingSaveBusyPattern)).toHaveCount(0);
  await expect(page.getByText("Drawings ready.").first()).toBeVisible();

  let releaseAnnotationSave!: () => void;
  const annotationSaveRelease = new Promise<void>((resolve) => {
    releaseAnnotationSave = resolve;
  });
  let annotationPutBody: { annotations?: unknown[]; version?: number } | null = null;
  let journalBridgeRequests = 0;

  await page.route("**/api/closed-trades/*/annotations", async (route) => {
    if (route.request().method() !== "PUT" || !route.request().url().includes(firstAnnotationsPath)) {
      await route.continue();
      return;
    }
    const requestBody = route.request().postDataJSON() as typeof annotationPutBody;
    if ((requestBody?.annotations?.length ?? 0) === 0) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          annotations: [],
          version: (requestBody?.version ?? 1) + 1,
          updatedAt: "2026-06-29T00:00:00.000Z",
        }),
      });
      return;
    }
    annotationPutBody = requestBody;
    await annotationSaveRelease;
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "Drawings changed in another tab.", currentVersion: 104 }),
    });
  });
  await page.route("**/api/closed-trades/*/journal", async (route) => {
    journalBridgeRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ created: false, journalEntryId: "demo-journal-a" }),
    });
  });

  try {
    const annotationSaveRequest = page.waitForRequest((request) => {
      if (request.method() !== "PUT" || !request.url().includes(firstAnnotationsPath)) return false;
      const body = request.postDataJSON() as { annotations?: unknown[] };
      return (body.annotations?.length ?? 0) > 0;
    });
    await page.getByTitle("Store execution markers").click();
    await annotationSaveRequest;
    await expect.poll(() => annotationPutBody?.annotations?.length ?? 0).toBeGreaterThan(0);
    await expect(page.getByTestId("closed-trade-workstation")).toHaveAttribute("data-chart-save-blocking", "true");

    const journalAction = page.getByRole("button", { name: /Create Journal|Open Journal/ }).first();
    await expect(journalAction).toBeEnabled();
    await journalAction.click();
    await expect(page.getByTestId("chart-save-guard")).toContainText("Opening journal when chart save finishes.");
    const inspector = page.locator("aside").filter({ hasText: "Structured Review" }).last();
    await expect(inspector.getByLabel("Thesis")).toBeDisabled();
    await expect(inspector.getByLabel("Tags")).toBeDisabled();
    await expect(inspector.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await expect(inspector.getByRole("button", { name: "Save & Next" })).toBeDisabled();
    await expect(journalAction).toBeDisabled();
    await page.waitForTimeout(300);
    expect(journalBridgeRequests).toBe(0);

    const conflictResponse = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().includes(firstAnnotationsPath));
    releaseAnnotationSave();
    expect((await conflictResponse).status()).toBe(409);
    await expect(page.getByTestId("chart-save-guard")).toContainText("Chart save needs attention.");
    await expect(page.getByText("Drawings changed in another tab.").first()).toBeVisible();
    expect(journalBridgeRequests).toBe(0);
    expect(new URL(page.url()).pathname).toBe("/trades");

    await page.getByRole("button", { name: /reload latest/i }).click();
    await expect(page.getByText("Drawings changed in another tab.").first()).toBeHidden();
    await expect(page.getByTestId("chart-save-guard")).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(journalBridgeRequests).toBe(0);
    expect(new URL(page.url()).pathname).toBe("/trades");

    const journalBridgeRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().includes("/api/closed-trades/") &&
        request.url().endsWith("/journal"),
    );
    await journalAction.click();
    await journalBridgeRequest;
    await expect.poll(() => journalBridgeRequests).toBe(1);
    await expect(page).toHaveURL(/\/journal\?entryId=demo-journal-a/);
  } finally {
    await page.unroute("**/api/closed-trades/*/annotations");
    await page.unroute("**/api/closed-trades/*/journal");
  }

  expect(browserErrors).toEqual([]);
});

test("closed-trade journal waits for pending chart annotation saves", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);

  await signIn(page);
  await gotoAndSettle(page, `/trades?account=${demoAccountCode}`);
  const demoTradeButtons = page.locator('button[data-account-code="DEMO-WORKSTATION"]');
  const firstTrade = demoTradeButtons.filter({ hasText: /DEMOA/ }).first();
  await expect(firstTrade).toBeVisible();
  const firstGroupKey = await firstTrade.getAttribute("data-group-key");
  expect(firstGroupKey).toBeTruthy();
  const firstAnnotationsPath = `/api/closed-trades/${encodeURIComponent(firstGroupKey!)}/annotations`;

  await firstTrade.click();
  await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", firstGroupKey!);
  await expectFirstCanvasPainted(page);
  await expect(page.getByText(drawingSaveBusyPattern)).toHaveCount(0);
  await expect(page.getByText("Drawings ready.").first()).toBeVisible();

  let releaseAnnotationSave!: () => void;
  const annotationSaveRelease = new Promise<void>((resolve) => {
    releaseAnnotationSave = resolve;
  });
  let annotationPutBody: { annotations?: unknown[]; version?: number } | null = null;
  let journalBridgeRequests = 0;

  await page.route("**/api/closed-trades/*/annotations", async (route) => {
    if (route.request().method() !== "PUT" || !route.request().url().includes(firstAnnotationsPath)) {
      await route.continue();
      return;
    }
    const requestBody = route.request().postDataJSON() as typeof annotationPutBody;
    if ((requestBody?.annotations?.length ?? 0) === 0) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          annotations: [],
          version: (requestBody?.version ?? 1) + 1,
          updatedAt: "2026-06-29T00:00:00.000Z",
        }),
      });
      return;
    }
    annotationPutBody = requestBody;
    await annotationSaveRelease;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        annotations: annotationPutBody?.annotations ?? [],
        version: (annotationPutBody?.version ?? 1) + 1,
        updatedAt: "2026-06-29T00:00:00.000Z",
      }),
    });
  });
  await page.route("**/api/closed-trades/*/journal", async (route) => {
    journalBridgeRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ created: false, journalEntryId: "demo-journal-a" }),
    });
  });

  try {
    const annotationSaveRequest = page.waitForRequest((request) => {
      if (request.method() !== "PUT" || !request.url().includes(firstAnnotationsPath)) return false;
      const body = request.postDataJSON() as { annotations?: unknown[] };
      return (body.annotations?.length ?? 0) > 0;
    });
    await page.getByTitle("Store execution markers").click();
    await expect(page.getByTestId("closed-trade-workstation")).toHaveAttribute("data-chart-save-blocking", "true");

    const journalAction = page.getByRole("button", { name: /Create Journal|Open Journal/ }).first();
    await expect(journalAction).toBeEnabled();
    const journalBridgeRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().includes("/api/closed-trades/") &&
        request.url().endsWith("/journal"),
    );
    await journalAction.click();
    await expect(page.getByTestId("chart-save-guard")).toContainText("Opening journal when chart save finishes.");
    await page.waitForTimeout(300);
    expect(journalBridgeRequests).toBe(0);
    expect(new URL(page.url()).pathname).toBe("/trades");

    await annotationSaveRequest;
    await expect.poll(() => annotationPutBody?.annotations?.length ?? 0).toBeGreaterThan(0);
    const annotationSaveResponse = page.waitForResponse(
      (response) => response.request().method() === "PUT" && response.url().includes(firstAnnotationsPath),
    );
    releaseAnnotationSave();
    const saveResponse = await annotationSaveResponse;
    expect(saveResponse.ok()).toBeTruthy();
    await journalBridgeRequest;
    await expect.poll(() => journalBridgeRequests).toBe(1);
    await expect(page).toHaveURL(/\/journal\?entryId=demo-journal-a/);
  } finally {
    await page.unroute("**/api/closed-trades/*/annotations");
    await page.unroute("**/api/closed-trades/*/journal");
  }

  expect(browserErrors).toEqual([]);
});

test("chart workstation allows trade switches after simple chart clicks", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);

  await signIn(page);
  await gotoAndSettle(page, `/trades?account=${demoAccountCode}`);
  const demoTradeButtons = page.locator('button[data-account-code="DEMO-WORKSTATION"]');
  const firstTrade = demoTradeButtons.filter({ hasText: /DEMOC/ }).first();
  const secondTrade = demoTradeButtons.filter({ hasText: /DEMOB/ }).first();
  await expect(firstTrade).toBeVisible();
  await expect(secondTrade).toBeVisible();
  const firstGroupKey = await firstTrade.getAttribute("data-group-key");
  const secondGroupKey = await secondTrade.getAttribute("data-group-key");
  expect(firstGroupKey).toBeTruthy();
  expect(secondGroupKey).toBeTruthy();

  await firstTrade.click();
  await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", firstGroupKey!);
  await expect.poll(() => new URL(page.url()).searchParams.get("groupKey")).toBe(firstGroupKey);
  await expectFirstCanvasPainted(page);
  await expect(page.getByText(layoutSaveBusyPattern)).toHaveCount(0);
  await expect(page.getByTestId("chart-save-guard")).toHaveCount(0);

  const firstPlot = page.getByTestId("closed-trade-chart-panel").first().getByTestId("closed-trade-chart-plot");
  await firstPlot.evaluate((node) => node.scrollIntoView({ block: "center", inline: "nearest" }));
  await expect(page.getByTestId("chart-save-guard")).toHaveCount(0);
  await expect(page.getByText("Chart range save pending.")).toHaveCount(0);
  const box = await firstPlot.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.click(box!.x + box!.width * 0.5, box!.y + box!.height * 0.5);
  await expect(page.getByTestId("chart-save-guard")).toHaveCount(0);
  await expect(page.getByText("Chart range save pending.")).toHaveCount(0);

  await secondTrade.click();
  await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", secondGroupKey!, { timeout: 1_000 });
  await expect.poll(() => new URL(page.url()).searchParams.get("groupKey")).toBe(secondGroupKey);
  await expect(page.getByTestId("chart-save-guard")).toHaveCount(0);
  await expect(page.getByText(preLayoutSaveGuardPattern)).toHaveCount(0);

  expect(browserErrors).toEqual([]);
});

test("chart workstation blocks trade switches while visible range saves are pending", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);

  await signIn(page);
  await gotoAndSettle(page, `/trades?account=${demoAccountCode}`);
  const demoTradeButtons = page.locator('button[data-account-code="DEMO-WORKSTATION"]');
  const firstTrade = demoTradeButtons.filter({ hasText: /DEMOC/ }).first();
  const secondTrade = demoTradeButtons.filter({ hasText: /DEMOB/ }).first();
  await expect(firstTrade).toBeVisible();
  await expect(secondTrade).toBeVisible();
  const firstGroupKey = await firstTrade.getAttribute("data-group-key");
  const secondGroupKey = await secondTrade.getAttribute("data-group-key");
  expect(firstGroupKey).toBeTruthy();
  expect(secondGroupKey).toBeTruthy();
  const firstLayoutPath = `/api/closed-trades/${encodeURIComponent(firstGroupKey!)}/chart-layout`;

  await firstTrade.click();
  await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", firstGroupKey!);
  await expectFirstCanvasPainted(page);
  await expect(page.getByText(layoutSaveBusyPattern)).toHaveCount(0);

  let releaseLayoutSave!: () => void;
  const layoutSaveRelease = new Promise<void>((resolve) => {
    releaseLayoutSave = resolve;
  });
  const hasNumericVisibleRange = (body: { panels?: Array<{ visibleFrom?: unknown; visibleTo?: unknown }> }) =>
    body.panels?.some((panel) => typeof panel.visibleFrom === "number" && typeof panel.visibleTo === "number") === true;

  await page.route("**/api/closed-trades/*/chart-layout", async (route) => {
    if (route.request().method() !== "PUT" || !route.request().url().includes(firstLayoutPath)) {
      await route.continue();
      return;
    }
    const requestBody = route.request().postDataJSON() as {
      layoutMode?: string;
      panels?: Array<{ visibleFrom?: unknown; visibleTo?: unknown }>;
    };
    if (!hasNumericVisibleRange(requestBody)) {
      await route.continue();
      return;
    }
    await layoutSaveRelease;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        layout: {
          id: "delayed-visible-range-save",
          groupKey: firstGroupKey,
          layoutMode: requestBody.layoutMode,
          panels: requestBody.panels,
          version: 102,
        },
      }),
    });
  });

  const layoutSaveRequest = page.waitForRequest((request) => {
    if (request.method() !== "PUT" || !request.url().includes(firstLayoutPath)) return false;
    return hasNumericVisibleRange(
      request.postDataJSON() as { panels?: Array<{ visibleFrom?: unknown; visibleTo?: unknown }> },
    );
  });
  await panFirstChart(page);
  const focusToggle = page.getByTestId("chart-panel-focus-toggle");
  await expect(focusToggle).toBeEnabled();
  await focusToggle.click();
  await expect(focusToggle).toContainText("Show all");
  await secondTrade.click();
  await expect(page.getByTestId("chart-save-guard")).toContainText(preLayoutSaveGuardPattern);
  await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", firstGroupKey!);

  const request = await layoutSaveRequest;
  const requestBody = request.postDataJSON() as {
    panels?: Array<{ visibleFrom?: unknown; visibleTo?: unknown }>;
  };
  expect(hasNumericVisibleRange(requestBody)).toBe(true);
  await expect(page.getByText(layoutSaveBusyPattern).first()).toBeVisible();
  await secondTrade.click();
  await expect(page.getByTestId("chart-save-guard")).toContainText(/layout/i);
  await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", firstGroupKey!);

  const layoutSaveResponse = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().includes(firstLayoutPath));
  releaseLayoutSave();
  const saveResponse = await layoutSaveResponse;
  expect(saveResponse.ok()).toBeTruthy();
  await expect(page.getByTestId("chart-save-guard")).toHaveCount(0);
  await expect(page.getByText(layoutSaveBusyPattern)).toHaveCount(0);

  const releasedSecondTrade = page.locator(`button[data-group-key="${secondGroupKey}"]`);
  await releasedSecondTrade.scrollIntoViewIfNeeded();
  await expect(async () => {
    await releasedSecondTrade.click();
    await expect(page.locator('button[aria-current="true"]')).toHaveAttribute("data-group-key", secondGroupKey!, { timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  await page.unroute("**/api/closed-trades/*/chart-layout");

  expect(browserErrors).toEqual([]);
});

test("chart workstation retries failed layout loads, locks on layout conflicts, and reloads latest", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page, ["409 (Conflict)", "503 (Service Unavailable)", "404 (Not Found)"]);

  const fixtureCandles = [
    {
      time: unixSeconds("2026-06-18T12:00:00.000Z"),
      open: 45.2,
      high: 45.3,
      low: 44.5,
      close: 44.75,
      volume: 2200,
    },
    {
      time: unixSeconds("2026-06-18T16:00:00.000Z"),
      open: 43.3,
      high: 43.45,
      low: 42.7,
      close: 42.95,
      volume: 2600,
    },
    {
      time: unixSeconds("2026-06-22T13:00:00.000Z"),
      open: 42.1,
      high: 42.25,
      low: 41.5,
      close: 41.7,
      volume: 2900,
    },
  ];
  await page.route("**/api/market/candles**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        symbol: url.searchParams.get("symbol") ?? "DEMOC",
        source: "cache",
        candles: fixtureCandles,
        metadata: {
          requestedRange: null,
          returnedRange: { from: fixtureCandles[0].time, to: fixtureCandles.at(-1)?.time ?? fixtureCandles[0].time },
          barIntervalSeconds: 3600,
          limit: Number(url.searchParams.get("limit") ?? 1200),
          truncated: false,
          warnings: [],
        },
      }),
    });
  });

  const layoutRoutePattern = "**/api/closed-trades/*/chart-layout";
  let layoutGetCount = 0;
  let groupKey: string | null = null;
  await page.route(layoutRoutePattern, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    layoutGetCount += 1;
    if (layoutGetCount === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Chart layout failed to load." }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        layout: {
          id: "retry-layout",
          groupKey: groupKey ?? "retry-layout-group",
          layoutMode: "one-plus-two",
          version: 4,
          panels: [
            { id: "panel-1", symbol: "DEMOC", timeframe: "1h", rangePreset: "trade", visibleFrom: null, visibleTo: null },
            { id: "panel-2", symbol: "DEMOC", timeframe: "5m", rangePreset: "trade", visibleFrom: null, visibleTo: null },
            { id: "panel-3", symbol: "DEMOC", timeframe: "1d", rangePreset: "1m", visibleFrom: null, visibleTo: null },
          ],
        },
      }),
    });
  });

  await signIn(page);
  await gotoAndSettle(page, "/trades?symbol=DEMOC");
  const demoClosedTrade = page.getByRole("button", { name: /DEMOC SHORT/ }).first();
  await expect(demoClosedTrade).toBeVisible();
  groupKey = await demoClosedTrade.getAttribute("data-group-key");
  expect(groupKey).toBeTruthy();

  await demoClosedTrade.click();
  await expect(page.getByText("Chart layout failed to load.").first()).toBeVisible();
  expect(layoutGetCount).toBe(1);
  await expect(page.getByTitle("1+2")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reset" })).toBeDisabled();

  await page.getByRole("button", { name: /retry chart layout/i }).click();
  await expect(page.getByText("Chart layout failed to load.")).toBeHidden();
  await expect(page.getByLabel("Timeframe").first()).toHaveValue("1H");
  expect(layoutGetCount).toBe(2);

  await page.unroute(layoutRoutePattern);
  await page.route(layoutRoutePattern, async (route) => {
    if (route.request().method() !== "PUT") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "Layout changed in another tab.", currentVersion: 99 }),
    });
  });

  await page.getByTitle("Switch to 1D").first().click();
  await expect(page.getByText("Layout changed in another tab.").first()).toBeVisible();
  await expect(page.getByText("Read-only").first()).toBeVisible();
  await expect(page.getByTitle("1+2")).toBeDisabled();
  await expect(page.getByLabel("Timeframe").first()).toBeDisabled();
  await page.unroute(layoutRoutePattern);

  const annotationsRoutePattern = "**/api/closed-trades/*/annotations";
  let reloadLayoutGetCount = 0;
  let reloadDrawingGetCount = 0;
  const postReloadLayoutPutBodies: Array<{ version?: number; panels?: Array<{ timeframe?: string }> }> = [];
  let postReloadDrawingPutBody: { version?: number; annotations?: Array<{ id?: string }> } | null = null;
  const persistedAnnotation = {
    id: "server-drawing",
    groupKey,
    panelId: "panel-1",
    symbol: "DEMOC",
    timeframe: "15m",
    scope: "TRADE",
    type: "horizontal",
    points: [],
    price: 432.1,
    text: "Server persisted line",
    style: { color: "#2563eb" },
    createdAt: "2026-06-26T00:00:00.000Z",
    updatedAt: "2026-06-26T00:00:00.000Z",
  };

  await page.route(layoutRoutePattern, async (route) => {
    if (route.request().method() === "GET") {
      reloadLayoutGetCount += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          layout: {
            id: "server-layout",
            groupKey,
            layoutMode: "single",
            version: 99,
            panels: [{ id: "panel-1", symbol: "DEMOC", timeframe: "15m", rangePreset: "trade", visibleFrom: null, visibleTo: null }],
          },
        }),
      });
      return;
    }
    if (route.request().method() === "PUT") {
      const postReloadLayoutPutBody = route.request().postDataJSON() as { version?: number; panels?: Array<{ timeframe?: string }> };
      postReloadLayoutPutBodies.push(postReloadLayoutPutBody);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ layout: { ...postReloadLayoutPutBody, id: "server-layout", groupKey, version: 100 } }),
      });
      return;
    }
    await route.continue();
  });

  await page.route(annotationsRoutePattern, async (route) => {
    if (route.request().method() === "GET") {
      reloadDrawingGetCount += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ annotations: [persistedAnnotation], version: 12, updatedAt: persistedAnnotation.updatedAt }),
      });
      return;
    }
    if (route.request().method() === "PUT") {
      postReloadDrawingPutBody = route.request().postDataJSON() as typeof postReloadDrawingPutBody;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ annotations: postReloadDrawingPutBody?.annotations ?? [], version: 13, updatedAt: persistedAnnotation.updatedAt }),
      });
      return;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: /reload latest/i }).click();
  await expect(page.getByText("Read-only", { exact: true }).first()).toBeHidden();
  await expect(page.getByText("Layout changed in another tab.").first()).toBeHidden();
  await expect(page.getByLabel("Timeframe").first()).toHaveValue("15M");
  expect(reloadLayoutGetCount).toBe(1);
  expect(reloadDrawingGetCount).toBe(1);
  await expect(page.getByTitle("1+2")).toBeEnabled();

  await page.getByTitle("Switch to 1H").first().click();
  await expect.poll(() => postReloadLayoutPutBodies.some((body) => body.panels?.[0]?.timeframe === "1h")).toBe(true);
  const oneHourSave = [...postReloadLayoutPutBodies].reverse().find((body) => body.panels?.[0]?.timeframe === "1h");
  expect(oneHourSave?.version ?? 0).toBeGreaterThanOrEqual(99);

  await page.getByTitle("Store execution markers").click();
  await expect.poll(() => postReloadDrawingPutBody?.version).toBe(12);
  expect(postReloadDrawingPutBody?.annotations?.some((annotation) => annotation.id === "server-drawing")).toBe(true);
  await page.unroute(layoutRoutePattern);
  await page.unroute(annotationsRoutePattern);
  await page.unroute("**/api/market/candles**");

  expect(browserErrors).toEqual([]);
});

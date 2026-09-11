import { expect, test, Page } from "@playwright/test";
import { demoCandles, demoTrades } from "../../src/lib/workstation/demo";
import { aggregateCandles } from "../../src/lib/workstation/math";

async function open(page: Page) {
  const errors: string[] = [],
    requests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  await page.goto("/preview/trades");
  await expect(page.locator(".ws-chart")).toHaveCount(3);
  await expect(page.locator(".ws-chart-state")).toHaveCount(0);
  await expect(page.locator(".ws-chart").first()).toHaveAttribute(
    "data-visible-from",
    /\d+/,
  );
  return { errors, requests };
}
const dimensions = (page: Page) =>
  page.locator(".ws-chart-canvas").evaluateAll((elements) =>
    elements.map((element) => ({
      width: element.clientWidth,
      height: element.clientHeight,
    })),
  );
const windows = (page: Page) =>
  page.locator(".ws-chart").evaluateAll((elements) =>
    elements.map((element) => ({
      from: Number(element.getAttribute("data-visible-from")),
      to: Number(element.getAttribute("data-visible-to")),
    })),
  );

test("collapsed panels reclaim space, focus restores drafts and layout survives reload", async ({
  page,
}, testInfo) => {
  const { errors, requests } = await open(page);
  await expect(page.locator(".ws-page-heading")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Show Executions", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  const compact = await dimensions(page);
  expect(compact[1].height).toBeGreaterThan(300);
  expect(compact[2].height).toBeGreaterThan(300);
  await page.screenshot({
    path: testInfo.outputPath("workstation-compact-dark.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Show Executions", exact: true })
    .click();
  await expect
    .poll(async () => (await dimensions(page))[1].height)
    .toBeLessThan(compact[1].height - 40);
  await page
    .getByRole("button", { name: "Collapse review panels", exact: true })
    .first()
    .click();
  await expect
    .poll(async () => (await dimensions(page))[1].height)
    .toBe(compact[1].height);
  await page
    .getByRole("button", { name: "Show page title", exact: true })
    .click();
  await expect(page.locator(".ws-page-heading")).toBeVisible();
  await expect
    .poll(async () => (await dimensions(page))[1].height)
    .toBeLessThan(compact[1].height - 20);
  await page
    .getByRole("button", { name: "Hide page title", exact: true })
    .click();
  await page
    .getByPlaceholder("What will you repeat or change?")
    .fill("Keep this review when panels collapse.");
  await page.getByRole("button", { name: "Chart focus", exact: true }).click();
  await expect(page.locator(".ws-topbar")).toBeHidden();
  await expect
    .poll(async () => (await dimensions(page))[1].height)
    .toBeGreaterThan(compact[1].height + 50);
  const focused = await dimensions(page);
  await testInfo.attach("chart-canvas-sizes", {
    body: JSON.stringify({ compact, focused }, null, 2),
    contentType: "application/json",
  });
  expect(focused[1].width).toBeGreaterThan(compact[1].width + 100);
  await page.screenshot({
    path: testInfo.outputPath("workstation-focus-dark.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Exit chart focus", exact: true })
    .click();
  await expect(
    page.getByPlaceholder("What will you repeat or change?"),
  ).toHaveValue("Keep this review when panels collapse.");
  await expect
    .poll(async () => (await dimensions(page))[1].height)
    .toBe(compact[1].height);
  await page.reload();
  await expect(page.locator(".ws-page-heading")).toBeHidden();
  await expect(
    page.getByPlaceholder("What will you repeat or change?"),
  ).toHaveValue("Keep this review when panels collapse.");
  await expect(
    page.getByRole("button", { name: "Show Executions", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
});

async function dateMenu(page: Page) {
  if ((await page.locator(".ws-date-control").getAttribute("open")) === null)
    await page.getByLabel("Date synchronization", { exact: true }).click();
}
async function moveChartIndependently(page: Page, index: number, date: string) {
  await page
    .locator(".ws-chart")
    .nth(index)
    .locator(".ws-chart-symbol strong")
    .click();
  await dateMenu(page);
  await page
    .getByLabel("Date linking", { exact: true })
    .selectOption("independent");
  await page.getByLabel("Target date UTC", { exact: true }).fill(date);
  await page.getByRole("button", { name: "Go to date", exact: true }).click();
  const target = Date.parse(`${date}Z`) / 1000;
  await expect
    .poll(async () => (await windows(page))[index].to)
    .toBeLessThan(target + 20 * 86400);
  await page.getByLabel("Date linking", { exact: true }).selectOption("target");
  await page.getByLabel("Date synchronization", { exact: true }).click();
}
const barSpans = (page: Page) =>
  page
    .locator(".ws-chart")
    .evaluateAll((charts) =>
      charts.map((chart) => Number(chart.getAttribute("data-visible-bars"))),
    );

// Allow the 180ms history/viewport debounce to finish when asserting no movement.
const settleViewport = (page: Page) => page.waitForTimeout(500);

test("clicking a date moves only charts missing it and preserves their zoom", async ({
  page,
}, testInfo) => {
  const { errors, requests } = await open(page);
  await moveChartIndependently(page, 1, "2025-09-09T15:00");
  await settleViewport(page);
  const before = await windows(page),
    spans = await barSpans(page);
  const box = (await page.locator(".ws-chart-canvas").first().boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.55, box.y + 60);
  await expect(page.getByLabel("Target date UTC", { exact: true })).toHaveValue(
    /^2026-09-09T/,
  );
  const target =
    Date.parse(
      `${await page.getByLabel("Target date UTC", { exact: true }).inputValue()}Z`,
    ) / 1000;
  await expect
    .poll(async () => {
      const window = (await windows(page))[1];
      return window.from <= target && window.to + 3600 > target;
    })
    .toBe(true);
  await settleViewport(page);
  const after = await windows(page);
  expect(after[0]).toEqual(before[0]);
  expect(after[2]).toEqual(before[2]);
  expect(Math.abs((await barSpans(page))[1] - spans[1])).toBeLessThanOrEqual(1);
  await page.mouse.click(box.x + box.width * 0.55, box.y + 60);
  await settleViewport(page);
  expect(await windows(page)).toEqual(after);
  await page.screenshot({
    path: testInfo.outputPath("workstation-click-linked-date.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
});

test("zooming and dragging any chart stay independent; drawing clicks do not navigate", async ({
  page,
}) => {
  const { errors, requests } = await open(page);
  for (let index = 0; index < 3; index++) {
    const before = await windows(page);
    const beforeSpans = await barSpans(page);
    const box = (await page
      .locator(".ws-chart-canvas")
      .nth(index)
      .boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.85);
    await page.mouse.wheel(0, -220);
    await expect
      .poll(async () => (await barSpans(page))[index])
      .not.toEqual(beforeSpans[index]);
    await settleViewport(page);
    const zoomed = await windows(page);
    expect(zoomed.filter((_, i) => i !== index)).toEqual(
      before.filter((_, i) => i !== index),
    );
    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.85);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.85, {
      steps: 12,
    });
    await page.mouse.up();
    await expect
      .poll(async () => (await windows(page))[index])
      .not.toEqual(zoomed[index]);
    await settleViewport(page);
    expect((await windows(page)).filter((_, i) => i !== index)).toEqual(
      zoomed.filter((_, i) => i !== index),
    );
  }
  await moveChartIndependently(page, 1, "2025-09-09T15:00");
  const beforeNote = (await windows(page))[1];
  await page.getByRole("button", { name: "Text note", exact: true }).click();
  const box = (await page.locator(".ws-chart-canvas").first().boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await expect(
    page.getByLabel("Annotation text", { exact: true }),
  ).toBeVisible();
  await settleViewport(page);
  expect((await windows(page))[1]).toEqual(beforeNote);
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
});

test("target linking keeps interval-specific spans and independent navigation leaves other charts alone", async ({
  page,
}) => {
  const { errors, requests } = await open(page);
  await page.getByLabel("Date synchronization", { exact: true }).click();
  await page
    .getByLabel("Target date UTC", { exact: true })
    .fill("2025-09-09T15:00");
  await page.getByRole("button", { name: "Go to date", exact: true }).click();
  const target = Date.parse("2025-09-09T15:00Z") / 1000;
  await expect
    .poll(async () =>
      (await windows(page)).every(
        (range) => range.from < target && range.to > target,
      ),
    )
    .toBe(true);
  const linked = await windows(page);
  expect(linked[2].to - linked[2].from).toBeGreaterThan(
    (linked[0].to - linked[0].from) * 10,
  );
  await page
    .getByLabel("Date linking", { exact: true })
    .selectOption("independent");
  await page
    .getByLabel("Target date UTC", { exact: true })
    .fill("2025-08-12T15:00");
  await page.getByRole("button", { name: "Go to date", exact: true }).click();
  await expect
    .poll(async () => (await windows(page))[0].to)
    .toBeLessThan(target - 20 * 86400);
  expect((await windows(page)).slice(1)).toEqual(linked.slice(1));
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
});

test("hourly and daily chart clicks reveal the trade date, and execution selections move only missing views", async ({
  page,
}) => {
  const { errors, requests } = await open(page);
  await moveChartIndependently(page, 0, "2025-09-09T15:00");
  await settleViewport(page);
  const beforeHourly = await windows(page);
  const hourBox = (await page
    .locator(".ws-chart-canvas")
    .nth(1)
    .boundingBox())!;
  await page.mouse.click(
    hourBox.x + (hourBox.width - 60) * 0.5,
    hourBox.y + hourBox.height * 0.82,
  );
  await expect
    .poll(async () => (await windows(page))[0].to)
    .toBeGreaterThan(demoTrades[0].openTime);
  await settleViewport(page);
  expect((await windows(page)).slice(1)).toEqual(beforeHourly.slice(1));

  await moveChartIndependently(page, 1, "2025-09-09T15:00");
  await settleViewport(page);
  const beforeDaily = await windows(page);
  const daily = aggregateCandles(demoCandles(demoTrades[0]), "1d").filter(
    (bar) => bar.time >= beforeDaily[2].from && bar.time <= beforeDaily[2].to,
  );
  const day = Math.floor(demoTrades[0].openTime / 86400) * 86400;
  const fraction =
    (daily.findIndex((bar) => bar.time === day) + 0.5) / daily.length;
  const dayBox = (await page.locator(".ws-chart-canvas").nth(2).boundingBox())!;
  await page.mouse.click(
    dayBox.x + (dayBox.width - 60) * fraction,
    dayBox.y + dayBox.height * 0.82,
  );
  await expect(page.getByLabel("Target date UTC", { exact: true })).toHaveValue(
    "2026-09-09T00:00",
  );
  await expect
    .poll(async () => {
      const view = (await windows(page))[1];
      return (
        view.from <= demoTrades[0].openTime &&
        view.to + 3600 > demoTrades[0].openTime
      );
    })
    .toBe(true);
  await settleViewport(page);
  const afterDaily = await windows(page);
  expect(afterDaily[0]).toEqual(beforeDaily[0]);
  expect(afterDaily[2]).toEqual(beforeDaily[2]);
  await page.mouse.click(
    dayBox.x + (dayBox.width - 60) * fraction,
    dayBox.y + dayBox.height * 0.82,
  );
  await settleViewport(page);
  expect(await windows(page)).toEqual(afterDaily);

  await page
    .getByRole("button", { name: "Show Executions", exact: true })
    .click();
  await settleViewport(page);
  const beforeExecution = await windows(page);
  await page.getByLabel("Focus execution 1", { exact: true }).click();
  const fill = demoTrades[0].executions[0];
  await expect
    .poll(async () => {
      const view = (await windows(page))[0];
      return view.from <= fill.time && view.to + 300 > fill.time;
    })
    .toBe(true);
  await settleViewport(page);
  expect((await windows(page)).slice(1)).toEqual(beforeExecution.slice(1));
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
});

test("existing window-sync preferences migrate without resetting the chosen theme or title visibility", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "execution-lab:workstation:preferences:demo:v1",
      JSON.stringify({ dateLink: "window", theme: "light", heading: true }),
    ),
  );
  const { errors, requests } = await open(page);
  await expect(page.locator(".workstation")).toHaveClass(/ws-light/);
  await expect(page.locator(".ws-page-heading")).toBeVisible();
  await dateMenu(page);
  await expect(page.getByLabel("Date linking", { exact: true })).toHaveValue(
    "target",
  );
  await expect(
    page.getByRole("option", { name: "Same calendar window", exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem(
              "execution-lab:workstation:preferences:demo:v1",
            )!,
          ).dateLink,
      ),
    )
    .toBe("target");
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
});

test("multichart PNG export retains all three chart images in the chosen arrangement", async ({
  page,
}, testInfo) => {
  const { errors, requests } = await open(page);
  await page.getByLabel("Chart settings", { exact: true }).click();
  await page
    .getByLabel("Chart arrangement", { exact: true })
    .selectOption("top");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "All charts PNG", exact: true })
    .click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  await download.saveAs(
    testInfo.outputPath("workstation-multichart-export.png"),
  );
  expect(await download.failure()).toBeNull();
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
});

test("top arrangement, laptop and mobile retain usable charts in both themes", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { errors, requests } = await open(page);
  expect((await dimensions(page))[1].height).toBeGreaterThan(240);
  await page.getByLabel("Chart settings", { exact: true }).click();
  await page
    .getByLabel("Chart arrangement", { exact: true })
    .selectOption("top");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(page.locator(".ws-chart-grid")).toHaveClass(
    /ws-arrangement-top/,
  );
  await page.getByRole("button", { name: "Chart focus", exact: true }).click();
  const boxes = await page.locator(".ws-chart").evaluateAll((elements) =>
    elements.map((element) => {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }),
  );
  expect(boxes[0].width).toBeGreaterThan(boxes[1].width * 1.9);
  expect(boxes[1].y).toBe(boxes[2].y);
  expect((await dimensions(page))[1].height).toBeGreaterThan(300);
  await page.screenshot({
    path: testInfo.outputPath("workstation-top-focus-laptop.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Exit chart focus", exact: true })
    .click();
  await page.getByTitle("Appearance", { exact: true }).click();
  await page.screenshot({
    path: testInfo.outputPath("workstation-compact-light-laptop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Choose trade", { exact: true })).toBeVisible();
  const mobile = await dimensions(page);
  expect(
    mobile.every((chart) => chart.width > 300 && chart.height >= 250),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("workstation-compact-mobile.png"),
    fullPage: true,
  });
  await page.getByLabel("Chart history chart-1", { exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "History details chart-1", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "History details chart-1", exact: true }),
  ).toBeHidden();
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
});

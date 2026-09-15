import { showTakeaways } from "./review-helpers";
import { expect, test, Page } from "@playwright/test";
import { createHash } from "node:crypto";

async function openPreview(page: Page) {
  const errors: string[] = [],
    apiRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) => {
    apiRequests.push(route.request().url());
    return route.abort();
  });
  await page.goto("/preview/trades");
  const chart = page.getByRole("region", {
    name: "NVDA 5m chart",
    exact: true,
  });
  await chart.getByLabel("Chart history chart-1", { exact: true }).click();
  await expect(
    chart.getByRole("button", { name: "Load older", exact: true }),
  ).toBeEnabled();
  await expect(chart.locator(".ws-chart-coverage")).toContainText(
    "4 executions",
  );
  return { chart, errors, apiRequests };
}

test("prepending preserves execution/drawing pixel positions; reviews and drawings recover on reload", async ({
  page,
}) => {
  const { chart, errors, apiRequests } = await openPreview(page);
  const history = chart.getByRole("status").first();
  const count = async () =>
    Number((await history.innerText()).match(/[\d,]+/)![0].replaceAll(",", ""));
  const initial = await count();
  const overlay = chart.locator(".ws-chart-overlay");
  const pixels = async () =>
    createHash("sha256")
      .update(
        await overlay.evaluate((canvas: HTMLCanvasElement) =>
          canvas.toDataURL(),
        ),
      )
      .digest("hex");
  await page.mouse.move(80, 100);
  const before = await pixels();
  await chart.getByRole("button", { name: "Load older", exact: true }).click();
  await expect.poll(count).toBeGreaterThan(initial);
  await page.mouse.move(80, 100);
  await expect.poll(pixels).toBe(before);
  await showTakeaways(page);
  await page
    .getByRole("textbox", { name: "Takeaways", exact: true })
    .fill("History review survives reload");
  await expect(
    page.getByText("Saved on this device", { exact: true }).first(),
  ).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(() =>
        localStorage.getItem("execution-lab:workstation:demo:v1:demo-nvda"),
      ),
    )
    .toContain("History review survives reload");
  await page.reload(); await showTakeaways(page);
  await expect(
    page.getByRole("textbox", { name: "Takeaways", exact: true }),
  ).toHaveText("History review survives reload");
  expect(errors).toEqual([]);
  expect(apiRequests).toEqual([]);
});

test("dragging to the history edge fetches older bars and timeframe changes remain interactive", async ({
  page,
}) => {
  const { chart, errors, apiRequests } = await openPreview(page);
  const status = chart.getByRole("status").first();
  const initial = await status.innerText();
  const box = (await chart.locator(".ws-chart-canvas").boundingBox())!;
  for (let i = 0; i < 3; i++) {
    await page.mouse.move(box.x + 50, box.y + box.height * 0.65);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 100, box.y + box.height * 0.65, {
      steps: 12,
    });
    await page.mouse.up();
  }
  await chart.getByLabel("Chart history chart-1", { exact: true }).click();
  await expect(status).not.toHaveText(initial);
  await expect(status).not.toContainText("Loading");
  await page
    .getByLabel("Timeframe chart-1", { exact: true })
    .selectOption("15m");
  const changed = page.getByRole("region", {
    name: "NVDA 15m chart",
    exact: true,
  });
  if (
    (await changed
      .getByLabel("Chart history chart-1", { exact: true })
      .getAttribute("aria-expanded")) !== "true"
  )
    await changed.getByLabel("Chart history chart-1", { exact: true }).click();
  await expect(
    changed.getByRole("button", { name: "Load older", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("Timeframe chart-1", { exact: true })
    .selectOption("5m");
  await expect(
    chart.getByRole("button", { name: "Load older", exact: true }),
  ).toBeEnabled();
  await chart.getByLabel("Fit trade chart-1", { exact: true }).click();
  await chart.getByLabel("Chart history chart-1", { exact: true }).click();
  await expect(chart.locator(".ws-chart-coverage")).toContainText(
    "4 executions",
  );
  expect(errors).toEqual([]);
  expect(apiRequests).toEqual([]);
});

test("replay disables newer history and a fresh preview renders in both themes and mobile", async ({
  page,
}, testInfo) => {
  const { chart, errors, apiRequests } = await openPreview(page);
  await chart.getByLabel("Close history chart-1", { exact: true }).click();
  await page.screenshot({
    path: testInfo.outputPath("workstation-dark.png"),
    fullPage: true,
  });
  const overlay = chart.locator(".ws-chart-overlay");
  const pixels = async () =>
    createHash("sha256")
      .update(
        await overlay.evaluate((canvas: HTMLCanvasElement) =>
          canvas.toDataURL(),
        ),
      )
      .digest("hex");
  const before = await pixels();
  await page.getByRole("button", { name: "Replay trade", exact: true }).click();
  await chart.getByLabel("Chart history chart-1", { exact: true }).click();
  await expect(
    chart.getByRole("button", { name: "Load newer", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Exit replay", exact: true }).click();
  await page.mouse.move(80, 100);
  await expect.poll(pixels).toBe(before);
  await page.getByTitle("Appearance", { exact: true }).click();
  await expect(page.locator(".workstation")).toHaveClass(/ws-light/);
  await page.screenshot({
    path: testInfo.outputPath("workstation-light.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Choose trade", { exact: true })).toBeVisible();
  await chart.getByLabel("Chart history chart-1", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Load older", exact: true }).first(),
  ).toBeVisible();
  await chart.getByLabel("Close history chart-1", { exact: true }).click();
  await page.screenshot({
    path: testInfo.outputPath("workstation-mobile.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
  expect(apiRequests).toEqual([]);
});

test("history controls work by keyboard at laptop size with reduced motion", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { chart, errors, apiRequests } = await openPreview(page);
  const status = chart.getByRole("status").first(),
    initial = await status.innerText();
  const older = chart.getByRole("button", { name: "Load older", exact: true });
  await older.focus();
  await expect(older).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(status).not.toHaveText(initial);
  await expect(older).toBeEnabled();
  await chart.getByLabel("Close history chart-1", { exact: true }).click();
  await page.mouse.move(80, 100);
  await page.screenshot({
    path: testInfo.outputPath("workstation-laptop-dark.png"),
    fullPage: true,
  });
  await page.getByTitle("Appearance", { exact: true }).click();
  await page.screenshot({
    path: testInfo.outputPath("workstation-laptop-light.png"),
    fullPage: true,
  });
  await page.getByTitle("Appearance", { exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Choose trade", { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("workstation-mobile-dark.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
  expect(apiRequests).toEqual([]);
});

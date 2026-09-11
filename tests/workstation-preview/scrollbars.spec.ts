import { expect, test, type Page } from "@playwright/test";

async function open(page: Page) {
  await page.route("**/api/**", route => route.abort());
  await page.goto("/preview/trades");
  await expect(page.locator(".ws-chart")).toHaveCount(3);
  await expect(page.locator(".ws-chart-state")).toHaveCount(0);
}

async function samples(page: Page) {
  // Let legitimate viewport and panel changes settle before checking stability.
  await page.waitForTimeout(350);
  return page.locator(".ws-resizable-grid").evaluate(async host => {
    const frames = [];
    for (let i = 0; i < 45; i++) {
      await new Promise(requestAnimationFrame);
      frames.push({ width: host.clientWidth, height: host.clientHeight, scrollWidth: host.scrollWidth, scrollHeight: host.scrollHeight });
    }
    return frames;
  });
}

test("desktop layouts remain stable with native scrollbars enabled", async ({ page }) => {
  await page.setViewportSize({ width: 1830, height: 710 });
  await open(page);
  for (const count of [3, 2, 4, 1]) {
    await page.getByLabel("Number of charts").selectOption(String(count));
    const frames = await samples(page);
    expect(new Set(frames.map(frame => JSON.stringify(frame))).size).toBe(1);
    expect(frames.every(frame => frame.scrollWidth <= frame.width && frame.scrollHeight <= frame.height)).toBe(true);
  }
  await page.getByLabel("Number of charts").selectOption("3");
  await page.getByLabel("Chart settings", { exact: true }).click();
  await page.getByLabel("Chart arrangement").selectOption("top");
  await page.getByLabel("Close dialog", { exact: true }).click();
  await page.getByRole("button", { name: "Chart focus", exact: true }).click();
  const focused = await samples(page);
  expect(new Set(focused.map(frame => JSON.stringify(frame))).size).toBe(1);
  expect(focused.every(frame => frame.scrollWidth <= frame.width && frame.scrollHeight <= frame.height)).toBe(true);
  await page.getByRole("button", { name: "Exit chart focus", exact: true }).click();
  await page.getByRole("button", { name: "Focus chart-1", exact: true }).click();
  await expect(page.locator(".ws-chart-fullscreen")).toBeVisible();
  await page.keyboard.press("Escape");
  const restored = await samples(page);
  expect(new Set(restored.map(frame => JSON.stringify(frame))).size).toBe(1);
  expect(restored.every(frame => frame.scrollWidth <= frame.width && frame.scrollHeight <= frame.height)).toBe(true);
});

test("fractional layout sizes stay stable in both themes", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 901 });
  await open(page);
  await page.evaluate(() => { document.documentElement.style.zoom = "1.1"; });
  for (const theme of ["dark", "light"]) {
    if (theme === "light") await page.getByTitle("Appearance", { exact: true }).click();
    const frames = await samples(page);
    expect(new Set(frames.map(frame => JSON.stringify(frame))).size).toBe(1);
    expect(frames.every(frame => frame.scrollWidth <= frame.width && frame.scrollHeight <= frame.height)).toBe(true);
  }
});

test("stacked charts retain stable vertical scrolling without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(page.locator(".ws-resizable-grid")).toHaveAttribute("data-stacked", "true");
  const frames = await samples(page);
  expect(new Set(frames.map(frame => JSON.stringify(frame))).size).toBe(1);
  expect(frames.every(frame => frame.scrollWidth <= frame.width && frame.scrollHeight > frame.height)).toBe(true);
  const last = page.getByRole("separator", { name: "Chart 3 height" });
  await last.scrollIntoViewIfNeeded();
  await last.focus();
  await page.keyboard.press("ArrowDown");
  await expect(last).toHaveAttribute("aria-valuenow", "310");
  const resized = await samples(page);
  expect(new Set(resized.map(frame => JSON.stringify(frame))).size).toBe(1);
  expect(resized.every(frame => frame.scrollWidth <= frame.width)).toBe(true);
});

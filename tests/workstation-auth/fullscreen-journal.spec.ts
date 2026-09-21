import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { defaultPreferences, type TradeDocument } from "../../src/lib/workstation/types";
import { fallbackLayout } from "../../src/lib/workstation/template-layout";
import { candleFixture } from "./candle-fixture";

test("authenticated fullscreen replay edits, deliberate default clearing and PNG bytes survive reload/export", async ({ page, context }) => {
  const groupKey = "DEMO-NOTION-VALIDATION", endpoint = `/api/closed-trades/${groupKey}/workstation`;
  const { csrfToken } = await (await context.request.get("/api/auth/csrf")).json();
  await context.request.post("/api/auth/callback/credentials", { form: { csrfToken, username: "phase2-reviewer", password: "phase2-local-test-only", json: "true" } });
  expect((await (await context.request.get("/api/auth/session")).json()).user.name).toBe("phase2-reviewer");
  const read = async () => await (await context.request.get(endpoint)).json() as TradeDocument;
  const before = await read();
  await context.route("**/api/workstation/notion/template", route => route.fulfill({ json: { layout: fallbackLayout } }));
  await context.route("**/api/workstation/candles?**", route => route.fulfill({ json: candleFixture(route.request().url()) }));
  await page.addInitScript(prefs => localStorage.setItem("execution-lab:workstation:preferences:application:v1", JSON.stringify({ ...prefs, journal: true, panels: [{ id: "chart-1", interval: "5m" }] })), defaultPreferences());
  await page.goto(`/trades?account=DEMO-WORKSTATION&groupKey=${groupKey}`);
  await expect(page.locator(".ws-chart")).toHaveAttribute("data-visible-bars", /[1-9]/);
  await page.getByRole("button", { name: "Replay trade", exact: true }).click();
  await page.getByRole("button", { name: "Focus chart-1", exact: true }).click();
  await page.getByRole("button", { name: "Show fullscreen journal" }).click();
  const sidebar = page.getByRole("complementary", { name: "Fullscreen trade journal" });
  await sidebar.locator("summary").filter({ hasText: /^Trade properties$/ }).click();
  const reviewType = sidebar.getByLabel("Type of Review", { exact: true });
  // Also supports rerunning against this disposable fixture after intentional clearing.
  expect(before.review.notion?.executedTradeDefaults).toBe(1);
  if (!await sidebar.getByTitle("Remove Taken Trade", { exact: true }).count()) { await reviewType.fill("Taken Trade"); await reviewType.press("Enter"); }
  await sidebar.getByTitle("Remove Taken Trade", { exact: true }).click();
  await expect.poll(async () => (await read()).review.notion?.properties.typeOfReview).toEqual([]);
  await sidebar.locator("summary").filter({ hasText: /^Takeaways$/ }).click();
  const note = sidebar.getByRole("textbox", { name: "Takeaways", exact: true });
  await note.fill("Authenticated fullscreen replay review");
  await sidebar.getByRole("button", { name: "Attach current chart to Takeaways", exact: true }).click();
  await expect.poll(async () => (await read()).evidence.length).toBe(before.evidence.length + 1);
  const captured = (await read()).evidence.at(-1)!;
  expect(captured.replayAt).toBeGreaterThan(0);
  const png = Buffer.from(captured.image.split(",")[1], "base64"); expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(1920);
  await page.reload();
  expect((await read()).review.notion?.properties.typeOfReview).toEqual([]);
  expect((await read()).review.takeaway).toContain("Authenticated fullscreen replay review");
  await page.getByRole("button", { name: "Export review for Notion", exact: true }).click();
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Review page ZIP", exact: true }).click();
  const files = unzipSync(await readFile((await (await download).path())!));
  expect(Object.entries(files).some(([name, bytes]) => name.startsWith("assets/") && Buffer.from(bytes).equals(png))).toBe(true);
  expect((await read()).evidence.slice(0, before.evidence.length)).toEqual(before.evidence);
});

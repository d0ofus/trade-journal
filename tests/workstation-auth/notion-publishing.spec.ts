import { expect, test } from "@playwright/test";
import { defaultPreferences, type TradeDocument } from "../../src/lib/workstation/types";
import { fallbackLayout } from "../../src/lib/workstation/template-layout";
import type { PublicationResult } from "../../src/lib/workstation/notion-publication-client";
import { candleFixture } from "./candle-fixture";

test("authenticated saves automatically prepare a fresh preview and explicitly update the same page", async ({ page, context }) => {
  const groupKey = "DEMO-NOTION-VALIDATION", endpoint = `/api/closed-trades/${groupKey}/workstation`;
  const { csrfToken } = await (await context.request.get("/api/auth/csrf")).json();
  await context.request.post("/api/auth/callback/credentials", { form: { csrfToken, username: "phase2-reviewer", password: "phase2-local-test-only", json: "true" } });
  expect((await (await context.request.get("/api/auth/session")).json()).user.name).toBe("phase2-reviewer");
  const read = async () => await (await context.request.get(endpoint)).json() as TradeDocument;
  let job: PublicationResult["job"] = null, lastPublished: number | null = null, publishedText = "", confirms = 0, resumes = 0;
  const pageUrl = "https://notion.invalid/synthetic-page";
  await context.route("**/api/workstation/notion/template", route => route.fulfill({ json: { layout: fallbackLayout } }));
  await context.route("**/api/workstation/candles?**", route => route.fulfill({ json: candleFixture(route.request().url()) }));
  // Only publication transport is mocked. Authentication, autosave and reload
  // use the isolated PostgreSQL adapter; no live Notion writes are possible.
  await context.route("**/api/workstation/notion/publications**", async route => {
    const doc = await read(), body = route.request().method() === "POST" ? route.request().postDataJSON() : null;
    if (body?.action === "preview") {
      expect(body.revision).toBe(doc.revision);
      if (job?.state !== "succeeded" || job.revision !== doc.revision) job = { id: `job-${doc.revision}`, groupKey, revision: doc.revision, state: "preview", phase: "preview", error: null, retryAt: null, pageUrl: lastPublished === null ? null : pageUrl, missingSections: [], templateVersion: "test", properties: [], omitted: [], errors: [], assets: [], sections: [{ key: "takeaways", label: "Takeaways", blocks: 1, images: 0, done: false, html: doc.review.takeaway, imageIds: [] }] };
    } else if (body?.action === "publish") {
      expect(body.id).toBe(job?.id); confirms++;
      job = { ...job!, state: "waiting", phase: "template_wait", retryAt: new Date(Date.now() + 2000), pageUrl };
    } else if (body?.action === "resume") {
      resumes++; lastPublished = job!.revision; publishedText = job!.sections[0].html!;
      job = { ...job!, state: "succeeded", phase: "succeeded", retryAt: null };
    }
    await route.fulfill({ json: { enabled: true, job, publication: { savedRevision: doc.revision, lastPublishedRevision: lastPublished, pageUrl: job?.pageUrl ?? null, activeJobId: job?.state === "waiting" ? job.id : null } } });
  });
  await page.addInitScript(prefs => localStorage.setItem("execution-lab:workstation:preferences:application:v1", JSON.stringify({ ...prefs, journal: true, panels: [{ id: "chart-1", interval: "5m" }] })), defaultPreferences());
  await page.goto(`/trades?account=DEMO-WORKSTATION&groupKey=${groupKey}`);
  await expect(page.locator(".ws-chart")).toHaveAttribute("data-visible-bars", /[1-9]/);
  await page.locator("summary").filter({ hasText: /^Takeaways$/ }).click();
  const note = page.getByRole("textbox", { name: "Takeaways", exact: true }), dialog = page.getByRole("dialog", { name: "Publish/update in Notion", exact: true });
  for (const [index, text] of ["Fresh first journal content", "Edited journal content reaches the same page"].entries()) {
    await note.fill(text);
    await page.getByRole("button", { name: "Publish/update in Notion", exact: true }).click();
    await expect(dialog.getByRole("button", { name: new RegExp(`^Confirm ${index ? "update" : "publish"} revision`) })).toBeEnabled();
    expect(confirms).toBe(index);
    await dialog.locator("summary").filter({ hasText: /^Takeaways:/ }).click(); await expect(dialog.locator(".ws-notion-preview-text")).toContainText(text);
    await dialog.getByRole("button", { name: /^Confirm / }).click();
    await expect(dialog.getByText(/Waiting for Notion to apply/)).toBeVisible();
    await expect(dialog.getByText("This saved revision has already been published.")).toBeVisible();
    expect(confirms).toBe(index + 1); expect(resumes).toBe(index + 1); expect(publishedText).toContain(text);
    await expect(dialog.getByRole("link", { name: "Open app-owned Notion page" })).toHaveAttribute("href", pageUrl);
    await dialog.getByRole("button", { name: "Close dialog", exact: true }).click();
  }
  await page.reload(); expect((await read()).review.takeaway).toContain("Edited journal content reaches the same page");
  await page.getByRole("button", { name: "Publish/update in Notion", exact: true }).click();
  await expect(dialog.getByText("This saved revision has already been published.")).toBeVisible(); expect(confirms).toBe(2);
});

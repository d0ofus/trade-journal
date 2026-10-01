import { expect, test } from "@playwright/test";
import { defaultPreferences, type TradeDocument } from "../../src/lib/workstation/types";
import { fallbackLayout } from "../../src/lib/workstation/template-layout";
import type { PublicationResult } from "../../src/lib/workstation/notion-publication-client";
import { candleFixture } from "./candle-fixture";
import { resetSyntheticLayouts, notionFixtureKey } from "./reset-layout";
import { prisma } from "../../src/lib/prisma";
import { readWorkstationDocument, saveWorkstationDocument } from "../../src/lib/server/trade-workstation";
import { completePublishedReview } from "../../src/lib/server/notion-review-completion";
import { jsonHash } from "../../src/lib/server/notion-client";
test.beforeEach(async () => {
  await resetSyntheticLayouts();
  const key = await notionFixtureKey(), doc = await readWorkstationDocument(key);
  await saveWorkstationDocument(key, { ...doc, review: { ...doc.review, status: "In progress" } }, doc.revision);
});
test.afterAll(() => prisma.$disconnect());

test("authenticated saves automatically prepare a fresh preview and explicitly update the same page", async ({ page, context }) => {
  test.setTimeout(90000);
  const groupKey = await notionFixtureKey(), endpoint = `/api/closed-trades/${encodeURIComponent(groupKey)}/workstation`;
  let editorSaves = 0;
  page.on("request", request => { if (request.method() === "PATCH" && request.url().endsWith("/workstation")) editorSaves++; });
  const { csrfToken } = await (await context.request.get("/api/auth/csrf")).json();
  await context.request.post("/api/auth/callback/credentials", { form: { csrfToken, username: "phase2-reviewer", password: "phase2-local-test-only", json: "true" } });
  expect((await (await context.request.get("/api/auth/session")).json()).user.name).toBe("phase2-reviewer");
  const read = async () => await (await context.request.get(endpoint)).json() as TradeDocument;
  let job: PublicationResult["job"] = null, lastPublished: number | null = null, publishedText = "", confirms = 0, resumes = 0;
  let frozen: TradeDocument;
  const pageUrl = "https://notion.invalid/synthetic-page";
  await context.route("**/api/workstation/notion/template", route => route.fulfill({ json: { layout: fallbackLayout } }));
  await context.route("**/api/workstation/candles?**", route => route.fulfill({ json: candleFixture(route.request().url()) }));
  // Only publication transport is mocked. Authentication, autosave and reload
  // use the isolated PostgreSQL adapter; no live Notion writes are possible.
  await context.route("**/api/workstation/notion/publications**", async route => {
    const doc = await read(), body = route.request().method() === "POST" ? route.request().postDataJSON() : null;
    if (body?.action === "preview") {
      frozen = structuredClone(doc);
      expect(body.revision).toBe(doc.revision);
      if (job?.state !== "succeeded" || job.revision !== doc.revision || job.presentationVersion !== 3) job = { id: `job-${doc.revision}`, groupKey, revision: doc.revision, state: "preview", phase: "preview", error: null, retryAt: null, pageUrl: lastPublished === null ? null : pageUrl, missingSections: [], presentationVersion: 3, templateVersion: "test", properties: [], omitted: [], errors: [], assets: [], sections: [{ key: "takeaways", label: "Takeaways", blocks: 1, images: 0, done: false, html: doc.review.takeaway, imageIds: [] }] };
    } else if (body?.action === "publish") {
      expect(body.id).toBe(job?.id); confirms++;
      job = { ...job!, state: "waiting", phase: "template_wait", retryAt: new Date(Date.now() + 2000), pageUrl };
    } else if (body?.action === "resume") {
      resumes++; lastPublished = job!.revision; publishedText = job!.sections[0].html!;
      const reviewCompletion = await prisma.$transaction(tx => completePublishedReview(tx, groupKey, job!.revision, jsonHash(frozen)));
      job = { ...job!, state: "succeeded", phase: "succeeded", retryAt: null, reviewCompletion };
    }
    const saved = await read();
    await route.fulfill({ json: { enabled: true, job, publication: { savedRevision: saved.revision, savedNoteUpdatedAt: saved.noteUpdatedAt ?? null, savedJournalUpdatedAt: saved.journalUpdatedAt ?? null, lastPublishedRevision: lastPublished, pageUrl: job?.pageUrl ?? null, activeJobId: job?.state === "waiting" ? job.id : null } } });
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
    const otherTab = await context.newPage();
    await otherTab.goto(`/trades?account=DEMO-WORKSTATION&groupKey=${groupKey}`);
    await expect(otherTab.getByLabel("Review status", { exact: true })).toHaveValue(index ? "Reviewed" : "In progress");
    const draftTab = index === 0 ? await context.newPage() : null;
    if (draftTab) {
      await draftTab.route("**/workstation", route => route.request().method() === "PATCH" ? route.fulfill({ status: 503, json: { error: "Draft held for publication test" } }) : route.continue());
      await draftTab.goto(`/trades?account=DEMO-WORKSTATION&groupKey=${groupKey}`);
      await draftTab.locator("summary").filter({ hasText: /^Takeaways$/ }).click();
      await draftTab.getByRole("textbox", { name: "Takeaways", exact: true }).fill("Unsaved draft stays in this tab");
    }
    const savesBeforePublication = editorSaves;
    await dialog.getByRole("button", { name: /^Confirm / }).click();
    await expect(dialog.getByText(/Waiting for Notion to apply/)).toBeVisible();
    await expect(dialog.getByText("This saved review has already been published.")).toBeVisible();
    await expect(page.getByLabel("Review status", { exact: true })).toHaveValue("Reviewed");
    await expect(otherTab.getByLabel("Review status", { exact: true })).toHaveValue("Reviewed");
    for (const tab of [page, otherTab]) await expect(tab.locator(".ws-trade-card").filter({ has: tab.locator("strong", { hasText: "NTST" }) }).locator(".ws-review-dot")).toHaveAttribute("data-review-state", "reviewed");
    expect(editorSaves).toBe(savesBeforePublication);
    if (draftTab) {
      await expect(draftTab.getByRole("textbox", { name: "Takeaways", exact: true })).toContainText("Unsaved draft stays in this tab");
      await expect(draftTab.getByLabel("Review status", { exact: true })).toHaveValue("In progress");
      await expect(draftTab.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
      await draftTab.getByRole("button", { name: "Reload saved review", exact: true }).click();
      await expect(draftTab.getByLabel("Review status", { exact: true })).toHaveValue("Reviewed");
      await draftTab.close();
    }
    expect((await read()).review.status).toBe("Reviewed");
    await otherTab.close();
    expect(confirms).toBe(index + 1); expect(resumes).toBe(index + 1); expect(publishedText).toContain(text);
    await expect(dialog.getByRole("link", { name: "Open app-owned Notion page" })).toHaveAttribute("href", pageUrl);
    await dialog.getByRole("button", { name: "Close Publish/update in Notion", exact: true }).click();
  }
  await page.reload(); expect((await read()).review.takeaway).toContain("Edited journal content reaches the same page");
  await page.getByRole("button", { name: "Publish/update in Notion", exact: true }).click();
  await expect(dialog.getByText("This saved review has already been published.")).toBeVisible(); expect(confirms).toBe(2);
  await dialog.getByRole("button", { name: "Close Publish/update in Notion", exact: true }).click();
  const markLegacy = () => { if (!job) throw new Error("Missing completed fixture"); job.presentationVersion = 1; };
  markLegacy();
  await page.getByRole("button", { name: "Publish/update in Notion", exact: true }).click();
  await expect(dialog.getByText(/Publication format update:/)).toBeVisible();
  await expect(dialog.getByText(/Newer saved edits in revision/)).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /^Confirm update/ })).toBeEnabled();
  expect(confirms).toBe(2);
  await dialog.getByRole("button", { name: /^Confirm update/ }).click();
  await expect(dialog.getByText("This saved review has already been published.")).toBeVisible();
  expect(confirms).toBe(3); expect((await read()).review.status).toBe("Reviewed");
});

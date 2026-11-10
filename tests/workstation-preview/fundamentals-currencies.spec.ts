import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { demoFundamentals } from "../../src/lib/workstation/fundamentals-demo";
import { demoTrades } from "../../src/lib/workstation/demo";
import type { FundamentalsCapture } from "../../src/lib/workstation/fundamentals";

// Mount the real component with mocked HTTP. No authentication or database is opened.
let javascript: string, css: string;
test.beforeAll(async () => {
  const bundle = await build({ stdin: { contents: `import React from "react"; import {createRoot} from "react-dom/client"; import {FundamentalsSection} from "./src/components/workstation/fundamentals-section"; createRoot(document.getElementById("root")).render(React.createElement(FundamentalsSection,{trade:window.fixtureTrade,mode:"application",onAttach:async(canvas,metadata)=>{sessionStorage.setItem("captured",JSON.stringify(metadata));window.capturedSize=[canvas.width,canvas.height];}}));`, resolveDir: process.cwd(), sourcefile: "currency-fixture.tsx", loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"development"' } });
  javascript = bundle.outputFiles[0].text;
  css = await readFile("src/components/workstation/workstation.css", "utf8") + await readFile("src/components/workstation/fundamentals.css", "utf8");
});
for (const currency of ["USD", "EUR", "TWD"]) test(`${currency} charts, tooltips, sources and snapshot metadata`, async ({ page }, info) => {
  const data = demoFundamentals(demoTrades[0], "before-entry");
  const payload = { ...data, currency, coverage: "partial" as const, message: "Some quarterly results are unavailable." };
  for (const q of payload.quarters) for (const m of [q.revenue, q.netIncome]) if (m) {
    m.currency = currency; m.accountingStandard = "ifrs-full";
    if (m === q.netIncome) m.incomeBasis = "consolidated";
    m.sources = m.sources.map(s => ({ ...s, kind: "statement", document: "earnings.htm", label: "Reported financial statement" }));
  }
  await page.addInitScript(trade => { (window as unknown as { fixtureTrade: unknown }).fixtureTrade = trade; }, demoTrades[0]);
  await page.route("**/api/workstation/fundamentals?*", route => route.fulfill({ json: payload }));
  await page.route("**/__fundamentals_fixture__", route => route.fulfill({ contentType: "text/html", body: `<html><head><style>${css}</style></head><body style="background:#101824;color:#f1f5f9;font:14px Arial"><main id="root" class="workstation" style="width:1100px;margin:20px"></main><script>${javascript.replaceAll("</script", "<\\/script")}</script></body></html>` }));
  await page.goto("http://127.0.0.1:3000/__fundamentals_fixture__");
  await expect(page.getByRole("button", { name: "Attach snapshot", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "View fundamentals" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(`${currency} · 8 fiscal quarters`);
  await expect(dialog).toContainText("filings and financial statements");
  await expect(dialog).toContainText("NET INCOME · CONSOLIDATED");
  await expect(dialog).toContainText("Partial coverage");
  const chart = dialog.locator(".ws-fundamentals-hit-area").first(), box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width / 16, box.y + 2);
  await expect(page.getByRole("tooltip")).toContainText(currency === "USD" ? "$298,000,000" : `${currency}`);
  await dialog.locator("summary").click();
  await expect(dialog.locator('a[href$="earnings.htm"]').first()).toBeVisible();
  await dialog.screenshot({ path: info.outputPath(`${currency}-fundamentals.png`) });
  await dialog.getByRole("button", { name: "Attach snapshot", exact: true }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("captured"))).not.toBeNull();
  const capture = await page.evaluate(() => JSON.parse(sessionStorage.getItem("captured")!) as FundamentalsCapture);
  expect(capture.currency).toBe(currency); expect(capture.coverage).toBe("partial");
  expect(capture.quarters[0].revenue?.currency).toBe(currency);
  expect(await page.evaluate(() => (window as unknown as { capturedSize: number[] }).capturedSize)).toEqual([2240, 1640]);
  await page.reload();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("captured")!))).toEqual(capture);
});

import { expect, type Page } from "@playwright/test";
export async function showTakeaways(page: Page) {
  await expect(page.locator(".ws-notion-review")).toBeVisible();
  if (!await page.getByRole("textbox", { name: "Takeaways", exact: true }).isVisible()) await page.locator("summary").filter({ hasText: /^Takeaways$/ }).click();
}

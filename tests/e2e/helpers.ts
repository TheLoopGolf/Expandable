import { expect, type Page } from "@playwright/test";

/** Sign in through the demo persona picker. */
export async function signInAs(page: Page, persona: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(persona) }).first().click();
  await page.waitForURL(/\/dashboard/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/** Wait for the sonner toast produced by a server action. */
export async function expectToast(page: Page, text: RegExp | string) {
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: text }).first()).toBeVisible();
}

/** Open the first record link in a data table. */
export async function openFirstRow(page: Page, hrefPrefix: string) {
  const link = page.locator(`table a[href^="${hrefPrefix}"]`).first();
  await expect(link).toBeVisible();
  await link.click();
  await page.waitForURL(new RegExp(hrefPrefix.replace(/\//g, "\\/")));
}

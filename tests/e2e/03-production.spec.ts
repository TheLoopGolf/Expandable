import { expect, test } from "@playwright/test";
import { expectToast, signInAs } from "./helpers";

test("Workflow 2: issue BOM materials to a work order for 10, record 5 good + 1 scrap", async ({ page }) => {
  await signInAs(page, "Riley Morgan");
  await page.goto("/production?q=FG-CALKIT&status=released");
  // The released order for 10 kits (workflow 4's order is the larger, blocked one).
  const row = page.getByRole("row").filter({ hasText: "FG-CALKIT" }).filter({ hasNotText: "High" }).first();
  await row.locator('a[href^="/production/work-orders/"]').click();
  await page.waitForURL(/\/production\/work-orders\//);
  await expect(page.getByText("Rev A (snapshot)")).toBeVisible();

  await page.getByRole("button", { name: "Issue materials" }).click();
  const issue = page.getByRole("dialog");
  await expect(issue.getByLabel("Issue quantity for CASE-CAL")).toHaveValue("10");
  await expect(issue.getByLabel("Issue quantity for PROBE-REF")).toHaveValue("10");
  await issue.getByRole("button", { name: "Post issue" }).click();
  await expectToast(page, /Issued/i);
  await expect(page.getByText("In Progress").first()).toBeVisible();

  await page.getByRole("button", { name: "Record output" }).click();
  const output = page.getByRole("dialog");
  await output.getByLabel("Good quantity").fill("5");
  await output.getByLabel("Scrap quantity").fill("1");
  await output.getByLabel("Notes (scrap reason)").fill("E2E: cracked case latch");
  await output.getByRole("button", { name: "Record output" }).click();
  await expectToast(page, /Output recorded/);
  await expect(page.getByText("5 / 1")).toBeVisible();
  await expect(page.getByText("60%").first()).toBeVisible();
});

test("BOM to work order: a new order freezes the released BOM revision", async ({ page }) => {
  await signInAs(page, "Riley Morgan");
  await page.goto("/production/work-orders/new");
  const item = page.locator('select[name="itemId"]');
  const value = await item.locator("option", { hasText: "FG-CALKIT" }).getAttribute("value");
  await item.selectOption(value!);
  await page.locator('input[name="quantity"]').fill("2");
  await page.getByRole("button", { name: "Create work order" }).click();
  await page.waitForURL(/\/production\/work-orders\/[0-9a-f-]{36}/);
  await expect(page.getByText("Draft").first()).toBeVisible();
  const snapshot = page.getByRole("region", { name: "BOM snapshot" });
  await expect(snapshot).toContainText("CASE-CAL");
  await expect(snapshot).toContainText("PROBE-REF");
});

import { expect, test } from "@playwright/test";
import { expectToast, signInAs } from "./helpers";

test("Workflow 1: receive 60 of 100 with a lot number", async ({ page }) => {
  await signInAs(page, "Sam Okafor");
  await page.goto("/purchasing/receive");
  const po = page.getByRole("region").filter({ hasText: "RTD-PT100" }).filter({ hasText: "Granite Peak Sensors" }).first();
  await expect(po).toBeVisible();
  await po.getByRole("link", { name: "Receive" }).click();
  await page.waitForURL(/\/purchasing\/orders\//);

  await page.getByRole("button", { name: "Receive" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Receive quantity for RTD-PT100").fill("60");
  await dialog.getByLabel("Lot number for RTD-PT100").fill("E2E-RTD-0001");
  await dialog.getByRole("button", { name: "Post receipt" }).click();
  await expectToast(page, /Received/i);
  await expect(page.getByText("Partially Received").first()).toBeVisible();

  // The lot exists with 60 on hand and the receipt is in the inventory ledger.
  await page.goto("/inventory/lots?q=E2E-RTD-0001");
  await expect(page.getByRole("row").filter({ hasText: "E2E-RTD-0001" }).first()).toContainText("60");
  await page.goto("/inventory/movements?q=E2E-RTD-0001");
  await expect(page.getByRole("row").filter({ hasText: "E2E-RTD-0001" }).first()).toBeVisible();
});

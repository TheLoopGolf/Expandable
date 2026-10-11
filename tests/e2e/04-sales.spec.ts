import { expect, test } from "@playwright/test";
import { expectToast, signInAs } from "./helpers";

test("Workflow 3: reserved sales order → partial shipment → invoice issued", async ({ page }) => {
  await signInAs(page, "Sam Okafor");
  await page.goto("/sales/orders?q=LMD-PO-88412");
  await page.locator('table a[href^="/sales/orders/"]').first().click();
  await page.waitForURL(/\/sales\/orders\/[0-9a-f-]{36}/);
  const soNumber = (await page.getByRole("heading", { level: 1 }).textContent())?.match(/SO-\d+/)?.[0];
  expect(soNumber).toBeTruthy();

  await page.getByRole("button", { name: "Ship" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Ship quantity for line 1").fill("12");
  await dialog.getByLabel("Ship quantity for line 2").fill("0");
  await expect(dialog.getByText(/draft invoice is created automatically/)).toBeVisible();
  await dialog.getByRole("button", { name: "Confirm shipment" }).click();
  await expectToast(page, /confirmed — order partially shipped; draft INV-/);
  await expect(page.getByText("Partially Shipped").first()).toBeVisible();

  const invoices = page.getByRole("region", { name: /Invoices \(1\)/ });
  await expect(invoices).toContainText("Draft");
  const invoiceNumber = (await invoices.locator("a").first().textContent())!.trim();

  // Finance issues the drafted invoice; AR now carries it.
  await signInAs(page, "Morgan Diaz");
  await page.goto(`/finance?tab=invoices&q=${invoiceNumber}`);
  const row = page.getByRole("row").filter({ hasText: invoiceNumber });
  await row.getByRole("button", { name: "Issue" }).click();
  await expectToast(page, /Invoice issued/);
  await expect(row).toContainText("Issued");
});

import { expect, test } from "@playwright/test";
import { expectToast, signInAs } from "./helpers";

test("Workflow 4: a quality hold blocks material issue until quality releases it", async ({ page }) => {
  // The blocked kit order: PROBE-REF readiness reads "Blocked" because the usable lots cannot cover it.
  await signInAs(page, "Riley Morgan");
  await page.goto("/production?q=FG-CALKIT&status=released");
  await page.getByRole("row").filter({ hasText: "FG-CALKIT" }).filter({ hasText: "High" }).first().locator('a[href^="/production/work-orders/"]').click();
  await page.waitForURL(/\/production\/work-orders\//);
  const readiness = page.getByRole("region", { name: "Material readiness" });
  await expect(readiness.getByRole("row").filter({ hasText: "PROBE-REF" })).toContainText("Blocked");

  // Explicitly picking the held lot is refused by the server.
  await page.getByRole("button", { name: "Issue materials" }).click();
  let dialog = page.getByRole("dialog");
  const lotSelect = dialog.getByLabel("Lot for PROBE-REF");
  const heldLot = await lotSelect.locator("option", { hasText: "HOLD" }).first().getAttribute("value");
  const heldLabel = (await lotSelect.locator("option", { hasText: "HOLD" }).first().textContent())!;
  const heldLotNumber = heldLabel.split(" · ")[0].trim();
  await lotSelect.selectOption(heldLot!);
  await dialog.getByLabel("Issue quantity for PROBE-REF").fill("5");
  await dialog.getByLabel("Issue quantity for CASE-CAL").fill("0");
  await dialog.getByRole("button", { name: "Post issue" }).click();
  await expectToast(page, /hold/i);
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // Quality releases the hold with a documented justification.
  await signInAs(page, "Casey Nguyen");
  await page.goto("/quality?tab=holds");
  const holdRow = page.getByRole("row").filter({ hasText: heldLotNumber });
  await holdRow.getByRole("button", { name: "Release" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel(/justification|reason/i).fill("Supplier calibration certificates verified; 100% re-test passed");
  await dialog.getByRole("button", { name: "Release hold" }).click();
  await expectToast(page, /released/i);

  // The same issue now succeeds and the order is no longer blocked.
  await signInAs(page, "Riley Morgan");
  await page.goto("/production?q=FG-CALKIT&status=released");
  await page.getByRole("row").filter({ hasText: "FG-CALKIT" }).filter({ hasText: "High" }).first().locator('a[href^="/production/work-orders/"]').click();
  await page.waitForURL(/\/production\/work-orders\//);
  await expect(page.getByRole("region", { name: "Material readiness" }).getByRole("row").filter({ hasText: "PROBE-REF" })).not.toContainText("Blocked");
  await page.getByRole("button", { name: "Issue materials" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Lot for PROBE-REF").selectOption({ label: (await dialog.getByLabel("Lot for PROBE-REF").locator("option", { hasText: heldLotNumber }).first().textContent())! });
  await dialog.getByLabel("Issue quantity for PROBE-REF").fill("5");
  await dialog.getByLabel("Issue quantity for CASE-CAL").fill("0");
  await dialog.getByRole("button", { name: "Post issue" }).click();
  await expectToast(page, /Issued 1 material line/);
});

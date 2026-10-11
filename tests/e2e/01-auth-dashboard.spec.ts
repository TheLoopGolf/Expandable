import { expect, test } from "@playwright/test";
import { signInAs } from "./helpers";

test.describe("Sign-in and dashboard", () => {
  test("unauthenticated visitors are sent to the demo sign-in, which is clearly labeled", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Choose a demo persona" })).toBeVisible();
    await expect(page.getByText(/fictional data/i).first()).toBeVisible();
  });

  test("admin sees live KPIs, charts with table views and the demo-data label", async ({ page }) => {
    await signInAs(page, "Avery Chen");
    for (const label of ["On-time delivery", "Inventory value", "Critical material shortages", "Open quality issues"]) {
      await expect(page.getByRole("link", { name: `Open ${label} details` })).toBeVisible();
    }
    await expect(page.getByText(/Demo workspace/)).toBeVisible();
    const chart = page.locator("section[aria-label]").filter({ has: page.getByRole("button", { name: "Table view" }) }).first();
    await chart.getByRole("button", { name: "Table view" }).click();
    await expect(chart.locator("table")).toBeVisible();
  });

  test("date range and plant filters update the dashboard; KPI cards drill into filtered lists", async ({ page }) => {
    await signInAs(page, "Avery Chen");
    await page.getByRole("button", { name: "Date range" }).click();
    await page.getByRole("menuitem", { name: "Last 30 days" }).click();
    await expect(page.getByRole("button", { name: "Date range" })).toContainText("Last 30 days");

    await page.getByRole("button", { name: "Filter by plant" }).click();
    await page.getByRole("menuitemradio", { name: /Rochester/ }).click();
    await expect(page.getByRole("button", { name: "Filter by plant" })).toContainText("Rochester");
    await page.getByRole("button", { name: "Filter by plant" }).click();
    await page.getByRole("menuitemradio", { name: "All plants" }).click();
    await expect(page.getByRole("button", { name: "Filter by plant" })).toContainText("All plants");

    await page.getByRole("link", { name: "Open Critical material shortages details" }).click();
    await expect(page).toHaveURL(/\/inventory\?alert=shortage/);
    await expect(page.getByRole("combobox", { name: "Alerts" })).toHaveValue("shortage");
  });

  test("a viewer is read-only: create pages are refused by the server", async ({ page }) => {
    await signInAs(page, "Jamie Fischer");
    await page.goto("/purchasing/orders/new");
    await expect(page.getByRole("heading", { name: /don.t have access/ })).toBeVisible();
    await page.goto("/purchasing");
    await expect(page.getByRole("link", { name: /New purchase order/ })).toHaveCount(0);
  });
});

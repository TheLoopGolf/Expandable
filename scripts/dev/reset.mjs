// Exercise Settings → Data → Reset demo data as the admin persona.
import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Avery Chen/ }).first().click();
await page.waitForURL(/dashboard/);
await page.goto("http://localhost:3000/settings?tab=data", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Reset demo data" }).click();
await page.getByLabel(/Type "RESET"/).fill("RESET");
const t0 = Date.now();
await page.getByRole("button", { name: "Reset data" }).click();
await page.waitForURL(/login\?reset=1/, { timeout: 300000 });
console.log(`reset ok in ${Math.round((Date.now() - t0) / 1000)}s; errors: ${errors.length ? errors.join(" | ") : "none"}`);
await browser.close();

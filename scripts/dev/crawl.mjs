// Visit pages as a persona; report console errors and save screenshots.
import { chromium } from "@playwright/test";
const [, , outDir, persona = "Avery Chen", ...paths] = process.argv;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
let errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 300)));
await page.goto("http://localhost:3000/login", { waitUntil: "networkidle", timeout: 120000 });
await page.getByRole("button", { name: new RegExp(persona) }).first().click();
await page.waitForURL(/dashboard/, { timeout: 120000 });
for (const p of paths) {
  errors = [];
  let target = p;
  if (p.includes("{first:")) {
    // {first:/list|selector} -> open first link matching selector on list page
    const [, list, sel] = p.match(/\{first:([^|]+)\|([^}]+)\}/);
    await page.goto("http://localhost:3000" + list, { waitUntil: "networkidle" });
    target = await page.locator(sel).first().getAttribute("href");
  }
  const res = await page.goto("http://localhost:3000" + target, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(500);
  const name = target.replace(/[^a-z0-9]+/gi, "_").slice(0, 60) || "root";
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: false });
  const h1 = await page.locator("h1").first().textContent().catch(() => "");
  console.log(`${res?.status()} ${target} :: ${h1?.trim().slice(0, 60)} ${errors.length ? "ERRORS: " + errors.join(" | ") : ""}`);
}
await browser.close();

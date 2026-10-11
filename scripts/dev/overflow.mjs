import { chromium } from "@playwright/test";
const path = process.argv[2] ?? "/dashboard";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Avery Chen/ }).first().click();
await page.waitForURL(/dashboard/);
if (path !== "/dashboard") await page.goto("http://localhost:3000" + path, { waitUntil: "networkidle" });
const res = await page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) {
      let p = el.parentElement, clipped = false;
      while (p) { const s = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(s.overflowX)) { clipped = true; break; } p = p.parentElement; }
      if (!clipped) out.push(`${el.tagName}.${String(el.className).slice(0, 80)} [${Math.round(r.left)},${Math.round(r.right)}]`);
    }
  }
  return { vw, sw: document.documentElement.scrollWidth, out: out.slice(0, 15) };
});
console.log(JSON.stringify(res, null, 1));
await browser.close();

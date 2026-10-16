// Phase 5 verification: screenshot every screen in light + dark for review.
// Usage: BASE=http://localhost:4173 OUT=/path/to/out node scripts/shots.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE || "http://localhost:4173";
const OUT = process.env.OUT || "shots";
mkdirSync(OUT, { recursive: true });

const routes = [
  ["today", ""],
  ["parcel-top", "parcel/101"],
  ["parcel-balance", "parcel/101#balance"],
  ["log", "log"],
  ["chat", "chat"],
  ["admin", "admin"],
  ["gallery", "gallery"],
];

const browser = await chromium.launch();
for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem("tf-theme", t);
    } catch {
      /* ignore */
    }
  }, theme);
  const page = await ctx.newPage();
  for (const [name, hash] of routes) {
    await page.goto(`${BASE}/#/${hash}`, { waitUntil: "load" });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${name}-${theme}.png` });
    console.log(name, theme, "ok");
  }
  await ctx.close();
}
await browser.close();
console.log("done →", OUT);

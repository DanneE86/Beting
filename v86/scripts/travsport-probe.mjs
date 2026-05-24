import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";

const out = resolve("v86/output");
mkdirSync(out, { recursive: true });

const captures = [];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on("response", async (res) => {
  const url = res.url();
  if (!/travsport\.se/i.test(url)) return;
  if (!/json|api|sportinfo/i.test(url)) return;
  try {
    const ct = res.headers()["content-type"] ?? "";
    if (!ct.includes("json") && !url.includes("api")) return;
    const data = await res.json().catch(() => null);
    if (data) captures.push({ url, status: res.status(), data });
  } catch {
    /* */
  }
});

await page.goto("https://sportapp.travsport.se/sportinfo/horse", {
  waitUntil: "networkidle",
  timeout: 120000,
});

await page.waitForTimeout(2000);

const inputs = await page.locator("input").all();
console.log("inputs", inputs.length);

for (const sel of [
  'input[type="search"]',
  "input[placeholder*='sök' i]",
  "input[placeholder*='Sök' i]",
  "input",
]) {
  const el = page.locator(sel).first();
  if (await el.isVisible().catch(() => false)) {
    await el.fill("Double Deceiver");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(4000);
    break;
  }
}

const links = await page.evaluate(() =>
  [...document.querySelectorAll("a[href*='/sportinfo/horse/']")]
    .map((a) => a.href)
    .slice(0, 5),
);

console.log("horse links", links);

if (links[0]) {
  await page.goto(links[0] + "/results", { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(3000);
}

writeFileSync(
  resolve(out, "travsport-probe.json"),
  JSON.stringify({ captures, links, finalUrl: page.url() }, null, 2),
);

console.log(`Saved ${captures.length} API captures`);
await browser.close();

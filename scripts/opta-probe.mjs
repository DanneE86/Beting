/**
 * Playwright-probe för Opta Player Stats (Stats Perform).
 * Kör: npm run test:opta
 *
 * OBS: Endast för personligt bruk. Opta-data kan vara licensierad — respektera ToS.
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";

const OPTA_BASE = "https://optaplayerstats.statsperform.com";
const SOCCER_URL = `${OPTA_BASE}/en_GB/soccer`;

async function waitForRealPage(page, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = page.url();
    const body = await page.locator("body").innerText().catch(() => "");
    const isVerify =
      url.includes("bm-verify") ||
      body.toLowerCase().includes("checking your browser") ||
      body.toLowerCase().includes("please wait");
    if (!isVerify && body.length > 200) return;
    await page.waitForTimeout(1500);
  }
}

export async function probeOptaSoccer(headless = true) {
  const apiResponses = [];
  let browser = null;

  try {
    browser = await chromium.launch({
      headless,
      args: ["--disable-blink-features=AutomationControlled"],
    });

    const context = await browser.newContext({
      locale: "en-GB",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      viewport: { width: 1366, height: 900 },
    });

    const page = await context.newPage();

    page.on("response", async (res) => {
      const url = res.url();
      const ct = res.headers()["content-type"] ?? "";
      if (
        !url.includes("statsperform") &&
        !url.includes("opta") &&
        !url.includes("performgroup")
      ) {
        return;
      }
      if (!/json|graphql|api/i.test(url) && !ct.includes("json")) return;
      try {
        const text = await res.text();
        apiResponses.push({
          url,
          status: res.status(),
          contentType: ct,
          sample: text.slice(0, 500),
        });
      } catch {
        /* body redan konsumerad */
      }
    });

    await page.goto(SOCCER_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForRealPage(page);
    await page.waitForTimeout(3000);

    const finalUrl = page.url();
    const title = await page.title();
    const pageTextSample = (await page.locator("body").innerText()).slice(0, 1500);

    const matchLinks = await page
      .locator("a[href*='/soccer/'], a[href*='match'], a[href*='fixture']")
      .evaluateAll((els) =>
        [...new Set(els.map((a) => a.href).filter(Boolean))].slice(0, 20),
      );

    const outDir = resolve("scripts/opta-output");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(resolve(outDir, "probe-page.html"), await page.content(), "utf8");
    writeFileSync(
      resolve(outDir, "probe-apis.json"),
      JSON.stringify({ finalUrl, title, apiResponses }, null, 2),
      "utf8",
    );

    return {
      ok: !finalUrl.includes("bm-verify") && pageTextSample.length > 100,
      finalUrl,
      title,
      apiResponses,
      pageTextSample,
      matchLinks,
    };
  } catch (e) {
    return {
      ok: false,
      finalUrl: SOCCER_URL,
      title: "",
      apiResponses,
      pageTextSample: "",
      matchLinks: [],
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    await browser?.close();
  }
}

async function main() {
  const headless = !process.argv.includes("--headed");
  console.log(`Opta Playwright-probe (headless=${headless})...\n`);

  const result = await probeOptaSoccer(headless);

  console.log("OK:", result.ok);
  console.log("URL:", result.finalUrl);
  console.log("Title:", result.title);
  if (result.error) console.log("Error:", result.error);
  console.log("\nAPI-svar fångade:", result.apiResponses.length);
  for (const r of result.apiResponses.slice(0, 8)) {
    console.log(`  [${r.status}] ${r.url.slice(0, 100)}`);
  }
  console.log("\nMatch-länkar:", result.matchLinks.length);
  result.matchLinks.slice(0, 5).forEach((l) => console.log(" ", l));
  console.log("\nSidtext (utdrag):");
  console.log(result.pageTextSample.slice(0, 600));
  console.log("\nSparat: scripts/opta-output/probe-page.html + probe-apis.json");

  process.exit(result.ok ? 0 : 1);
}

main();

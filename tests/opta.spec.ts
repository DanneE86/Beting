import { test, expect } from "@playwright/test";
import { existsSync } from "fs";
import { resolve } from "path";

const SESSION = resolve(".opta/session.json");

/**
 * Opta kräver headed browser första gången (Akamai blockerar headless).
 * Kör: npm run test:opta:setup   → sparar .opta/session.json
 * Sedan: npm run test:opta       → använder sparad session
 */
test.describe("Opta Player Stats", () => {
  test("hämtar livescores via intern API", async ({ browser }) => {
    const context = await browser.newContext(
      existsSync(SESSION) ? { storageState: SESSION } : { locale: "en-GB" },
    );
    const page = await context.newPage();

    await page.goto("https://optaplayerstats.statsperform.com/en_GB/soccer", {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });

    await expect(page.locator("body")).not.toContainText("Access Denied", { timeout: 45000 });

    const apiUrl =
      "https://optaplayerstats.statsperform.com/api/en_GB/soccer/livescores?offset=-120";

    const result = await page.evaluate(async (url) => {
      const r = await fetch(url, { credentials: "include" });
      return { status: r.status, data: await r.json() };
    }, apiUrl);

    expect(result.status).toBe(200);
    expect(Array.isArray(result.data?.matches)).toBe(true);
    expect(result.data.matches.length).toBeGreaterThan(0);

    const first = result.data.matches[0];
    expect(first.home?.name).toBeTruthy();
    expect(first.away?.name).toBeTruthy();
    expect(first.comp?.name).toBeTruthy();

    console.log(
      `Opta: ${result.data.matches.length} matcher, t.ex. ${first.home.name} vs ${first.away.name}`,
    );

    await context.storageState({ path: SESSION });
    await context.close();
  });
});

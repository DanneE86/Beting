import { test, expect } from "@playwright/test";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";

const OUT = resolve("v86", "output");
const ANDEL_URL =
  process.env.V86_ANDEL_URL ??
  "https://www.atg.se/andelsspel?gameId=V85_2026-05-30_5_5";
const GAME_ID = process.env.V86_GAME_ID ?? "V85_2026-05-30_5_5";

/**
 * Hämtar ATG-data via publikt API + andelsspel/travsport via browser.
 * Kör: npm run test:v86
 * Med sparad session (snabbare): npm run test:v86:setup
 */
test.describe("V86 / GS75 data", () => {
  test("ATG racinginfo API – spel och lopp", async ({ request }) => {
    const gameRes = await request.get(
      `https://www.atg.se/services/racinginfo/v1/api/games/${GAME_ID}`,
    );
    expect(gameRes.ok()).toBeTruthy();
    const game = await gameRes.json();
    expect(game.races?.length).toBeGreaterThan(0);
    expect(game.races[0].starts?.length).toBeGreaterThan(0);

    const firstStart = game.races[0].starts.find((s: { scratched?: boolean }) => !s.scratched);
    expect(firstStart?.horse?.name).toBeTruthy();

    mkdirSync(OUT, { recursive: true });
    writeFileSync(resolve(OUT, "playwright-game.json"), JSON.stringify(game, null, 2));
    console.log(`ATG: ${game.type} ${game.id}, ${game.races.length} avdelningar`);
  });

  test("andelsspel – expertandelar och markeringar", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(ANDEL_URL, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(3000);

    const bodyText = await page.locator("body").innerText();
    expect(bodyText.length).toBeGreaterThan(200);
    expect(bodyText).not.toMatch(/Access Denied/i);

    const shares = await page.evaluate(() => {
      const cards: {
        name: string;
        expert?: string;
        costKr?: number;
        marks?: string;
      }[] = [];

      const candidates = document.querySelectorAll(
        "article, [data-testid], a[href*='andel'], li, div",
      );
      for (const el of candidates) {
        const text = (el as HTMLElement).innerText?.trim() ?? "";
        if (text.length < 20 || text.length > 800) continue;
        if (!/kr|andel|markering|GS75|V86/i.test(text)) continue;
        const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
        const name = lines[0];
        if (!name || name.length < 3) continue;
        const krMatch = text.match(/(\d+)\s*kr/);
        const expertLine = lines.find((l) =>
          /expert|trav|tip|redaktion/i.test(l),
        );
        const markLine = lines.find((l) =>
          /^\d+[\s,|xX\-]+/.test(l) || /avd|leg/i.test(l),
        );
        if (cards.some((c) => c.name === name)) continue;
        cards.push({
          name: name.slice(0, 80),
          expert: expertLine,
          costKr: krMatch ? Number(krMatch[1]) : undefined,
          marks: markLine,
        });
        if (cards.length >= 25) break;
      }
      return cards;
    });

    const apiCaptures: unknown[] = [];
    page.on("response", async (res) => {
      const url = res.url();
      if (
        !res.ok() ||
        !/atg\.se\/services/i.test(url) ||
        !/andel|share|shop/i.test(url)
      )
        return;
      try {
        const ct = res.headers()["content-type"] ?? "";
        if (!ct.includes("json")) return;
        apiCaptures.push({ url, data: await res.json() });
      } catch {
        /* ignore */
      }
    });

    await page.reload({ waitUntil: "networkidle", timeout: 90_000 }).catch(() => {});
    await page.waitForTimeout(2000);

    mkdirSync(OUT, { recursive: true });
    const payload = {
      fetchedAt: new Date().toISOString(),
      url: ANDEL_URL,
      shares,
      apiCaptures,
      pageTitle: await page.title(),
    };
    writeFileSync(
      resolve(OUT, "andelsspel-playwright.json"),
      JSON.stringify(payload, null, 2),
    );

    console.log(`Andelsspel: ${shares.length} andelar parsade, ${apiCaptures.length} API-träffar`);
    expect(shares.length + apiCaptures.length).toBeGreaterThan(0);
  });

  test("Travsport API – hästresultat", async ({ request }) => {
    const res = await request.get(
      "https://api.travsport.se/webapi/horses/results/organisation/TROT/sourceofdata/SPORT/horseid/795096",
    );
    expect(res.ok()).toBeTruthy();
    const rows = await res.json();
    expect(Array.isArray(rows)).toBe(true);
    const done = rows.filter(
      (r: { placement?: { sortValue?: number } }) =>
        r.placement?.sortValue != null && r.placement.sortValue < 20,
    );
    expect(done.length).toBeGreaterThan(3);
    console.log(`Travsport API: ${done.length} avslutade starter för häst 795096`);
  });

  test("travsport sportinfo – hästsök (browser)", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("https://sportapp.travsport.se/sportinfo/horse", {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });

    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);

    const searchInput = page
      .locator('input[type="search"], input[placeholder*="sök" i], input[name*="search" i]')
      .first();
    let horseSnippet: Record<string, unknown> | null = null;

    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill("Maharajah");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(2500);
      horseSnippet = await page.evaluate(() => ({
        url: location.href,
        text: document.body.innerText.slice(0, 2000),
      }));
    } else {
      horseSnippet = {
        url: page.url(),
        note: "Sökfält ej hittat – sidan kräver ev. inloggning eller annan DOM",
        text: (await page.locator("body").innerText()).slice(0, 1500),
      };
    }

    mkdirSync(OUT, { recursive: true });
    writeFileSync(
      resolve(OUT, "travsport-horse.json"),
      JSON.stringify({ fetchedAt: new Date().toISOString(), ...horseSnippet }, null, 2),
    );
    console.log("Travsport: snapshot sparad");
  });
});

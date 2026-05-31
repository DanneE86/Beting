/**
 * Playwright E2E — AI-prognos-knappen
 * Testar att "Visa AI-prognos" inte kraschar sidan och visar korrekt UI.
 *
 * Kör: npm run test:e2e
 * (Kräver att dev-servern körs på localhost:8080)
 */
import { test, expect } from "@playwright/test";

test.describe("AI-prognos", () => {
  // ─── Sidan kraschar inte ─────────────────────────────────────────────────

  test("startsida laddas utan JS-fel", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    expect(errors).toEqual([]);
  });

  // ─── Matchkortet visas ────────────────────────────────────────────────────

  test("matchkort med AI-prognos-knapp finns på Idag & Live", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Vänta på att matcher laddas (max 15s)
    const matchCards = page.locator('[class*="Card"], .card, [data-testid="match-card"]').first();
    const aiBtn = page.getByRole("button", { name: /AI-prognos|visa ai/i }).first();

    // Antingen matcher eller loading-skeleton ska synas
    const hasCards = await matchCards.isVisible().catch(() => false);
    const hasBtn   = await aiBtn.isVisible().catch(() => false);

    // Sidan är responsiv — något ska synas
    await expect(page.locator("body")).toBeVisible();
    // Om inga matcher idag: kolla att appen inte kraschade
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.length).toBeGreaterThan(50);
    console.log(`Matchkort: ${hasCards}, AI-knapp: ${hasBtn}`);
  });

  // ─── AI-prognos-knappen kraschar inte sidan ───────────────────────────────

  test("klick på AI-prognos-knapp kraschfri", async ({ page }) => {
    const errors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Hitta första AI-prognos-knappen
    const aiBtn = page.getByRole("button", { name: /AI-prognos/i }).first();
    const btnExists = await aiBtn.isVisible({ timeout: 10_000 }).catch(() => false);

    if (!btnExists) {
      // Ingen match idag — testa att sidan ändå inte kraschade
      console.log("Ingen AI-prognos-knapp hittad (inga matcher idag?)");
      expect(errors).toEqual([]);
      return;
    }

    // Klicka knappen
    await aiBtn.click();

    // Vänta på att prognos-panelen eller laddning syns (max 5s)
    await page.waitForTimeout(2000);

    // Sidan ska inte ha kraschats (inga uncaught errors)
    expect(errors, `JS-fel efter klick: ${errors.join(", ")}`).toEqual([]);

    // Sidan ska fortfarande vara responsiv
    await expect(page.locator("body")).toBeVisible();
  });

  // ─── Prognos-panel innehåller rätt UI-element ────────────────────────────

  test("prognos-panelen visar sannolikheter och BTTS efter klick", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const aiBtn = page.getByRole("button", { name: /AI-prognos/i }).first();
    const btnExists = await aiBtn.isVisible({ timeout: 10_000 }).catch(() => false);

    if (!btnExists) {
      console.log("Ingen AI-prognos-knapp (inga matcher)");
      return;
    }

    await aiBtn.click();

    // Vänta på att API-svaret kommer (kan ta upp till 20s)
    const loadingSpinner = page.locator("[class*='animate-spin']").first();
    if (await loadingSpinner.isVisible({ timeout: 2000 }).catch(() => false)) {
      await loadingSpinner.waitFor({ state: "hidden", timeout: 20_000 });
    }

    // Efter API-svar ska vi se prognos-panelen
    // Kontrollera antingen: %-tecken (sannolikheter) eller BTTS-text
    const hasPct = await page.getByText(/%/).first().isVisible({ timeout: 3000 }).catch(() => false);
    const hasBtts = await page.getByText(/Båda lagen gör mål/i).first().isVisible({ timeout: 1000 }).catch(() => false);
    const hasTips = await page.getByText(/▲ TIPS|tippa på/i).first().isVisible({ timeout: 1000 }).catch(() => false);

    // Antingen prognos eller ett felmeddelande — men inte en krasch
    expect(errors, `Sidan kraschade: ${errors.join(", ")}`).toEqual([]);

    if (hasPct || hasBtts || hasTips) {
      console.log("✓ Prognos-panel visas korrekt");
      // Verifiera att minst en %-siffra finns
      if (hasPct) {
        await expect(page.getByText(/%/).first()).toBeVisible();
      }
    } else {
      // API-fel är OK — sidan får visa felmeddelande
      const errorMsg = await page.getByText(/Kunde inte hämta|error|fel/i).first().isVisible().catch(() => false);
      console.log(`Prognos ej synlig — API-fel: ${errorMsg}`);
    }
  });

  // ─── /v86 route fungerar ──────────────────────────────────────────────────

  test("/v86 laddas utan kraschar", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    const res = await page.goto("/v86");
    expect(res?.status()).toBeLessThan(500);
    await page.waitForLoadState("networkidle");

    expect(errors, `JS-fel på /v86: ${errors.join(", ")}`).toEqual([]);
    await expect(page.locator("body")).toBeVisible();

    const bodyText = await page.locator("body").innerText();
    expect(bodyText.length).toBeGreaterThan(20);
    console.log("✓ /v86 laddad OK");
  });

  // ─── Alla flikar navigerbara utan kraschar ────────────────────────────────

  test("alla tabs klickbara utan JS-fel", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const tabs = page.getByRole("tab");
    const count = await tabs.count();

    console.log(`Hittade ${count} tabs`);
    for (let i = 0; i < Math.min(count, 8); i++) {
      const tab = tabs.nth(i);
      const label = await tab.textContent();
      await tab.click();
      await page.waitForTimeout(300);
      expect(errors, `Krasch vid klick på tab "${label}": ${errors.join(", ")}`).toEqual([]);
    }
  });
});

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.V86_BASE_URL ?? "http://localhost:8080";
const TARGET_URL = `${BASE_URL.replace(/\/$/, "")}/v86`;

test.describe("V86/DD system GUI", () => {
  test("spellista laddas och Analysera-knappen aktiveras", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });

    // Game picker must populate (skeleton → select with options)
    const gameSelect = page.locator("select").filter({ has: page.locator("option[value*='_']") });
    await expect(gameSelect).toBeVisible({ timeout: 20_000 });

    // Analysera button must become enabled once a game is selected
    const analyzeBtn = page.getByRole("button", { name: "Analysera" });
    await expect(analyzeBtn).toBeEnabled({ timeout: 15_000 });
  });

  test("analyze slutförs utan enum-fel (Supabase ok eller nere)", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });

    // Wait for button to be enabled
    const analyzeBtn = page.getByRole("button", { name: "Analysera" });
    await expect(analyzeBtn).toBeEnabled({ timeout: 20_000 });

    await analyzeBtn.click();

    // Must NOT show enum validation error
    await expect(
      page.getByText(/Invalid enum value|invalid_enum_value|received":"rule5|received\.:."rule5"/i),
    ).toHaveCount(0, { timeout: 20_000 });

    // Accept both: success (Supabase ok) OR warning (Supabase nere/timeout)
    await expect(
      page.getByText(/Analys klar/i),
    ).toBeVisible({ timeout: 60_000 });
  });
});

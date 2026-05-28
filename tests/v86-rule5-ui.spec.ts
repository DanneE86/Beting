import { test, expect } from "@playwright/test";

const BASE_URL = process.env.V86_BASE_URL ?? "http://localhost:8080";
const TARGET_URL = `${BASE_URL.replace(/\/$/, "")}/v86`;

test.describe("Regel 5 GUI", () => {
  test("analyze med rule5 ska inte ge enum-fel", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 90_000 });

    await expect(page.getByRole("button", { name: "Analysera" })).toBeVisible();

    const rule5Tab = page.getByRole("link", { name: /Regel 5 målstyrd plus/i });
    if (await rule5Tab.isVisible().catch(() => false)) {
      await rule5Tab.click();
    }

    await page.getByRole("button", { name: "Analysera" }).click();

    await expect(
      page.getByText(/Invalid enum value|invalid_enum_value|received":"rule5|received.:."rule5"/i),
    ).toHaveCount(0, { timeout: 20_000 });

    await expect(page.getByText(/Analys klar och sparad i historiken/i)).toBeVisible({
      timeout: 60_000,
    });
  });
});

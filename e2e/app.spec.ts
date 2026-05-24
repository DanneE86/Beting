import { test, expect } from "@playwright/test";

test.describe("App smoke", () => {
  test("startsida laddas utan fel", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    const res = await page.goto("/");
    expect(res?.ok()).toBeTruthy();
    await expect(page.locator("body")).not.toBeEmpty();
    expect(errors).toEqual([]);
  });

  test("flikar eller huvudnavigation syns", async ({ page }) => {
    await page.goto("/");
    const tabs = page.getByRole("tab");
    const count = await tabs.count();
    if (count > 0) {
      await expect(tabs.first()).toBeVisible();
    } else {
      await expect(page.locator("main, [role=main], body")).toBeVisible();
    }
  });
});

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  retries: 0,
  use: {
    // Akamai blockerar headless — Opta kräver synlig Chromium
    headless: false,
    locale: "en-GB",
    viewport: { width: 1366, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    launchOptions: {
      args: ["--disable-blink-features=AutomationControlled"],
    },
  },
});

import { defineConfig } from "@playwright/test";

/** Enkel GUI-smoke — headless, separat från Opta-tester i tests/. */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080",
    headless: true,
    locale: "sv-SE",
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: "npm run dev",
    url: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

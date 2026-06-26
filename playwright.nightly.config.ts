/**
 * Playwright configuration for the nightly scheduled run against the deployed
 * production (or staging) application.
 *
 * Key differences from playwright.config.ts:
 *  - No webServer block — the app is already running in production.
 *  - baseURL is read from PLAYWRIGHT_BASE_URL / E2E_BASE_URL (required).
 *  - Longer per-test timeout to accommodate real network latency.
 *  - Only the "chromium" project is retained (smallest footprint for CI).
 *  - SKIP_NETWORK_TESTS must NOT be set so the round-trip test actually runs.
 */

import { defineConfig, devices } from "@playwright/test";

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ||
  process.env.E2E_BASE_URL ||
  (() => {
    throw new Error(
      "Set PLAYWRIGHT_BASE_URL or E2E_BASE_URL to the production URL before running the nightly suite.",
    );
  })();

// Only override executablePath when explicitly requested (e.g. on Replit where
// Chromium lives in the Nix store).  On GitHub-hosted runners the value is
// unset and Playwright resolves its own installed browser automatically.
const launchOptions: Record<string, unknown> = {
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
};
if (process.env.PLAYWRIGHT_CHROMIUM_PATH) {
  launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/accessibility-quick-tools.spec.ts",
  grep: /full round-trip scan/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: true,
  retries: 1,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "nightly-results.json" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    launchOptions,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});

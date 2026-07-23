import { defineConfig, devices } from "@playwright/test";

const SYSTEM_CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ??
  "/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || process.env.E2E_BASE_URL || "http://127.0.0.1:5000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath: SYSTEM_CHROMIUM,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // When running the full Playwright suite independently, spin up a
  // test-mode dev server.  Re-use the already-running server if it
  // answers on port 5000 (typical for development).
  webServer: {
    command: "PLAYWRIGHT_TEST=1 npm run dev",
    url: "http://127.0.0.1:5000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});

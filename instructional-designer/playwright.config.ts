import { defineConfig, devices } from "@playwright/test";

const SYSTEM_CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ??
  "/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium";

const ID_PORT = parseInt(process.env.ID_PORT || "3001", 10);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${ID_PORT}`;

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
    baseURL: BASE_URL,
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
  webServer: {
    command: `PORT=${ID_PORT} PLAYWRIGHT_TEST=1 npm run dev`,
    cwd: "instructional-designer",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
  },
});

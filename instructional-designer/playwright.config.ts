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
    // The command is intentionally a no-op: when running under the validation
    // step, smoke-test.sh starts the server externally before Playwright runs,
    // so Playwright just reuses it.  When a developer is already running the
    // app locally, reuseExistingServer also picks up that server.
    // This avoids Playwright spawning /bin/sh internally, which fails in the
    // validation runner's sandboxed environment (spawn /bin/sh ENOENT).
    command: `node -e "process.exit(0)"`,
    cwd: "instructional-designer",
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 90_000,
  },
});

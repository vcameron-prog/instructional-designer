/**
 * Shared Playwright auth helpers.
 *
 * loginAndRedirect() navigates to GET /api/test/login with the given user
 * fields as query parameters.  The test endpoint creates a real session and
 * responds with a 302 redirect; the browser follows that redirect naturally
 * and lands on `returnTo`.  This approach works from any initial page state
 * (including about:blank) because page.goto() resolves the URL against
 * Playwright's configured baseURL rather than the current document origin.
 *
 * Usage:
 *   import { loginAndRedirect, DEFAULT_TEST_USER } from "../helpers/auth";
 *   await loginAndRedirect(page, "/settings");
 */

import type { Page } from "@playwright/test";

export interface TestUser {
  sub: string;
  email: string;
  firstName: string;
  lastName: string;
}

export const DEFAULT_TEST_USER: TestUser = {
  sub: "pw-default-test-user",
  email: "pwdefault@bridgew.edu",
  firstName: "Playwright",
  lastName: "Default",
};

/**
 * Navigate to GET /api/test/login so the browser follows the server-issued
 * 302 redirect and lands on `returnTo`.
 *
 * @param page      - Playwright Page object.
 * @param returnTo  - The path (and optional query string) to redirect to after
 *                    login, e.g. "/settings" or "/settings?tab=account".
 * @param user      - Optional user fields; defaults to DEFAULT_TEST_USER.
 * @param timeout   - How long to wait for the browser to reach returnTo (ms).
 */
export async function loginAndRedirect(
  page: Page,
  returnTo: string,
  user: TestUser = DEFAULT_TEST_USER,
  timeout = 15_000,
): Promise<void> {
  const params = new URLSearchParams({
    sub: user.sub,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    returnTo,
  });

  try {
    await page.goto(`/api/test/login?${params.toString()}`, { timeout });
    await page.waitForURL(`**${returnTo}`, { timeout });
  } catch (err: unknown) {
    const isTimeout =
      err instanceof Error &&
      (err.message.includes("Timeout") || err.constructor.name === "TimeoutError");
    if (isTimeout) {
      throw new Error(
        `loginAndRedirect timed out waiting for "${returnTo}" — ` +
          `is the server running with PLAYWRIGHT_TEST=1?`,
      );
    }
    throw err;
  }
}

/**
 * Shared Playwright auth helpers.
 *
 * loginAndRedirect() submits a form POST to /api/test/login with the given
 * user fields and a returnTo path.  The test endpoint creates a real session
 * and responds with a 302 redirect; the browser follows that redirect
 * naturally — no manual page.goto() is needed.  This mirrors the real OIDC
 * callback's req.session.returnTo redirect flow.
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
 * POST to /api/test/login via a synthetic form submission so the browser
 * follows the server-issued 302 redirect and lands on `returnTo`.
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
  await page.evaluate(
    ({ fields }: { fields: Record<string, string> }) => {
      const form = document.createElement("form");
      form.method = "POST";
      form.action = "/api/test/login";
      for (const [name, value] of Object.entries(fields)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
    },
    {
      fields: {
        sub: user.sub,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        returnTo,
      },
    },
  );

  try {
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

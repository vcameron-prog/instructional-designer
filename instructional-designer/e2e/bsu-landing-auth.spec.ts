/**
 * Smoke tests for the BSU faculty landing page (/bsu) — authenticated view.
 *
 * These tests sign in as a synthetic @bridgew.edu faculty user via the
 * dev-only POST /api/test/login endpoint (disabled in production) and verify
 * that the key elements visible only to authenticated BSU users are rendered:
 *   1. Quick Tools card  (data-testid="card-quick-tools")
 *   2. Design a New Course card  (data-testid="card-new-course")
 *
 * Companion to bsu-landing.spec.ts which covers the unauthenticated view.
 *
 * Run with:
 *   npx playwright test e2e/bsu-landing-auth.spec.ts
 */

import { test, expect } from "@playwright/test";

test.describe("BSU faculty landing page — authenticated faculty view", () => {
  test.beforeEach(async ({ page }) => {
    // Inject a synthetic @bridgew.edu session via the dev-only helper endpoint.
    // This avoids the full Replit OIDC flow while still exercising real Passport
    // sessions.  The endpoint writes directly to req.session and calls
    // session.save() so that Set-Cookie is emitted over plain HTTP.
    const resp = await page.request.post("/api/test/login", {
      data: {
        sub: "bsu-e2e-faculty-smoke",
        email: "e2e-faculty@bridgew.edu",
        firstName: "Faculty",
        lastName: "Smoke",
      },
    });
    expect(
      resp.status(),
      "POST /api/test/login must return 200 — is the app running in dev mode?",
    ).toBe(200);
    const body = await resp.json();
    expect(body?.ok, "test login response must have ok: true").toBe(true);
  });

  test("Quick Tools card is visible for authenticated BSU faculty", async ({
    page,
  }) => {
    await page.goto("/bsu");

    const card = page.getByTestId("card-quick-tools");
    await expect(card).toBeVisible({ timeout: 15_000 });
  });

  test("Design a New Course card is visible for authenticated BSU faculty", async ({
    page,
  }) => {
    await page.goto("/bsu");

    const card = page.getByTestId("card-new-course");
    await expect(card).toBeVisible({ timeout: 15_000 });
  });

  test("both faculty tool cards are visible together", async ({ page }) => {
    await page.goto("/bsu");

    await expect(page.getByTestId("card-quick-tools")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("card-new-course")).toBeVisible({
      timeout: 15_000,
    });
  });
});

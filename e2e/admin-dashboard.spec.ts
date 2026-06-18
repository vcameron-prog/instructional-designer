import { test, expect } from "@playwright/test";

/**
 * Admin Dashboard — System Configuration card
 *
 * Asserts that the Version History Limit stat card (data-testid="stat-version-history-limit")
 * is visible on /admin and displays a positive integer.
 *
 * Authentication is handled by GET /api/test/admin-login, a dev-only endpoint that
 * injects a pre-authenticated Passport session for the first user in ADMIN_USER_IDS.
 * The endpoint is disabled in production (NODE_ENV === "production").
 */
test.describe("Admin Dashboard — version history limit card", () => {
  test.beforeEach(async ({ page }) => {
    // Inject an admin session via the dev-only helper endpoint.
    // This avoids the full OIDC flow while still exercising real Passport sessions.
    const resp = await page.goto("/api/test/admin-login");
    expect(resp?.status(), "dev-login endpoint must return 200").toBe(200);
    const body = await resp?.json();
    expect(body?.ok, "dev-login response must have ok: true").toBe(true);
  });

  test("stat-version-history-limit is visible and contains a positive integer", async ({
    page,
  }) => {
    await page.goto("/admin");

    // Wait for the stats to load (the element is rendered once /api/admin/stats resolves).
    const card = page.getByTestId("stat-version-history-limit");
    await expect(card).toBeVisible({ timeout: 15_000 });

    // The version limit is rendered in a large <p> inside the card.
    // Extract the first number-like text from the card's content.
    const limitText = await card.locator("p").first().innerText();
    const parsed = parseInt(limitText.trim(), 10);

    expect(
      Number.isInteger(parsed) && parsed > 0,
      `Expected a positive integer inside stat-version-history-limit, got: "${limitText}"`,
    ).toBe(true);

    // Also verify the label text is present for human readability.
    await expect(card).toContainText("Version History Limit");
  });
});

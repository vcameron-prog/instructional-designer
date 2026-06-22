import { test, expect } from "@playwright/test";

/**
 * ID App Smoke Tests
 *
 * Verifies that the instructional-designer app's own routes work correctly
 * after the split from the root converter project:
 *
 *  1. Admin stats route returns ID-only JSON (courses, content, users;
 *     totalConversions: 0, conversionStats empty).
 *  2. Library page loads without errors and has no conversions card.
 *  3. VITE_CONVERTER_APP_URL is set and the landing-page converter link
 *     renders with the correct URL (not "#").
 *
 * Authentication (where required) is injected via dev-only endpoints so
 * no real OIDC flow is needed.
 */

// ---------------------------------------------------------------------------
// Helper: inject an admin session via the dev-only endpoint.
// Mirrors the same pattern used by the root app's admin-dashboard.spec.ts.
// ---------------------------------------------------------------------------
async function loginAsAdmin(page: import("@playwright/test").Page) {
  const resp = await page.goto("/api/test/admin-login");
  expect(resp?.status(), "dev admin-login endpoint must return 200").toBe(200);
  const body = await resp?.json();
  expect(body?.ok, "dev-login response must have ok: true").toBe(true);
}

// ---------------------------------------------------------------------------
// Helper: inject a regular BSU user session.
// ---------------------------------------------------------------------------
async function loginAsUser(
  page: import("@playwright/test").Page,
  sub = "e2e-user-001",
  email = "e2e@bridgew.edu",
) {
  const resp = await page.request.post("/api/test/login", {
    data: { sub, email, firstName: "E2E", lastName: "User" },
  });
  expect(resp.status(), "dev login endpoint must return 200").toBe(200);
}

// ===========================================================================
// Test 1 — Admin stats returns ID-only JSON
// ===========================================================================
test.describe("Admin stats — ID-only shape", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("totalConversions is 0 and conversionStats is empty", async ({ page }) => {
    const resp = await page.request.get("/api/admin/stats");
    expect(resp.status(), "/api/admin/stats must return 200").toBe(200);

    const body = await resp.json();

    // Summary must contain ID-relevant fields
    expect(body.summary, "summary object is present").toBeTruthy();
    expect(typeof body.summary.totalCourses, "totalCourses is a number").toBe("number");
    expect(typeof body.summary.totalContent, "totalContent is a number").toBe("number");
    expect(typeof body.summary.totalUsers, "totalUsers is a number").toBe("number");

    // Conversion count must be hard-coded to 0 (no converter DB in ID app)
    expect(
      body.summary.totalConversions,
      "totalConversions must be 0 — ID app has no converter data",
    ).toBe(0);

    // conversionStats must exist but be empty
    expect(body.conversionStats, "conversionStats object is present").toBeTruthy();
    expect(
      Object.keys(body.conversionStats.byStatus ?? {}).length,
      "byStatus must be empty",
    ).toBe(0);
    expect(
      Object.keys(body.conversionStats.bySourceType ?? {}).length,
      "bySourceType must be empty",
    ).toBe(0);
    expect(body.conversionStats.ocrUsed, "ocrUsed must be 0").toBe(0);

    // monthlyTrends entries must carry conversions: 0
    if (Array.isArray(body.monthlyTrends) && body.monthlyTrends.length > 0) {
      for (const trend of body.monthlyTrends) {
        expect(trend.conversions, `trend ${trend.month} conversions must be 0`).toBe(0);
      }
    }
  });
});

// ===========================================================================
// Test 2 — Library page loads without a conversions card
// ===========================================================================
test.describe("Library page — no conversions card", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsUser(page);
  });

  test("library page loads and does not show a conversions card", async ({ page }) => {
    // Capture JS errors before navigation
    const jsErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") jsErrors.push(msg.text());
    });

    await page.goto("/library");

    // Page URL must reach /library, not be redirected to an error or login page
    await expect(page).toHaveURL(/\/library/);

    // The page always renders this heading and back button regardless of auth/courses
    await expect(
      page.getByTestId("button-back"),
      "back button is always visible on library page",
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      page.getByRole("heading", { name: "Content Library", exact: true }),
      "'Content Library' h1 heading is visible",
    ).toBeVisible({ timeout: 10_000 });

    // There must be NO element with testid or text that references conversions
    const conversionsCard = page.locator('[data-testid*="conversion"]');
    await expect(conversionsCard, "no conversions testid on library page").toHaveCount(0);

    // Also check text — a "Conversions" heading would indicate stale converter UI
    const conversionHeading = page.getByRole("heading", { name: /conversions/i });
    await expect(conversionHeading, "no conversions heading on library page").toHaveCount(0);

    // No JS errors should have fired during page load
    expect(
      jsErrors.filter((e) => !e.includes("favicon") && !e.includes("ResizeObserver")),
      "no unhandled JS errors on library page",
    ).toHaveLength(0);
  });
});

// ===========================================================================
// Test 3 — Converter link uses VITE_CONVERTER_APP_URL
// ===========================================================================
test.describe("Landing page — Accessibility Converter link", () => {
  test("card-pdf-accessibility is visible and configured with a real URL", async ({ page }) => {
    await page.goto("/");

    const converterCard = page.getByTestId("card-pdf-accessibility");
    await expect(converterCard, "converter card is visible").toBeVisible({ timeout: 10_000 });

    // The card should have an accessible label and role="button"
    await expect(converterCard).toHaveAttribute(
      "aria-label",
      /Accessibility Converter/i,
    );
    await expect(converterCard).toHaveAttribute("role", "button");

    // Capture the URL that window.open would be called with
    let openedUrl: string | null = null;
    await page.exposeFunction("__captureOpenUrl", (url: string) => {
      openedUrl = url;
    });
    await page.addInitScript(() => {
      const orig = window.open.bind(window);
      window.open = (url?: string | URL, ...rest: any[]) => {
        if (typeof (window as any).__captureOpenUrl === "function") {
          (window as any).__captureOpenUrl(String(url ?? ""));
        }
        return orig(url, ...rest);
      };
    });

    // Re-navigate so the init script is active
    await page.goto("/");
    const card = page.getByTestId("card-pdf-accessibility");
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();

    // Give the click handler a moment to run
    await page.waitForTimeout(300);

    // The URL must not be the fallback "#"
    expect(openedUrl, "window.open must receive a real URL, not '#'").not.toBe("#");
    expect(openedUrl, "window.open URL must not be empty").toBeTruthy();
  });
});

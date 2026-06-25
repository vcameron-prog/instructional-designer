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
 *  4. Course creation form submits successfully and lands on the tools page.
 *  5. Quick-tool (assignment) form fills required fields, generates content
 *     (API mocked), and the result page renders without errors.
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
// Test 3 — Converter link points to /accessibility
// ===========================================================================

test.describe("Landing page — Accessibility Converter link", () => {
  test("card-pdf-accessibility is visible and opens /accessibility", async ({ page }) => {
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

    // The URL must end with /accessibility regardless of hostname (dev uses
    // window.location.hostname; prod uses VITE_CONVERTER_APP_URL which should
    // also end with /accessibility).
    expect(
      openedUrl,
      `window.open URL must end with /accessibility.\nReceived: ${openedUrl}`,
    ).toMatch(/\/accessibility$/);
  });
});

// ===========================================================================
// Test 4 — Course creation lands on the tools page
// ===========================================================================
test.describe("Course creation — form submits and lands on tools page", () => {
  // Track any course IDs created during this describe block so we can delete
  // them in afterEach, keeping the dev database free of stale test rows.
  let createdCourseId: number | null = null;

  test.beforeEach(async ({ page }) => {
    createdCourseId = null;
    await loginAsUser(page);
  });

  test.afterEach(async ({ page }) => {
    if (createdCourseId !== null) {
      // Re-authenticate as the same e2e user so the session cookie is present,
      // then issue a DELETE against the course that was just created.
      await loginAsUser(page);
      const resp = await page.request.delete(`/api/courses/${createdCourseId}`);
      // 204 = deleted, 404 = already gone — both are acceptable outcomes.
      const ok = resp.status() === 204 || resp.status() === 404;
      if (!ok) {
        console.warn(
          `[e2e teardown] Failed to delete test course ${createdCourseId}: HTTP ${resp.status()}`,
        );
      }
      createdCourseId = null;
    }
  });

  test("fills course form and navigates to the course tools page", async ({ page }) => {
    await page.goto("/new-course");
    await expect(page).toHaveURL(/\/new-course/, { timeout: 10_000 });

    // Fill all required fields
    await page.getByTestId("input-course-name").fill("E2E Test Course");
    await page.getByTestId("input-course-number").fill("TEST 101");

    // Course level select
    await page.getByTestId("select-course-level").click();
    await page.getByRole("option", { name: "Undergraduate - 100 level" }).click();

    // Credits select
    await page.getByTestId("select-credits").click();
    await page.getByRole("option", { name: "3" }).click();

    // Semester type select
    await page.getByTestId("select-semester-type").click();
    await page.getByRole("option", { name: "Fall" }).click();

    // Semester year select — pick the first available year
    await page.getByTestId("select-semester-year").click();
    await page.getByRole("option").first().click();

    await page.getByTestId("input-instructor").fill("E2E Instructor");
    await page.getByTestId("input-department").fill("E2E Department");

    await page.getByTestId("textarea-description").fill(
      "This is a smoke-test course created by the E2E suite to verify the creation flow.",
    );
    await page.getByTestId("textarea-outcomes").fill(
      "Students will demonstrate understanding of the course material.",
    );

    // Submit the form
    await page.getByTestId("button-submit").click();

    // After a successful create the app navigates to /course/:id/tools
    await expect(page, "should land on the course tools page").toHaveURL(
      /\/course\/\d+\/tools/,
      { timeout: 15_000 },
    );

    // Extract the course ID from the URL so afterEach can clean it up.
    const urlMatch = page.url().match(/\/course\/(\d+)\/tools/);
    if (urlMatch) {
      createdCourseId = parseInt(urlMatch[1], 10);
    }

    // The tools page shows a back-home button as its persistent chrome
    await expect(
      page.getByTestId("button-back-home"),
      "tools page back-home button is visible",
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ===========================================================================
// Test 5 — Quick-tool form generates content and result page renders
// ===========================================================================
// (see also Test 6 below for the batch assignment+rubric flow)
test.describe("Quick-tool — assignment form generates content", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsUser(page);
  });

  test("fills assignment form, mocks generation, and result page renders content", async ({
    page,
  }) => {
    // ---------------------------------------------------------------------------
    // Mock the AI generation endpoint so the test is fast and deterministic.
    // The route handler returns a minimal GeneratedContent object; a second mock
    // covers the subsequent fetch for that same record on the result page.
    // ---------------------------------------------------------------------------
    const MOCK_ID = 88888;
    const mockContent = {
      id: MOCK_ID,
      courseId: null,
      userId: "e2e-user-001",
      visitorToken: null,
      toolType: "assignment",
      toolName: "Assignment",
      formData: {},
      content:
        "## Overview\n\nThis is a smoke-test assignment generated by the E2E suite.\n\n## Learning Objectives\n\nStudents will understand the core concepts.",
      isApproved: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await page.route("**/api/generate-standalone", async (route) => {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(mockContent),
      });
    });

    await page.route(`**/api/standalone-content/${MOCK_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockContent),
      });
    });

    // Navigate to quick tools and pick the assignment card
    await page.goto("/quick-tools");
    await expect(
      page.getByTestId("card-quick-tool-assignment"),
      "assignment quick-tool card is visible",
    ).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("card-quick-tool-assignment").click();

    await expect(page, "navigates to assignment tool form").toHaveURL(
      /\/quick-tools\/assignment/,
      { timeout: 10_000 },
    );

    // Fill required fields
    await page.getByTestId("select-assignmentType").click();
    await page.getByRole("option", { name: "Essay/Paper" }).click();

    await page.getByTestId("textarea-learningObjectives").fill(
      "Students will analyze and synthesize primary source materials.",
    );

    await page.getByTestId("select-duration").click();
    await page.getByRole("option", { name: "1 week" }).click();

    // Submit — the mocked endpoint responds immediately
    await page.getByTestId("button-generate").click();

    // Should navigate to the result page for the mocked content id
    await expect(page, "lands on result page for mocked content").toHaveURL(
      new RegExp(`/quick-tools/result/${MOCK_ID}`),
      { timeout: 15_000 },
    );

    // The copy button is rendered only once content has loaded — its presence
    // confirms the result page rendered successfully without errors.
    await expect(
      page.getByTestId("button-copy"),
      "copy button is visible on result page — content loaded without errors",
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ===========================================================================
// Test 7 — Accessibility Tools hub renders all 4 tool tiles
// ===========================================================================
test.describe("Accessibility Tools hub — all 4 tool tiles visible", () => {
  test("renders url-scanner, color-contrast, alt-text, and math-ocr cards", async ({ page }) => {
    await page.goto("/accessibility-tools");
    await expect(page).toHaveURL(/\/accessibility-tools/, { timeout: 10_000 });

    await expect(
      page.getByRole("heading", { name: "Accessibility Tools", exact: true }),
      "'Accessibility Tools' heading is visible",
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      page.getByTestId("card-tool-url-scanner"),
      "URL Scanner tile is visible",
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      page.getByTestId("card-tool-color-contrast"),
      "Color Contrast tile is visible",
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      page.getByTestId("card-tool-alt-text"),
      "Alt Text Generator tile is visible",
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      page.getByTestId("card-tool-math-ocr"),
      "Math OCR tile is visible",
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ===========================================================================
// Test 8 — Color Contrast page: inputs, submit, and mocked result
// ===========================================================================
test.describe("Accessibility Tools — Color Contrast page", () => {
  test("foreground/background inputs and submit button visible; result renders on API response", async ({
    page,
  }) => {
    // Mock the contrast API so the test is fast and avoids hitting Anthropic
    const mockContrastResult = {
      ratio: 21,
      aa_normal: true,
      aa_large: true,
      aaa_normal: true,
      aaa_large: true,
      foreground: "#000000",
      background: "#ffffff",
    };

    await page.route("**/api/tools/color-contrast", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockContrastResult),
      });
    });

    await page.goto("/accessibility-tools/color-contrast");
    await expect(page).toHaveURL(/\/accessibility-tools\/color-contrast/, { timeout: 10_000 });

    await expect(
      page.getByRole("heading", { name: "Color Contrast Checker", exact: true }),
      "Color Contrast Checker heading is visible",
    ).toBeVisible({ timeout: 10_000 });

    const fgInput = page.getByTestId("input-foreground");
    await expect(fgInput, "foreground input is visible").toBeVisible({ timeout: 10_000 });

    const bgInput = page.getByTestId("input-background");
    await expect(bgInput, "background input is visible").toBeVisible({ timeout: 10_000 });

    const checkButton = page.getByTestId("button-check-contrast");
    await expect(checkButton, "Check Contrast button is visible").toBeVisible({ timeout: 10_000 });

    // Fill in colors and submit
    await fgInput.fill("#000000");
    await bgInput.fill("#ffffff");
    await checkButton.click();

    // Result panel must appear
    await expect(
      page.getByTestId("contrast-result"),
      "contrast result panel appears after submission",
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      page.getByTestId("text-contrast-ratio"),
      "contrast ratio value is displayed",
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ===========================================================================
// Test 9 — URL Scanner page: URL input, submit button, mocked result area
// ===========================================================================
test.describe("Accessibility Tools — URL Scanner page", () => {
  test("URL input and scan button visible; result area renders on API response", async ({
    page,
  }) => {
    const mockScanResult = {
      url: "https://example.com",
      score: 90,
      summary: "Page is mostly accessible with a few minor issues.",
      issues: [],
      passed: ["Images have alt text", "Headings are properly structured"],
    };

    await page.route("**/api/tools/url-scanner", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockScanResult),
      });
    });

    await page.goto("/accessibility-tools/url-scanner");
    await expect(page).toHaveURL(/\/accessibility-tools\/url-scanner/, { timeout: 10_000 });

    await expect(
      page.getByRole("heading", { name: "URL Accessibility Scanner", exact: true }),
      "URL Accessibility Scanner heading is visible",
    ).toBeVisible({ timeout: 10_000 });

    const urlInput = page.getByTestId("input-scan-url");
    await expect(urlInput, "URL input is visible").toBeVisible({ timeout: 10_000 });

    const scanButton = page.getByTestId("button-scan");
    await expect(scanButton, "Scan button is visible").toBeVisible({ timeout: 10_000 });

    // Fill in a URL and trigger a scan
    await urlInput.fill("https://example.com");
    await scanButton.click();

    // Result area must appear after the mocked response
    await expect(
      page.getByTestId("scan-results"),
      "scan results area appears after submission",
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      page.getByTestId("text-scan-score"),
      "scan score is displayed",
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ===========================================================================
// Test 10 — Alt Text Generator: upload image and assert result card appears
// ===========================================================================
test.describe("Accessibility Tools — Alt Text Generator page", () => {
  test("uploads a synthetic image, mocks API, and result card with alt text appears", async ({
    page,
  }) => {
    // ---------------------------------------------------------------------------
    // Mock navigator.clipboard before the first navigation so the component's
    // copy() function reaches setCopied(true) without real clipboard access.
    // navigator.clipboard is unavailable in headless Playwright; without this
    // mock the try/catch in copy() silently swallows the error and the button
    // never transitions to its "Copied" state.
    // ---------------------------------------------------------------------------
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: (_text: string) => Promise.resolve() },
        writable: true,
        configurable: true,
      });
    });

    // Mock the alt-text API — avoid any real Anthropic call
    const mockAltResult = {
      altText: "A red circle",
      isDecorative: false,
      characterCount: 14,
    };
    await page.route("**/api/tools/alt-text", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockAltResult),
      });
    });

    await page.goto("/accessibility-tools/alt-text");
    await expect(page).toHaveURL(/\/accessibility-tools\/alt-text/, { timeout: 10_000 });

    await expect(
      page.getByRole("heading", { name: "Alt Text Generator", exact: true }),
      "Alt Text Generator heading is visible",
    ).toBeVisible({ timeout: 10_000 });

    // Dropzone must be visible
    await expect(
      page.getByTestId("dropzone-image"),
      "image upload dropzone is visible",
    ).toBeVisible({ timeout: 10_000 });

    // Upload a minimal 1×1 red PNG via the hidden file input
    const fileInput = page.getByTestId("input-image-file");
    await expect(fileInput, "hidden file input is present in DOM").toBeAttached();

    // Minimal 1×1 red PNG (67 bytes, valid file header)
    const minimalPng = Buffer.from(
      "89504e470d0a1a0a0000000d494844520000000100000001080200000090" +
        "7753de0000000c4944415408d76360f8cfc00000000200017221bc330000" +
        "0000049454e44ae426082",
      "hex",
    );
    await fileInput.setInputFiles({
      name: "test-image.png",
      mimeType: "image/png",
      buffer: minimalPng,
    });

    // Generate button should become enabled once a file is selected
    const generateBtn = page.getByTestId("button-generate-alt");
    await expect(generateBtn, "Generate Alt Text button is enabled after file select").toBeEnabled({
      timeout: 5_000,
    });

    // Click to trigger the (mocked) API call
    await generateBtn.click();

    // Result card must appear
    await expect(
      page.getByTestId("alt-result"),
      "alt-result card appears after generation",
    ).toBeVisible({ timeout: 10_000 });

    // The generated alt text must be displayed
    await expect(
      page.getByTestId("text-generated-alt"),
      "generated alt text is displayed in result card",
    ).toHaveText("A red circle", { timeout: 10_000 });

    // The character count badge must show the correct count from the API response
    await expect(
      page.getByTestId("text-alt-char-count"),
      "character count badge shows '14 characters' inside the result card",
    ).toHaveText("14 characters", { timeout: 10_000 });

    // ---------------------------------------------------------------------------
    // Verify the copy button transitions to its "Copied" state after a click.
    // ---------------------------------------------------------------------------
    const copyBtn = page.getByTestId("button-copy-alt");
    await expect(copyBtn, "copy-alt button is visible before clicking").toBeVisible({ timeout: 5_000 });
    await expect(copyBtn, "copy-alt button starts with 'Copy alt text' label").toHaveAttribute(
      "aria-label",
      "Copy alt text",
    );

    await copyBtn.click();

    // The button should switch aria-label to "Copied" within a short window
    await expect(
      copyBtn,
      "copy-alt button aria-label transitions to 'Copied' after click",
    ).toHaveAttribute("aria-label", "Copied", { timeout: 3_000 });
  });

  test("uploads a synthetic image, mocks decorative API response, and shows empty-alt code snippet", async ({
    page,
  }) => {
    // Mock the alt-text API to return a decorative result
    const mockDecorativeResult = {
      altText: "",
      isDecorative: true,
      characterCount: 0,
    };
    await page.route("**/api/tools/alt-text", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockDecorativeResult),
      });
    });

    await page.goto("/accessibility-tools/alt-text");
    await expect(page).toHaveURL(/\/accessibility-tools\/alt-text/, { timeout: 10_000 });

    // Upload the same minimal 1×1 red PNG via the hidden file input
    const fileInput = page.getByTestId("input-image-file");
    await expect(fileInput, "hidden file input is present in DOM").toBeAttached();

    const minimalPng = Buffer.from(
      "89504e470d0a1a0a0000000d494844520000000100000001080200000090" +
        "7753de0000000c4944415408d76360f8cfc00000000200017221bc330000" +
        "0000049454e44ae426082",
      "hex",
    );
    await fileInput.setInputFiles({
      name: "test-image.png",
      mimeType: "image/png",
      buffer: minimalPng,
    });

    // Generate button should become enabled once a file is selected
    const generateBtn = page.getByTestId("button-generate-alt");
    await expect(generateBtn, "Generate Alt Text button is enabled after file select").toBeEnabled({
      timeout: 5_000,
    });

    // Click to trigger the (mocked) API call
    await generateBtn.click();

    // Result card must appear
    await expect(
      page.getByTestId("alt-result"),
      "alt-result card appears for decorative image",
    ).toBeVisible({ timeout: 10_000 });

    // The non-decorative alt text element must NOT be present
    await expect(
      page.getByTestId("text-generated-alt"),
      "text-generated-alt is not rendered for decorative images",
    ).toHaveCount(0);

    // The decorative code snippet with alt="" must be visible
    await expect(
      page.getByTestId("code-decorative-snippet"),
      "decorative-image code snippet with alt=\"\" is visible",
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      page.getByTestId("code-decorative-snippet"),
      "code snippet contains alt=\"\" attribute",
    ).toContainText('alt=""');

    // The human-readable "Decorative Image" label must be visible inside the result card
    await expect(
      page.getByTestId("alt-result").getByText("Decorative Image"),
      "result card shows the 'Decorative Image' label",
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ===========================================================================
// Test 11 — Math OCR: upload image and assert result card appears
// ===========================================================================
test.describe("Accessibility Tools — Math OCR page", () => {
  test("uploads a synthetic image, mocks API, and math-result card appears", async ({ page }) => {
    // Mock the math-ocr API — avoid any real Anthropic call
    const mockMathResult = {
      plainText: "x squared plus y squared equals r squared",
      latex: "x^2 + y^2 = r^2",
      mathml: "<math><msup><mi>x</mi><mn>2</mn></msup></math>",
      description: "The Pythagorean theorem in standard form.",
    };
    await page.route("**/api/tools/math-ocr", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockMathResult),
      });
    });

    await page.goto("/accessibility-tools/math-ocr");
    await expect(page).toHaveURL(/\/accessibility-tools\/math-ocr/, { timeout: 10_000 });

    await expect(
      page.getByRole("heading", { name: "Math OCR", exact: true }),
      "Math OCR heading is visible",
    ).toBeVisible({ timeout: 10_000 });

    // Dropzone must be visible
    await expect(
      page.getByTestId("dropzone-math-image"),
      "math image upload dropzone is visible",
    ).toBeVisible({ timeout: 10_000 });

    // Upload a minimal 1×1 PNG via the hidden file input
    const fileInput = page.getByTestId("input-math-file");
    await expect(fileInput, "hidden file input is present in DOM").toBeAttached();

    const minimalPng = Buffer.from(
      "89504e470d0a1a0a0000000d494844520000000100000001080200000090" +
        "7753de0000000c4944415408d76360f8cfc00000000200017221bc330000" +
        "0000049454e44ae426082",
      "hex",
    );
    await fileInput.setInputFiles({
      name: "math-image.png",
      mimeType: "image/png",
      buffer: minimalPng,
    });

    // Extract button should become enabled once a file is selected
    const extractBtn = page.getByTestId("button-extract-math");
    await expect(extractBtn, "Extract Math Content button is enabled after file select").toBeEnabled(
      { timeout: 5_000 },
    );

    // Click to trigger the (mocked) API call
    await extractBtn.click();

    // Math result card must appear
    await expect(
      page.getByTestId("math-result"),
      "math-result card appears after extraction",
    ).toBeVisible({ timeout: 10_000 });

    // At least one copy button should be visible in the result card
    await expect(
      page.getByTestId("button-copy-plain"),
      "copy plain-text button is visible in math-result card",
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ===========================================================================
// Test 6 — Batch assignment+rubric form generates both and result-batch renders
// ===========================================================================
test.describe("Quick-tool — batch assignment+rubric form generates both items", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsUser(page);
  });

  test("enables rubric switch, mocks batch endpoint, and result-batch page renders both panels", async ({
    page,
  }) => {
    // ---------------------------------------------------------------------------
    // Mock IDs for the two generated records.
    // ---------------------------------------------------------------------------
    const ASSIGNMENT_ID = 77701;
    const RUBRIC_ID = 77702;

    const mockAssignment = {
      id: ASSIGNMENT_ID,
      courseId: null,
      userId: "e2e-user-001",
      visitorToken: null,
      toolType: "assignment",
      toolName: "Assignment",
      formData: {},
      content:
        "## Overview\n\nBatch smoke-test assignment.\n\n## Learning Objectives\n\nStudents will demonstrate mastery.",
      isApproved: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockRubric = {
      id: RUBRIC_ID,
      courseId: null,
      userId: "e2e-user-001",
      visitorToken: null,
      toolType: "rubric",
      toolName: "Rubric",
      formData: {},
      content:
        "## Criteria\n\nBatch smoke-test rubric.\n\n## Scoring\n\nExcellent / Satisfactory / Needs Improvement.",
      isApproved: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Mock the batch generation endpoint
    await page.route("**/api/generate-batch-assignment-rubric", async (route) => {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ assignmentId: ASSIGNMENT_ID, rubricId: RUBRIC_ID }),
      });
    });

    // Mock the individual content fetches that result-batch makes for each panel
    await page.route(`**/api/standalone-content/${ASSIGNMENT_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockAssignment),
      });
    });

    await page.route(`**/api/standalone-content/${RUBRIC_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockRubric),
      });
    });

    // Navigate to the assignment quick-tool form
    await page.goto("/quick-tools/assignment");
    await expect(page, "navigates to assignment tool form").toHaveURL(
      /\/quick-tools\/assignment/,
      { timeout: 10_000 },
    );

    // Enable the "Generate matching rubric" toggle
    const rubricSwitch = page.getByTestId("switch-generate-rubric");
    await expect(rubricSwitch, "generate-rubric switch is visible").toBeVisible({ timeout: 10_000 });
    await rubricSwitch.click();

    // Fill the required form fields
    await page.getByTestId("select-assignmentType").click();
    await page.getByRole("option", { name: "Essay/Paper" }).click();

    const learningObjectivesTextarea = page.getByTestId("textarea-learningObjectives");
    await expect(learningObjectivesTextarea, "learningObjectives textarea is visible").toBeVisible({ timeout: 10_000 });
    await learningObjectivesTextarea.scrollIntoViewIfNeeded();
    await learningObjectivesTextarea.fill(
      "Students will critically evaluate primary sources and construct evidence-based arguments.",
    );

    await page.getByTestId("select-duration").click();
    await page.getByRole("option", { name: "1 week" }).click();

    // Submit — the mocked batch endpoint responds immediately
    await page.getByTestId("button-generate").click();

    // Should navigate to the result-batch page for both mocked IDs
    await expect(page, "lands on result-batch page for mocked content").toHaveURL(
      new RegExp(`/quick-tools/result-batch/${ASSIGNMENT_ID}/${RUBRIC_ID}`),
      { timeout: 15_000 },
    );

    // The assignment copy button confirms the assignment panel loaded without errors
    await expect(
      page.getByTestId("button-copy-assignment"),
      "copy button for assignment panel is visible — assignment content loaded",
    ).toBeVisible({ timeout: 10_000 });

    // The rubric copy button confirms the rubric panel loaded without errors
    await expect(
      page.getByTestId("button-copy-rubric"),
      "copy button for rubric panel is visible — rubric content loaded",
    ).toBeVisible({ timeout: 10_000 });
  });
});

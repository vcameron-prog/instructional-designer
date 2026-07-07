import { test, expect } from "@playwright/test";

/**
 * Accessibility Tools — Integration Tests
 *
 * These tests hit the real server endpoints with NO page.route mocking.
 * They validate the server-side logic (math, response shape, field ranges)
 * rather than just confirming the UI can render a given payload.
 *
 * Labelled [integration] so they can be excluded from fast CI runs:
 *   npx playwright test --grep-invert integration
 *
 * Included test suites:
 *  A. Color Contrast — pure WCAG math, fully deterministic; always safe to run.
 *  B. URL Scanner    — fetches a public URL and calls the Anthropic AI;
 *     skipped automatically when ANTHROPIC_API_KEY is not set.
 */

// ===========================================================================
// A. [integration] Color Contrast — real server, no mock
// ===========================================================================
test.describe("[integration] Color Contrast — real server response", () => {
  // Black on white: the maximum possible contrast (21:1).
  test("black on white returns ratio ≈ 21 and passes all WCAG levels", async ({ page }) => {
    const resp = await page.request.post("/api/tools/color-contrast", {
      data: { foreground: "#000000", background: "#ffffff" },
    });

    expect(resp.status(), "color-contrast must return 200").toBe(200);

    const body = await resp.json();

    // Ratio must be a positive finite number
    expect(typeof body.ratio, "ratio is a number").toBe("number");
    expect(body.ratio, "ratio must be > 0").toBeGreaterThan(0);
    expect(isFinite(body.ratio), "ratio must be finite").toBe(true);

    // Black / white is exactly 21:1 per WCAG specification
    expect(body.ratio, "black-on-white ratio must be 21").toBe(21);

    // All WCAG levels pass at 21:1
    expect(body.aa_normal, "aa_normal passes at 21:1").toBe(true);
    expect(body.aa_large, "aa_large passes at 21:1").toBe(true);
    expect(body.aaa_normal, "aaa_normal passes at 21:1").toBe(true);
    expect(body.aaa_large, "aaa_large passes at 21:1").toBe(true);

    // Echo fields must match what was sent
    expect(body.foreground, "foreground echoed").toBe("#000000");
    expect(body.background, "background echoed").toBe("#ffffff");
  });

  // White on white: minimum contrast (1:1) — fails every WCAG level.
  test("white on white returns ratio 1 and fails all WCAG levels", async ({ page }) => {
    const resp = await page.request.post("/api/tools/color-contrast", {
      data: { foreground: "#ffffff", background: "#ffffff" },
    });

    expect(resp.status(), "color-contrast must return 200").toBe(200);

    const body = await resp.json();

    expect(body.ratio, "white-on-white ratio must be 1").toBe(1);
    expect(body.aa_normal, "aa_normal fails at 1:1").toBe(false);
    expect(body.aa_large, "aa_large fails at 1:1").toBe(false);
    expect(body.aaa_normal, "aaa_normal fails at 1:1").toBe(false);
    expect(body.aaa_large, "aaa_large fails at 1:1").toBe(false);
  });

  // Mid-range pair: a ratio that passes AA large/large but not AA normal.
  // #767676 on #ffffff → ratio ≈ 4.54, which is ≥ 4.5 (aa_normal) and ≥ 3 (aa_large).
  test("#767676 on #ffffff passes AA (ratio ≈ 4.54) but not AAA normal", async ({ page }) => {
    const resp = await page.request.post("/api/tools/color-contrast", {
      data: { foreground: "#767676", background: "#ffffff" },
    });

    expect(resp.status(), "color-contrast must return 200").toBe(200);

    const body = await resp.json();

    expect(body.ratio, "ratio must be > 0").toBeGreaterThan(0);
    // Known value for this pair
    expect(body.ratio, "ratio must be ≥ 4.5").toBeGreaterThanOrEqual(4.5);
    expect(body.ratio, "ratio must be < 7").toBeLessThan(7);

    expect(body.aa_normal, "aa_normal passes at ≥ 4.5").toBe(true);
    expect(body.aa_large, "aa_large passes at ≥ 3").toBe(true);
    expect(body.aaa_normal, "aaa_normal fails below 7").toBe(false);
    // aaa_large requires ≥ 4.5 — same threshold as aa_normal
    expect(body.aaa_large, "aaa_large passes at ≥ 4.5").toBe(true);
  });

  // 3-digit shorthand hex must be accepted and expanded correctly.
  test("3-digit shorthand #000 / #fff equals the 6-digit variant", async ({ page }) => {
    const [short, full] = await Promise.all([
      page.request.post("/api/tools/color-contrast", {
        data: { foreground: "#000", background: "#fff" },
      }),
      page.request.post("/api/tools/color-contrast", {
        data: { foreground: "#000000", background: "#ffffff" },
      }),
    ]);

    expect(short.status(), "shorthand request returns 200").toBe(200);
    expect(full.status(), "full-hex request returns 200").toBe(200);

    const shortBody = await short.json();
    const fullBody = await full.json();

    expect(shortBody.ratio, "shorthand ratio matches full-hex ratio").toBe(fullBody.ratio);
  });

  // Invalid color must return 400 — not a silent wrong answer.
  test("invalid foreground color returns 400", async ({ page }) => {
    const resp = await page.request.post("/api/tools/color-contrast", {
      data: { foreground: "notacolor", background: "#ffffff" },
    });
    expect(resp.status(), "invalid foreground must yield 400").toBe(400);
    const body = await resp.json();
    expect(body.error, "error message is present").toBeTruthy();
  });

  // Missing both fields must return 400.
  test("missing colors returns 400", async ({ page }) => {
    const resp = await page.request.post("/api/tools/color-contrast", {
      data: {},
    });
    expect(resp.status(), "missing colors must yield 400").toBe(400);
  });
});

// ===========================================================================
// B. [integration] URL Scanner — real server + AI response, no mock
// ===========================================================================
// These tests make a live Anthropic API call.  They are automatically skipped
// when ANTHROPIC_API_KEY is absent from the server environment.
test.describe("[integration] URL Scanner — real server + AI response", () => {
  test.beforeEach(async ({ page }) => {
    // Probe the server for the API key presence via a canary request.
    // If the key is missing the endpoint returns a 500 with a recognisable
    // message; we skip gracefully rather than fail the suite.
    const probe = await page.request.post("/api/tools/url-scanner", {
      data: { url: "https://example.com" },
    });
    const status = probe.status();
    if (status === 429) {
      test.skip(true, "Rate limit exceeded — skipping AI-dependent test");
    }
    if (status === 500) {
      const body = await probe.json().catch(() => ({}));
      const msg = (body?.error ?? "") as string;
      if (
        msg.toLowerCase().includes("api key") ||
        msg.toLowerCase().includes("anthropic") ||
        msg.toLowerCase().includes("authentication")
      ) {
        test.skip(true, "ANTHROPIC_API_KEY not available — skipping AI-dependent test");
      }
    }
  });

  test("example.com scan returns a valid accessibility report shape", async ({ page }) => {
    const resp = await page.request.post("/api/tools/url-scanner", {
      data: { url: "https://example.com" },
    });

    // A network or API error produces a 4xx/5xx — fail fast so the cause is clear
    expect(
      resp.status(),
      `url-scanner returned ${resp.status()} — check ANTHROPIC_API_KEY and network access`,
    ).toBe(200);

    const body = await resp.json();

    // --- Shape checks ---
    expect(body, "response body is an object").toBeTruthy();

    // url field must be present and match what was sent
    expect(typeof body.url, "url field is a string").toBe("string");
    expect(body.url, "url field matches the request").toContain("example.com");

    // score must be an integer in [0, 100]
    expect(typeof body.score, "score is a number").toBe("number");
    expect(body.score, "score must be ≥ 0").toBeGreaterThanOrEqual(0);
    expect(body.score, "score must be ≤ 100").toBeLessThanOrEqual(100);
    expect(Number.isInteger(body.score) || body.score === Math.floor(body.score),
      "score is a whole number or truncated value",
    ).toBe(true);

    // summary must be a non-empty string
    expect(typeof body.summary, "summary is a string").toBe("string");
    expect(body.summary.trim().length, "summary is non-empty").toBeGreaterThan(0);

    // issues must be an array (may be empty for a simple page like example.com)
    expect(Array.isArray(body.issues), "issues is an array").toBe(true);

    // Each issue must have at minimum: title, severity, description
    for (const issue of body.issues as Array<Record<string, unknown>>) {
      expect(typeof issue.title, "issue.title is a string").toBe("string");
      expect(typeof issue.severity, "issue.severity is a string").toBe("string");
      expect(
        ["critical", "major", "minor"].includes(issue.severity as string),
        `issue.severity "${issue.severity}" must be critical | major | minor`,
      ).toBe(true);
      expect(typeof issue.description, "issue.description is a string").toBe("string");
    }

    // passed must be an array of strings (may be empty)
    expect(Array.isArray(body.passed), "passed is an array").toBe(true);
    for (const item of body.passed as unknown[]) {
      expect(typeof item, "each passed entry is a string").toBe("string");
    }
  });

  // SSRF guard: localhost must be blocked at the server level, not just the UI.
  test("localhost URL is rejected with 400 — SSRF guard active", async ({ page }) => {
    const resp = await page.request.post("/api/tools/url-scanner", {
      data: { url: "http://127.0.0.1/" },
    });
    expect(resp.status(), "SSRF guard must return 400 for localhost").toBe(400);
    const body = await resp.json();
    expect(body.error, "error message is present").toBeTruthy();
  });

  // Invalid/non-URL input must return 400.
  test("non-URL input is rejected with 400", async ({ page }) => {
    const resp = await page.request.post("/api/tools/url-scanner", {
      data: { url: "not-a-url" },
    });
    expect(resp.status(), "non-URL must yield 400").toBe(400);
    const body = await resp.json();
    expect(body.error, "error message is present").toBeTruthy();
  });

  // file:// protocol must be blocked.
  test("file:// URL is rejected with 400", async ({ page }) => {
    const resp = await page.request.post("/api/tools/url-scanner", {
      data: { url: "file:///etc/passwd" },
    });
    expect(resp.status(), "file:// URL must yield 400").toBe(400);
  });

  // Missing url field must return 400.
  test("missing url field returns 400", async ({ page }) => {
    const resp = await page.request.post("/api/tools/url-scanner", {
      data: {},
    });
    expect(resp.status(), "missing url must yield 400").toBe(400);
  });
});

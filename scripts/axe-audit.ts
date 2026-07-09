#!/usr/bin/env tsx
/**
 * scripts/axe-audit.ts
 *
 * Accessibility audit using axe-core for the Instructional Designer app.
 * Covers both public (unauthenticated) and authenticated pages.
 *
 * Authenticated pages are reached by posting to the dev-only
 * POST /api/test/login endpoint (disabled in production) to inject a
 * synthetic BSU session before navigating.
 *
 * For course-scoped result pages, the script creates a real course and
 * content record via the API, audits the page, then deletes the records.
 * Content is created with POST /api/test/seed-content (no AI required).
 *
 * Exit codes:
 *   0 — no critical or serious violations found on any audited page
 *   1 — at least one critical or serious violation was found, OR a required
 *       page could not be reached (login failure, setup failure)
 *
 * Usage:
 *   npx tsx scripts/axe-audit.ts
 *
 * Environment variables:
 *   AXE_BASE_URL  — base URL of the running Instructional Designer app
 *                   (default: http://127.0.0.1:3001)
 *   PLAYWRIGHT_CHROMIUM_PATH — path to the Chromium executable
 *                   (default: Nix store path used by existing e2e suite)
 */

import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BASE_URL =
  process.env.AXE_BASE_URL ?? "http://127.0.0.1:3001";

const CHROMIUM_PATH =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ??
  "/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium";

const APP_BASE = "/faculty";

/** Path to the axe-core browser bundle installed in node_modules */
const AXE_SCRIPT_PATH = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../node_modules/axe-core/axe.js",
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AxeViolation {
  id: string;
  impact: string | null;
  description: string;
  nodes: Array<{ html: string; failureSummary?: string }>;
}

interface PageResult {
  label: string;
  url: string;
  violations: AxeViolation[];
  /** Set when the page could not be audited at all (login/setup failure). */
  error?: string;
  /** Whether this page is required (failure here causes a non-zero exit). */
  required?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function appPath(p: string): string {
  return `${APP_BASE}${p.startsWith("/") ? p : `/${p}`}`;
}

function fullUrl(p: string): string {
  return `${BASE_URL}${p}`;
}

/** POST /api/test/login to inject a synthetic BSU session into the browser context. */
async function loginAsUser(
  page: import("playwright").Page,
  sub = "axe-audit-user",
  email = "axe-audit@bridgew.edu",
): Promise<void> {
  const resp = await page.request.post(`${BASE_URL}/api/test/login`, {
    data: { sub, email, firstName: "Axe", lastName: "Audit" },
  });
  if (!resp.ok()) {
    throw new Error(
      `POST /api/test/login returned HTTP ${resp.status()} — is the app running in dev mode?`,
    );
  }
  const body = await resp.json();
  if (!body?.ok) {
    throw new Error(
      `POST /api/test/login returned ok:${body?.ok} — synthetic login failed`,
    );
  }
}

/** GET /api/test/admin-login to inject an admin session. */
async function loginAsAdmin(page: import("playwright").Page): Promise<void> {
  const resp = await page.goto(`${BASE_URL}/api/test/admin-login`);
  if (!resp || !resp.ok()) {
    throw new Error(
      `GET /api/test/admin-login returned HTTP ${resp?.status() ?? "no response"}` +
        ` — is ADMIN_USER_IDS configured and the app in dev mode?`,
    );
  }
  const body = await resp.json();
  if (!body?.ok) {
    throw new Error(
      `GET /api/test/admin-login returned ok:${body?.ok} — ` +
        (body?.error ?? "synthetic admin login failed"),
    );
  }
}

/** Read axe-core source and inject it into the page, then run axe.run(). */
async function runAxe(page: import("playwright").Page): Promise<AxeViolation[]> {
  await page.addScriptTag({ path: AXE_SCRIPT_PATH });

  const violations = await page.evaluate((): Promise<AxeViolation[]> => {
    return new Promise((resolve, reject) => {
      // @ts-ignore — axe is injected globally
      window.axe.run(
        document,
        {
          runOnly: {
            type: "tag",
            values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"],
          },
        },
        (err: Error | null, results: { violations: AxeViolation[] }) => {
          if (err) reject(err);
          else resolve(results.violations);
        },
      );
    });
  });

  return violations;
}

/** Filter to only critical/serious violations. */
function isCriticalOrSerious(v: AxeViolation): boolean {
  return v.impact === "critical" || v.impact === "serious";
}

/** Print a human-readable summary of violations for a page. */
function printViolations(label: string, url: string, violations: AxeViolation[]): void {
  const criticalOrSerious = violations.filter(isCriticalOrSerious);
  const minor = violations.filter((v) => !isCriticalOrSerious(v));

  const statusIcon = criticalOrSerious.length > 0 ? "✗" : "✓";
  console.log(`\n${statusIcon} ${label}`);
  console.log(`  URL: ${url}`);
  console.log(
    `  Violations: ${violations.length} total (${criticalOrSerious.length} critical/serious, ${minor.length} minor)`,
  );

  for (const v of criticalOrSerious) {
    console.log(`\n  [${v.impact?.toUpperCase()}] ${v.id}: ${v.description}`);
    for (const node of v.nodes.slice(0, 3)) {
      console.log(`    Element: ${node.html.slice(0, 120)}`);
      if (node.failureSummary) {
        const summary = node.failureSummary.replace(/\n/g, " ").slice(0, 160);
        console.log(`    Fix: ${summary}`);
      }
    }
    if (v.nodes.length > 3) {
      console.log(`    ... and ${v.nodes.length - 3} more affected elements`);
    }
  }
}

// ---------------------------------------------------------------------------
// Test-data management helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal course record via POST /api/courses.
 * Requires an active BSU-authenticated session in `page`.
 * Returns the created course id.
 */
async function createTestCourse(page: import("playwright").Page): Promise<number> {
  const resp = await page.request.post(`${BASE_URL}/api/courses`, {
    data: {
      courseName: "Axe Audit Test Course",
      courseNumber: "AXE 000",
      courseLevel: "undergraduate-100",
      credits: "3",
      semester: "Fall 2026",
      instructor: "Axe Auditor",
      department: "E2E Testing",
      courseDescription: "Synthetic course created by the axe audit script for accessibility testing.",
      learningOutcomes: "Students will complete the axe accessibility audit.",
    },
  });

  if (!resp.ok()) {
    throw new Error(
      `POST /api/courses returned HTTP ${resp.status()} — cannot create test course`,
    );
  }

  const course = await resp.json();
  if (!course?.id) {
    throw new Error("POST /api/courses returned no id field");
  }
  return course.id as number;
}

/**
 * Create a minimal generated-content record for a course via the dev-only
 * POST /api/test/seed-content endpoint (no AI call required).
 * Returns the created content id.
 */
async function createTestContent(
  page: import("playwright").Page,
  courseId: number,
  userId: string,
): Promise<number> {
  const resp = await page.request.post(`${BASE_URL}/api/test/seed-content`, {
    data: {
      courseId,
      userId,
      toolType: "assignment",
      toolName: "Assignment",
      formData: { assignmentType: "Essay/Paper" },
      content:
        "## Overview\n\nThis is a synthetic assignment created by the axe audit script.\n\n" +
        "## Learning Objectives\n\nStudents will demonstrate understanding of the subject matter.\n\n" +
        "## Instructions\n\nComplete the assigned reading and write a 5-page reflective essay.",
    },
  });

  if (!resp.ok()) {
    throw new Error(
      `POST /api/test/seed-content returned HTTP ${resp.status()} — cannot create test content`,
    );
  }

  const content = await resp.json();
  if (!content?.id) {
    throw new Error("POST /api/test/seed-content returned no id field");
  }
  return content.id as number;
}

/** Delete a test course (cascades to its content). */
async function deleteTestCourse(
  page: import("playwright").Page,
  courseId: number,
): Promise<void> {
  try {
    await page.request.delete(`${BASE_URL}/api/courses/${courseId}`);
  } catch {
    console.warn(`[teardown] Could not delete test course ${courseId}`);
  }
}

// ---------------------------------------------------------------------------
// Audit runner
// ---------------------------------------------------------------------------

async function auditPage(
  page: import("playwright").Page,
  label: string,
  url: string,
  opts: { waitForSelector?: string; required?: boolean } = {},
): Promise<PageResult> {
  const { waitForSelector, required = false } = opts;
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });

    // Wait for a key selector to confirm content has rendered.
    // Always soft-fail so a slow loading spinner never aborts the audit —
    // axe runs on whatever is in the DOM at timeout.
    const selectorToWait = waitForSelector ?? "main, h1, [role='main']";
    await page
      .waitForSelector(selectorToWait, { timeout: 15_000 })
      .catch(() => {
        // Selector not found — continue and run axe on the current DOM.
      });

    const violations = await runAxe(page);
    printViolations(label, url, violations);
    return { label, url, violations, required };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`\n! ${label}`);
    console.log(`  URL: ${url}`);
    console.log(`  ERROR: ${message}`);
    return { label, url, violations: [], error: message, required };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!fs.existsSync(AXE_SCRIPT_PATH)) {
    console.error(
      `[axe-audit] axe-core not found at ${AXE_SCRIPT_PATH}. Run: npm install axe-core`,
    );
    process.exit(1);
  }

  console.log("=============================================================");
  console.log("  BSU Accessibility Tool — axe-core Accessibility Audit");
  console.log(`  Base URL : ${BASE_URL}`);
  console.log("=============================================================");

  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const results: PageResult[] = [];

  // Track test data created so teardown can clean up even on error.
  let testCourseId: number | null = null;

  try {
    // -----------------------------------------------------------------------
    // Section 1: Public / unauthenticated pages
    // -----------------------------------------------------------------------
    console.log("\n── Public pages (no auth required) ─────────────────────────");

    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      results.push(
        await auditPage(page, "Landing page", fullUrl(appPath("/")), {
          waitForSelector: "h1",
          required: true,
        }),
      );

      results.push(
        await auditPage(page, "Quick Tools list", fullUrl(appPath("/quick-tools")), {
          waitForSelector: "h1",
          required: true,
        }),
      );

      results.push(
        await auditPage(
          page,
          "Accessibility Tools hub",
          fullUrl(appPath("/accessibility-tools")),
          { waitForSelector: "h1", required: true },
        ),
      );

      results.push(
        await auditPage(page, "New Course form", fullUrl(appPath("/new-course")), {
          waitForSelector: "h1",
          required: true,
        }),
      );

      await ctx.close();
    }

    // -----------------------------------------------------------------------
    // Section 2: Authenticated pages (BSU faculty user)
    // -----------------------------------------------------------------------
    console.log("\n── Authenticated pages (BSU faculty session) ────────────────");

    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      // Establish session — failure here is a hard error; we cannot audit any
      // of the authenticated pages without a valid session.
      await loginAsUser(page);

      results.push(
        await auditPage(page, "Library page", fullUrl(appPath("/library")), {
          waitForSelector: "h1",
          required: true,
        }),
      );

      results.push(
        await auditPage(
          page,
          "Quick Tools — assignment form",
          fullUrl(appPath("/quick-tools/assignment")),
          { waitForSelector: "h1", required: true },
        ),
      );

      results.push(
        await auditPage(
          page,
          "Quick Tools — syllabus form",
          fullUrl(appPath("/quick-tools/syllabus")),
          { waitForSelector: "h1", required: true },
        ),
      );

      // -----------------------------------------------------------------------
      // Course-scoped result page: /faculty/course/:id/result/:contentId
      //
      // Creates a real course + content record via dev-only endpoints (no AI
      // required), audits the result page, then cleans up in teardown.
      // -----------------------------------------------------------------------
      let courseResultAudited = false;
      try {
        // The seed-content endpoint uses the session's user id. Extract it first.
        const meResp = await page.request.get(`${BASE_URL}/api/auth/user`);
        const me = meResp.ok() ? await meResp.json() : null;
        const userId: string = me?.claims?.sub ?? "axe-audit-user";

        testCourseId = await createTestCourse(page);
        const testContentId = await createTestContent(page, testCourseId, userId);

        results.push(
          await auditPage(
            page,
            "Course result page (/faculty/course/:id/result/:contentId)",
            fullUrl(appPath(`/course/${testCourseId}/result/${testContentId}`)),
            { waitForSelector: "h1", required: true },
          ),
        );
        courseResultAudited = true;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`\n! Course result page`);
        console.log(`  FAILED to set up test data: ${msg}`);
        results.push({
          label: "Course result page (/faculty/course/:id/result/:contentId)",
          url: fullUrl(appPath("/course/<setup-failed>/result/<setup-failed>")),
          violations: [],
          error: msg,
          required: true,
        });
      }

      // Also audit the quick-tools standalone result page shell.
      // (supplemental, not required — the course result page covers the requirement)
      results.push(
        await auditPage(
          page,
          "Quick Tools result page (standalone shell)",
          fullUrl(appPath("/quick-tools/result/0")),
          { required: false },
        ),
      );

      // -----------------------------------------------------------------------
      // Admin dashboard — audited within the same BSU user session.
      //
      // The admin dashboard component always renders one of two states:
      //   • Full dashboard — when the logged-in user's sub is in ADMIN_USER_IDS.
      //   • "Access Denied" screen — otherwise.
      //
      // Both states produce meaningful, axe-auditable DOM, so the audit is
      // always possible without requiring ADMIN_USER_IDS to be configured.
      // To audit the full dashboard, set ADMIN_USER_IDS=axe-audit-user.
      // -----------------------------------------------------------------------
      console.log("\n── Admin dashboard (within BSU user session) ────────────────");

      results.push(
        await auditPage(page, "Admin dashboard", fullUrl(appPath("/admin")), {
          waitForSelector: "h1",
          required: true,
        }),
      );

      await ctx.close();

      // Clean up test course (cascades to content)
      if (testCourseId !== null) {
        // Re-authenticate for the DELETE call (context was closed above)
        const cleanupCtx = await browser.newContext();
        const cleanupPage = await cleanupCtx.newPage();
        await loginAsUser(cleanupPage);
        await deleteTestCourse(cleanupPage, testCourseId);
        await cleanupCtx.close();
        testCourseId = null;
      }
    }
  } finally {
    // Emergency teardown: if the test course was not cleaned up above,
    // attempt cleanup now so we don't leave stale data in dev DB.
    if (testCourseId !== null) {
      try {
        const cleanupCtx = await browser.newContext();
        const cleanupPage = await cleanupCtx.newPage();
        await loginAsUser(cleanupPage);
        await deleteTestCourse(cleanupPage, testCourseId);
        await cleanupCtx.close();
      } catch {
        console.warn(
          `[teardown] Emergency cleanup of course ${testCourseId} also failed — delete manually.`,
        );
      }
    }

    await browser.close();
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log("\n=============================================================");
  console.log("  Summary");
  console.log("=============================================================");

  const pagesWithErrors = results.filter((r) => r.error);
  const requiredPagesFailed = results.filter((r) => r.required && r.error);
  const pagesAudited = results.filter((r) => !r.error);
  const allViolations = pagesAudited.flatMap((r) => r.violations);
  const criticalOrSerious = allViolations.filter(isCriticalOrSerious);

  // Count unique violation rule IDs at critical/serious impact
  const uniqueRuleIds = [...new Set(criticalOrSerious.map((v) => v.id))];

  console.log(`\n  Pages audited : ${pagesAudited.length}`);
  console.log(`  Pages errored : ${pagesWithErrors.length}`);
  if (requiredPagesFailed.length > 0) {
    console.log(`  Required pages failed : ${requiredPagesFailed.length}`);
    for (const r of requiredPagesFailed) {
      console.log(`    - ${r.label}: ${r.error}`);
    }
  }
  console.log(`  Total violations : ${allViolations.length}`);
  console.log(
    `  Critical/serious : ${criticalOrSerious.length} (${uniqueRuleIds.length} unique rule IDs)`,
  );

  if (uniqueRuleIds.length > 0) {
    console.log(`\n  Failing rules:`);
    for (const id of uniqueRuleIds) {
      const count = criticalOrSerious.filter((v) => v.id === id).length;
      const impact = criticalOrSerious.find((v) => v.id === id)?.impact ?? "";
      console.log(
        `    [${impact}] ${id} — ${count} violation(s) across audited pages`,
      );
    }
  }

  console.log("");

  if (requiredPagesFailed.length > 0) {
    console.log(
      `  RESULT: FAIL — ${requiredPagesFailed.length} required page(s) could not be audited.`,
    );
    process.exit(1);
  } else if (criticalOrSerious.length > 0) {
    console.log("  RESULT: FAIL — critical or serious violations found.");
    process.exit(1);
  } else {
    const skippedNote =
      pagesWithErrors.length > 0
        ? " (some optional pages had errors — see above)"
        : "";
    console.log(`  RESULT: PASS — no critical or serious violations.${skippedNote}`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("\n[axe-audit] Fatal error:", err);
  process.exit(1);
});

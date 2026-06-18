/**
 * End-to-end tests for the "Outdated content" staleness banner on Quick Tools
 * result pages that are linked to a course.
 *
 * The banner (`data-testid="banner-stale-content"`) is rendered when:
 *   content.courseId is set
 *   AND course.syllabusUploadedAt is set
 *   AND content.createdAt < course.syllabusUploadedAt
 *
 * Auth / seeding setup:
 *   - Uses `/api/test/login` to establish a session (PLAYWRIGHT_TEST=1 required).
 *   - Uses `POST /api/courses` to create a real course row.
 *   - Uses `POST /api/test/seed-content` with a courseId to link content to the course.
 *   - Uses `PATCH /api/test/set-syllabus-date/:courseId` to advance syllabusUploadedAt
 *     past the content's createdAt, triggering the staleness condition.
 *
 * Run with:
 *   PLAYWRIGHT_TEST=1 npx playwright test e2e/stale-content-banner.spec.ts
 */

import { test, expect, type BrowserContext } from "@playwright/test";
import { randomBytes } from "crypto";

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5000";

function uid(): string {
  return randomBytes(4).toString("hex");
}

const ASSIGNMENT_CONTENT =
  "## Assignment Overview\n\nStudents will write a research paper.\n\n" +
  "## Learning Objectives\n\n- Analyze sources\n- Develop argument\n\n" +
  "## Instructions\n\nSubmit a 5-page paper.";

async function loginAs(context: BrowserContext, sub: string, email: string): Promise<void> {
  const res = await context.request.post(`${BASE}/api/test/login`, {
    data: { sub, email, firstName: "Playwright", lastName: "Test" },
  });
  if (!res.ok()) {
    throw new Error(
      `Test login failed: ${res.status()} — is the server running with PLAYWRIGHT_TEST=1?`,
    );
  }
}

async function createCourse(context: BrowserContext, suffix: string): Promise<number> {
  const res = await context.request.post(`${BASE}/api/courses`, {
    data: {
      courseName: `Stale Banner Test Course ${suffix}`,
      courseNumber: `SB-${suffix}`,
      sectionNumber: "01",
      courseLevel: "Undergraduate",
      credits: "3",
      semester: "Fall 2026",
      instructor: "Dr. Test",
      department: "Education",
      courseDescription: "Course used for stale banner E2E tests",
      learningOutcomes: "Students will understand the staleness banner",
      prerequisites: "",
    },
  });
  if (!res.ok()) {
    const text = await res.text();
    throw new Error(`createCourse failed ${res.status()}: ${text}`);
  }
  const body = await res.json();
  return body.id as number;
}

async function seedContent(
  context: BrowserContext,
  userId: string,
  courseId: number | null,
): Promise<number> {
  const res = await context.request.post(`${BASE}/api/test/seed-content`, {
    data: {
      toolType: "assignment",
      toolName: "Assignment Design",
      formData: { subject: "History 101", courseLevel: "Undergraduate" },
      content: ASSIGNMENT_CONTENT,
      userId,
      courseId,
    },
  });
  if (!res.ok()) {
    const text = await res.text();
    throw new Error(`seedContent failed ${res.status()}: ${text}`);
  }
  const body = await res.json();
  return body.id as number;
}

async function setSyllabusDate(
  context: BrowserContext,
  courseId: number,
  isoDate?: string,
): Promise<void> {
  const res = await context.request.patch(
    `${BASE}/api/test/set-syllabus-date/${courseId}`,
    { data: isoDate ? { syllabusUploadedAt: isoDate } : {} },
  );
  if (!res.ok()) {
    const text = await res.text();
    throw new Error(`setSyllabusDate failed ${res.status()}: ${text}`);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Stale-content banner on Quick Tools result pages", () => {
  test("banner is visible when content is linked to a course with a newer syllabus upload", async ({
    context,
    page,
  }) => {
    const suffix = uid();
    const sub = `pw-stale-test-${suffix}`;
    const email = `stale-${suffix}@bridgew.edu`;

    await loginAs(context, sub, email);

    const courseId = await createCourse(context, suffix);

    // Seed the content linked to the course.
    const contentId = await seedContent(context, sub, courseId);

    // Advance the course's syllabusUploadedAt to now (which is after the
    // content's createdAt, triggering the staleness condition).
    await setSyllabusDate(context, courseId);

    await page.goto(`/quick-tools/result/${contentId}`);

    // Wait for the page to render the assignment content.
    await expect(page.locator("text=Assignment Overview")).toBeVisible({
      timeout: 15_000,
    });

    // The staleness banner must be visible.
    await expect(page.getByTestId("banner-stale-content")).toBeVisible();
  });

  test("banner is NOT shown when content has no courseId (standalone Quick Tool)", async ({
    context,
    page,
  }) => {
    const suffix = uid();
    const sub = `pw-no-course-${suffix}`;
    const email = `nocourse-${suffix}@bridgew.edu`;

    await loginAs(context, sub, email);

    // Seed content without a courseId.
    const contentId = await seedContent(context, sub, null);

    await page.goto(`/quick-tools/result/${contentId}`);

    // Wait for page content to render.
    await expect(page.locator("text=Assignment Overview")).toBeVisible({
      timeout: 15_000,
    });

    // The staleness banner must NOT appear.
    await expect(page.getByTestId("banner-stale-content")).not.toBeVisible();
  });
});

/**
 * End-to-end tests for the Quick Tools chaining flow.
 *
 * Covers: Assignment Design result page → "Build a rubric for this" →
 * Rubric Builder form with pre-filled assessmentType and criteria fields.
 *
 * Auth setup: The tests use a test-only login endpoint (`/api/test/login`)
 * that is only registered when the server is started with PLAYWRIGHT_TEST=1.
 * Run with:
 *   PLAYWRIGHT_TEST=1 npx playwright test
 */

import { test, expect, type Page } from "@playwright/test";

const TEST_USER = {
  sub: "pw-chain-test-user",
  email: "pwtest@bridgew.edu",
  firstName: "Playwright",
  lastName: "Test",
};

const ASSIGNMENT_FORM_DATA = {
  assignmentType: "Research Paper",
  learningObjectives: "Analyze primary sources, Develop thesis statement",
  subject: "History 101",
  courseLevel: "Undergraduate",
};

const ASSIGNMENT_CONTENT =
  "## Assignment Overview\n\nStudents will write a research paper " +
  "analyzing primary historical sources.\n\n## Learning Objectives\n\n" +
  "- Analyze primary sources\n- Develop thesis statement\n\n## Instructions\n\n" +
  "Submit a 10-page paper following academic citation guidelines.";

/**
 * Log in via the test-only endpoint using the page's request context so that
 * session cookies are automatically available to the browser page.
 */
async function loginAsTestUser(page: Page): Promise<void> {
  const resp = await page.request.post("/api/test/login", {
    data: TEST_USER,
  });
  if (!resp.ok()) {
    const body = await resp.text();
    throw new Error(
      `Test login failed (${resp.status()}): ${body}. ` +
        "Make sure the server is started with PLAYWRIGHT_TEST=1.",
    );
  }
}

/**
 * Insert an assignment content record and return its id.
 * Uses the page's request context so it shares auth cookies with the browser.
 */
async function seedAssignmentContent(page: Page): Promise<number> {
  const resp = await page.request.post("/api/test/seed-content", {
    data: {
      toolType: "assignment",
      toolName: "Assignment Design",
      formData: ASSIGNMENT_FORM_DATA,
      content: ASSIGNMENT_CONTENT,
      userId: TEST_USER.sub,
    },
  });
  if (!resp.ok()) {
    const body = await resp.text();
    throw new Error(`Seed content failed (${resp.status()}): ${body}`);
  }
  const json = (await resp.json()) as { id: number };
  return json.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Quick Tools chaining — Assignment → Rubric", () => {
  test("Next Steps card and chain button are visible on an assignment result page", async ({
    page,
  }) => {
    await loginAsTestUser(page);
    const contentId = await seedAssignmentContent(page);

    await page.goto(`/quick-tools/result/${contentId}`);

    // The result page should load and display assignment content
    await expect(page.locator("text=Assignment Overview")).toBeVisible({
      timeout: 15_000,
    });

    // Next Steps card must be visible
    await expect(page.getByTestId("card-next-steps")).toBeVisible();

    // The rubric chain button must be present with the correct label
    await expect(page.getByTestId("button-chain-rubric")).toBeVisible();
    await expect(page.getByTestId("button-chain-rubric")).toContainText(
      "Build a rubric for this",
    );
  });

  test("clicking 'Build a rubric for this' navigates to the rubric form", async ({
    page,
  }) => {
    await loginAsTestUser(page);
    const contentId = await seedAssignmentContent(page);

    await page.goto(`/quick-tools/result/${contentId}`);
    await expect(page.getByTestId("card-next-steps")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId("button-chain-rubric").click();

    await expect(page).toHaveURL(/\/quick-tools\/rubric/, { timeout: 5_000 });
  });

  test("rubric form is pre-filled with assessmentType from the assignment", async ({
    page,
  }) => {
    await loginAsTestUser(page);
    const contentId = await seedAssignmentContent(page);

    await page.goto(`/quick-tools/result/${contentId}`);
    await expect(page.getByTestId("card-next-steps")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId("button-chain-rubric").click();
    await expect(page).toHaveURL(/\/quick-tools\/rubric/, { timeout: 5_000 });

    // assessmentType is pre-filled from the assignment's assignmentType
    await expect(page.getByTestId("input-assessmentType")).toHaveValue(
      ASSIGNMENT_FORM_DATA.assignmentType,
    );
  });

  test("rubric form is pre-filled with criteria from the assignment learning objectives", async ({
    page,
  }) => {
    await loginAsTestUser(page);
    const contentId = await seedAssignmentContent(page);

    await page.goto(`/quick-tools/result/${contentId}`);
    await expect(page.getByTestId("card-next-steps")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId("button-chain-rubric").click();
    await expect(page).toHaveURL(/\/quick-tools\/rubric/, { timeout: 5_000 });

    // criteria is pre-filled from the assignment's learningObjectives
    await expect(page.getByTestId("textarea-criteria")).toHaveValue(
      ASSIGNMENT_FORM_DATA.learningObjectives,
    );
  });

  test("full chaining flow: both assessmentType and criteria are pre-filled", async ({
    page,
  }) => {
    await loginAsTestUser(page);
    const contentId = await seedAssignmentContent(page);

    await page.goto(`/quick-tools/result/${contentId}`);
    await expect(page.getByTestId("card-next-steps")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("button-chain-rubric")).toBeVisible();

    await page.getByTestId("button-chain-rubric").click();
    await expect(page).toHaveURL(/\/quick-tools\/rubric/, { timeout: 5_000 });

    // Both fields must be pre-filled
    await expect(page.getByTestId("input-assessmentType")).toHaveValue(
      ASSIGNMENT_FORM_DATA.assignmentType,
    );
    await expect(page.getByTestId("textarea-criteria")).toHaveValue(
      ASSIGNMENT_FORM_DATA.learningObjectives,
    );
  });
});

/**
 * End-to-end tests for the result-page chaining flows that are not yet
 * covered by quick-tools-chaining.spec.ts:
 *
 *  1. Rubric Builder result → "Check alignment for this rubric" →
 *     Alignment Checker form with the rubric content pre-filled in the
 *     `assignments` field.
 *
 *  2. AI-Resistant Assignment Designer result →
 *     "Design an AI-powered activity for this" →
 *     AI-Powered Activity Designer form with `additionalContext` pre-filled
 *     in the `learningObjectives` field.
 *
 * Auth setup: Uses the test-only `/api/test/login` and `/api/test/seed-content`
 * endpoints that are only registered when the server is started with
 * PLAYWRIGHT_TEST=1.
 * Run with:
 *   PLAYWRIGHT_TEST=1 npx playwright test e2e/result-chaining.spec.ts
 */

import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const TEST_USER = {
  sub: "pw-chain-result-test-user",
  email: "pwchainresult@bridgew.edu",
  firstName: "Playwright",
  lastName: "Chain",
};

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

async function seedContent(
  page: Page,
  toolType: string,
  toolName: string,
  formData: Record<string, string>,
  content: string,
): Promise<number> {
  const resp = await page.request.post("/api/test/seed-content", {
    data: {
      toolType,
      toolName,
      formData,
      content,
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
// Rubric → Alignment chain
// ---------------------------------------------------------------------------

const RUBRIC_FORM_DATA = {
  assessmentType: "Research Paper",
  criteria: "Analyze primary sources, Develop a coherent thesis",
};

const RUBRIC_CONTENT =
  "## Rubric Overview\n\nThis rubric assesses a research paper.\n\n" +
  "## Criteria\n\n" +
  "### Analyze Primary Sources\n" +
  "- Excellent: Thoroughly integrates multiple primary sources with nuanced analysis.\n" +
  "- Proficient: Uses primary sources with adequate analysis.\n" +
  "- Developing: Includes some primary sources with limited analysis.\n" +
  "- Beginning: Minimal or no use of primary sources.\n\n" +
  "### Develop a Coherent Thesis\n" +
  "- Excellent: Thesis is clear, original, and consistently supported.\n" +
  "- Proficient: Thesis is clear and mostly supported.\n" +
  "- Developing: Thesis is present but inconsistently supported.\n" +
  "- Beginning: Thesis is missing or unclear.\n\n" +
  "## Grading Scale\n\n" +
  "Total Points: 100. Excellent = 90-100, Proficient = 75-89, Developing = 60-74, Beginning = 0-59.";

test.describe("Quick Tools chaining — Rubric → Alignment", () => {
  test("Next Steps card and alignment chain button are visible on a rubric result page", async ({
    page,
  }) => {
    await loginAsTestUser(page);
    const contentId = await seedContent(
      page,
      "rubric",
      "Rubric Builder",
      RUBRIC_FORM_DATA,
      RUBRIC_CONTENT,
    );

    await page.goto(`/quick-tools/result/${contentId}`);

    await expect(page.locator("text=Rubric Overview")).toBeVisible({
      timeout: 15_000,
    });

    await expect(page.getByTestId("card-next-steps")).toBeVisible();

    await expect(page.getByTestId("button-chain-alignment")).toBeVisible();
    await expect(page.getByTestId("button-chain-alignment")).toContainText(
      "Check alignment for this rubric",
    );
  });

  test("clicking 'Check alignment for this rubric' navigates to the alignment form", async ({
    page,
  }) => {
    await loginAsTestUser(page);
    const contentId = await seedContent(
      page,
      "rubric",
      "Rubric Builder",
      RUBRIC_FORM_DATA,
      RUBRIC_CONTENT,
    );

    await page.goto(`/quick-tools/result/${contentId}`);
    await expect(page.getByTestId("card-next-steps")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId("button-chain-alignment").click();

    await expect(page).toHaveURL(/\/quick-tools\/alignment/, {
      timeout: 5_000,
    });
  });

  test("alignment form is pre-filled with the rubric content in the assignments field", async ({
    page,
  }) => {
    await loginAsTestUser(page);
    const contentId = await seedContent(
      page,
      "rubric",
      "Rubric Builder",
      RUBRIC_FORM_DATA,
      RUBRIC_CONTENT,
    );

    await page.goto(`/quick-tools/result/${contentId}`);
    await expect(page.getByTestId("card-next-steps")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId("button-chain-alignment").click();
    await expect(page).toHaveURL(/\/quick-tools\/alignment/, {
      timeout: 5_000,
    });

    // The assignments field should be pre-filled with (up to 1500 chars of)
    // the rubric's generated content.
    const expectedAssignments = RUBRIC_CONTENT.slice(0, 1500);
    await expect(page.getByTestId("textarea-assignments")).toHaveValue(
      expectedAssignments,
    );
  });

  test("chain prefill banner is shown on the alignment form", async ({
    page,
  }) => {
    await loginAsTestUser(page);
    const contentId = await seedContent(
      page,
      "rubric",
      "Rubric Builder",
      RUBRIC_FORM_DATA,
      RUBRIC_CONTENT,
    );

    await page.goto(`/quick-tools/result/${contentId}`);
    await expect(page.getByTestId("card-next-steps")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId("button-chain-alignment").click();
    await expect(page).toHaveURL(/\/quick-tools\/alignment/, {
      timeout: 5_000,
    });

    // The prefill banner signals to the user that fields were carried over.
    await expect(page.getByTestId("banner-chain-prefill")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// AI-Resistant → AI-Student Activity chain
// ---------------------------------------------------------------------------

const AI_RESISTANT_FORM_DATA = {
  assignmentType: "Essay",
  additionalContext:
    "Students will demonstrate original thinking through personal reflection",
};

const AI_RESISTANT_CONTENT =
  "## AI-Resistant Assignment Analysis\n\n" +
  "This assignment has been assessed for AI vulnerability.\n\n" +
  "## Vulnerability Assessment\n\n" +
  "The essay prompt as written could be addressed by AI tools.\n\n" +
  "## Recommended Modifications\n\n" +
  "- Require students to document their drafting process with dated screenshots.\n" +
  "- Add an in-class verbal defense component.\n" +
  "- Ask students to connect the argument to a personal experience shared in class.\n\n" +
  "## Rationale\n\n" +
  "These modifications introduce personal and temporal elements that AI cannot fabricate authentically.";

test.describe("Quick Tools chaining — AI-Resistant → AI-Student Activity", () => {
  test("Next Steps card and aistudent chain button are visible on an AI-resistant result page", async ({
    page,
  }) => {
    await loginAsTestUser(page);
    const contentId = await seedContent(
      page,
      "airesistant",
      "AI-Resistant Assignment Designer",
      AI_RESISTANT_FORM_DATA,
      AI_RESISTANT_CONTENT,
    );

    await page.goto(`/quick-tools/result/${contentId}`);

    await expect(
      page.locator("text=AI-Resistant Assignment Analysis"),
    ).toBeVisible({ timeout: 15_000 });

    await expect(page.getByTestId("card-next-steps")).toBeVisible();

    await expect(page.getByTestId("button-chain-aistudent")).toBeVisible();
    await expect(page.getByTestId("button-chain-aistudent")).toContainText(
      "Design an AI-powered activity for this",
    );
  });

  test("clicking 'Design an AI-powered activity for this' navigates to the aistudent form", async ({
    page,
  }) => {
    await loginAsTestUser(page);
    const contentId = await seedContent(
      page,
      "airesistant",
      "AI-Resistant Assignment Designer",
      AI_RESISTANT_FORM_DATA,
      AI_RESISTANT_CONTENT,
    );

    await page.goto(`/quick-tools/result/${contentId}`);
    await expect(page.getByTestId("card-next-steps")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId("button-chain-aistudent").click();

    await expect(page).toHaveURL(/\/quick-tools\/aistudent/, {
      timeout: 5_000,
    });
  });

  test("aistudent form is pre-filled with additionalContext in the learningObjectives field", async ({
    page,
  }) => {
    await loginAsTestUser(page);
    const contentId = await seedContent(
      page,
      "airesistant",
      "AI-Resistant Assignment Designer",
      AI_RESISTANT_FORM_DATA,
      AI_RESISTANT_CONTENT,
    );

    await page.goto(`/quick-tools/result/${contentId}`);
    await expect(page.getByTestId("card-next-steps")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId("button-chain-aistudent").click();
    await expect(page).toHaveURL(/\/quick-tools\/aistudent/, {
      timeout: 5_000,
    });

    // learningObjectives is pre-filled from the AI-resistant form's additionalContext
    await expect(page.getByTestId("textarea-learningObjectives")).toHaveValue(
      AI_RESISTANT_FORM_DATA.additionalContext,
    );
  });

  test("chain prefill banner is shown on the aistudent form", async ({
    page,
  }) => {
    await loginAsTestUser(page);
    const contentId = await seedContent(
      page,
      "airesistant",
      "AI-Resistant Assignment Designer",
      AI_RESISTANT_FORM_DATA,
      AI_RESISTANT_CONTENT,
    );

    await page.goto(`/quick-tools/result/${contentId}`);
    await expect(page.getByTestId("card-next-steps")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId("button-chain-aistudent").click();
    await expect(page).toHaveURL(/\/quick-tools\/aistudent/, {
      timeout: 5_000,
    });

    await expect(page.getByTestId("banner-chain-prefill")).toBeVisible();
  });
});

import { test, expect, type BrowserContext } from "@playwright/test";
import { randomBytes } from "crypto";

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5000";

function uid() {
  return randomBytes(4).toString("hex");
}

async function loginAs(
  context: BrowserContext,
  sub: string,
  email: string,
) {
  const res = await context.request.post(`${BASE}/api/test/login`, {
    data: { sub, email, firstName: "Test", lastName: "Faculty" },
  });
  if (!res.ok()) {
    throw new Error(
      `Test login failed: ${res.status()} — is the server running in development mode?`,
    );
  }
}

async function createCourse(
  context: BrowserContext,
  suffix: string,
): Promise<number> {
  const res = await context.request.post(`${BASE}/api/courses`, {
    data: {
      courseName: `Prefill Test Course ${suffix}`,
      courseNumber: `PF-${suffix}`,
      sectionNumber: "01",
      courseLevel: "Undergraduate",
      credits: "3",
      semester: "Fall 2026",
      instructor: "Dr. Test",
      department: "Education",
      courseDescription: "Course used for pre-fill E2E tests",
      learningOutcomes: "Students will understand the pre-fill feature",
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
  courseId: number,
  userId: string,
  toolType: string,
  formData: Record<string, string>,
): Promise<number> {
  const res = await context.request.post(`${BASE}/api/test/seed-content`, {
    data: {
      courseId,
      userId,
      toolType,
      toolName: toolType === "assignment" ? "Assignment Builder" : "Rubric Builder",
      formData,
      content: `Seeded ${toolType} content for pre-fill tests`,
    },
  });
  if (!res.ok()) {
    const text = await res.text();
    throw new Error(`seedContent failed ${res.status()}: ${text}`);
  }
  const body = await res.json();
  return body.id as number;
}

test.describe("Pre-fill flow — Rubric Builder", () => {
  test.describe.configure({ mode: "serial" });

  test("dropdown is visible and populates assessmentType + criteria when a prior Assignment exists", async ({
    page,
    context,
  }) => {
    const sub = `prefill-e2e-${uid()}`;
    const email = `${sub}@bridgew.edu`;

    await loginAs(context, sub, email);

    const courseId = await createCourse(context, uid());
    await seedContent(context, courseId, sub, "assignment", {
      assignmentType: "Essay",
      learningObjectives: "Demonstrate critical thinking and academic writing",
    });

    await page.goto(`${BASE}/course/${courseId}/tool/rubric`);

    const prefillCard = page.getByText("Pre-fill from a previous item");
    await expect(prefillCard).toBeVisible({ timeout: 10_000 });

    const trigger = page.getByTestId("select-prefill-item");
    await expect(trigger).toBeVisible();

    await trigger.click();
    const option = page.locator('[data-testid^="prefill-option-"]').first();
    await expect(option).toBeVisible({ timeout: 5_000 });
    await expect(option).toContainText("Assignment Builder");
    await option.click();

    await expect(page.getByText("Form pre-filled", { exact: true }).first()).toBeVisible({ timeout: 5_000 });

    const assessmentTypeInput = page.getByTestId("input-assessmentType");
    await expect(assessmentTypeInput).toHaveValue("Essay");

    const criteriaTextarea = page.getByTestId("textarea-criteria");
    await expect(criteriaTextarea).toHaveValue(
      "Demonstrate critical thinking and academic writing",
    );
  });

  test("dropdown is hidden when the course has no compatible prior items (only Rubric content)", async ({
    page,
    context,
  }) => {
    const sub = `prefill-e2e-${uid()}`;
    const email = `${sub}@bridgew.edu`;

    await loginAs(context, sub, email);

    const courseId = await createCourse(context, uid());
    await seedContent(context, courseId, sub, "rubric", {
      assessmentType: "Presentation",
      criteria: "Existing rubric criteria",
    });

    await page.goto(`${BASE}/course/${courseId}/tool/rubric`);

    await expect(page.getByText("Tool Configuration")).toBeVisible({ timeout: 10_000 });

    await expect(page.getByText("Pre-fill from a previous item")).not.toBeVisible();
    await expect(page.getByTestId("select-prefill-item")).not.toBeVisible();
  });
});

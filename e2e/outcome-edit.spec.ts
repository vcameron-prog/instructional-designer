import { test, expect, type BrowserContext } from "@playwright/test";
import { randomBytes } from "crypto";

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5000";

function uid() {
  return randomBytes(4).toString("hex");
}

async function loginAs(context: BrowserContext, sub: string, email: string) {
  const res = await context.request.post(`${BASE}/api/test/login`, {
    data: { sub, email, firstName: "Test", lastName: "Faculty" },
  });
  if (!res.ok()) {
    throw new Error(
      `Test login failed: ${res.status()} — is the server running with PLAYWRIGHT_TEST=1?`,
    );
  }
}

async function createOutcome(
  context: BrowserContext,
  text: string,
): Promise<number> {
  const res = await context.request.post(`${BASE}/api/outcomes`, {
    data: { text },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`createOutcome failed ${res.status()}: ${body}`);
  }
  const body = await res.json();
  return body.id as number;
}

/**
 * Outcome Edit Flow
 *
 * Verifies that a faculty member can:
 *   1. Open the Outcome Library modal from the course-creation form.
 *   2. Switch to the "My Outcomes" tab where their saved outcomes appear.
 *   3. Click the pencil icon to enter inline-edit mode.
 *   4. Change the outcome text and confirm with Enter.
 *   5. See the updated text in the list (the UI re-fetches after a successful PATCH).
 */
test.describe("Outcome edit flow", () => {
  test.describe.configure({ mode: "serial" });

  test("pencil → edit text → Enter → updated text appears in My Outcomes list", async ({
    page,
    context,
  }) => {
    const sub = `outcome-edit-e2e-${uid()}`;
    const email = `${sub}@bridgew.edu`;

    await loginAs(context, sub, email);

    const originalText = `Original outcome ${uid()}`;
    const updatedText = `Updated outcome ${uid()}`;

    const outcomeId = await createOutcome(context, originalText);

    await page.goto(`${BASE}/new-course`);

    const browseBtn = page.getByTestId("button-browse-outcome-library");
    await expect(browseBtn).toBeVisible({ timeout: 15_000 });
    await browseBtn.click();

    const myOutcomesTab = page.getByTestId("tab-my-outcomes");
    await expect(myOutcomesTab).toBeVisible({ timeout: 5_000 });
    await myOutcomesTab.click();

    const outcomeRow = page.getByTestId(`my-outcome-row-${outcomeId}`);
    await expect(outcomeRow).toBeVisible({ timeout: 10_000 });
    await expect(outcomeRow).toContainText(originalText);

    const editBtn = page.getByTestId(`button-edit-outcome-${outcomeId}`);
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    const editInput = page.getByTestId(`input-edit-outcome-${outcomeId}`);
    await expect(editInput).toBeVisible();

    await editInput.fill(updatedText);
    await editInput.press("Enter");

    await expect(outcomeRow).toContainText(updatedText, { timeout: 10_000 });
    await expect(outcomeRow).not.toContainText(originalText);
  });

  test("pressing Escape cancels the edit and restores the original text", async ({
    page,
    context,
  }) => {
    const sub = `outcome-cancel-e2e-${uid()}`;
    const email = `${sub}@bridgew.edu`;

    await loginAs(context, sub, email);

    const originalText = `Cancel test outcome ${uid()}`;
    const outcomeId = await createOutcome(context, originalText);

    await page.goto(`${BASE}/new-course`);

    const browseBtn = page.getByTestId("button-browse-outcome-library");
    await expect(browseBtn).toBeVisible({ timeout: 15_000 });
    await browseBtn.click();

    const myOutcomesTab = page.getByTestId("tab-my-outcomes");
    await expect(myOutcomesTab).toBeVisible({ timeout: 5_000 });
    await myOutcomesTab.click();

    const outcomeRow = page.getByTestId(`my-outcome-row-${outcomeId}`);
    await expect(outcomeRow).toBeVisible({ timeout: 10_000 });

    const editBtn = page.getByTestId(`button-edit-outcome-${outcomeId}`);
    await editBtn.click();

    const editInput = page.getByTestId(`input-edit-outcome-${outcomeId}`);
    await editInput.fill("This change should not be saved");
    await editInput.press("Escape");

    await expect(outcomeRow).toContainText(originalText, { timeout: 5_000 });
    const editBtnAfterCancel = page.getByTestId(`button-edit-outcome-${outcomeId}`);
    await expect(editBtnAfterCancel).toBeVisible();
  });

  test("clicking the checkmark button saves the edit", async ({
    page,
    context,
  }) => {
    const sub = `outcome-check-e2e-${uid()}`;
    const email = `${sub}@bridgew.edu`;

    await loginAs(context, sub, email);

    const originalText = `Checkmark save outcome ${uid()}`;
    const updatedText = `Checkmark updated ${uid()}`;
    const outcomeId = await createOutcome(context, originalText);

    await page.goto(`${BASE}/new-course`);

    const browseBtn = page.getByTestId("button-browse-outcome-library");
    await expect(browseBtn).toBeVisible({ timeout: 15_000 });
    await browseBtn.click();

    const myOutcomesTab = page.getByTestId("tab-my-outcomes");
    await expect(myOutcomesTab).toBeVisible({ timeout: 5_000 });
    await myOutcomesTab.click();

    const outcomeRow = page.getByTestId(`my-outcome-row-${outcomeId}`);
    await expect(outcomeRow).toBeVisible({ timeout: 10_000 });

    const editBtn = page.getByTestId(`button-edit-outcome-${outcomeId}`);
    await editBtn.click();

    const editInput = page.getByTestId(`input-edit-outcome-${outcomeId}`);
    await editInput.fill(updatedText);

    const saveEditBtn = page.getByTestId(`button-save-edit-outcome-${outcomeId}`);
    await expect(saveEditBtn).toBeVisible();
    await saveEditBtn.click();

    await expect(outcomeRow).toContainText(updatedText, { timeout: 10_000 });
    await expect(outcomeRow).not.toContainText(originalText);
  });
});

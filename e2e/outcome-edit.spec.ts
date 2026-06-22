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

  /**
   * 204 success path: deleting an outcome removes it from the My Outcomes list.
   */
  test("deleting an outcome (204) removes it from the My Outcomes list", async ({
    page,
    context,
  }) => {
    const sub = `outcome-delete-204-e2e-${uid()}`;
    const email = `${sub}@bridgew.edu`;

    await loginAs(context, sub, email);

    const outcomeText = `Delete 204 test outcome ${uid()}`;
    const outcomeId = await createOutcome(context, outcomeText);

    await page.goto(`${BASE}/new-course`);

    const browseBtn = page.getByTestId("button-browse-outcome-library");
    await expect(browseBtn).toBeVisible({ timeout: 15_000 });
    await browseBtn.click();

    const myOutcomesTab = page.getByTestId("tab-my-outcomes");
    await expect(myOutcomesTab).toBeVisible({ timeout: 5_000 });
    await myOutcomesTab.click();

    const outcomeRow = page.getByTestId(`my-outcome-row-${outcomeId}`);
    await expect(outcomeRow).toBeVisible({ timeout: 10_000 });

    const deleteBtn = page.getByTestId(`button-delete-outcome-${outcomeId}`);
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    await expect(outcomeRow).not.toBeVisible({ timeout: 10_000 });
  });

  /**
   * 500 delete path: when the DELETE endpoint returns a non-404 error (e.g. a
   * server-side 500), the UI shows the generic "Could not delete outcome"
   * destructive toast and the item remains in the My Outcomes list.
   */
  test("deleting an outcome that returns 500 shows 'Could not delete outcome' toast and keeps item in list", async ({
    page,
    context,
  }) => {
    const sub = `outcome-delete-500-e2e-${uid()}`;
    const email = `${sub}@bridgew.edu`;

    await loginAs(context, sub, email);

    const outcomeText = `500 delete test outcome ${uid()}`;
    const outcomeId = await createOutcome(context, outcomeText);

    await page.goto(`${BASE}/new-course`);

    const browseBtn = page.getByTestId("button-browse-outcome-library");
    await expect(browseBtn).toBeVisible({ timeout: 15_000 });
    await browseBtn.click();

    const myOutcomesTab = page.getByTestId("tab-my-outcomes");
    await expect(myOutcomesTab).toBeVisible({ timeout: 5_000 });
    await myOutcomesTab.click();

    const outcomeRow = page.getByTestId(`my-outcome-row-${outcomeId}`);
    await expect(outcomeRow).toBeVisible({ timeout: 10_000 });

    // Intercept the DELETE in the browser so it returns 500, simulating a
    // server-side failure (item still exists server-side).
    await page.route(`**/api/outcomes/${outcomeId}`, async (route) => {
      if (route.request().method() === "DELETE") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "Internal server error" }),
        });
      } else {
        await route.continue();
      }
    });

    const deleteBtn = page.getByTestId(`button-delete-outcome-${outcomeId}`);
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // The generic error toast must appear.
    await expect(
      page.getByText("Could not delete outcome").first(),
    ).toBeVisible({ timeout: 10_000 });

    // The item must remain in the list since the deletion failed.
    await expect(outcomeRow).toBeVisible({ timeout: 5_000 });
  });

  /**
   * 500 save path: when POST /api/outcomes returns a server error, the UI shows
   * the "Could not save outcome" destructive toast.
   */
  test("saving a custom outcome that returns 500 shows 'Could not save outcome' toast", async ({
    page,
    context,
  }) => {
    const sub = `outcome-save-500-e2e-${uid()}`;
    const email = `${sub}@bridgew.edu`;

    await loginAs(context, sub, email);

    await page.goto(`${BASE}/new-course`);

    const browseBtn = page.getByTestId("button-browse-outcome-library");
    await expect(browseBtn).toBeVisible({ timeout: 15_000 });
    await browseBtn.click();

    const myOutcomesTab = page.getByTestId("tab-my-outcomes");
    await expect(myOutcomesTab).toBeVisible({ timeout: 5_000 });
    await myOutcomesTab.click();

    // Intercept POST /api/outcomes to simulate a server-side failure.
    await page.route("**/api/outcomes", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "Internal server error" }),
        });
      } else {
        await route.continue();
      }
    });

    const customInput = page.getByTestId("input-custom-outcome");
    await expect(customInput).toBeVisible({ timeout: 5_000 });
    await customInput.fill("Outcome that will fail to save");

    const saveBtn = page.getByTestId("button-save-custom-outcome");
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // The error toast must appear.
    await expect(
      page.getByText("Could not save outcome").first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  /**
   * Happy path: after a successful POST the bookmark button switches to
   * BookmarkCheck (filled), becomes disabled, and its aria-label changes to
   * "Already saved to My Outcomes".
   */
  test("bookmark button shows saved state (disabled + BookmarkCheck label) after a successful save", async ({
    page,
    context,
  }) => {
    const sub = `outcome-bookmark-success-e2e-${uid()}`;
    const email = `${sub}@bridgew.edu`;

    await loginAs(context, sub, email);

    await page.goto(`${BASE}/new-course`);

    const browseBtn = page.getByTestId("button-browse-outcome-library");
    await expect(browseBtn).toBeVisible({ timeout: 15_000 });
    await browseBtn.click();

    // Library tab is the default; wait for at least one curated outcome bookmark button.
    const firstSaveBtn = page.getByTestId(/^button-save-outcome-/).first();
    await expect(firstSaveBtn).toBeVisible({ timeout: 10_000 });

    // Confirm the button starts enabled with the unsaved aria-label.
    await expect(firstSaveBtn).not.toBeDisabled();
    await expect(firstSaveBtn).toHaveAttribute("aria-label", "Save to My Outcomes");

    // Click without any route intercept — the real POST must succeed.
    await firstSaveBtn.click();

    // After a successful save the button must be disabled and carry the saved label.
    await expect(firstSaveBtn).toBeDisabled({ timeout: 10_000 });
    await expect(firstSaveBtn).toHaveAttribute("aria-label", "Already saved to My Outcomes");
  });

  /**
   * 500 save path (curated library): when POST /api/outcomes returns a server
   * error after clicking the bookmark button on a curated-library outcome, the
   * UI shows the "Could not save outcome" destructive toast.
   */
  test("saving a curated-library outcome that returns 500 shows 'Could not save outcome' toast", async ({
    page,
    context,
  }) => {
    const sub = `outcome-library-save-500-e2e-${uid()}`;
    const email = `${sub}@bridgew.edu`;

    await loginAs(context, sub, email);

    await page.goto(`${BASE}/new-course`);

    const browseBtn = page.getByTestId("button-browse-outcome-library");
    await expect(browseBtn).toBeVisible({ timeout: 15_000 });
    await browseBtn.click();

    // The Library tab is the default; wait for at least one curated outcome to load.
    const firstSaveBtn = page
      .getByTestId(/^button-save-outcome-/)
      .first();
    await expect(firstSaveBtn).toBeVisible({ timeout: 10_000 });

    // Intercept POST /api/outcomes to simulate a server-side failure.
    await page.route("**/api/outcomes", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "Internal server error" }),
        });
      } else {
        await route.continue();
      }
    });

    await firstSaveBtn.click();

    // The error toast must appear.
    await expect(
      page.getByText("Could not save outcome").first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  /**
   * 500 bookmark path (re-enable check): after POST /api/outcomes returns 500,
   * the bookmark button must re-enable so the user can retry without refreshing.
   * isPending drops back to false on mutation settle; isSaved must NOT be set
   * true when the save failed.
   */
  test("bookmark button re-enables after a failed 500 save so the user can retry", async ({
    page,
    context,
  }) => {
    const sub = `outcome-bookmark-retry-e2e-${uid()}`;
    const email = `${sub}@bridgew.edu`;

    await loginAs(context, sub, email);

    await page.goto(`${BASE}/new-course`);

    const browseBtn = page.getByTestId("button-browse-outcome-library");
    await expect(browseBtn).toBeVisible({ timeout: 15_000 });
    await browseBtn.click();

    // Library tab is the default; wait for at least one curated outcome bookmark button.
    const firstSaveBtn = page.getByTestId(/^button-save-outcome-/).first();
    await expect(firstSaveBtn).toBeVisible({ timeout: 10_000 });

    // Confirm the button is enabled before clicking.
    await expect(firstSaveBtn).not.toBeDisabled();

    // Intercept POST /api/outcomes to simulate a server-side failure.
    await page.route("**/api/outcomes", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "Internal server error" }),
        });
      } else {
        await route.continue();
      }
    });

    await firstSaveBtn.click();

    // Error toast must appear.
    await expect(
      page.getByText("Could not save outcome").first(),
    ).toBeVisible({ timeout: 10_000 });

    // After the mutation settles with an error, isPending → false and isSaved
    // must still be false, so the button must be enabled again for retry.
    await expect(firstSaveBtn).not.toBeDisabled({ timeout: 5_000 });
  });

  /**
   * 404 delete path: when the DELETE endpoint returns 404 (item already removed
   * by another session), the UI shows the "Outcome was already removed" toast
   * and the item disappears from the My Outcomes list after the query is
   * invalidated and the server returns an updated list.
   */
  test("deleting an outcome that returns 404 shows 'Outcome was already removed' toast and removes item from list", async ({
    page,
    context,
  }) => {
    const sub = `outcome-delete-404-e2e-${uid()}`;
    const email = `${sub}@bridgew.edu`;

    await loginAs(context, sub, email);

    const outcomeText = `404 delete test outcome ${uid()}`;
    const outcomeId = await createOutcome(context, outcomeText);

    await page.goto(`${BASE}/new-course`);

    const browseBtn = page.getByTestId("button-browse-outcome-library");
    await expect(browseBtn).toBeVisible({ timeout: 15_000 });
    await browseBtn.click();

    const myOutcomesTab = page.getByTestId("tab-my-outcomes");
    await expect(myOutcomesTab).toBeVisible({ timeout: 5_000 });
    await myOutcomesTab.click();

    const outcomeRow = page.getByTestId(`my-outcome-row-${outcomeId}`);
    await expect(outcomeRow).toBeVisible({ timeout: 10_000 });

    // Simulate the item being removed by another session so the server-side
    // GET /api/outcomes will return an empty list on the next refetch.
    await context.request.delete(`${BASE}/api/outcomes/${outcomeId}`);

    // Now intercept the DELETE in the browser so it returns 404, matching the
    // scenario where the UI still shows a stale item that no longer exists.
    await page.route(`**/api/outcomes/${outcomeId}`, async (route) => {
      if (route.request().method() === "DELETE") {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ message: "Not found" }),
        });
      } else {
        await route.continue();
      }
    });

    const deleteBtn = page.getByTestId(`button-delete-outcome-${outcomeId}`);
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // The "already removed" toast must appear.
    await expect(
      page.getByText("Outcome was already removed"),
    ).toBeVisible({ timeout: 10_000 });

    // The query invalidation causes a real GET which returns the updated list
    // (item no longer exists server-side), so the row must disappear.
    await expect(outcomeRow).not.toBeVisible({ timeout: 10_000 });
  });
});

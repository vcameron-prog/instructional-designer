# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sign-in-redirect.spec.ts >> Sign-in returnTo redirect flow >> after sign-in the browser lands on the originally requested URL, not just /
- Location: e2e/sign-in-redirect.spec.ts:81:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Help & Resources')
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByText('Help & Resources')

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - link "Skip to main content" [ref=e3] [cursor=pointer]:
    - /url: "#main-content"
  - region "Notifications (F8)":
    - list
  - main [ref=e4]:
    - generic [ref=e7]:
      - generic [ref=e8]:
        - button "Go back" [ref=e9] [cursor=pointer]:
          - img
        - generic [ref=e10]:
          - img [ref=e12]
          - generic [ref=e15]:
            - heading "Help & Resources" [level=1] [ref=e16]
            - paragraph [ref=e17]: How to use the Accessibility Converter
      - generic [ref=e18]:
        - generic [ref=e19]:
          - button "Decrease font size" [ref=e20] [cursor=pointer]:
            - img
          - img [ref=e21]
          - button "Increase font size" [ref=e23] [cursor=pointer]:
            - img
        - button "Switch to dark mode" [ref=e24] [cursor=pointer]:
          - img
        - button "Go to home" [ref=e25] [cursor=pointer]:
          - img
        - button "Sign in" [ref=e26] [cursor=pointer]:
          - img
          - text: Sign In
    - generic [ref=e27]:
      - generic [ref=e28]:
        - heading "How It Works" [level=2] [ref=e29]:
          - img [ref=e30]
          - text: How It Works
        - generic [ref=e33]:
          - generic [ref=e34]:
            - generic [ref=e36]:
              - img [ref=e38]
              - generic [ref=e41]: 1. Upload your document
            - generic [ref=e43]: Drag and drop or browse to select a PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), or other supported file. You can also paste a Google Docs, Sheets, or Slides URL.
          - generic [ref=e44]:
            - generic [ref=e46]:
              - img [ref=e48]
              - generic [ref=e51]: 2. Automated accessibility audit
            - generic [ref=e53]: The tool extracts text, checks reading order, analyzes headings, tables, images, and color contrast against WCAG 2.1 AA — the standard required for ADA Title II compliance.
          - generic [ref=e54]:
            - generic [ref=e56]:
              - img [ref=e58]
              - generic [ref=e62]: 3. Review the compliance report
            - generic [ref=e64]: See a full list of issues found, with severity levels and suggested fixes. You can apply AI-suggested fixes automatically or make manual edits in the built-in editor.
          - generic [ref=e65]:
            - generic [ref=e67]:
              - img [ref=e69]
              - generic [ref=e72]: 4. Download the accessible version
            - generic [ref=e74]: Export the remediated document as accessible HTML, a Word (.docx) file, or a tagged PDF suitable for screen readers and assistive technologies.
      - generic [ref=e75]:
        - heading "Supported File Formats" [level=2] [ref=e76]:
          - img [ref=e77]
          - text: Supported File Formats
        - generic [ref=e81]:
          - generic [ref=e82]:
            - generic [ref=e83]:
              - img [ref=e84]
              - generic [ref=e87]:
                - paragraph [ref=e88]: PDF (.pdf)
                - paragraph [ref=e89]: Text-based and scanned (OCR applied automatically)
            - generic [ref=e90]:
              - img [ref=e91]
              - generic [ref=e94]:
                - paragraph [ref=e95]: Word (.docx)
                - paragraph [ref=e96]: All versions; tables, lists, and images supported
            - generic [ref=e97]:
              - img [ref=e98]
              - generic [ref=e101]:
                - paragraph [ref=e102]: Excel (.xlsx)
                - paragraph [ref=e103]: Spreadsheets; select a specific sheet to convert
            - generic [ref=e104]:
              - img [ref=e105]
              - generic [ref=e108]:
                - paragraph [ref=e109]: PowerPoint (.pptx)
                - paragraph [ref=e110]: Slides converted to structured HTML
            - generic [ref=e111]:
              - img [ref=e112]
              - generic [ref=e115]:
                - paragraph [ref=e116]: Google Docs
                - paragraph [ref=e117]: Paste a sharing link (document must be publicly shared)
            - generic [ref=e118]:
              - img [ref=e119]
              - generic [ref=e122]:
                - paragraph [ref=e123]: Google Sheets
                - paragraph [ref=e124]: Paste a sharing link; choose which sheet to convert
            - generic [ref=e125]:
              - img [ref=e126]
              - generic [ref=e129]:
                - paragraph [ref=e130]: Google Slides
                - paragraph [ref=e131]: Paste a sharing link
            - generic [ref=e132]:
              - img [ref=e133]
              - generic [ref=e136]:
                - paragraph [ref=e137]: RTF, ODT, EPUB
                - paragraph [ref=e138]: Additional document formats
          - generic [ref=e139]:
            - img [ref=e140]
            - paragraph [ref=e142]:
              - text: "Maximum file size:"
              - strong [ref=e143]: 20 MB
              - text: . Password-protected documents cannot be processed.
      - generic [ref=e144]:
        - heading "What to Expect" [level=2] [ref=e145]:
          - img [ref=e146]
          - text: What to Expect
        - generic [ref=e150]:
          - generic [ref=e151]:
            - generic [ref=e152]:
              - paragraph [ref=e153]: 1–2 min
              - paragraph [ref=e154]: Typical processing time
            - generic [ref=e155]:
              - paragraph [ref=e156]: WCAG 2.1 AA
              - paragraph [ref=e157]: Accessibility standard checked
            - generic [ref=e158]:
              - paragraph [ref=e159]: 3 formats
              - paragraph [ref=e160]: HTML · DOCX · Tagged PDF
          - paragraph [ref=e161]: The converter performs both automated rule-based checks and AI-powered analysis to catch issues that automated tools alone may miss — such as ambiguous alt text, complex table structures, and reading-order problems in multi-column layouts.
          - link "WCAG 2.1 Quick Reference at W3C" [ref=e163] [cursor=pointer]:
            - /url: https://www.w3.org/WAI/WCAG21/quickref/
            - text: WCAG 2.1 Quick Reference at W3C
            - img [ref=e164]
      - generic [ref=e168]:
        - heading "Frequently Asked Questions" [level=2] [ref=e169]:
          - img [ref=e170]
          - text: Frequently Asked Questions
        - generic [ref=e173]:
          - heading "What file size limit applies?" [level=3] [ref=e175]:
            - button "What file size limit applies?" [ref=e176] [cursor=pointer]:
              - text: What file size limit applies?
              - img [ref=e177]
          - heading "What accessibility standard does the converter check against?" [level=3] [ref=e180]:
            - button "What accessibility standard does the converter check against?" [ref=e181] [cursor=pointer]:
              - text: What accessibility standard does the converter check against?
              - img [ref=e182]
          - heading "How long does conversion take?" [level=3] [ref=e185]:
            - button "How long does conversion take?" [ref=e186] [cursor=pointer]:
              - text: How long does conversion take?
              - img [ref=e187]
          - heading "What is OCR and when is it used?" [level=3] [ref=e190]:
            - button "What is OCR and when is it used?" [ref=e191] [cursor=pointer]:
              - text: What is OCR and when is it used?
              - img [ref=e192]
          - heading "Can I edit the converted document before downloading?" [level=3] [ref=e195]:
            - button "Can I edit the converted document before downloading?" [ref=e196] [cursor=pointer]:
              - text: Can I edit the converted document before downloading?
              - img [ref=e197]
          - heading "Do I need an account?" [level=3] [ref=e200]:
            - button "Do I need an account?" [ref=e201] [cursor=pointer]:
              - text: Do I need an account?
              - img [ref=e202]
          - heading "Is my document stored securely?" [level=3] [ref=e205]:
            - button "Is my document stored securely?" [ref=e206] [cursor=pointer]:
              - text: Is my document stored securely?
              - img [ref=e207]
          - heading "What download formats are available?" [level=3] [ref=e210]:
            - button "What download formats are available?" [ref=e211] [cursor=pointer]:
              - text: What download formats are available?
              - img [ref=e212]
          - heading "How was this tool built?" [level=3] [ref=e215]:
            - button "How was this tool built?" [ref=e216] [cursor=pointer]:
              - text: How was this tool built?
              - img [ref=e217]
    - generic [ref=e220]:
      - img "BSU Center for Artificial Intelligence" [ref=e222]
      - paragraph [ref=e223]:
        - img [ref=e224]
        - generic [ref=e226]:
          - text: Your data is stored securely, never shared, and not used to train AI models. Powered by
          - link "Anthropic's Claude API" [ref=e227] [cursor=pointer]:
            - /url: https://www.anthropic.com/privacy
          - text: . This tool improves accessibility but does not guarantee full WCAG 2.1 compliance — automated remediation is a starting point and human review is required. Please review all content before use.
```

# Test source

```ts
  15  |  *    login.
  16  |  *
  17  |  * Uses /help as the target page because it renders HeaderControls directly
  18  |  * (with showLogin defaulting to true), so button-header-login is visible to
  19  |  * unauthenticated visitors. Pages using ConverterHeader (history, conversion,
  20  |  * upload) force showLogin={false} and do not show this button.
  21  |  * /settings was previously tried but it is a protected route (requiresAuth:
  22  |  * true) that redirects unauthenticated visitors to OIDC before rendering.
  23  |  *
  24  |  * Run with:
  25  |  *   PLAYWRIGHT_TEST=1 npx playwright test e2e/sign-in-redirect.spec.ts
  26  |  */
  27  | 
  28  | import { test, expect } from "@playwright/test";
  29  | import { loginAndRedirect, DEFAULT_TEST_USER } from "./helpers/auth";
  30  | 
  31  | /** Synthetic user used throughout the spec. */
  32  | const TEST_USER = {
  33  |   ...DEFAULT_TEST_USER,
  34  |   sub: "pw-return-to-test-user",
  35  |   email: "pwreturnto@bridgew.edu",
  36  |   firstName: "Playwright",
  37  |   lastName: "ReturnTo",
  38  | };
  39  | 
  40  | test.describe("Sign-in returnTo redirect flow", () => {
  41  |   test.beforeEach(async ({ page }) => {
  42  |     // Start each test without an active session.
  43  |     await page.context().clearCookies();
  44  |   });
  45  | 
  46  |   test("unauthenticated visit to a page with HeaderControls shows Sign In button", async ({
  47  |     page,
  48  |   }) => {
  49  |     // /help uses HeaderControls directly with showLogin defaulting to true.
  50  |     await page.goto("/help");
  51  | 
  52  |     const loginBtn = page.getByTestId("button-header-login");
  53  |     await expect(loginBtn).toBeVisible({ timeout: 15_000 });
  54  |     await expect(loginBtn).toContainText("Sign In");
  55  |   });
  56  | 
  57  |   test("Sign In button encodes current path as returnTo query param", async ({
  58  |     page,
  59  |   }) => {
  60  |     const protectedPath = "/help";
  61  |     await page.goto(protectedPath);
  62  | 
  63  |     const loginBtn = page.getByTestId("button-header-login");
  64  |     await expect(loginBtn).toBeVisible({ timeout: 15_000 });
  65  | 
  66  |     // Intercept the /api/login navigation to capture the URL it builds, then
  67  |     // abort so we stay on the page for inspection.
  68  |     const loginRequestPromise = page.waitForRequest("**/api/login*");
  69  |     await page.route("**/api/login*", (route) => route.abort());
  70  | 
  71  |     await loginBtn.click();
  72  | 
  73  |     const loginRequest = await loginRequestPromise;
  74  |     const loginUrl = new URL(loginRequest.url());
  75  |     const returnTo = loginUrl.searchParams.get("returnTo");
  76  | 
  77  |     // The returnTo must match the path the user was on when they clicked Sign In.
  78  |     expect(returnTo).toBe(protectedPath);
  79  |   });
  80  | 
  81  |   test("after sign-in the browser lands on the originally requested URL, not just /", async ({
  82  |     page,
  83  |   }) => {
  84  |     const protectedPath = "/help";
  85  | 
  86  |     // Step 1: Navigate to the page without being signed in.
  87  |     await page.goto(protectedPath);
  88  | 
  89  |     // Step 2: Assert the sign-in prompt is shown and verify the formula it uses.
  90  |     const loginBtn = page.getByTestId("button-header-login");
  91  |     await expect(loginBtn).toBeVisible({ timeout: 15_000 });
  92  | 
  93  |     // Read the returnTo formula directly from the browser — the same expression
  94  |     // used by the Sign In button's onClick and the queryClient 401 handler.
  95  |     const capturedReturnTo = await page.evaluate(
  96  |       () => window.location.pathname + window.location.search,
  97  |     );
  98  |     expect(capturedReturnTo).toBe(protectedPath);
  99  | 
  100 |     // Step 3: Simulate the post-OIDC callback using the shared loginAndRedirect
  101 |     // helper, which POSTs to /api/test/login with returnTo in the body.
  102 |     // The endpoint creates a real session and issues a 302 redirect — the
  103 |     // browser follows that redirect naturally.
  104 |     await loginAndRedirect(page, capturedReturnTo, TEST_USER);
  105 | 
  106 |     // Step 4: Assert the browser is on the correct URL — not just "/".
  107 |     expect(new URL(page.url()).pathname).toBe(protectedPath);
  108 | 
  109 |     // The header Sign In button must be gone — we're authenticated now.
  110 |     await expect(page.getByTestId("button-header-login")).not.toBeVisible({
  111 |       timeout: 10_000,
  112 |     });
  113 | 
  114 |     // The page must render content that proves we're on /help.
> 115 |     await expect(page.getByText("Help & Resources")).toBeVisible({ timeout: 10_000 });
      |                                                      ^ Error: expect(locator).toBeVisible() failed
  116 |   });
  117 | 
  118 |   test("returnTo preserves path AND query string (matches queryClient 401 handler)", async ({
  119 |     page,
  120 |   }) => {
  121 |     // The queryClient 401 handler uses:
  122 |     //   window.location.pathname + window.location.search
  123 |     // This test verifies the header Sign In button uses the same formula by
  124 |     // navigating to a path with a query string and checking the encoded value.
  125 |     const pathWithSearch = "/help?tab=account";
  126 |     await page.goto(pathWithSearch);
  127 | 
  128 |     const loginBtn = page.getByTestId("button-header-login");
  129 |     await expect(loginBtn).toBeVisible({ timeout: 15_000 });
  130 | 
  131 |     const loginRequestPromise = page.waitForRequest("**/api/login*");
  132 |     await page.route("**/api/login*", (route) => route.abort());
  133 | 
  134 |     await loginBtn.click();
  135 | 
  136 |     const loginRequest = await loginRequestPromise;
  137 |     const loginUrl = new URL(loginRequest.url());
  138 |     const returnTo = loginUrl.searchParams.get("returnTo");
  139 | 
  140 |     // returnTo must include both pathname AND search params.
  141 |     expect(returnTo).toBe(pathWithSearch);
  142 |   });
  143 | });
  144 | 
```
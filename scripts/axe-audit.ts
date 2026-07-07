/**
 * WCAG 2.1 AA axe-core audit script
 *
 * Launches a headless browser, injects axe-core, and reports critical/serious
 * violations for key pages in both the root app and the instructional-designer
 * sub-app.
 *
 * Usage (from workspace root):
 *   npx tsx scripts/axe-audit.ts
 *
 * Prerequisites:
 *   - Both servers must be running:
 *       npm run dev                             (root app on port 5000)
 *       cd instructional-designer && npm run dev (ID app on port 3001)
 *   - axe-core: npm install --save-dev axe-core
 *   - @playwright/test is already a devDependency.
 *
 * The script exits with code 1 if any critical or serious violations are found
 * OR if any target page fails to load, making it suitable as a manual
 * pre-deploy gate.
 */

import { chromium, type Page } from "@playwright/test";
import { readFileSync } from "fs";
import { resolve } from "path";

const AXE_SOURCE = readFileSync(
  resolve(process.cwd(), "node_modules/axe-core/axe.js"),
  "utf8",
);

const ROOT_BASE = "http://localhost:5000";
const ID_BASE = "http://localhost:3001/faculty";

interface AxeViolation {
  id: string;
  impact: string;
  description: string;
  help: string;
  helpUrl: string;
  nodes: { html: string; target: string[] }[];
}

interface AxeResults {
  violations: AxeViolation[];
}

async function runAxe(page: Page): Promise<AxeResults> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async () => {
    return new Promise<AxeResults>((resolve) => {
      (window as any).axe.run(
        document,
        {
          runOnly: {
            type: "tag",
            values: ["wcag2a", "wcag2aa", "wcag21aa"],
          },
        },
        (_err: Error | null, results: AxeResults) => {
          resolve(results);
        },
      );
    });
  });
}

function printViolations(url: string, violations: AxeViolation[]): number {
  const critical = violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  if (critical.length === 0) {
    console.log(`  ✓ No critical/serious violations`);
    return 0;
  }
  console.error(`  ✗ ${critical.length} critical/serious violation(s):`);
  for (const v of critical) {
    console.error(`    [${v.impact.toUpperCase()}] ${v.id}: ${v.help}`);
    console.error(`      ${v.helpUrl}`);
    for (const node of v.nodes.slice(0, 2)) {
      const html = node.html.replace(/\s+/g, " ").slice(0, 140);
      console.error(`      Element: ${html}`);
    }
  }
  return critical.length;
}

/**
 * Audits one page.
 * Returns:
 *  - negative number (-1) if the page failed to load or redirected to auth
 *  - 0 if no critical/serious violations
 *  - positive number = count of critical/serious violations
 */
async function auditPage(
  page: Page,
  url: string,
  label: string,
  options: { requiresAuth?: boolean } = {},
): Promise<number> {
  console.log(`\nAuditing: ${label}`);
  console.log(`         ${url}`);

  try {
    const response = await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });

    if (!response) {
      console.error("  ✗ LOAD ERROR: No response received (network failure).");
      return -1;
    }

    const finalUrl = page.url();
    const redirectedToAuth =
      finalUrl.includes("/login") ||
      finalUrl.includes("/sign-in") ||
      finalUrl.includes("auth") ||
      (finalUrl !== url && !finalUrl.startsWith(url));

    if (redirectedToAuth) {
      if (options.requiresAuth) {
        console.warn(
          `  ⚠ SKIPPED: Page requires authentication — audit the login page reached instead.`,
        );
        // Audit the login/redirect page that was shown
        const results = await runAxe(page);
        return printViolations(finalUrl, results.violations);
      }
      console.error(
        `  ✗ LOAD ERROR: Unexpected redirect to ${finalUrl} — possible auth regression.`,
      );
      return -1;
    }

    const status = response.status();
    if (status >= 400) {
      console.error(`  ✗ LOAD ERROR: HTTP ${status} returned for ${url}.`);
      return -1;
    }

    const results = await runAxe(page);
    return printViolations(url, results.violations);
  } catch (err) {
    console.error(`  ✗ LOAD ERROR: ${err}`);
    return -1;
  }
}

/**
 * Pages to audit.
 *
 * "PDF conversion page" for the ID app does not exist (the ID app is an
 * instructional-design tool, not a PDF converter). The closest equivalents are
 * the Quick Tools page and the Accessibility Tools page.
 *
 * "Tool result page" requires authentication in both apps; we audit the
 * redirect target (login page) and note that the full result page should be
 * audited manually after login.
 */
const PAGES: { label: string; url: string; requiresAuth?: boolean }[] = [
  // ── Root app ────────────────────────────────────────────────────────────────
  {
    label: "Root — Landing / Home",
    url: `${ROOT_BASE}/`,
  },
  {
    label: "Root — PDF upload (conversion home)",
    url: `${ROOT_BASE}/pdf-accessibility`,
  },
  {
    label: "Root — PDF conversion history",
    url: `${ROOT_BASE}/pdf-accessibility/history`,
  },
  {
    label: "Root — Alt-text generator",
    url: `${ROOT_BASE}/accessibility-tools/alt-text`,
  },
  {
    label: "Root — Color contrast checker",
    url: `${ROOT_BASE}/accessibility-tools/color-contrast`,
  },
  {
    label: "Root — Admin dashboard (auth-gated; audits login redirect)",
    url: `${ROOT_BASE}/admin`,
    requiresAuth: true,
  },
  // ── Instructional Designer sub-app ─────────────────────────────────────────
  {
    label: "ID — Landing / Home",
    url: `${ID_BASE}/`,
  },
  {
    label: "ID — Quick tools",
    url: `${ID_BASE}/quick-tools`,
  },
  {
    label: "ID — Accessibility tools (PDF conversion equivalent)",
    url: `${ID_BASE}/accessibility-tools`,
  },
  {
    label: "ID — New course form",
    url: `${ID_BASE}/course/new`,
  },
  {
    label: "ID — Admin dashboard (auth-gated; audits login redirect)",
    url: `${ID_BASE}/admin`,
    requiresAuth: true,
  },
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  let totalViolations = 0;
  let totalLoadErrors = 0;

  console.log("=== axe-core WCAG 2.1 AA Audit ===");
  console.log(`    Checking ${PAGES.length} pages across both apps.\n`);
  console.log(
    "    NOTE: Auth-gated pages (admin, tool results) audit the login",
  );
  console.log(
    "    redirect shown to unauthenticated users. Run against a logged-in",
  );
  console.log(
    "    session (see scripts/axe-audit.ts notes) to audit the full page.\n",
  );

  for (const { label, url, requiresAuth } of PAGES) {
    const count = await auditPage(page, url, label, { requiresAuth });
    if (count < 0) {
      totalLoadErrors++;
    } else {
      totalViolations += count;
    }
  }

  await browser.close();

  console.log("\n=== Summary ===");
  if (totalLoadErrors > 0) {
    console.error(
      `  ${totalLoadErrors} page(s) failed to load — check that both servers are running.`,
    );
  }
  if (totalViolations === 0 && totalLoadErrors === 0) {
    console.log("  ✓ All pages passed — zero critical/serious violations.");
    process.exit(0);
  } else {
    if (totalViolations > 0) {
      console.error(
        `  ✗ ${totalViolations} critical/serious violation(s) found across all audited pages.`,
      );
    }
    process.exit(1);
  }
})();

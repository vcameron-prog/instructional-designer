import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGES_DIR = path.resolve(__dirname, "../client/src/pages");
const COMPONENTS_DIR = path.resolve(__dirname, "../client/src/components");

// ---------------------------------------------------------------------------
// Convention-based pattern for loading-state variables used in page components.
//
// Matches variables that follow the project naming conventions:
//   isLoading*    — e.g. isLoading, isLoadingStats, isLoadingCourse
//   is*Loading    — e.g. isAuthLoading
//   isChecking*   — e.g. isCheckingAdmin
//   isPending     — mutation pending state
//   isGenerating  — generation in progress (tool-form)
//   authLoading   — legacy short name
//
// New loading variables that follow these patterns are detected automatically.
// Variables that don't follow the convention must be added explicitly above.
// ---------------------------------------------------------------------------
const LOADING_VAR_PATTERN =
  /\b(?:isLoading\w*|is\w*Loading|isPending|isGenerating|authLoading|isChecking\w*)\b/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the paths of every .tsx file in client/src/pages/ that imports the
 * PoweredByFooter component.
 */
function pageFilesWithFooterImport(): string[] {
  const files = readdirSync(PAGES_DIR).filter((f) => f.endsWith(".tsx"));
  return files
    .map((f) => path.join(PAGES_DIR, f))
    .filter((filePath) => readFileSync(filePath, "utf-8").includes("powered-by-footer"));
}

/**
 * Returns the paths of every .tsx file in client/src/pages/ that imports the
 * LoadingScreen component.  These files are expected to have at least one
 * loading-guard early-return branch detectable by `loadingBranchReturnBlocks`.
 */
function pageFilesWithLoadingImport(): string[] {
  const files = readdirSync(PAGES_DIR).filter((f) => f.endsWith(".tsx"));
  return files
    .map((f) => path.join(PAGES_DIR, f))
    .filter((filePath) => readFileSync(filePath, "utf-8").includes("loading-screen"));
}

/**
 * Returns the paths of every .tsx file in client/src/pages/ that are
 * candidates for having a non-loading guarded <main> early-return block.
 *
 * A page is a candidate when ALL of the following raw heuristics match:
 *   1. It imports PoweredByFooter (cares about the footer in page layouts).
 *   2. It contains `<main` somewhere (renders a full-page layout).
 *   3. Its source matches the structural pattern:
 *        `if (condition) {\n    return (`
 *      i.e. a single-line if-condition followed by an opening brace, a
 *      newline, and a parenthesised return statement.
 *
 * Condition (3) is checked with a regex independently of
 * `nonLoadingGuardedMainReturnBlocks`, making the candidate detection
 * non-circular.  The regex deliberately excludes brace-less and
 * non-parenthesised return forms (e.g. `if (x) return;`) so pages whose
 * only guards are loading guards (which return `<LoadingScreen />`, not
 * `return (…)`) are not flagged as candidates.
 */
function pageFilesWithNonLoadingMainGuards(): string[] {
  const files = readdirSync(PAGES_DIR).filter((f) => f.endsWith(".tsx"));
  // Matches: if (single-line-condition) {\n   return (
  // The braced + newline requirement avoids matching `if (x) return val;\n return (…`
  // across separate statements, which a plain { 0,N } window cannot prevent.
  const BRACED_RETURN_PAREN = /\bif\s*\([^)]*\)\s*\{\s*\n\s*return\s*\(/;

  return files
    .map((f) => path.join(PAGES_DIR, f))
    .filter((filePath) => {
      const source = readFileSync(filePath, "utf-8");
      return (
        source.includes("powered-by-footer") &&
        source.includes("<main") &&
        BRACED_RETURN_PAREN.test(source)
      );
    });
}

/**
 * Recursively collects every .tsx file under a directory.
 */
function collectTsxFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectTsxFiles(full));
    } else if (entry.endsWith(".tsx")) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Returns the paths of every .tsx file in client/src/components/ (recursively)
 * that imports the PoweredByFooter component.
 *
 * The components/ directory may contain full-page-layout helper components
 * (e.g. error boundaries, access-gate wrappers) that render a <main> element
 * and should include <PoweredByFooter /> just like page files do.  This helper
 * makes those files visible to the footer regression suite so they are checked
 * by the same rules applied to pages/.
 *
 * As of the initial addition of this helper, no component file imports
 * PoweredByFooter (the only <main> in components/ is inside the shadcn/ui
 * sidebar primitive, which is a layout utility rather than a full-page
 * component).  The helper is intentionally written to return zero results in
 * that case; the companion tests skip the "must find at least one" sanity
 * check that the pages/ tests enforce.
 */
function componentFilesWithFooterImport(): string[] {
  return collectTsxFiles(COMPONENTS_DIR).filter((filePath) =>
    readFileSync(filePath, "utf-8").includes("powered-by-footer"),
  );
}

/**
 * Walk `source` starting at `startIdx` (the opening `(`) and return the index
 * of the matching closing `)`, handling string literals so parens inside
 * strings don't confuse the count.  Returns -1 if no match found.
 */
function findMatchingParen(source: string, startIdx: number): number {
  let depth = 0;
  let inString = false;
  let stringChar = "";

  for (let i = startIdx; i < source.length; i++) {
    const ch = source[i];

    if (inString) {
      if (ch === "\\" && stringChar !== "`") {
        i++; // skip escaped character
        continue;
      }
      if (ch === stringChar) inString = false;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      inString = true;
      stringChar = ch;
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

/**
 * Extracts the content of `return ( ... )` blocks that immediately follow an
 * `if ( <loadingCondition> ) {` guard at component scope.
 *
 * "Immediately follow" means: between the closing `)` of the if-condition and
 * the `return (`, there is only whitespace and the opening `{` of the if-body
 * — no other statements.  This reliably targets loading-branch early returns
 * while ignoring returns inside JSX map/filter callbacks or helper functions.
 *
 * Returns an array of extracted block strings (the content between the outer
 * parentheses of each matching `return ( ... )`).
 */
function loadingBranchReturnBlocks(source: string): string[] {
  const blocks: string[] = [];
  const IF_RE = /\bif\s*\(/g;
  let m: RegExpExecArray | null;

  while ((m = IF_RE.exec(source)) !== null) {
    // 1. Find the closing `)` of the if-condition.
    const condOpenIdx = m.index + m[0].length - 1; // position of `(`
    const condCloseIdx = findMatchingParen(source, condOpenIdx);
    if (condCloseIdx === -1) continue;

    // 2. Check whether the condition references a loading variable.
    const condition = source.slice(condOpenIdx, condCloseIdx + 1);
    if (!LOADING_VAR_PATTERN.test(condition)) continue;

    // 3. After the condition, accept only whitespace + optional `{` + whitespace
    //    + `return (`.  Any other non-whitespace token (another statement, a
    //    nested if, etc.) means this isn't a simple loading-guard branch.
    //    Both braced `if (x) { return (` and brace-less `if (x) return (` forms
    //    are supported.
    const afterCond = source.slice(condCloseIdx + 1);
    const immediateReturn = /^[\s]*(?:\{[\s]*)?return\s*(?:\(|<)/.exec(afterCond);
    if (!immediateReturn) continue;

    // 4. Check if this is a self-closing JSX return: `return <LoadingScreen ... />;`
    //    These don't have parentheses to match — capture the whole statement.
    const isSelfClosingJSX = /^[\s]*(?:\{[\s]*)?return\s*</.test(afterCond);
    if (isSelfClosingJSX) {
      const returnStart = afterCond.search(/return\s*</);
      const stmtStart = condCloseIdx + 1 + returnStart;
      const semicolonIdx = source.indexOf(";", stmtStart);
      if (semicolonIdx !== -1) {
        blocks.push(source.slice(stmtStart, semicolonIdx + 1));
      }
      continue;
    }

    // 5. Locate the opening `(` of the return statement and extract its block.
    const returnOpenOffset = immediateReturn[0].lastIndexOf("(");
    const returnOpenIdx = condCloseIdx + 1 + returnOpenOffset;
    const returnCloseIdx = findMatchingParen(source, returnOpenIdx);
    if (returnCloseIdx === -1) continue;

    blocks.push(source.slice(returnOpenIdx, returnCloseIdx + 1));
  }

  return blocks;
}

/**
 * Extracts the content of `return ( ... )` blocks that immediately follow an
 * `if ( <anyCondition> ) {` guard at component scope, where:
 *   - the condition does NOT reference a loading variable (those are already
 *     handled by `loadingBranchReturnBlocks`), and
 *   - the returned block contains a `<main` element (i.e. it renders a full
 *     page layout rather than a small helper component or callback return).
 *
 * This catches "not found", "error", and "access-denied" early-return branches
 * that a developer might forget to include `<PoweredByFooter />` in.
 */
function nonLoadingGuardedMainReturnBlocks(source: string): string[] {
  const blocks: string[] = [];
  const IF_RE = /\bif\s*\(/g;
  let m: RegExpExecArray | null;

  while ((m = IF_RE.exec(source)) !== null) {
    const condOpenIdx = m.index + m[0].length - 1;
    const condCloseIdx = findMatchingParen(source, condOpenIdx);
    if (condCloseIdx === -1) continue;

    const condition = source.slice(condOpenIdx, condCloseIdx + 1);

    // Skip loading-condition guards — those are already covered by the
    // loadingBranchReturnBlocks helper and the companion test above.
    if (LOADING_VAR_PATTERN.test(condition)) continue;

    const afterCond = source.slice(condCloseIdx + 1);
    const immediateReturn = /^[\s]*(?:\{[\s]*)?return\s*\(/.exec(afterCond);
    if (!immediateReturn) continue;

    const returnOpenOffset = immediateReturn[0].lastIndexOf("(");
    const returnOpenIdx = condCloseIdx + 1 + returnOpenOffset;
    const returnCloseIdx = findMatchingParen(source, returnOpenIdx);
    if (returnCloseIdx === -1) continue;

    const block = source.slice(returnOpenIdx, returnCloseIdx + 1);

    // Only consider blocks that render a <main> element — those represent
    // full-page layouts that should include the disclaimer footer.
    if (!block.includes("<main")) continue;

    blocks.push(block);
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PoweredByFooter — loading-branch regression", () => {
  /**
   * Core guarantee: the shared LoadingScreen component must render
   * <PoweredByFooter />.  All pages that use <LoadingScreen /> in their
   * loading branches automatically satisfy the footer requirement via this
   * single component-level check, eliminating per-call-site repetition.
   */
  it("LoadingScreen component renders <PoweredByFooter />", () => {
    const source = readFileSync(
      path.join(COMPONENTS_DIR, "loading-screen.tsx"),
      "utf-8",
    );
    expect(source).toContain("PoweredByFooter");
  });

  /**
   * Regression guard: every loading-guard return block must render either
   * <LoadingScreen /> (which includes the footer) or <PoweredByFooter />
   * directly (for custom loading UIs that don't use the shared component).
   *
   * This prevents a future developer from adding a new loading-state branch
   * and forgetting the disclaimer footer in both the shared and custom paths.
   */
  it("every loading-guard return block renders <LoadingScreen /> or <PoweredByFooter />", () => {
    const violations: string[] = [];
    const files = readdirSync(PAGES_DIR).filter((f) => f.endsWith(".tsx"));

    for (const fileName of files) {
      const filePath = path.join(PAGES_DIR, fileName);
      const source = readFileSync(filePath, "utf-8");

      // Only examine files that import either LoadingScreen or PoweredByFooter.
      const usesLoadingScreen = source.includes("loading-screen");
      const usesFooter = source.includes("powered-by-footer");
      if (!usesLoadingScreen && !usesFooter) continue;

      const blocks = loadingBranchReturnBlocks(source);

      for (const block of blocks) {
        const hasLoadingScreen = block.includes("LoadingScreen");
        const hasFooter = block.includes("PoweredByFooter");
        if (!hasLoadingScreen && !hasFooter) {
          violations.push(
            `${fileName}: a loading-guard return block is missing <LoadingScreen /> or <PoweredByFooter />`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  /**
   * Companion check: a page file that imports PoweredByFooter must also render
   * it at least once (directly or via LoadingScreen).  An import with no usage
   * means the footer was removed — either a regression or a dead import.
   */
  it("every page that imports PoweredByFooter renders it at least once", () => {
    const violations: string[] = [];
    const files = readdirSync(PAGES_DIR).filter((f) => f.endsWith(".tsx"));

    for (const fileName of files) {
      const filePath = path.join(PAGES_DIR, fileName);
      const source = readFileSync(filePath, "utf-8");
      if (!source.includes("powered-by-footer")) continue;
      if (!source.includes("<PoweredByFooter")) {
        violations.push(
          `${fileName}: imports PoweredByFooter but never renders it`,
        );
      }
    }

    expect(violations).toEqual([]);
  });

  /**
   * Coverage check: every page that imports LoadingScreen must have at least
   * one loading-guard early-return block detected by `loadingBranchReturnBlocks`.
   *
   * This list is built dynamically by scanning the pages directory for files
   * that import the loading-screen component, so new pages are automatically
   * included without any manual list maintenance.
   */
  it("loading-branch detection finds at least one block in each page that imports LoadingScreen", () => {
    const filePaths = pageFilesWithLoadingImport();

    expect(filePaths.length).toBeGreaterThan(0);

    const violations: string[] = [];

    for (const filePath of filePaths) {
      const source = readFileSync(filePath, "utf-8");
      const fileName = path.basename(filePath);
      const blocks = loadingBranchReturnBlocks(source);

      if (blocks.length === 0) {
        violations.push(
          `${fileName}: imports LoadingScreen but no loading-guard return blocks were detected — ` +
            "either the file was refactored or LOADING_VAR_PATTERN needs updating",
        );
      }
    }

    expect(violations).toEqual([]);
  });

  /**
   * Non-loading early-return guard:
   *
   * For every page file that imports PoweredByFooter, any early-return block
   * guarded by a non-loading `if` condition that renders a `<main>` element
   * must also render `<PoweredByFooter />`.
   *
   * This catches "not found", "error", and "access-denied" states that a
   * developer might add without remembering to include the footer.
   */
  it("every non-loading-guard <main> return block renders <PoweredByFooter />", () => {
    const violations: string[] = [];
    const filePaths = pageFilesWithFooterImport();

    expect(filePaths.length).toBeGreaterThan(0);

    for (const filePath of filePaths) {
      const source = readFileSync(filePath, "utf-8");
      const fileName = path.basename(filePath);
      const blocks = nonLoadingGuardedMainReturnBlocks(source);

      for (const block of blocks) {
        if (!block.includes("PoweredByFooter")) {
          violations.push(
            `${fileName}: a non-loading-guard <main> return block is missing <PoweredByFooter />`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  /**
   * Coverage check: every page identified (by raw heuristic) as having a
   * non-loading conditional that renders a <main> element must yield at least
   * one block from `nonLoadingGuardedMainReturnBlocks`.
   *
   * Candidates are discovered dynamically via `pageFilesWithNonLoadingMainGuards`:
   * pages that import PoweredByFooter, contain `if (!`, and contain `<main`.
   * The candidate heuristic is independent of the block extractor, so a
   * failure means either (a) the detector needs updating or (b) the file was
   * refactored to remove all such guards and no longer matches the heuristic.
   *
   * New pages that satisfy the heuristic are automatically included without any
   * manual list maintenance.
   */
  it("non-loading-guard detection finds at least one <main> block in each candidate page", () => {
    const filePaths = pageFilesWithNonLoadingMainGuards();

    expect(filePaths.length).toBeGreaterThan(0);

    const violations: string[] = [];

    for (const filePath of filePaths) {
      const source = readFileSync(filePath, "utf-8");
      const fileName = path.basename(filePath);
      const blocks = nonLoadingGuardedMainReturnBlocks(source);

      if (blocks.length === 0) {
        violations.push(
          `${fileName}: matched non-loading-guard heuristic but no <main> blocks were detected — ` +
            "either the file was refactored or the detection logic needs updating",
        );
      }
    }

    expect(violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Component-level footer regression suite
//
// These tests apply the same rules to client/src/components/ that the suite
// above applies to client/src/pages/.
//
// As of the initial addition of this suite, no component file imports
// PoweredByFooter — the only <main> element in components/ belongs to the
// shadcn/ui sidebar primitive (sidebar.tsx), which is a layout utility rather
// than a full-page component and therefore does not need the disclaimer footer.
//
// If a future developer adds a full-page helper component (e.g. an error
// boundary or access-gate wrapper that renders <main>) to components/ and
// imports PoweredByFooter, these tests will automatically pick it up and
// enforce the same footer-in-every-branch rules without any test changes.
// ---------------------------------------------------------------------------

describe("PoweredByFooter — component loading-branch regression", () => {
  /**
   * For every component file that imports PoweredByFooter, any loading-guard
   * early-return block must also render <PoweredByFooter />.
   *
   * No sanity-check for "must find at least one file" is performed here because
   * it is valid (and currently the case) that zero component files import the
   * footer.  The test becomes active automatically once any such file exists.
   */
  it("every loading-guard return block in components renders <PoweredByFooter />", () => {
    const violations: string[] = [];
    const filePaths = componentFilesWithFooterImport();

    for (const filePath of filePaths) {
      const source = readFileSync(filePath, "utf-8");
      const fileName = path.relative(COMPONENTS_DIR, filePath);
      const blocks = loadingBranchReturnBlocks(source);

      for (const block of blocks) {
        if (!block.includes("PoweredByFooter")) {
          violations.push(
            `components/${fileName}: a loading-guard return block is missing <PoweredByFooter />`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  /**
   * For every component file that imports PoweredByFooter, the import must
   * actually be used (renders at least once).
   */
  it("every component that imports PoweredByFooter renders it at least once", () => {
    const violations: string[] = [];
    const filePaths = componentFilesWithFooterImport();

    for (const filePath of filePaths) {
      const source = readFileSync(filePath, "utf-8");
      if (!source.includes("<PoweredByFooter")) {
        violations.push(
          `components/${path.relative(COMPONENTS_DIR, filePath)}: imports PoweredByFooter but never renders it`,
        );
      }
    }

    expect(violations).toEqual([]);
  });

  /**
   * For every component file that imports PoweredByFooter, any non-loading
   * early-return block that renders a <main> element must also render
   * <PoweredByFooter />.
   */
  it("every non-loading-guard <main> return block in components renders <PoweredByFooter />", () => {
    const violations: string[] = [];
    const filePaths = componentFilesWithFooterImport();

    for (const filePath of filePaths) {
      const source = readFileSync(filePath, "utf-8");
      const fileName = path.relative(COMPONENTS_DIR, filePath);
      const blocks = nonLoadingGuardedMainReturnBlocks(source);

      for (const block of blocks) {
        if (!block.includes("PoweredByFooter")) {
          violations.push(
            `components/${fileName}: a non-loading-guard <main> return block is missing <PoweredByFooter />`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

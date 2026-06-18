import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGES_DIR = path.resolve(__dirname, "../client/src/pages");

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
    const immediateReturn = /^[\s]*(?:\{[\s]*)?return\s*\(/.exec(afterCond);
    if (!immediateReturn) continue;

    // 4. Locate the opening `(` of the return statement and extract its block.
    const returnOpenOffset = immediateReturn[0].lastIndexOf("(");
    const returnOpenIdx = condCloseIdx + 1 + returnOpenOffset;
    const returnCloseIdx = findMatchingParen(source, returnOpenIdx);
    if (returnCloseIdx === -1) continue;

    blocks.push(source.slice(returnOpenIdx, returnCloseIdx + 1));
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PoweredByFooter — loading-branch regression", () => {
  /**
   * Core regression guard:
   *
   * For every page file that imports PoweredByFooter, any early-return block
   * that is directly guarded by a loading-state `if` condition must also render
   * `<PoweredByFooter />`.
   *
   * This prevents a future developer from adding a new loading-state branch
   * and forgetting the disclaimer footer.
   */
  it("every loading-guard return block renders <PoweredByFooter />", () => {
    const violations: string[] = [];
    const filePaths = pageFilesWithFooterImport();

    // Sanity-check: the helper must find at least one page file.
    expect(filePaths.length).toBeGreaterThan(0);

    for (const filePath of filePaths) {
      const source = readFileSync(filePath, "utf-8");
      const fileName = path.basename(filePath);
      const blocks = loadingBranchReturnBlocks(source);

      for (const block of blocks) {
        if (!block.includes("PoweredByFooter")) {
          violations.push(
            `${fileName}: a loading-guard return block is missing <PoweredByFooter />`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  /**
   * Companion check: a page file that imports PoweredByFooter must also render
   * it at least once.  An import with no usage means the footer was removed
   * from every branch — either a regression or a dead import.
   */
  it("every page that imports PoweredByFooter renders it at least once", () => {
    const violations: string[] = [];
    const filePaths = pageFilesWithFooterImport();

    for (const filePath of filePaths) {
      const source = readFileSync(filePath, "utf-8");
      if (!source.includes("<PoweredByFooter")) {
        violations.push(
          `${path.basename(filePath)}: imports PoweredByFooter but never renders it`,
        );
      }
    }

    expect(violations).toEqual([]);
  });

  /**
   * Coverage check: files with loading guards must actually have those guards
   * covered by the test above (i.e. `loadingBranchReturnBlocks` must find at
   * least one block in files known to have loading early-returns).
   *
   * Listed files are those the task identified as having loading-guard branches.
   * If a file is refactored to remove all loading guards, remove it from this list.
   */
  it("loading-branch detection finds at least one block in each known page with loading states", () => {
    const knownLoadingPages = [
      "landing.tsx",
      "result.tsx",
      "pdf-conversion.tsx",
      "pdf-upload.tsx",
      "course-form.tsx",
      "tool-form.tsx",
      "tool-selection.tsx",
      "admin-dashboard.tsx",
      "pdf-history.tsx",
    ];

    const violations: string[] = [];

    for (const fileName of knownLoadingPages) {
      const filePath = path.join(PAGES_DIR, fileName);
      const source = readFileSync(filePath, "utf-8");
      const blocks = loadingBranchReturnBlocks(source);

      if (blocks.length === 0) {
        violations.push(
          `${fileName}: expected loading-guard return blocks but none were found — ` +
            "either the file was refactored or LOADING_VAR_PATTERN needs updating",
        );
      }
    }

    expect(violations).toEqual([]);
  });
});

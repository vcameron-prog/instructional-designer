/**
 * Shared vi.mock() factory for "./lib/accessibility-engine".
 *
 * Why this exists: several route test files fully replace the accessibility
 * engine module with `vi.mock(...)`, hand-listing only the exports each test
 * currently needs. When `server/routes.ts` starts calling a *new* export
 * from that module, every test file whose mock omits it throws
 * `TypeError: X is not a function` at runtime — which surfaces as a
 * confusing 500/503 instead of a clear "your mock is missing an export"
 * message.
 *
 * Using `createAccessibilityEngineMock()` instead of a hand-rolled object
 * guarantees every mock includes every export currently used by
 * `server/routes.ts`. When a new export is added to routes.ts, add it here
 * ONCE and every test file automatically picks it up. The coverage test in
 * `accessibility-engine-mock.coverage.test.ts` fails loudly if this list
 * ever drifts out of sync with what routes.ts actually imports/uses, or if
 * a test file bypasses the factory with a hand-rolled mock object that is
 * missing a required export.
 */
import { vi } from "vitest";

/**
 * Every export from "./lib/accessibility-engine" that `server/routes.ts`
 * references, either via the static top-level import or via one of its
 * `await import("./lib/accessibility-engine")` dynamic imports.
 *
 * Kept in sync by `server/lib/accessibility-engine-mock.coverage.test.ts`,
 * which asserts this list is a superset of what routes.ts actually uses.
 */
export const ACCESSIBILITY_ENGINE_EXPORTS_USED_BY_ROUTES = [
  "getDeterministicFixerKeys",
  "getAiFixRetryMetrics",
  "getPersistAiFixRetryLastFailed",
  "applyHeadingHierarchyFix",
  "generateAccessibleDocument",
  "evaluateOriginalDocument",
  "fixComplianceIssue",
  "fixAllAriaRoleMisuse",
  "buildComplianceReport",
] as const;

export type AccessibilityEngineMockOverrides = Partial<
  Record<string, unknown>
>;

/**
 * Builds a mock module object for "./lib/accessibility-engine" that always
 * includes a safe default for every export routes.ts uses. Pass `overrides`
 * to customize/spy on specific functions for a given test file; anything
 * not overridden falls back to an inert default so route registration and
 * unrelated code paths never crash with "is not a function".
 */
export function createAccessibilityEngineMock(
  overrides: AccessibilityEngineMockOverrides = {},
) {
  return {
    getDeterministicFixerKeys: () => [],
    getAiFixRetryMetrics: () => ({ count: 0, lastAt: null }),
    getPersistAiFixRetryLastFailed: vi.fn().mockReturnValue(false),
    applyHeadingHierarchyFix: (html: string) => html,
    applyAriaComboboxRoleFix: (html: string) => html,
    applyAriaGridRoleFix: (html: string) => html,
    applyAriaTabRoleFix: (html: string) => html,
    generateAccessibleDocument: vi.fn(),
    evaluateOriginalDocument: vi.fn(),
    fixComplianceIssue: vi.fn(),
    fixAllAriaRoleMisuse: vi.fn(),
    buildComplianceReport: vi.fn((issues: unknown[]) => ({ issues })),
    registerDeterministicFixer: vi.fn(),
    ...overrides,
  };
}

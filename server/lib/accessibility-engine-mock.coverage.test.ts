/**
 * Guards against the failure mode described in the task: route test files
 * that fully replace "./lib/accessibility-engine" with vi.mock(...) can
 * silently drift out of sync with the real module. When server/routes.ts
 * starts calling a new export, any test file whose mock omits it throws a
 * confusing `TypeError: X is not a function` at runtime instead of a clear
 * "your mock is stale" message.
 *
 * This test asserts, statically:
 *  1. Every export in ACCESSIBILITY_ENGINE_EXPORTS_USED_BY_ROUTES actually
 *     exists on the real "./accessibility-engine" module (catches typos /
 *     renamed exports in the tracked list itself).
 *  2. Every export server/routes.ts actually imports/uses from
 *     "./lib/accessibility-engine" (parsed from its source, both the static
 *     import and its `await import(...)` destructures) is present in
 *     ACCESSIBILITY_ENGINE_EXPORTS_USED_BY_ROUTES. If routes.ts starts using
 *     a new export, this fails until the shared list (and therefore the
 *     shared mock factory) is updated.
 *  3. The shared mock factory's default output includes every tracked
 *     export as a real, callable stand-in.
 *  4. Every test file that mocks "./lib/accessibility-engine" either uses
 *     the shared factory, or (if it hand-rolls the mock object) includes
 *     every tracked export as a key — so a hand-rolled mock can't silently
 *     fall behind.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import * as accessibilityEngine from "./accessibility-engine.js";
import {
  ACCESSIBILITY_ENGINE_EXPORTS_USED_BY_ROUTES,
  createAccessibilityEngineMock,
} from "../test-utils/accessibility-engine-mock";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = join(__dirname, "..");
const routesSource = readFileSync(join(serverDir, "routes.ts"), "utf-8");

/**
 * Extracts every identifier destructured from an
 * `import { a, b } from "./lib/accessibility-engine"` or
 * `await import("./lib/accessibility-engine")` in the given source text.
 */
function extractAccessibilityEngineImports(source: string): string[] {
  const names = new Set<string>();

  const staticImportRe =
    /import\s*\{([^}]+)\}\s*from\s*["']\.\/lib\/accessibility-engine(?:\.js)?["']/g;
  for (const match of source.matchAll(staticImportRe)) {
    for (const raw of match[1].split(",")) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (name) names.add(name);
    }
  }

  const dynamicImportRe =
    /const\s*\{([^}]+)\}\s*=\s*await\s*import\(\s*["']\.\/lib\/accessibility-engine(?:\.js)?["']\s*\)/g;
  for (const match of source.matchAll(dynamicImportRe)) {
    for (const raw of match[1].split(",")) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (name) names.add(name);
    }
  }

  return Array.from(names);
}

describe("accessibility-engine mock coverage", () => {
  it("tracks only exports that really exist on the accessibility-engine module", () => {
    for (const name of ACCESSIBILITY_ENGINE_EXPORTS_USED_BY_ROUTES) {
      expect(
        (accessibilityEngine as Record<string, unknown>)[name],
        `Tracked export "${name}" does not exist on ./lib/accessibility-engine — update the tracked list.`,
      ).toBeDefined();
    }
  });

  it("tracks every export that server/routes.ts actually imports from accessibility-engine", () => {
    const actuallyUsed = extractAccessibilityEngineImports(routesSource);
    expect(actuallyUsed.length).toBeGreaterThan(0);

    const missing = actuallyUsed.filter(
      (name) => !ACCESSIBILITY_ENGINE_EXPORTS_USED_BY_ROUTES.includes(name as any),
    );
    expect(
      missing,
      `server/routes.ts now uses these accessibility-engine exports that are ` +
        `missing from ACCESSIBILITY_ENGINE_EXPORTS_USED_BY_ROUTES in ` +
        `server/test-utils/accessibility-engine-mock.ts. Add them there so every ` +
        `test mock picks them up: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("the shared mock factory provides a callable/defined stand-in for every tracked export", () => {
    const mock = createAccessibilityEngineMock();
    for (const name of ACCESSIBILITY_ENGINE_EXPORTS_USED_BY_ROUTES) {
      expect(
        (mock as Record<string, unknown>)[name],
        `createAccessibilityEngineMock() is missing a default for "${name}".`,
      ).toBeDefined();
    }
  });

  it("every route test file mocking accessibility-engine covers all tracked exports", () => {
    const files = readdirSync(serverDir).filter(
      (f) => f.endsWith(".test.ts") && f !== "lib",
    );

    const offenders: string[] = [];

    for (const file of files) {
      const fullPath = join(serverDir, file);
      let source: string;
      try {
        source = readFileSync(fullPath, "utf-8");
      } catch {
        continue;
      }

      if (!/vi\.mock\(\s*["']\.\/lib\/accessibility-engine(?:\.js)?["']/.test(source)) {
        continue;
      }

      if (source.includes("createAccessibilityEngineMock")) {
        // Uses the shared factory — automatically in sync by construction.
        continue;
      }

      // Hand-rolled mock: every vi.mock("./lib/accessibility-engine", () => ({ ... }))
      // block must list every tracked export as a key.
      const blockRe =
        /vi\.mock\(\s*["']\.\/lib\/accessibility-engine(?:\.js)?["']\s*,\s*\(\)\s*=>\s*\(\{([\s\S]*?)\}\)\s*\)/g;
      for (const match of source.matchAll(blockRe)) {
        const body = match[1];
        const missing = ACCESSIBILITY_ENGINE_EXPORTS_USED_BY_ROUTES.filter(
          (name) => !new RegExp(`(^|[\\s,{])${name}\\s*:`).test(body),
        );
        if (missing.length > 0) {
          offenders.push(`${file}: missing ${missing.join(", ")}`);
        }
      }
    }

    expect(
      offenders,
      `These test files hand-roll a "./lib/accessibility-engine" mock that is ` +
        `missing exports used by server/routes.ts. Use createAccessibilityEngineMock() ` +
        `from server/test-utils/accessibility-engine-mock.ts instead:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

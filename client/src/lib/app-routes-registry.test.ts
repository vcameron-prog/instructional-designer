/**
 * Structural test: verifies that every <Route> element in App.tsx with a
 * `path` prop comes exclusively from the ROUTES.map() registry loop.
 *
 * A developer cannot sneak in a route by writing <Route path="/foo"> (or any
 * expression form) outside the registry without this test failing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const APP_TSX = resolve(__dirname, "..", "App.tsx");

// Use createRequire so we can load CJS packages (@babel/parser) from ESM test.
const require = createRequire(pathToFileURL(__filename).href);

// ---------------------------------------------------------------------------
// Minimal recursive AST walk — no @babel/traverse dep required.
// Returns the accumulated array for chaining.
// ---------------------------------------------------------------------------
type Node = Record<string, unknown>;

function walk(
  node: Node,
  ancestors: Node[],
  visit: (node: Node, ancestors: Node[]) => void
): void {
  if (!node || typeof node !== "object") return;
  visit(node, ancestors);
  const next = [...ancestors, node];
  for (const key of Object.keys(node)) {
    const child = node[key] as Node | Node[];
    if (Array.isArray(child)) {
      child.forEach((c) => c && typeof c === "object" && (c as Node).type && walk(c as Node, next, visit));
    } else if (child && typeof child === "object" && (child as Node).type) {
      walk(child as Node, next, visit);
    }
  }
}

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

function parseAppTsx() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { parse } = require("@babel/parser") as typeof import("@babel/parser");
  const src = readFileSync(APP_TSX, "utf8");
  return parse(src, { sourceType: "module", plugins: ["jsx", "typescript"] });
}

function isInsideRoutesMap(ancestors: Node[]): boolean {
  return ancestors.some((a) => {
    if (a.type !== "CallExpression") return false;
    const callee = a.callee as Node | undefined;
    if (!callee || callee.type !== "MemberExpression") return false;
    const obj = callee.object as Node | undefined;
    const prop = callee.property as Node | undefined;
    return (
      obj?.type === "Identifier" &&
      (obj as { name?: string }).name === "ROUTES" &&
      prop?.type === "Identifier" &&
      (prop as { name?: string }).name === "map"
    );
  });
}

interface RouteInfo {
  hasPath: boolean;
  inRoutesMap: boolean;
  line: number;
}

function collectRouteNodes(): RouteInfo[] {
  const ast = parseAppTsx() as Node;
  const results: RouteInfo[] = [];

  walk(ast, [], (node, ancestors) => {
    if (node.type !== "JSXOpeningElement") return;
    const nameNode = node.name as Node | undefined;
    if (!nameNode || nameNode.type !== "JSXIdentifier") return;
    if ((nameNode as { name?: string }).name !== "Route") return;

    const attrs = (node.attributes as Node[]) ?? [];
    const hasPath = attrs.some(
      (a) =>
        a.type === "JSXAttribute" &&
        (a.name as Node | undefined)?.type === "JSXIdentifier" &&
        ((a.name as { name?: string }).name) === "path"
    );

    const loc = (node.loc as { start?: { line: number } } | undefined)?.start;
    results.push({
      hasPath,
      inRoutesMap: isInsideRoutesMap(ancestors),
      line: loc?.line ?? 0,
    });
  });

  return results;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("App.tsx ROUTES registry exhaustiveness (AST)", () => {
  it("the ROUTES array exists in App.tsx", () => {
    const src = readFileSync(APP_TSX, "utf8");
    expect(src).toContain("const ROUTES:");
  });

  it("every <Route path=...> element is inside the ROUTES.map() callback — not hardcoded outside the registry", () => {
    const routes = collectRouteNodes();

    // Every Route element that has a path prop must be inside ROUTES.map().
    // If it's outside, it's an unregistered route bypassing the registry.
    const unguarded = routes.filter((r) => r.hasPath && !r.inRoutesMap);

    expect(
      unguarded,
      unguarded.length > 0
        ? `Found ${unguarded.length} <Route path=...> element(s) outside ROUTES.map() at line(s): ${unguarded.map((r) => r.line).join(", ")}. Move them into the ROUTES array in App.tsx.`
        : ""
    ).toHaveLength(0);
  });

  it("exactly one <Route> without a path prop exists (the NotFound catch-all) and it is outside ROUTES.map()", () => {
    const routes = collectRouteNodes();

    const catchAlls = routes.filter((r) => !r.hasPath && !r.inRoutesMap);
    expect(
      catchAlls,
      `Expected exactly one catch-all <Route> (no path) outside ROUTES.map(), found ${catchAlls.length}`
    ).toHaveLength(1);
  });

  it("no <Route> without a path prop appears inside ROUTES.map() (every registered route must declare a path)", () => {
    const routes = collectRouteNodes();

    const pathlessInMap = routes.filter((r) => !r.hasPath && r.inRoutesMap);
    expect(
      pathlessInMap,
      pathlessInMap.length > 0
        ? `Found ${pathlessInMap.length} <Route> element(s) inside ROUTES.map() that have no path attribute at line(s): ${pathlessInMap.map((r) => r.line).join(", ")}.`
        : ""
    ).toHaveLength(0);
  });

  it("every entry in the ROUTES array has requiresAuth explicitly defined", async () => {
    // ROUTES is now derived from ROUTE_VISIBILITY via .map(), so object
    // literals with requiresAuth live in route-visibility.ts, not inline in
    // App.tsx.  Import and verify the canonical registry directly.
    const { ROUTE_VISIBILITY } = await import("./route-visibility");

    expect(ROUTE_VISIBILITY.length).toBeGreaterThan(0);

    for (const entry of ROUTE_VISIBILITY) {
      expect(
        typeof entry.requiresAuth,
        `Route "${entry.path}" is missing a boolean requiresAuth field`
      ).toBe("boolean");
    }
  });

  it("every path in the ROUTES array is unique (no duplicate registrations)", async () => {
    // Paths live in the ROUTE_VISIBILITY registry — check uniqueness there.
    const { ROUTE_VISIBILITY } = await import("./route-visibility");

    const paths = ROUTE_VISIBILITY.map((r) => r.path);
    expect(paths.length).toBeGreaterThan(0);

    const uniquePaths = new Set(paths);
    expect(
      uniquePaths.size,
      `Duplicate path(s) in ROUTE_VISIBILITY: ${paths
        .filter((p, i) => paths.indexOf(p) !== i)
        .join(", ")}`
    ).toBe(paths.length);
  });
});

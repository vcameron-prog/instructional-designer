import { describe, it, expect, vi, beforeEach } from "vitest";
import { pushFilterState } from "./nav-utils";

// ---------------------------------------------------------------------------
// pushFilterState — unit tests
//
// The function reads window.location.pathname and calls
// window.history.replaceState, so we stub both before each test.
// ---------------------------------------------------------------------------

function setupWindow(pathname: string) {
  vi.stubGlobal("window", {
    location: { pathname },
    history: { replaceState: vi.fn() },
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Empty params → strip query string
// ---------------------------------------------------------------------------

describe("pushFilterState — empty params", () => {
  it("calls replaceState with only the pathname when given an empty URLSearchParams", () => {
    setupWindow("/history");
    pushFilterState(new URLSearchParams());
    expect(window.history.replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/history",
    );
  });

  it("calls replaceState with only the pathname when given an empty plain object", () => {
    setupWindow("/quick-tools");
    pushFilterState({});
    expect(window.history.replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/quick-tools",
    );
  });

  it("does not append a '?' when params are empty", () => {
    setupWindow("/history");
    pushFilterState(new URLSearchParams());
    const [, , url] = (window.history.replaceState as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [unknown, unknown, string];
    expect(url).not.toContain("?");
  });
});

// ---------------------------------------------------------------------------
// Non-empty params → appends correct query string
// ---------------------------------------------------------------------------

describe("pushFilterState — non-empty params", () => {
  it("appends a single key/value pair from a plain object", () => {
    setupWindow("/history");
    pushFilterState({ tool: "assignment" });
    expect(window.history.replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/history?tool=assignment",
    );
  });

  it("appends multiple key/value pairs from a plain object", () => {
    setupWindow("/history");
    pushFilterState({ tool: "rubric", sort: "desc" });
    const [, , url] = (window.history.replaceState as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [unknown, unknown, string];
    const parsed = new URLSearchParams(url.split("?")[1]);
    expect(parsed.get("tool")).toBe("rubric");
    expect(parsed.get("sort")).toBe("desc");
  });

  it("appends key/value pairs from a URLSearchParams instance", () => {
    setupWindow("/history");
    const params = new URLSearchParams({ search: "intro biology" });
    pushFilterState(params);
    expect(window.history.replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/history?search=intro+biology",
    );
  });

  it("URL-encodes special characters in values", () => {
    setupWindow("/history");
    pushFilterState({ q: "a&b=c" });
    const [, , url] = (window.history.replaceState as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [unknown, unknown, string];
    const parsed = new URLSearchParams(url.split("?")[1]);
    expect(parsed.get("q")).toBe("a&b=c");
  });
});

// ---------------------------------------------------------------------------
// Path always comes from window.location.pathname — never hard-coded
// ---------------------------------------------------------------------------

describe("pushFilterState — pathname derived from window.location", () => {
  it("uses the current pathname, not a hard-coded route", () => {
    setupWindow("/some/dynamic/path");
    pushFilterState({ page: "2" });
    const [, , url] = (window.history.replaceState as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [unknown, unknown, string];
    expect(url.startsWith("/some/dynamic/path")).toBe(true);
  });

  it("uses '/' as the pathname when window.location.pathname is the root", () => {
    setupWindow("/");
    pushFilterState({ tool: "syllabus" });
    expect(window.history.replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/?tool=syllabus",
    );
  });

  it("switches pathname correctly between calls", () => {
    setupWindow("/history");
    pushFilterState({ tool: "assignment" });
    expect(window.history.replaceState).toHaveBeenLastCalledWith(
      null,
      "",
      "/history?tool=assignment",
    );

    setupWindow("/quick-tools");
    pushFilterState({ tool: "rubric" });
    expect(window.history.replaceState).toHaveBeenLastCalledWith(
      null,
      "",
      "/quick-tools?tool=rubric",
    );
  });
});

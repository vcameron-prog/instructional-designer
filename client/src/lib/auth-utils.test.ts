import { describe, it, expect } from "vitest";
import { buildLoginRedirectUrl } from "./auth-utils";

describe("buildLoginRedirectUrl", () => {
  it("returns the correct URL for a simple path with no query string", () => {
    const url = buildLoginRedirectUrl("/dashboard", "");
    expect(url).toBe("/api/login?returnTo=%2Fdashboard");
  });

  it("returns the correct URL for the root path", () => {
    const url = buildLoginRedirectUrl("/", "");
    expect(url).toBe("/api/login?returnTo=%2F");
  });

  it("percent-encodes a path that contains spaces", () => {
    const url = buildLoginRedirectUrl("/my courses", "");
    expect(url).toBe("/api/login?returnTo=%2Fmy%20courses");
  });

  it("includes the query string in the returnTo value", () => {
    const url = buildLoginRedirectUrl("/search", "?q=accessibility&page=2");
    expect(url).toBe("/api/login?returnTo=%2Fsearch%3Fq%3Daccessibility%26page%3D2");
  });

  it("percent-encodes special characters in the path", () => {
    const url = buildLoginRedirectUrl("/courses/intro-to-design&innovation", "");
    expect(url).toBe("/api/login?returnTo=%2Fcourses%2Fintro-to-design%26innovation");
  });

  it("handles a path with multiple segments", () => {
    const url = buildLoginRedirectUrl("/admin/stats/users", "");
    expect(url).toBe("/api/login?returnTo=%2Fadmin%2Fstats%2Fusers");
  });

  it("includes both path and query string together in returnTo", () => {
    const url = buildLoginRedirectUrl("/conversions", "?tab=history&sort=desc");
    const returnTo = decodeURIComponent(url.replace("/api/login?returnTo=", ""));
    expect(returnTo).toBe("/conversions?tab=history&sort=desc");
  });

  it("the returnTo value round-trips through encodeURIComponent / decodeURIComponent", () => {
    const pathname = "/courses/ENG 101: Writing & Rhetoric";
    const search = "?section=2&instructor=O'Brien";
    const url = buildLoginRedirectUrl(pathname, search);
    const encoded = url.replace("/api/login?returnTo=", "");
    expect(decodeURIComponent(encoded)).toBe(pathname + search);
  });

  it("does not include a hash fragment (hash is client-only and must be omitted)", () => {
    const url = buildLoginRedirectUrl("/dashboard", "");
    expect(url).not.toContain("#");
  });

  it("returns a URL that starts with /api/login?returnTo=", () => {
    const url = buildLoginRedirectUrl("/any/path", "?foo=bar");
    expect(url.startsWith("/api/login?returnTo=")).toBe(true);
  });

  it("produces a returnTo value that is a single percent-encoded component (no unencoded & or ?)", () => {
    const url = buildLoginRedirectUrl("/page", "?a=1&b=2");
    const returnTo = url.replace("/api/login?returnTo=", "");
    expect(returnTo).not.toContain("&");
    expect(returnTo).not.toContain("?");
  });
});

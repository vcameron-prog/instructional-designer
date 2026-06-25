// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("wouter", () => ({
  useLocation: vi.fn(() => ["/settings", vi.fn()]),
}));

import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { ProtectedRoute } from "./protected-route";
import { buildLoginRedirectUrl } from "@/lib/auth-utils";

function DummyPage() {
  return <div data-testid="protected-content">Protected content</div>;
}

describe("buildLoginRedirectUrl", () => {
  it("preserves path and query string in the returnTo parameter", () => {
    const url = buildLoginRedirectUrl("/settings", "?tab=notifications");
    expect(url).toBe(
      `/api/login?returnTo=${encodeURIComponent("/settings?tab=notifications")}`,
    );
  });

  it("handles paths with no query string", () => {
    const url = buildLoginRedirectUrl("/admin", "");
    expect(url).toBe(`/api/login?returnTo=${encodeURIComponent("/admin")}`);
  });
});

describe("ProtectedRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state while auth check is in-flight and hides page content", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isLoading: true,
      isAuthenticated: false,
      logout: vi.fn(),
      isLoggingOut: false,
    });

    render(<ProtectedRoute component={DummyPage} />);

    expect(screen.queryByTestId("protected-content")).toBeNull();
  });

  it("renders the wrapped component when the user is authenticated", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: "1", email: "faculty@bridgew.edu" } as any,
      isLoading: false,
      isAuthenticated: true,
      logout: vi.fn(),
      isLoggingOut: false,
    });

    render(<ProtectedRoute component={DummyPage} />);

    expect(screen.getByTestId("protected-content")).toBeInTheDocument();
  });

  it("hides page content and redirects to login when the user is not authenticated", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isLoading: false,
      isAuthenticated: false,
      logout: vi.fn(),
      isLoggingOut: false,
    });
    vi.mocked(useLocation).mockReturnValue(["/settings", vi.fn()]);

    let capturedHref = "";
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        pathname: "/settings",
        search: "",
        get href() {
          return capturedHref;
        },
        set href(val: string) {
          capturedHref = val;
        },
      },
    });

    await act(async () => {
      render(<ProtectedRoute component={DummyPage} />);
    });

    // The component must not expose protected content while redirecting.
    expect(screen.queryByTestId("protected-content")).toBeNull();
    // The redirect must target the login URL with returnTo set to the current path.
    const expected = buildLoginRedirectUrl("/settings", "");
    expect(capturedHref).toBe(expected);
  });
});

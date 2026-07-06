// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("wouter", () => ({
  useLocation: vi.fn(() => ["/settings", vi.fn()]),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/components/header-controls", () => ({
  HeaderControls: () => null,
}));

import { useAuth } from "@/hooks/use-auth";
import { ThemeProvider } from "@/components/theme-provider";
import SettingsPage from "./settings";

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SettingsPage />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe("Settings page - save-failed indicator dismiss button", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    vi.mocked(useAuth).mockReturnValue({
      user: { id: "1", email: "faculty@bridgew.edu" } as any,
      isLoading: false,
      isAuthenticated: true,
      logout: vi.fn(),
      isLoggingOut: false,
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("shows the retry button on a failed save, then dismisses back to synced state without a new request", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/preferences" && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      if (url === "/api/preferences" && init?.method === "PATCH") {
        return new Response(JSON.stringify({ message: "Server error" }), { status: 500 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    renderSettings();

    await waitFor(() => {
      expect(screen.getByTestId("status-sync")).toBeInTheDocument();
    });

    const toggle = screen.getByTestId("checkbox-settings-auto-expand");
    await user.click(toggle);

    await waitFor(() => {
      expect(screen.getByTestId("status-sync-error")).toHaveTextContent("Save failed");
    });
    expect(screen.getByTestId("button-retry-save")).toBeInTheDocument();

    const callCountAfterFailure = fetchMock.mock.calls.length;

    await user.click(screen.getByTestId("button-dismiss-save-error"));

    await waitFor(() => {
      expect(screen.queryByTestId("status-sync-error")).toBeNull();
    });
    expect(screen.getByText("Synced to your account")).toBeInTheDocument();
    expect(screen.queryByTestId("button-retry-save")).toBeNull();
    expect(screen.queryByTestId("button-dismiss-save-error")).toBeNull();

    expect(fetchMock.mock.calls.length).toBe(callCountAfterFailure);
  });
});

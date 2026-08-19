// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("wouter", () => ({
  useParams: vi.fn(() => ({ id: "42" })),
  useLocation: vi.fn(() => ["/pdf-accessibility/42", vi.fn()]),
  Link: ({ children }: { children: unknown }) => children,
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: vi.fn(() => ({
    user: { id: "1", email: "faculty@bridgew.edu" },
    isAuthenticated: true,
    isLoading: false,
  })),
}));

vi.mock("@/components/header-controls", () => ({
  ConverterHeader: () => null,
  HeaderControls: () => null,
}));

import PdfConversion from "./pdf-conversion";

const base = {
  id: 42,
  originalFilename: "lecture-notes.pdf",
  sourceType: "pdf",
  createdAt: "2026-06-01T12:00:00.000Z",
};

const processing = {
  ...base,
  status: "processing",
  accessibleHtml: null,
  complianceReport: null,
};

const completed = {
  ...base,
  status: "completed",
  accessibleHtml: "<html><body><h1>Title</h1><p>Content</p></body></html>",
  complianceReport: { issues: [] },
};

const failed = {
  ...base,
  status: "failed",
  accessibleHtml: null,
  complianceReport: null,
};

function renderPage(conversion: any) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(["/api/conversions", 42], conversion);
  queryClient.setQueryData(["/api/deterministic-fixers"], { keys: [] });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <PdfConversion />
    </QueryClientProvider>,
  );
  return { queryClient, ...utils };
}

function setStatus(queryClient: QueryClient, conversion: any) {
  act(() => {
    queryClient.setQueryData(["/api/conversions", 42], conversion);
  });
}

describe("PdfConversion - screen reader completion announcement", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
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
  });

  it("renders a persistent polite status region that is empty while processing", async () => {
    renderPage(processing);
    const region = await screen.findByTestId("status-completion-announcement");
    expect(region).toHaveAttribute("role", "status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region.textContent).toBe("");
  });

  it("announces completion when status transitions from processing to completed", async () => {
    const { queryClient } = renderPage(processing);
    await screen.findByTestId("status-completion-announcement");
    setStatus(queryClient, completed);
    await waitFor(() => {
      expect(
        screen.getByTestId("status-completion-announcement").textContent,
      ).toContain("Document processing complete");
    });
  });

  it("announces failure when status transitions from processing to failed", async () => {
    const { queryClient } = renderPage(processing);
    await screen.findByTestId("status-completion-announcement");
    setStatus(queryClient, failed);
    await waitFor(() => {
      expect(
        screen.getByTestId("status-completion-announcement").textContent,
      ).toContain("Document processing failed");
    });
  });

  it("does not announce completion when the page loads with an already-completed conversion", async () => {
    renderPage(completed);
    const region = await screen.findByTestId("status-completion-announcement");
    expect(region.textContent).toBe("");
  });

  it("clears the announcement during reprocessing and announces again on the second completion", async () => {
    const { queryClient } = renderPage(processing);
    await screen.findByTestId("status-completion-announcement");

    // First completion
    setStatus(queryClient, completed);
    await waitFor(() => {
      expect(
        screen.getByTestId("status-completion-announcement").textContent,
      ).toContain("Document processing complete");
    });

    // Reprocessing clears the stale text so the next completion is a
    // fresh DOM change assistive technology will announce.
    setStatus(queryClient, processing);
    await waitFor(() => {
      expect(
        screen.getByTestId("status-completion-announcement").textContent,
      ).toBe("");
    });

    // Second completion announces again.
    setStatus(queryClient, completed);
    await waitFor(() => {
      expect(
        screen.getByTestId("status-completion-announcement").textContent,
      ).toContain("Document processing complete");
    });
  });
});

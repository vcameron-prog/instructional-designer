// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PAGE_TITLE_FALLBACK_NOTE, PAGE_TITLE_LOW_QUALITY_NOTE } from "@shared/page-title-messages";

vi.mock("wouter", () => ({
  useParams: vi.fn(() => ({ id: "42" })),
  useLocation: vi.fn(() => ["/pdf-accessibility/42", vi.fn()]),
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

function buildConversion(fixNotes: string) {
  return {
    id: 42,
    originalFilename: "syllabus.pdf",
    status: "completed",
    createdAt: "2026-06-01T12:00:00.000Z",
    accessibleHtml: "<html><body><h1>Title</h1><p>Content</p></body></html>",
    complianceReport: {
      issues: [
        {
          criterion: "2.4.2",
          title: "Page Titled",
          level: "A",
          status: "fixed",
          description: "Page has a title",
          details: "Title set",
          fixNotes,
        },
      ],
    },
  };
}

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
  return render(
    <QueryClientProvider client={queryClient}>
      <PdfConversion />
    </QueryClientProvider>,
  );
}

describe("PdfConversion results page - page title notes", () => {
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

  it("labels the generic-fallback note distinctly from a low-quality-title note", async () => {
    const user = userEvent.setup();
    renderPage(buildConversion(PAGE_TITLE_FALLBACK_NOTE));
    await waitFor(() => {
      expect(screen.getByTestId("issue-toggle-0")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("issue-toggle-0"));
    await waitFor(() => {
      expect(screen.getByTestId("page-title-fix-notes-0")).toBeInTheDocument();
    });
    expect(screen.getByTestId("page-title-fix-notes-0").textContent).toContain(
      "Generic Title Used",
    );
    expect(screen.getByTestId("page-title-fix-notes-text-0").textContent).toBe(
      PAGE_TITLE_FALLBACK_NOTE,
    );
  });

  it("labels the low-quality extracted title note distinctly from the generic-fallback note", async () => {
    const user = userEvent.setup();
    renderPage(buildConversion(PAGE_TITLE_LOW_QUALITY_NOTE));
    await waitFor(() => {
      expect(screen.getByTestId("issue-toggle-0")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("issue-toggle-0"));
    await waitFor(() => {
      expect(screen.getByTestId("page-title-fix-notes-0")).toBeInTheDocument();
    });
    expect(screen.getByTestId("page-title-fix-notes-0").textContent).toContain(
      "Title May Need Review",
    );
    expect(screen.getByTestId("page-title-fix-notes-text-0").textContent).toBe(
      PAGE_TITLE_LOW_QUALITY_NOTE,
    );
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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

const baseConversion = {
  id: 42,
  originalFilename: "syllabus.pdf",
  status: "completed",
  createdAt: "2026-06-01T12:00:00.000Z",
  accessibleHtml: "<html><body><h1>Title</h1><p>Content</p></body></html>",
  complianceReport: {
    issues: [
      {
        criterion: "2.4.6",
        title: "Headings and Labels",
        level: "AA",
        status: "pass",
        description: "Heading structure",
        details: "Headings were checked",
        fixNotes:
          "Heading levels were automatically renumbered: the document's topmost heading was an H2 instead of H1, so every heading was shifted by 1 level to close the gap and restore a valid hierarchy. Review the heading levels to confirm they still reflect your intended document structure.",
      },
      {
        criterion: "1.1.1",
        title: "Non-text Content",
        level: "A",
        status: "pass",
        description: "Images have alt text",
        details: "All images have alt text",
      },
    ],
  },
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
  return render(
    <QueryClientProvider client={queryClient}>
      <PdfConversion />
    </QueryClientProvider>,
  );
}

describe("PdfConversion results page - heading renumber banner", () => {
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

  it("shows a visible banner near the HTML preview when headings were auto-renumbered", async () => {
    renderPage(baseConversion);
    await waitFor(() => {
      expect(screen.getByTestId("heading-renumber-banner")).toBeInTheDocument();
    });
    expect(screen.getByTestId("heading-renumber-banner").textContent).toContain(
      "Heading levels were auto-renumbered.",
    );
  });

  it("does not show the banner when heading levels were not renumbered", async () => {
    const conversion = {
      ...baseConversion,
      complianceReport: {
        issues: [
          { ...baseConversion.complianceReport.issues[0], fixNotes: undefined },
          baseConversion.complianceReport.issues[1],
        ],
      },
    };
    renderPage(conversion);
    await waitFor(() => {
      expect(screen.getByTestId("html-preview")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("heading-renumber-banner")).not.toBeInTheDocument();
  });

  it("dismisses the banner and does not re-show it after dismissal", async () => {
    const user = userEvent.setup();
    renderPage(baseConversion);
    await waitFor(() => {
      expect(screen.getByTestId("heading-renumber-banner")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("button-dismiss-heading-renumber-banner"));
    expect(screen.queryByTestId("heading-renumber-banner")).not.toBeInTheDocument();
  });

  it("expands the matching compliance issue when 'View details' is clicked", async () => {
    const user = userEvent.setup();
    renderPage(baseConversion);
    await waitFor(() => {
      expect(screen.getByTestId("heading-renumber-banner")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("button-view-heading-renumber-note"));
    await waitFor(() => {
      expect(screen.getByTestId("heading-fix-notes-0")).toBeInTheDocument();
    });
  });
});

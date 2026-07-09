// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

const baseCompleted = {
  id: 42,
  originalFilename: "lecture-notes.pdf",
  status: "completed",
  sourceType: "pdf",
  createdAt: "2026-06-01T12:00:00.000Z",
  accessibleHtml: "<html><body><h1>Title</h1><p>Content</p></body></html>",
  complianceReport: { issues: [] },
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

describe("PdfConversion results page - download guidance callout", () => {
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

  it("shows the download guidance callout when status is completed (standard PDF)", async () => {
    renderPage(baseCompleted);
    await waitFor(() => {
      expect(screen.getByTestId("download-guidance")).toBeInTheDocument();
    });
    const guidance = screen.getByTestId("download-guidance");
    expect(guidance.textContent).toContain("Your converted file is ready to download.");
    expect(guidance.textContent).toContain("Word (.docx)");
    expect(guidance.textContent).toContain("Tagged PDF");
    expect(guidance.textContent).toContain("HTML");
  });

  it("shows the download guidance callout when status is completed for a DOCX source", async () => {
    renderPage({ ...baseCompleted, sourceType: "docx", originalFilename: "syllabus.docx" });
    await waitFor(() => {
      expect(screen.getByTestId("download-guidance")).toBeInTheDocument();
    });
  });

  it("shows the download guidance callout when status is completed for a Google Doc source", async () => {
    renderPage({ ...baseCompleted, sourceType: "google-doc", originalFilename: "my-doc.docx" });
    await waitFor(() => {
      expect(screen.getByTestId("download-guidance")).toBeInTheDocument();
    });
  });

  it("shows the download guidance callout when status is completed for a spreadsheet (xlsx)", async () => {
    renderPage({ ...baseCompleted, sourceType: "xlsx", originalFilename: "data.xlsx" });
    await waitFor(() => {
      expect(screen.getByTestId("download-guidance")).toBeInTheDocument();
    });
    const guidance = screen.getByTestId("download-guidance");
    expect(guidance.textContent).toContain("Your converted file is ready to download.");
  });

  it("shows the download guidance callout when status is completed for a Google Sheets source", async () => {
    renderPage({ ...baseCompleted, sourceType: "google-sheet", originalFilename: "sheet.xlsx" });
    await waitFor(() => {
      expect(screen.getByTestId("download-guidance")).toBeInTheDocument();
    });
  });

  it("does not show the download guidance callout when status is processing", async () => {
    renderPage({
      ...baseCompleted,
      status: "processing",
      accessibleHtml: null,
      complianceReport: null,
    });
    await waitFor(() => {
      expect(screen.queryByTestId("download-guidance")).not.toBeInTheDocument();
    });
  });

  it("does not show the download guidance callout when status is failed", async () => {
    renderPage({
      ...baseCompleted,
      status: "failed",
      accessibleHtml: null,
      complianceReport: null,
    });
    await waitFor(() => {
      expect(screen.queryByTestId("download-guidance")).not.toBeInTheDocument();
    });
  });

  it("shows the Accessible Excel download option only for spreadsheet conversions", async () => {
    const user = userEvent.setup();
    renderPage({ ...baseCompleted, sourceType: "xlsx", originalFilename: "data.xlsx" });
    await waitFor(() => {
      expect(screen.getByTestId("download-guidance")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("button-download-as"));
    await waitFor(() => {
      expect(screen.getByTestId("menu-download-xlsx")).toBeInTheDocument();
    });
  });

  it("does not show the Accessible Excel download option for non-spreadsheet conversions", async () => {
    const user = userEvent.setup();
    renderPage(baseCompleted);
    await waitFor(() => {
      expect(screen.getByTestId("download-guidance")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("button-download-as"));
    await waitFor(() => {
      expect(screen.getByTestId("menu-download-html")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("menu-download-xlsx")).not.toBeInTheDocument();
  });

  it("guidance text does not reference Excel for non-spreadsheet conversions", async () => {
    renderPage(baseCompleted);
    await waitFor(() => {
      expect(screen.getByTestId("download-guidance")).toBeInTheDocument();
    });
    const guidance = screen.getByTestId("download-guidance");
    expect(guidance.textContent).not.toContain("Excel");
  });
});

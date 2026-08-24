// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import AccessibilityToolsPage from "./accessibility-tools";
import UrlScannerPage from "./url-scanner";
import ColorContrastPage from "./color-contrast";

const { apiRequest } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

vi.mock("@/lib/queryClient", () => ({ apiRequest }));
vi.mock("@/hooks/use-page-title", () => ({ usePageTitle: vi.fn() }));
vi.mock("@/components/header-controls", () => ({
  HeaderControls: () => null,
  BackButton: () => null,
}));
vi.mock("@/components/powered-by-footer", () => ({
  PoweredByFooter: () => null,
}));
vi.mock("wouter", () => ({ useLocation: () => ["/", vi.fn()] }));

function response(body: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(body),
  });
}

describe("limited-scope accessibility check language", () => {
  beforeEach(() => {
    apiRequest.mockReset();
  });

  it("qualifies the scanner and contrast tools on the landing page", () => {
    render(<AccessibilityToolsPage />);

    expect(screen.getByText(/AI-assisted automated check of selected accessibility issues/i)).toBeInTheDocument();
    expect(screen.getByText(/not a determination of overall WCAG conformance/i)).toBeInTheDocument();
    expect(screen.getByText(/Test one foreground\/background color combination/i)).toBeInTheDocument();
    expect(screen.getByText(/not an overall WCAG 2.1 conformance determination/i)).toBeInTheDocument();
  });

  it("frames scanner findings and score as limited automated checks", async () => {
    apiRequest.mockReturnValue(response({
      url: "https://example.com",
      score: 92,
      summary: "The automated checks completed.",
      issues: [],
      passed: ["Page has a title"],
    }));

    render(<UrlScannerPage />);
    fireEvent.change(screen.getByTestId("input-scan-url"), { target: { value: "https://example.com" } });
    fireEvent.click(screen.getByTestId("button-scan"));

    await waitFor(() => expect(screen.getByTestId("scan-results")).toBeInTheDocument());
    expect(screen.getByText("Score for automated checks performed")).toBeInTheDocument();
    expect(screen.getByText("No issues found by these checks")).toBeInTheDocument();
    expect(screen.getByText(/Automated Checks Passed/)).toBeInTheDocument();
    expect(screen.getByText(/not an overall WCAG 2.1 conformance determination/i)).toBeInTheDocument();
    expect(screen.queryByText(/accessibility score/i)).not.toBeInTheDocument();
  });

  it("labels reported scanner issues as findings from automated checks", async () => {
    apiRequest.mockReturnValue(response({
      url: "https://example.com",
      score: 55,
      summary: "The automated checks found an issue.",
      issues: [{
        title: "Missing page title",
        severity: "major",
        criterion: "2.4.2",
        description: "The page has no title.",
        recommendation: "Add a descriptive title.",
      }],
      passed: [],
    }));

    render(<UrlScannerPage />);
    fireEvent.change(screen.getByTestId("input-scan-url"), { target: { value: "https://example.com" } });
    fireEvent.click(screen.getByTestId("button-scan"));

    await waitFor(() => expect(screen.getByTestId("scan-results")).toBeInTheDocument());
    expect(screen.getByText("Issues Found by Automated Checks (1)")).toBeInTheDocument();
    expect(screen.getByText(/not an overall WCAG 2.1 conformance determination/i)).toBeInTheDocument();
  });

  it.each([
    {
      result: { ratio: 21, aa_normal: true, aa_large: true, aaa_normal: true, aaa_large: true },
      badge: "Meets AA Text Contrast",
    },
    {
      result: { ratio: 3.5, aa_normal: false, aa_large: true, aaa_normal: false, aaa_large: false },
      badge: "Meets AA for Large Text Only",
    },
    {
      result: { ratio: 2, aa_normal: false, aa_large: false, aaa_normal: false, aaa_large: false },
      badge: "Does Not Meet AA Text Contrast",
    },
  ])("keeps the '$badge' result specific to the tested criterion", async ({ result, badge }) => {
    apiRequest.mockReturnValue(response({
      ...result,
      foreground: "#000000",
      background: "#ffffff",
    }));

    render(<ColorContrastPage />);
    fireEvent.click(screen.getByTestId("button-check-contrast"));

    await waitFor(() => expect(screen.getByTestId("contrast-result")).toBeInTheDocument());
    expect(screen.getByTestId("badge-contrast-rating")).toHaveTextContent(badge);
    expect(screen.getByText("WCAG 2.1 Text Contrast Results")).toBeInTheDocument();
    expect(screen.getByText(/apply only to the tested foreground\/background contrast criterion/i)).toBeInTheDocument();
    expect(screen.queryByText("AA Pass")).not.toBeInTheDocument();
    expect(screen.queryByText("Fails WCAG")).not.toBeInTheDocument();
  });
});
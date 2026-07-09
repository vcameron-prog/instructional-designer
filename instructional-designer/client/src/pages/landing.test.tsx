// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";

// ── Asset stubs ──────────────────────────────────────────────────────────────
vi.mock("@assets/bsu-cai-logo.png", () => ({ default: "bsu-cai-logo.png" }));
vi.mock(
  "@assets/Center_for_AI_Apparel_&_Promotional_Items-WHITE_(1)_1775653892158.png",
  () => ({ default: "bsu-cai-logo-white.png" }),
);

// ── Icon stubs ───────────────────────────────────────────────────────────────
vi.mock("react-icons/si", () => ({ SiGoogle: () => null }));

// ── Component stubs ──────────────────────────────────────────────────────────
vi.mock("@/components/header-controls", () => ({
  HeaderControls: () => null,
}));
vi.mock("@/components/powered-by-footer", () => ({
  PoweredByFooter: () => null,
}));
vi.mock("@/components/loading-screen", () => ({
  LoadingScreen: () => <div data-testid="loading-screen" />,
}));
vi.mock("@/components/course-card", () => ({
  CourseCard: () => null,
}));

// ── Hook stubs ───────────────────────────────────────────────────────────────
vi.mock("@/hooks/use-page-title", () => ({ usePageTitle: () => undefined }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// ── Query stubs ──────────────────────────────────────────────────────────────
vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  queryClient: { invalidateQueries: vi.fn() },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(() => ({ data: [], isLoading: false })),
  useMutation: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}));

// ── Wouter stub ──────────────────────────────────────────────────────────────
const mockNavigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/", mockNavigate],
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── Auth hook stub ───────────────────────────────────────────────────────────
const mockUseAuth = vi.fn();
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => mockUseAuth(),
}));

// ── Import the page AFTER all mocks ─────────────────────────────────────────
import LandingPage from "./landing";

// ── Helpers ──────────────────────────────────────────────────────────────────
let hrefSpy: ReturnType<typeof vi.fn>;

function stubWindowHref() {
  hrefSpy = vi.fn();
  Object.defineProperty(window, "location", {
    value: { href: "" },
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window.location, "href", {
    get: () => "",
    set: hrefSpy,
    configurable: true,
  });
}

function renderBsuUser() {
  mockUseAuth.mockReturnValue({
    user: { email: "faculty@bridgew.edu", firstName: "Test", profileImageUrl: null },
    isLoading: false,
    isAuthenticated: true,
    logout: vi.fn(),
    isLoggingOut: false,
  });
  render(<LandingPage />);
}

function renderAnonymousUser() {
  mockUseAuth.mockReturnValue({
    user: null,
    isLoading: false,
    isAuthenticated: false,
    logout: vi.fn(),
    isLoggingOut: false,
  });
  render(<LandingPage />);
}

function renderNonBsuUser() {
  mockUseAuth.mockReturnValue({
    user: { email: "someone@gmail.com", firstName: "External", profileImageUrl: null },
    isLoading: false,
    isAuthenticated: true,
    logout: vi.fn(),
    isLoggingOut: false,
  });
  render(<LandingPage />);
}

beforeEach(() => {
  mockNavigate.mockReset();
  stubWindowHref();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("LandingPage — card-pdf-accessibility navigation", () => {

  describe("BSU signed-in branch", () => {
    it("renders the card-pdf-accessibility card", () => {
      renderBsuUser();
      expect(screen.getByTestId("card-pdf-accessibility")).toBeInTheDocument();
    });

    it("clicking the card sets window.location.href to /pdf-accessibility", () => {
      renderBsuUser();
      fireEvent.click(screen.getByTestId("card-pdf-accessibility"));
      expect(hrefSpy).toHaveBeenCalledWith("/pdf-accessibility");
    });

    it("does NOT call wouter navigate() when the card is clicked", () => {
      renderBsuUser();
      fireEvent.click(screen.getByTestId("card-pdf-accessibility"));
      expect(mockNavigate).not.toHaveBeenCalledWith("/pdf-accessibility");
    });

    it("pressing Enter on the card sets window.location.href to /pdf-accessibility", () => {
      renderBsuUser();
      fireEvent.keyDown(screen.getByTestId("card-pdf-accessibility"), { key: "Enter" });
      expect(hrefSpy).toHaveBeenCalledWith("/pdf-accessibility");
    });

    it("pressing Space on the card sets window.location.href to /pdf-accessibility", () => {
      renderBsuUser();
      fireEvent.keyDown(screen.getByTestId("card-pdf-accessibility"), { key: " " });
      expect(hrefSpy).toHaveBeenCalledWith("/pdf-accessibility");
    });

    it("pressing other keys on the card does NOT navigate", () => {
      renderBsuUser();
      fireEvent.keyDown(screen.getByTestId("card-pdf-accessibility"), { key: "Tab" });
      expect(hrefSpy).not.toHaveBeenCalled();
    });
  });

  describe("Anonymous (not signed in) branch", () => {
    it("renders the card-pdf-accessibility card", () => {
      renderAnonymousUser();
      expect(screen.getByTestId("card-pdf-accessibility")).toBeInTheDocument();
    });

    it("clicking the card sets window.location.href to /pdf-accessibility", () => {
      renderAnonymousUser();
      fireEvent.click(screen.getByTestId("card-pdf-accessibility"));
      expect(hrefSpy).toHaveBeenCalledWith("/pdf-accessibility");
    });

    it("does NOT call wouter navigate() when the card is clicked", () => {
      renderAnonymousUser();
      fireEvent.click(screen.getByTestId("card-pdf-accessibility"));
      expect(mockNavigate).not.toHaveBeenCalledWith("/pdf-accessibility");
    });

    it("pressing Enter on the card sets window.location.href to /pdf-accessibility", () => {
      renderAnonymousUser();
      fireEvent.keyDown(screen.getByTestId("card-pdf-accessibility"), { key: "Enter" });
      expect(hrefSpy).toHaveBeenCalledWith("/pdf-accessibility");
    });

    it("pressing Space on the card sets window.location.href to /pdf-accessibility", () => {
      renderAnonymousUser();
      fireEvent.keyDown(screen.getByTestId("card-pdf-accessibility"), { key: " " });
      expect(hrefSpy).toHaveBeenCalledWith("/pdf-accessibility");
    });
  });

  describe("Non-BSU signed-in branch", () => {
    it("renders the card-pdf-accessibility card", () => {
      renderNonBsuUser();
      expect(screen.getByTestId("card-pdf-accessibility")).toBeInTheDocument();
    });

    it("clicking the card sets window.location.href to /pdf-accessibility", () => {
      renderNonBsuUser();
      fireEvent.click(screen.getByTestId("card-pdf-accessibility"));
      expect(hrefSpy).toHaveBeenCalledWith("/pdf-accessibility");
    });

    it("does NOT call wouter navigate() when the card is clicked", () => {
      renderNonBsuUser();
      fireEvent.click(screen.getByTestId("card-pdf-accessibility"));
      expect(mockNavigate).not.toHaveBeenCalledWith("/pdf-accessibility");
    });

    it("pressing Enter on the card sets window.location.href to /pdf-accessibility", () => {
      renderNonBsuUser();
      fireEvent.keyDown(screen.getByTestId("card-pdf-accessibility"), { key: "Enter" });
      expect(hrefSpy).toHaveBeenCalledWith("/pdf-accessibility");
    });

    it("pressing Space on the card sets window.location.href to /pdf-accessibility", () => {
      renderNonBsuUser();
      fireEvent.keyDown(screen.getByTestId("card-pdf-accessibility"), { key: " " });
      expect(hrefSpy).toHaveBeenCalledWith("/pdf-accessibility");
    });
  });
});

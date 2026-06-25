// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { WelcomeModal } from "./welcome-modal";

const WELCOME_KEY = "bsu_id_welcome_shown";

const STEP_TITLES = [
  "Welcome to Accessibility Tool",
  "Enter Your Course Information",
  "Choose Your Design Tools",
  "Universal Design for Learning",
  "Review & Refine",
  "You're Ready!",
];

beforeEach(() => {
  localStorage.removeItem(WELCOME_KEY);
});

describe("WelcomeModal — accessibility", () => {
  it("renders the modal when welcome has not been shown yet", () => {
    render(<WelcomeModal />);
    expect(screen.getByTestId("dialog-welcome")).toBeInTheDocument();
  });

  it("does not render the modal when already dismissed", () => {
    localStorage.setItem(WELCOME_KEY, "true");
    render(<WelcomeModal />);
    expect(screen.queryByTestId("dialog-welcome")).not.toBeInTheDocument();
  });

  it("sr-only live region contains the correct step text on step 1", () => {
    render(<WelcomeModal />);
    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
    expect(liveRegion?.textContent).toContain("Step 1 of 6");
    expect(liveRegion?.textContent).toContain(STEP_TITLES[0]);
  });

  it("sr-only live region updates to correct step text after navigating forward", async () => {
    const user = userEvent.setup();
    render(<WelcomeModal />);

    const liveRegion = document.querySelector('[aria-live="polite"]');

    await user.click(screen.getByTestId("button-next-step"));
    expect(liveRegion?.textContent).toContain("Step 2 of 6");
    expect(liveRegion?.textContent).toContain(STEP_TITLES[1]);

    await user.click(screen.getByTestId("button-next-step"));
    expect(liveRegion?.textContent).toContain("Step 3 of 6");
    expect(liveRegion?.textContent).toContain(STEP_TITLES[2]);
  });

  it("focus moves to the primary action button after each step change", async () => {
    const user = userEvent.setup();
    render(<WelcomeModal />);

    const nextButton = screen.getByTestId("button-next-step");

    await user.click(nextButton);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId("button-next-step"));
    });

    await user.click(nextButton);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId("button-next-step"));
    });
  });

  it("pressing Escape closes the modal", async () => {
    const user = userEvent.setup();
    render(<WelcomeModal />);

    expect(screen.getByTestId("dialog-welcome")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByTestId("dialog-welcome")).not.toBeInTheDocument();
    });
  });

  it("after close via Escape, the dialog is gone from the DOM", async () => {
    const user = userEvent.setup();
    render(<WelcomeModal />);

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("Skip Tour button closes the modal and saves dismissal to localStorage", async () => {
    const user = userEvent.setup();
    render(<WelcomeModal />);

    await user.click(screen.getByTestId("button-skip-tour"));

    await waitFor(() => {
      expect(screen.queryByTestId("dialog-welcome")).not.toBeInTheDocument();
    });
    expect(localStorage.getItem(WELCOME_KEY)).toBe("true");
  });

  it("can navigate all 6 steps with keyboard clicks and complete the tour", async () => {
    const user = userEvent.setup();
    render(<WelcomeModal />);

    const liveRegion = document.querySelector('[aria-live="polite"]');

    for (let step = 0; step < 5; step++) {
      expect(liveRegion?.textContent).toContain(`Step ${step + 1} of 6`);
      expect(liveRegion?.textContent).toContain(STEP_TITLES[step]);
      await user.click(screen.getByTestId("button-next-step"));
    }

    expect(liveRegion?.textContent).toContain("Step 6 of 6");
    expect(liveRegion?.textContent).toContain(STEP_TITLES[5]);
    expect(screen.getByTestId("button-next-step")).toHaveTextContent("Get Started");

    await user.click(screen.getByTestId("button-next-step"));

    await waitFor(() => {
      expect(screen.queryByTestId("dialog-welcome")).not.toBeInTheDocument();
    });
    expect(localStorage.getItem(WELCOME_KEY)).toBe("true");
  });

  it("step indicator has accessible label describing current position", () => {
    render(<WelcomeModal />);
    const indicator = document.querySelector('[aria-label^="Step 1 of 6"]');
    expect(indicator).not.toBeNull();
  });

  it("primary button aria-label includes destination step title when not on last step", () => {
    render(<WelcomeModal />);
    const nextBtn = screen.getByTestId("button-next-step");
    const label = nextBtn.getAttribute("aria-label") ?? "";
    expect(label).toContain("step 2 of 6");
    expect(label).toContain(STEP_TITLES[1]);
  });

  it("primary button aria-label changes to close-tour description on last step", async () => {
    const user = userEvent.setup();
    render(<WelcomeModal />);

    for (let i = 0; i < 5; i++) {
      await user.click(screen.getByTestId("button-next-step"));
    }

    const nextBtn = screen.getByTestId("button-next-step");
    expect(nextBtn.getAttribute("aria-label")).toContain("close the welcome tour");
  });
});

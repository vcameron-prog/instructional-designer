// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { renderFAQAnswer } from "./faq-shared";

describe("renderFAQAnswer", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  let consoleWarn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    consoleError.mockRestore();
    consoleWarn.mockRestore();
  });

  describe("plain string", () => {
    it("returns the string as-is", () => {
      const result = renderFAQAnswer("Hello, world!");
      expect(result).toBe("Hello, world!");
    });

    it("returns an empty string as-is", () => {
      const result = renderFAQAnswer("");
      expect(result).toBe("");
    });

    it("renders correctly as a text node", () => {
      const { container } = render(<>{renderFAQAnswer("Plain text answer")}</>);
      expect(container).toHaveTextContent("Plain text answer");
    });
  });

  describe("string array", () => {
    it("returns a React element (not the raw array)", () => {
      const result = renderFAQAnswer(["Line one", "Line two"]);
      expect(React.isValidElement(result)).toBe(true);
    });

    it("renders each string as its own <p> element", () => {
      render(<>{renderFAQAnswer(["First line", "Second line", "Third line"])}</>);
      const paragraphs = screen.getAllByRole("paragraph");
      expect(paragraphs).toHaveLength(3);
      expect(paragraphs[0]).toHaveTextContent("First line");
      expect(paragraphs[1]).toHaveTextContent("Second line");
      expect(paragraphs[2]).toHaveTextContent("Third line");
    });

    it("applies ml-2 class to bullet lines starting with •", () => {
      const { container } = render(
        <>{renderFAQAnswer(["• Bullet item", "Normal item"])}</>
      );
      const paragraphs = container.querySelectorAll("p");
      expect(paragraphs[0]).toHaveClass("ml-2");
      expect(paragraphs[1]).not.toHaveClass("ml-2");
    });

    it("applies ml-2 class to ordered-list lines matching /^\\d+\\./", () => {
      const { container } = render(
        <>{renderFAQAnswer(["1. First step", "Plain line"])}</>
      );
      const paragraphs = container.querySelectorAll("p");
      expect(paragraphs[0]).toHaveClass("ml-2");
      expect(paragraphs[1]).not.toHaveClass("ml-2");
    });

    it("handles an empty array without error", () => {
      const { container } = render(<>{renderFAQAnswer([])}</>);
      expect(container.querySelectorAll("p")).toHaveLength(0);
    });
  });

  describe("ReactNode (pre-composed JSX element)", () => {
    it("returns the same element reference", () => {
      const node = <span data-testid="my-node">Custom JSX</span>;
      const result = renderFAQAnswer(node);
      expect(result).toBe(node);
    });

    it("renders the element in the DOM", () => {
      render(
        <>
          {renderFAQAnswer(
            <p data-testid="faq-paragraph">
              Visit{" "}
              <a href="https://example.com" data-testid="faq-link">
                example.com
              </a>
            </p>
          )}
        </>
      );
      expect(screen.getByTestId("faq-paragraph")).toBeInTheDocument();
      expect(screen.getByTestId("faq-link")).toHaveAttribute(
        "href",
        "https://example.com"
      );
    });

    it("renders a Fragment with multiple children", () => {
      render(
        <>
          {renderFAQAnswer(
            <>
              <p data-testid="part-a">Part A</p>
              <p data-testid="part-b">Part B</p>
            </>
          )}
        </>
      );
      expect(screen.getByTestId("part-a")).toHaveTextContent("Part A");
      expect(screen.getByTestId("part-b")).toHaveTextContent("Part B");
    });
  });

  describe("render function", () => {
    it("calls the function and returns its result", () => {
      const fn = vi.fn(() => <span data-testid="rendered">From function</span>);
      const result = renderFAQAnswer(fn);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(React.isValidElement(result)).toBe(true);
    });

    it("renders the function output in the DOM", () => {
      const fn = () => (
        <p data-testid="fn-output">Answer from render function</p>
      );
      render(<>{renderFAQAnswer(fn)}</>);
      expect(screen.getByTestId("fn-output")).toHaveTextContent(
        "Answer from render function"
      );
    });

    it("supports functions returning Fragments with links", () => {
      const fn = () => (
        <>
          <p data-testid="fn-text">See policy at</p>
          <a
            href="https://example.com/privacy"
            data-testid="fn-link"
          >
            Privacy Policy
          </a>
        </>
      );
      render(<>{renderFAQAnswer(fn)}</>);
      expect(screen.getByTestId("fn-text")).toBeInTheDocument();
      expect(screen.getByTestId("fn-link")).toHaveAttribute(
        "href",
        "https://example.com/privacy"
      );
    });

    it("supports the PRIVACY_ANSWER render function from faq-shared", async () => {
      const { PRIVACY_ANSWER } = await import("./faq-shared");
      render(<>{renderFAQAnswer(PRIVACY_ANSWER)}</>);
      expect(
        screen.getByText(/uploaded content is stored/i)
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: /anthropic.*privacy policy/i })
      ).toHaveAttribute("href", "https://www.anthropic.com/privacy");
    });
  });
});

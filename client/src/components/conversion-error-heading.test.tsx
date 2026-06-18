// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  isExtractionError,
  EXTRACTION_ERROR_MESSAGES,
  EXTRACTION_ERROR_FALLBACK,
} from "@shared/extraction-error-messages";

function ConversionErrorHeading({ errorMessage }: { errorMessage: string | null | undefined }) {
  return (
    <h2 data-testid="text-error-heading">
      {isExtractionError(errorMessage) ? "File Could Not Be Read" : "Remediation Failed"}
    </h2>
  );
}

describe("Conversion error heading", () => {
  describe("extraction errors → 'File Could Not Be Read'", () => {
    it("shows 'File Could Not Be Read' for the PDF extraction error message", () => {
      render(<ConversionErrorHeading errorMessage={EXTRACTION_ERROR_MESSAGES["pdf"]} />);
      expect(screen.getByTestId("text-error-heading")).toHaveTextContent("File Could Not Be Read");
    });

    it("shows 'File Could Not Be Read' for the DOCX extraction error message", () => {
      render(<ConversionErrorHeading errorMessage={EXTRACTION_ERROR_MESSAGES["docx"]} />);
      expect(screen.getByTestId("text-error-heading")).toHaveTextContent("File Could Not Be Read");
    });

    it("shows 'File Could Not Be Read' for the PPTX extraction error message", () => {
      render(<ConversionErrorHeading errorMessage={EXTRACTION_ERROR_MESSAGES["pptx"]} />);
      expect(screen.getByTestId("text-error-heading")).toHaveTextContent("File Could Not Be Read");
    });

    it("shows 'File Could Not Be Read' for the EXTRACTION_ERROR_FALLBACK message", () => {
      render(<ConversionErrorHeading errorMessage={EXTRACTION_ERROR_FALLBACK} />);
      expect(screen.getByTestId("text-error-heading")).toHaveTextContent("File Could Not Be Read");
    });

    it("shows 'File Could Not Be Read' for every known extraction error message", () => {
      for (const msg of Object.values(EXTRACTION_ERROR_MESSAGES)) {
        const { unmount } = render(<ConversionErrorHeading errorMessage={msg} />);
        expect(screen.getByTestId("text-error-heading")).toHaveTextContent("File Could Not Be Read");
        unmount();
      }
    });
  });

  describe("non-extraction errors → 'Remediation Failed'", () => {
    it("shows 'Remediation Failed' for a generic AI processing failure", () => {
      render(<ConversionErrorHeading errorMessage="AI remediation step failed unexpectedly." />);
      expect(screen.getByTestId("text-error-heading")).toHaveTextContent("Remediation Failed");
    });

    it("shows 'Remediation Failed' for an internal server error message", () => {
      render(<ConversionErrorHeading errorMessage="Internal server error. Please try again." />);
      expect(screen.getByTestId("text-error-heading")).toHaveTextContent("Remediation Failed");
    });

    it("shows 'Remediation Failed' for a partial match that is not in the set", () => {
      render(<ConversionErrorHeading errorMessage="This PDF could not be read." />);
      expect(screen.getByTestId("text-error-heading")).toHaveTextContent("Remediation Failed");
    });

    it("shows 'Remediation Failed' for null errorMessage", () => {
      render(<ConversionErrorHeading errorMessage={null} />);
      expect(screen.getByTestId("text-error-heading")).toHaveTextContent("Remediation Failed");
    });

    it("shows 'Remediation Failed' for undefined errorMessage", () => {
      render(<ConversionErrorHeading errorMessage={undefined} />);
      expect(screen.getByTestId("text-error-heading")).toHaveTextContent("Remediation Failed");
    });
  });
});

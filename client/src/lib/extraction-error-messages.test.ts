import { describe, it, expect } from "vitest";
import {
  isExtractionError,
  EXTRACTION_ERROR_MESSAGES,
  EXTRACTION_ERROR_FALLBACK,
} from "@shared/extraction-error-messages";

describe("isExtractionError", () => {
  describe("known extraction error messages → 'File Could Not Be Read' heading", () => {
    it("returns true for the PDF extraction error message", () => {
      expect(isExtractionError(EXTRACTION_ERROR_MESSAGES["pdf"])).toBe(true);
    });

    it("returns true for the DOCX extraction error message", () => {
      expect(isExtractionError(EXTRACTION_ERROR_MESSAGES["docx"])).toBe(true);
    });

    it("returns true for the PPTX extraction error message", () => {
      expect(isExtractionError(EXTRACTION_ERROR_MESSAGES["pptx"])).toBe(true);
    });

    it("returns true for the Google Doc extraction error message", () => {
      expect(isExtractionError(EXTRACTION_ERROR_MESSAGES["google-doc"])).toBe(true);
    });

    it("returns true for the Google Sheet extraction error message", () => {
      expect(isExtractionError(EXTRACTION_ERROR_MESSAGES["google-sheet"])).toBe(true);
    });

    it("returns true for the EXTRACTION_ERROR_FALLBACK message", () => {
      expect(isExtractionError(EXTRACTION_ERROR_FALLBACK)).toBe(true);
    });

    it("returns true for every value in EXTRACTION_ERROR_MESSAGES", () => {
      for (const msg of Object.values(EXTRACTION_ERROR_MESSAGES)) {
        expect(isExtractionError(msg)).toBe(true);
      }
    });
  });

  describe("non-extraction error messages → 'Remediation Failed' heading", () => {
    it("returns false for a generic AI processing failure message", () => {
      expect(isExtractionError("AI remediation step failed unexpectedly.")).toBe(false);
    });

    it("returns false for a generic server error message", () => {
      expect(isExtractionError("Internal server error. Please try again.")).toBe(false);
    });

    it("returns false for an unrelated user-facing message", () => {
      expect(isExtractionError("Your session has expired. Please sign in again.")).toBe(false);
    });

    it("returns false for a message that partially matches but is not in the set", () => {
      expect(isExtractionError("This PDF could not be read.")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("returns false for null", () => {
      expect(isExtractionError(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isExtractionError(undefined)).toBe(false);
    });

    it("returns false for an empty string", () => {
      expect(isExtractionError("")).toBe(false);
    });
  });
});

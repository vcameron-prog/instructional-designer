import { describe, it, expect } from "vitest";
import {
  isExtractionError,
  EXTRACTION_ERROR_MESSAGES,
  EXTRACTION_ERROR_FALLBACK,
} from "@shared/extraction-error-messages";

// ---------------------------------------------------------------------------
// Snapshot tests — pin exact wording so any change causes an explicit failure.
//
// WHY: isExtractionError uses a Set built from these strings at module load
// time. If a message is reworded without updating every consumer the Set will
// no longer match and the UI will silently show "Remediation Failed" instead
// of "File Could Not Be Read". These snapshots make that class of regression
// immediately visible.
// ---------------------------------------------------------------------------

describe("EXTRACTION_ERROR_MESSAGES snapshot", () => {
  it("matches the full set of known file-type messages exactly", () => {
    expect(EXTRACTION_ERROR_MESSAGES).toMatchInlineSnapshot(`
      {
        "csv": "This CSV file could not be parsed. Check that it is a valid, well-formed CSV file.",
        "doc": "This file could not be read. It may be corrupted or in an unsupported variant of the .doc format.",
        "docx": "This Word document could not be read. It may be corrupted, password-protected, or in an unsupported format.",
        "epub": "This EPUB file could not be opened. It may be corrupted or not a valid EPUB.",
        "google-doc": "This Google Doc could not be extracted. It may be in an unsupported format or corrupted.",
        "google-sheet": "This Google Sheet could not be read. It may be in an unsupported format or corrupted.",
        "google-slide": "This Google Slides file could not be read. It may be in an unsupported format or corrupted.",
        "html": "This HTML file could not be parsed. Check that it is a valid HTML document.",
        "odp": "This OpenDocument Presentation could not be read. It may be corrupted or in an unsupported format.",
        "ods": "This OpenDocument Spreadsheet could not be read. It may be corrupted or in an unsupported format.",
        "odt": "This OpenDocument Text file could not be read. It may be corrupted or in an unsupported format.",
        "pdf": "This PDF could not be read. It may be corrupted, password-protected, or not a valid PDF.",
        "pptx": "This PowerPoint file could not be read. It may be corrupted, password-protected, or in an unsupported format.",
        "rtf": "This RTF file could not be read. It may be corrupted or in an unsupported format.",
        "xlsx": "This Excel spreadsheet could not be read. It may be corrupted, password-protected, or in an unsupported format.",
      }
    `);
  });
});

describe("EXTRACTION_ERROR_FALLBACK snapshot", () => {
  it("matches the exact fallback message", () => {
    expect(EXTRACTION_ERROR_FALLBACK).toMatchInlineSnapshot(
      `"This file could not be read. It may be corrupted or in an unsupported format."`,
    );
  });
});

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

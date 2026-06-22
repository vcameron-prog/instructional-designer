// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

vi.mock("@/lib/clipboard", () => ({
  writeToClipboard: vi.fn().mockResolvedValue(undefined),
}));
import {
  EXTRACTION_ERROR_MESSAGES,
  EXTRACTION_ERROR_FALLBACK,
} from "@shared/extraction-error-messages";
import { ConversionErrorPanel } from "./conversion-error-panel";
import { writeToClipboard } from "@/lib/clipboard";

describe("ConversionErrorPanel heading", () => {
  describe("extraction errors → 'File Could Not Be Read'", () => {
    it("shows exactly 'File Could Not Be Read' for the PDF extraction error message", () => {
      render(<ConversionErrorPanel errorMessage={EXTRACTION_ERROR_MESSAGES["pdf"]} />);
      expect(screen.getByTestId("text-error-heading").textContent).toBe("File Could Not Be Read");
    });

    it("shows exactly 'File Could Not Be Read' for the DOCX extraction error message", () => {
      render(<ConversionErrorPanel errorMessage={EXTRACTION_ERROR_MESSAGES["docx"]} />);
      expect(screen.getByTestId("text-error-heading").textContent).toBe("File Could Not Be Read");
    });

    it("shows exactly 'File Could Not Be Read' for the PPTX extraction error message", () => {
      render(<ConversionErrorPanel errorMessage={EXTRACTION_ERROR_MESSAGES["pptx"]} />);
      expect(screen.getByTestId("text-error-heading").textContent).toBe("File Could Not Be Read");
    });

    it("shows exactly 'File Could Not Be Read' for the EXTRACTION_ERROR_FALLBACK message", () => {
      render(<ConversionErrorPanel errorMessage={EXTRACTION_ERROR_FALLBACK} />);
      expect(screen.getByTestId("text-error-heading").textContent).toBe("File Could Not Be Read");
    });

    it("shows exactly 'File Could Not Be Read' for every known extraction error message", () => {
      for (const msg of Object.values(EXTRACTION_ERROR_MESSAGES)) {
        const { unmount } = render(<ConversionErrorPanel errorMessage={msg} />);
        expect(screen.getByTestId("text-error-heading").textContent).toBe("File Could Not Be Read");
        unmount();
      }
    });
  });

  describe("non-extraction errors → 'Remediation Failed'", () => {
    it("shows exactly 'Remediation Failed' for a generic AI processing failure", () => {
      render(<ConversionErrorPanel errorMessage="AI remediation step failed unexpectedly." />);
      expect(screen.getByTestId("text-error-heading").textContent).toBe("Remediation Failed");
    });

    it("shows exactly 'Remediation Failed' for an internal server error message", () => {
      render(<ConversionErrorPanel errorMessage="Internal server error. Please try again." />);
      expect(screen.getByTestId("text-error-heading").textContent).toBe("Remediation Failed");
    });

    it("shows exactly 'Remediation Failed' for a partial match that is not in the set", () => {
      render(<ConversionErrorPanel errorMessage="This PDF could not be read." />);
      expect(screen.getByTestId("text-error-heading").textContent).toBe("Remediation Failed");
    });

    it("shows exactly 'Remediation Failed' for null errorMessage", () => {
      render(<ConversionErrorPanel errorMessage={null} />);
      expect(screen.getByTestId("text-error-heading").textContent).toBe("Remediation Failed");
    });

    it("shows exactly 'Remediation Failed' for undefined errorMessage", () => {
      render(<ConversionErrorPanel errorMessage={undefined} />);
      expect(screen.getByTestId("text-error-heading").textContent).toBe("Remediation Failed");
    });
  });
});

describe("ConversionErrorPanel body text", () => {
  describe("body text matches the stored EXTRACTION_ERROR_MESSAGES string exactly", () => {
    it("renders the PDF extraction error message verbatim", () => {
      render(<ConversionErrorPanel errorMessage={EXTRACTION_ERROR_MESSAGES["pdf"]} />);
      expect(screen.getByTestId("text-error-message").textContent).toBe(
        EXTRACTION_ERROR_MESSAGES["pdf"],
      );
    });

    it("renders the DOCX extraction error message verbatim", () => {
      render(<ConversionErrorPanel errorMessage={EXTRACTION_ERROR_MESSAGES["docx"]} />);
      expect(screen.getByTestId("text-error-message").textContent).toBe(
        EXTRACTION_ERROR_MESSAGES["docx"],
      );
    });

    it("renders the PPTX extraction error message verbatim", () => {
      render(<ConversionErrorPanel errorMessage={EXTRACTION_ERROR_MESSAGES["pptx"]} />);
      expect(screen.getByTestId("text-error-message").textContent).toBe(
        EXTRACTION_ERROR_MESSAGES["pptx"],
      );
    });

    it("renders the EXTRACTION_ERROR_FALLBACK message verbatim", () => {
      render(<ConversionErrorPanel errorMessage={EXTRACTION_ERROR_FALLBACK} />);
      expect(screen.getByTestId("text-error-message").textContent).toBe(EXTRACTION_ERROR_FALLBACK);
    });

    it("renders every known extraction error message verbatim (exhaustive)", () => {
      for (const [, msg] of Object.entries(EXTRACTION_ERROR_MESSAGES)) {
        const { unmount } = render(<ConversionErrorPanel errorMessage={msg} />);
        expect(screen.getByTestId("text-error-message").textContent).toBe(msg);
        unmount();
      }
    });
  });

  describe("inline snapshots — pin exact stored wording so truncation/formatting is caught", () => {
    it("PDF body text matches inline snapshot", () => {
      render(<ConversionErrorPanel errorMessage={EXTRACTION_ERROR_MESSAGES["pdf"]} />);
      expect(screen.getByTestId("text-error-message").textContent).toMatchInlineSnapshot(
        `"This PDF could not be read. It may be corrupted, password-protected, or not a valid PDF."`,
      );
    });

    it("DOCX body text matches inline snapshot", () => {
      render(<ConversionErrorPanel errorMessage={EXTRACTION_ERROR_MESSAGES["docx"]} />);
      expect(screen.getByTestId("text-error-message").textContent).toMatchInlineSnapshot(
        `"This Word document could not be read. It may be corrupted, password-protected, or in an unsupported format."`,
      );
    });

    it("PPTX body text matches inline snapshot", () => {
      render(<ConversionErrorPanel errorMessage={EXTRACTION_ERROR_MESSAGES["pptx"]} />);
      expect(screen.getByTestId("text-error-message").textContent).toMatchInlineSnapshot(
        `"This PowerPoint file could not be read. It may be corrupted, password-protected, or in an unsupported format."`,
      );
    });

    it("EXTRACTION_ERROR_FALLBACK body text matches inline snapshot", () => {
      render(<ConversionErrorPanel errorMessage={EXTRACTION_ERROR_FALLBACK} />);
      expect(screen.getByTestId("text-error-message").textContent).toMatchInlineSnapshot(
        `"This file could not be read. It may be corrupted or in an unsupported format."`,
      );
    });
  });

  describe("fallback body text when no errorMessage is provided", () => {
    it("shows generic fallback text for null errorMessage", () => {
      render(<ConversionErrorPanel errorMessage={null} />);
      expect(screen.getByTestId("text-error-message").textContent).toBe(
        "An error occurred. Please try again.",
      );
    });

    it("shows generic fallback text for undefined errorMessage", () => {
      render(<ConversionErrorPanel errorMessage={undefined} />);
      expect(screen.getByTestId("text-error-message").textContent).toBe(
        "An error occurred. Please try again.",
      );
    });
  });
});

describe("ConversionErrorPanel copy button", () => {
  const mockWrite = () => vi.mocked(writeToClipboard);

  beforeEach(() => {
    vi.mocked(writeToClipboard).mockClear();
    vi.mocked(writeToClipboard).mockResolvedValue(undefined);
  });

  it("copies the PDF extraction error message exactly as stored", async () => {
    const user = userEvent.setup();
    const msg = EXTRACTION_ERROR_MESSAGES["pdf"];
    render(<ConversionErrorPanel errorMessage={msg} />);
    await user.click(screen.getByTestId("button-copy-error"));
    expect(mockWrite()).toHaveBeenCalledOnce();
    expect(mockWrite()).toHaveBeenCalledWith(msg);
  });

  it("copies the DOCX extraction error message exactly as stored", async () => {
    const user = userEvent.setup();
    const msg = EXTRACTION_ERROR_MESSAGES["docx"];
    render(<ConversionErrorPanel errorMessage={msg} />);
    await user.click(screen.getByTestId("button-copy-error"));
    expect(mockWrite()).toHaveBeenCalledOnce();
    expect(mockWrite()).toHaveBeenCalledWith(msg);
  });

  it("copies the PPTX extraction error message exactly as stored", async () => {
    const user = userEvent.setup();
    const msg = EXTRACTION_ERROR_MESSAGES["pptx"];
    render(<ConversionErrorPanel errorMessage={msg} />);
    await user.click(screen.getByTestId("button-copy-error"));
    expect(mockWrite()).toHaveBeenCalledOnce();
    expect(mockWrite()).toHaveBeenCalledWith(msg);
  });

  it("copies the EXTRACTION_ERROR_FALLBACK message exactly as stored", async () => {
    const user = userEvent.setup();
    render(<ConversionErrorPanel errorMessage={EXTRACTION_ERROR_FALLBACK} />);
    await user.click(screen.getByTestId("button-copy-error"));
    expect(mockWrite()).toHaveBeenCalledOnce();
    expect(mockWrite()).toHaveBeenCalledWith(EXTRACTION_ERROR_FALLBACK);
  });

  it("copies every known extraction error message exactly as stored (exhaustive)", async () => {
    for (const [, msg] of Object.entries(EXTRACTION_ERROR_MESSAGES)) {
      vi.mocked(writeToClipboard).mockClear();
      const user = userEvent.setup();
      const { unmount } = render(<ConversionErrorPanel errorMessage={msg} />);
      await user.click(screen.getByTestId("button-copy-error"));
      expect(mockWrite()).toHaveBeenCalledOnce();
      expect(mockWrite()).toHaveBeenCalledWith(msg);
      unmount();
    }
  });

  it("copies the generic fallback text when errorMessage is null", async () => {
    const user = userEvent.setup();
    render(<ConversionErrorPanel errorMessage={null} />);
    await user.click(screen.getByTestId("button-copy-error"));
    expect(mockWrite()).toHaveBeenCalledOnce();
    expect(mockWrite()).toHaveBeenCalledWith("An error occurred. Please try again.");
  });

  it("copies the generic fallback text when errorMessage is undefined", async () => {
    const user = userEvent.setup();
    render(<ConversionErrorPanel errorMessage={undefined} />);
    await user.click(screen.getByTestId("button-copy-error"));
    expect(mockWrite()).toHaveBeenCalledOnce();
    expect(mockWrite()).toHaveBeenCalledWith("An error occurred. Please try again.");
  });

  it("does not truncate or reformat the stored message before writing to clipboard", async () => {
    const user = userEvent.setup();
    const msg = EXTRACTION_ERROR_MESSAGES["pdf"];
    render(<ConversionErrorPanel errorMessage={msg} />);
    await user.click(screen.getByTestId("button-copy-error"));
    expect(mockWrite()).toHaveBeenCalledOnce();
    const written = vi.mocked(writeToClipboard).mock.calls[0][0];
    expect(written).toBe(msg);
    expect(written.length).toBe(msg.length);
  });
});

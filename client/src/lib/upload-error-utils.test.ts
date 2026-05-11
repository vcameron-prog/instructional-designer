import { describe, it, expect } from "vitest";
import {
  parseSyllabusUploadError,
  parseConversionsUploadError,
} from "./upload-error-utils";

// ---------------------------------------------------------------------------
// parseSyllabusUploadError – used by course-form.tsx /api/upload-syllabus
// ---------------------------------------------------------------------------

describe("parseSyllabusUploadError", () => {
  it("returns session-expired message on 401", () => {
    const err = parseSyllabusUploadError(401, "Unauthorized");
    expect(err.message).toBe(
      "Your session has expired. Please refresh the page and sign in again.",
    );
  });

  it("returns session-expired message on 403", () => {
    const err = parseSyllabusUploadError(403, "Forbidden");
    expect(err.message).toBe(
      "Your session has expired. Please refresh the page and sign in again.",
    );
  });

  it("returns session-expired message when body is HTML (login redirect)", () => {
    const htmlBody =
      "<!DOCTYPE html><html><body>Please sign in</body></html>";
    const err = parseSyllabusUploadError(302, htmlBody);
    expect(err.message).toBe(
      "Your session has expired. Please refresh the page and sign in again.",
    );
  });

  it("returns session-expired message for HTML body even on 500", () => {
    const htmlBody = "<html><body>Internal Server Error</body></html>";
    const err = parseSyllabusUploadError(500, htmlBody);
    expect(err.message).toBe(
      "Your session has expired. Please refresh the page and sign in again.",
    );
  });

  it("returns server-provided error message from JSON body", () => {
    const jsonBody = JSON.stringify({ error: "File type not supported." });
    const err = parseSyllabusUploadError(422, jsonBody);
    expect(err.message).toBe("File type not supported.");
  });

  it("returns generic fallback when JSON body has no error field", () => {
    const jsonBody = JSON.stringify({ message: "something went wrong" });
    const err = parseSyllabusUploadError(500, jsonBody);
    expect(err.message).toBe("Failed to upload file. Please try again.");
  });

  it("returns generic fallback for plain-text non-HTML body", () => {
    const err = parseSyllabusUploadError(500, "internal server error");
    expect(err.message).toBe("Failed to upload file. Please try again.");
  });

  it("returns generic fallback for empty body", () => {
    const err = parseSyllabusUploadError(500, "");
    expect(err.message).toBe("Failed to upload file. Please try again.");
  });

  it("does not include raw HTML markup in the returned message", () => {
    const htmlBody = "<html><body><h1>403 Forbidden</h1></body></html>";
    const err = parseSyllabusUploadError(403, htmlBody);
    expect(err.message).not.toMatch(/<[^>]+>/);
  });
});

// ---------------------------------------------------------------------------
// parseConversionsUploadError – used by pdf-upload.tsx /api/conversions/upload
// ---------------------------------------------------------------------------

describe("parseConversionsUploadError", () => {
  it("returns fallback message when body is HTML", () => {
    const htmlBody = "<html><body>Forbidden</body></html>";
    const err = parseConversionsUploadError(htmlBody);
    expect(err.message).toBe(
      "Upload failed. Please try again. If the problem persists, try refreshing the page.",
    );
  });

  it("does not include raw HTML markup in the message when body is HTML", () => {
    const htmlBody =
      "<!DOCTYPE html><html><body><p>401 Unauthorized</p></body></html>";
    const err = parseConversionsUploadError(htmlBody);
    expect(err.message).not.toMatch(/<[^>]+>/);
  });

  it("returns fallback when body starts with whitespace then HTML tag", () => {
    const htmlBody = "  \n<html><body>Error</body></html>";
    const err = parseConversionsUploadError(htmlBody);
    expect(err.message).toBe(
      "Upload failed. Please try again. If the problem persists, try refreshing the page.",
    );
  });

  it("returns server-provided error message from JSON body", () => {
    const jsonBody = JSON.stringify({ error: "File exceeds size limit." });
    const err = parseConversionsUploadError(jsonBody);
    expect(err.message).toBe("File exceeds size limit.");
  });

  it("returns fallback when JSON body has no error field", () => {
    const jsonBody = JSON.stringify({ status: "fail" });
    const err = parseConversionsUploadError(jsonBody);
    expect(err.message).toBe(
      "Upload failed. Please try again. If the problem persists, try refreshing the page.",
    );
  });

  it("returns fallback when body is malformed JSON", () => {
    const err = parseConversionsUploadError("{bad json}");
    expect(err.message).toBe(
      "Upload failed. Please try again. If the problem persists, try refreshing the page.",
    );
  });

  it("returns fallback for empty body", () => {
    const err = parseConversionsUploadError("");
    expect(err.message).toBe(
      "Upload failed. Please try again. If the problem persists, try refreshing the page.",
    );
  });
});

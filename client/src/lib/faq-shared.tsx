/**
 * Shared FAQ content used by both the Help page (client/src/pages/help.tsx)
 * and the PDF/Accessibility FAQ page (client/src/pages/pdf-faq.tsx).
 *
 * Edit here to update both pages at once.
 */

import React, { isValidElement } from "react";

// ---------------------------------------------------------------------------
// FAQ answer types
// ---------------------------------------------------------------------------

/**
 * Union of all valid FAQ answer shapes.
 *
 * - `string`               — plain text, rendered as a single paragraph.
 * - `string[]`             — list of lines, each rendered as its own paragraph.
 * - `React.ReactNode`      — pre-composed JSX (e.g. a Fragment with links).
 * - `() => React.ReactNode`— render function, called inside the component cycle.
 *                            Use this instead of a module-level ReactNode when
 *                            the answer contains JSX (avoids React hook-rule
 *                            warnings and invalid-DOM-nesting edge-cases).
 */
export type FAQAnswer = string | string[] | React.ReactNode | (() => React.ReactNode);

/**
 * Render any `FAQAnswer` value to `React.ReactNode`.
 *
 * Centralises the `typeof === "function"` guard and the ReactNode/string[]
 * branching so call-sites don't have to repeat the pattern.
 *
 * - Render functions are called and their result is returned directly.
 * - ReactNode values (elements, Fragments, etc.) are returned as-is.
 * - `string[]` is rendered as a series of `<p>` elements.
 * - Plain `string` is returned as-is (React renders it as a text node).
 */
export function renderFAQAnswer(answer: FAQAnswer): React.ReactNode {
  if (typeof answer === "function") {
    return answer();
  }
  if (isValidElement(answer) || (answer !== null && typeof answer === "object" && !Array.isArray(answer))) {
    return answer as React.ReactNode;
  }
  if (Array.isArray(answer)) {
    return (
      <>
        {(answer as string[]).map((line, i) => (
          <p
            key={i}
            className={
              line.startsWith("•") || /^\d+\./.test(line) ? "ml-2" : undefined
            }
          >
            {line}
          </p>
        ))}
      </>
    );
  }
  return answer as string;
}

// ---------------------------------------------------------------------------
// File size limit
// ---------------------------------------------------------------------------

export const FILE_SIZE_LIMIT_MB = 20;

/** Plain-text answer for the "What file size limit applies?" FAQ entry. */
export const FILE_SIZE_FAQ_ANSWER = `Files up to ${FILE_SIZE_LIMIT_MB} MB are accepted. For larger files, consider splitting the document into smaller sections before uploading.`;

// ---------------------------------------------------------------------------
// Supported formats
// ---------------------------------------------------------------------------

/** Structured format list used by the Help page's visual format grid. */
export const SUPPORTED_FORMATS = [
  { name: "PDF (.pdf)", notes: "Text-based and scanned (OCR applied automatically)" },
  { name: "Word (.docx)", notes: "All versions; tables, lists, and images supported" },
  { name: "Excel (.xlsx)", notes: "Spreadsheets; select a specific sheet to convert" },
  { name: "PowerPoint (.pptx)", notes: "Slides converted to structured HTML" },
  { name: "Google Docs", notes: "Paste a sharing link (document must be publicly shared)" },
  { name: "Google Sheets", notes: "Paste a sharing link; choose which sheet to convert" },
  { name: "Google Slides", notes: "Paste a sharing link" },
  { name: "RTF, ODT, EPUB", notes: "Additional document formats" },
];

/**
 * Bullet-list version of supported formats used by the PDF FAQ page's
 * "What file types can I upload?" answer.
 */
export const SUPPORTED_FORMATS_LINES: string[] = [
  "The tool accepts the following formats:",
  "• PDF files (.pdf)",
  "• Word documents (.docx)",
  "• Excel spreadsheets (.xlsx)",
  "• PowerPoint presentations (.pptx)",
  "• Google Docs — Paste your Google Docs link in the Import section.",
  "• Google Sheets — Paste your Google Sheets link in the Import section.",
  "• Google Slides — Paste your Google Slides link in the Import section.",
  'Google documents must be shared as "Anyone with the link" before importing.',
];

// ---------------------------------------------------------------------------
// How was this tool built?
// ---------------------------------------------------------------------------

/**
 * Canonical answer for the "How was this tool built?" FAQ question.
 * Used verbatim on both the Help page and the PDF FAQ page.
 */
export const HOW_BUILT_ANSWER =
  "This tool was developed through experimentation with Replit's vibe-coding platform, which makes it possible to build and deploy a full web application through a conversational AI interface — no traditional development environment required. It combines Node.js/Express on the backend with a React frontend, and Anthropic's Claude for AI-powered content analysis and remediation. It's been an interesting way to explore what's possible with AI-assisted development in a higher education context.";

// ---------------------------------------------------------------------------
// Privacy / data security
// ---------------------------------------------------------------------------

/**
 * Render function for the "Is my document stored / data secure?" FAQ answer.
 * Covers both server-side storage isolation and the Anthropic API.
 * Defined as a function (not a module-level ReactNode) so it is only evaluated
 * inside a component render cycle, avoiding React hook-rules warnings and
 * invalid DOM nesting issues caused by Fragment detection edge-cases.
 */
export function PRIVACY_ANSWER(): React.ReactNode {
  return (
    <>
      <p>
        Uploaded content is stored in a private database scoped to your session
        or account and is not shared with other users. AI processing uses
        Anthropic&#39;s Claude API&#8212;see{" "}
        <a
          href="https://www.anthropic.com/legal/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:opacity-80"
        >
          Anthropic&#39;s privacy policy
        </a>{" "}
        for details on how API data is handled.
      </p>
      <p className="mt-2">
        To protect privacy and maintain FERPA compliance, do not upload
        documents containing sensitive or personally identifiable information,
        including student records or other protected data.
      </p>
    </>
  );
}

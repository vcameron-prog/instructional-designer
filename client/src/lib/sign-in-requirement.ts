/**
 * Canonical sign-in requirement copy used by both the Help page
 * (client/src/pages/help.tsx) and the PDF/Accessibility FAQ page
 * (client/src/pages/pdf-faq.tsx).
 *
 * Edit here to update both pages at once.
 */

export const SIGN_IN_REQUIREMENT_LINES: string[] = [
  "No account is required to use the accessibility converter. Anyone can upload a document, run the audit, and download the remediated file.",
  "BSU employees can sign in with their BSU account to save conversion history and return to previous documents.",
  "Course creation and the instructional design tools (assignment builders, rubrics, syllabi, etc.) are only available to signed-in BSU users.",
];

export const SIGN_IN_REQUIREMENT_TEXT: string =
  SIGN_IN_REQUIREMENT_LINES.join(" ");

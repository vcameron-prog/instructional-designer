import { parse as parseHtml } from "node-html-parser";

/**
 * The set of fixType keys that can be applied deterministically (no AI call
 * required). Exposed via GET /api/deterministic-fixers so the client can
 * decide whether to show an instant "Apply fix" action or route through the
 * AI-backed flow (e.g. fix-vague-link-text).
 */
const DETERMINISTIC_FIXER_KEYS = [
  "fix-heading-skip",
  "fix-all-caps",
  "convert-markdown-tables",
  "fix-html-table-caption",
  "fix-html-table-thead",
  "edit-html-table-caption",
  "fix-aria-combobox",
  "fix-aria-grid",
  "fix-aria-tab",
];

export function getDeterministicFixerKeys(): string[] {
  return [...DETERMINISTIC_FIXER_KEYS];
}

/** Escape all regex metacharacters in a string so it can be safely embedded in a RegExp pattern. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matches the attribute list inside an HTML open tag, correctly skipping over
 * quoted attribute values so that `>`, `"`, or `'` inside a value are not
 * mistaken for the end of the tag.
 *
 * Pattern breakdown:
 *   [^>"'`]  — any character that is not >, ", ', or ` (unquoted attr chars)
 *   "[^"]*"  — a double-quoted value (including any >, ', or ` inside)
 *   '[^']*'  — a single-quoted value (including any >, ", or ` inside)
 *   `[^`]*`  — a backtick-quoted value (including any >, ", or ' inside)
 *
 * Use as a string so it can be interpolated into `new RegExp(...)` calls.
 */
const ATTR_PATTERN = "(?:[^>\"'`]|\"[^\"]*\"|'[^']*'|`[^`]*`)*";

/**
 * The set of deterministic (non-AI) fixer keys supported by the
 * fix-accessibility / preview-fix routes. Exposed via GET /api/deterministic-fixers
 * so the client can decide which fixes to run without an AI round-trip.
 */
export function getDeterministicFixerKeys(): string[] {
  return [
    "fix-heading-skip",
    "fix-all-caps",
    "convert-markdown-tables",
    "fix-html-table-caption",
    "fix-html-table-thead",
    "edit-html-table-caption",
    "fix-aria-tab",
    "fix-aria-combobox",
    "fix-aria-grid",
  ];
}

/**
 * Generic helper that finds every element with `role="{roleValue}"` whose
 * tag is not already one of the semantically-correct tags (per
 * `isAllowedTag`), and rewrites its opening/closing tags to `newTag` while
 * stripping the now-redundant role attribute. Uses node-html-parser to find
 * targets (so nesting is handled correctly) but performs the actual
 * replacement via string substitution to preserve the rest of the document
 * byte-for-byte.
 */
function replaceAriaRoleElements(
  html: string,
  roleValue: string,
  isAllowedTag: (tag: string) => boolean,
  newTag: string,
  buildOpenTag: (attrs: string) => string,
): string {
  const root = parseHtml(html);
  let result = html;

  const nodes = root.querySelectorAll(`[role='${roleValue}']`);
  const targets = nodes.filter((el) => !isAllowedTag(el.tagName?.toLowerCase() ?? ""));

  for (const el of targets) {
    const outerHtml = el.outerHTML;
    const tag = el.tagName?.toLowerCase() ?? "div";
    const openTagRegex = new RegExp(`^<${escapeRegex(tag)}(${ATTR_PATTERN})>`, "i");
    const openTagMatch = outerHtml.match(openTagRegex);
    if (!openTagMatch) continue;
    const closeTagIdx = outerHtml.lastIndexOf(`</${tag}>`);
    if (closeTagIdx === -1) continue;
    const innerHtml = outerHtml.slice(openTagMatch[0].length, closeTagIdx);
    const attrs = openTagMatch[1]
      .replace(new RegExp(`\\s*role\\s*=\\s*["']${escapeRegex(roleValue)}["']`, "gi"), "")
      .trim();
    const replacement = `${buildOpenTag(attrs)}${innerHtml}</${newTag}>`;
    result = result.replace(outerHtml, replacement);
  }

  return result;
}

/**
 * Rewrites `<div role="combobox">…</div>` (and similar non-semantic
 * elements) into a native `<select>` element, dropping the redundant
 * role attribute. Elements that are already `<select>` or `<input>` are
 * left untouched.
 */
export function applyAriaComboboxRoleFix(html: string): string {
  return replaceAriaRoleElements(
    html,
    "combobox",
    (tag) => tag === "select" || tag === "input",
    "select",
    (attrs) => `<select${attrs ? " " + attrs : ""}>`,
  );
}

/**
 * Rewrites `<div role="grid">…</div>` (and similar non-semantic elements)
 * into a native `<table>` element, dropping the redundant role attribute.
 * Elements that are already `<table>` are left untouched.
 */
export function applyAriaGridRoleFix(html: string): string {
  return replaceAriaRoleElements(
    html,
    "grid",
    (tag) => tag === "table",
    "table",
    (attrs) => `<table${attrs ? " " + attrs : ""}>`,
  );
}

/**
 * Rewrites `<div role="tab">…</div>` (and similar non-semantic elements)
 * into a native `<button>` element, dropping the redundant role attribute.
 * Elements that are already `<button>` or `<a>` are left untouched.
 */
export function applyAriaTabRoleFix(html: string): string {
  return replaceAriaRoleElements(
    html,
    "tab",
    (tag) => tag === "button" || tag === "a",
    "button",
    (attrs) => `<button${attrs ? " " + attrs : ""}>`,
  );
}

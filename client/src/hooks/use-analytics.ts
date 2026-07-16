const SESSION_KEY = "_analytics_sid";

const VALID_PAGES = new Set([
  "landing",
  "pdf-upload",
  "pdf-conversion",
  "pdf-history",
  "pdf-faq",
  "url-scanner",
  "color-contrast",
  "alt-text",
  "math-ocr",
  "settings",
  "help",
  "admin",
]);

const VALID_ACTIONS = new Set([
  "page_view",
  "conversion_started",
  "conversion_complete",
  "tool_result",
  "download_html",
  "download_docx",
  "download_pdf",
  "download_xlsx",
  "reprocess",
  "google_doc_import",
  "google_sheet_import",
  "google_slide_import",
]);

function getSessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export function trackEvent(page: string, action: string): void {
  if (!VALID_PAGES.has(page) || !VALID_ACTIONS.has(action)) return;
  try {
    const sessionId = getSessionId();
    fetch("/api/analytics/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, page, action }),
      credentials: "include",
    }).catch(() => {});
  } catch {
    // Never throw from analytics
  }
}

export const SESSION_EXPIRED_MESSAGE =
  "Your session has expired. Please sign in again.";

export function isSessionExpiredMessage(message: string): boolean {
  return message === SESSION_EXPIRED_MESSAGE ||
    message.includes("session has expired");
}

export function parseSyllabusUploadError(status: number, text: string): Error {
  const isHtml = text.trimStart().startsWith("<");
  if (status === 401 || status === 403 || isHtml) {
    return new Error(SESSION_EXPIRED_MESSAGE);
  }
  let message = "Failed to upload file. Please try again.";
  if (text && !isHtml) {
    try {
      const parsed = JSON.parse(text);
      if (parsed.error) message = parsed.error;
    } catch {}
  }
  return new Error(message);
}

export function parseConversionsUploadError(text: string): Error {
  const isHtml = text.trimStart().startsWith("<");
  if (isHtml) {
    return new Error(SESSION_EXPIRED_MESSAGE);
  }
  const fallback =
    "Upload failed. Please try again. If the problem persists, try refreshing the page.";
  let message = fallback;
  if (text) {
    try {
      const parsed = JSON.parse(text);
      if (parsed.error) message = parsed.error;
    } catch {
      message = fallback;
    }
  }
  return new Error(message);
}

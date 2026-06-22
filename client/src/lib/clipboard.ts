export function writeToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

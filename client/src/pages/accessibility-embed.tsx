import { usePageTitle } from "@/hooks/use-page-title";

export default function AccessibilityEmbed() {
  usePageTitle("PDF Accessibility Converter");

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="fixed inset-0 w-full h-full bg-background"
      aria-label="PDF Accessibility Converter"
    >
      <iframe
        src="https://bsu-accessibility-converter.replit.app"
        title="PDF Accessibility Converter"
        className="w-full h-full border-0"
        allow="clipboard-read; clipboard-write"
        data-testid="iframe-accessibility-converter"
      />
    </main>
  );
}

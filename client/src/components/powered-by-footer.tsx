import { Shield } from "lucide-react";
import bsuAiLogo from "@assets/bsu-cai-logo.png";
import { useLocation } from "wouter";

export function PoweredByFooter() {
  const [location] = useLocation();
  const isCaiRoot = location === "/";

  if (isCaiRoot) {
    return null;
  }

  return (
    <footer className="mt-12 py-8 bg-gray-200 dark:bg-gray-800" data-testid="footer-powered-by">
      <div className="container mx-auto px-4 space-y-4">
        <div className="flex justify-center">
          <img
            src={bsuAiLogo}
            alt="BSU Center for Artificial Intelligence"
            className="h-12 dark:bg-white/90 dark:rounded-lg dark:px-3 dark:py-1"
            data-testid="img-bsu-ai-logo"
          />
        </div>

        <p className="text-center text-xs text-gray-600 dark:text-gray-400 max-w-2xl mx-auto flex items-start justify-center gap-2" style={{ textWrap: "balance" }} data-testid="text-privacy">
          <Shield className="w-3 h-3 flex-shrink-0 mt-0.5" />
          <span>
            Your data is stored securely, never shared, and not used to train AI models. Powered by{" "}
            <a href="https://www.anthropic.com/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80">Anthropic's Claude API</a>.
            {" "}This tool improves accessibility but does not guarantee full WCAG 2.1 compliance — automated remediation is a starting point and human review is required. Please review all content before use.
          </span>
        </p>
      </div>
    </footer>
  );
}

import { useState } from "react";
import { AlertTriangle, Check, ClipboardCopy } from "lucide-react";
import { isExtractionError } from "@shared/extraction-error-messages";
import { writeToClipboard } from "@/lib/clipboard";

interface ConversionErrorPanelProps {
  errorMessage: string | null | undefined;
}

export function ConversionErrorPanel({ errorMessage }: ConversionErrorPanelProps) {
  const [copiedError, setCopiedError] = useState(false);

  return (
    <div className="mt-6 pt-6 border-t">
      <div
        className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 p-4 rounded-xl flex items-start gap-3"
        role="alert"
      >
        <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-bold" data-testid="text-error-heading">
              {isExtractionError(errorMessage) ? "File Could Not Be Read" : "Remediation Failed"}
            </h2>
            <button
              type="button"
              data-testid="button-copy-error"
              aria-label={copiedError ? "Error message copied" : "Copy error message"}
              onClick={() => {
                const msg = errorMessage || "An error occurred. Please try again.";
                writeToClipboard(msg).then(() => {
                  setCopiedError(true);
                  setTimeout(() => setCopiedError(false), 2000);
                }).catch(() => {
                  setCopiedError(false);
                });
              }}
              className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-red-300 dark:border-red-700 bg-red-100 dark:bg-red-900/40 hover:bg-red-200 dark:hover:bg-red-800/50 text-red-600 dark:text-red-400 transition-colors flex-shrink-0"
            >
              {copiedError ? (
                <>
                  <Check className="w-3 h-3" aria-hidden="true" />
                  Copied
                </>
              ) : (
                <>
                  <ClipboardCopy className="w-3 h-3" aria-hidden="true" />
                  Copy
                </>
              )}
            </button>
          </div>
          <p className="text-sm mt-1" data-testid="text-error-message">
            {errorMessage || "An error occurred. Please try again."}
          </p>
        </div>
      </div>
    </div>
  );
}

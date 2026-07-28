import { useEffect, useState, useRef } from "react";
import { useLocation, Link } from "wouter";
import caiLogoWhite from "@assets/Center_for_AI_Apparel_&_Promotional_Items-WHITE_(1)_1775653892158.png";
import caiLogoDarkInk from "@assets/cai-logo-dark-ink.png";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Loader2,
  AlertCircle,
  FileText,
  History,
  ArrowRight,
  HelpCircle,
  Check,
  ClipboardCopy,
  Image,
  Globe,
  Eye,
  Calculator,
  TriangleAlert,
  Info,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { ConverterHeader } from "@/components/header-controls";
import { usePageTitle } from "@/hooks/use-page-title";
import { cn } from "@/lib/utils";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { LoadingScreen } from "@/components/loading-screen";
import { format } from "date-fns";
import { SiGoogledrive, SiGooglesheets, SiGoogleslides } from "react-icons/si";
import { apiRequest } from "@/lib/queryClient";
import { parseConversionsUploadError, isSessionExpiredMessage } from "@/lib/upload-error-utils";
import { UploadDropzone } from "@/components/UploadDropzone";
import { trackEvent } from "@/hooks/use-analytics";

function reportToolUsage(toolName: "tool:url-scanner" | "tool:color-contrast" | "tool:alt-text" | "tool:math-ocr") {
  fetch("https://accessibility-converter.replit.app/api/usage/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "feature", feature: toolName }),
    keepalive: true,
  }).catch(() => {});
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

// Client-side heuristic: flag files that are very likely to exceed the
// server's section cap (60 sections × 12,000 chars = ~720,000 chars).
// This is a rough estimate — the authoritative warning comes from the server
// after extraction. Threshold is intentionally conservative to avoid
// false-positives on image-heavy documents.
const LARGE_FILE_THRESHOLD_BYTES = 5 * 1024 * 1024; // 5 MB

function getLargeSizeWarning(files: File[]): string | null {
  const large = files.filter((f) => f.size >= LARGE_FILE_THRESHOLD_BYTES);
  if (large.length === 0) return null;
  if (large.length === 1) {
    const mb = (large[0].size / (1024 * 1024)).toFixed(1);
    return `"${large[0].name}" is ${mb} MB. Very large documents are processed up to ~60 sections — content beyond that limit will be skipped. If your document is truncated, try splitting it before uploading.`;
  }
  const names = large.map((f) => `"${f.name}"`).join(", ");
  return `${names} are each over 5 MB. Very large documents are processed up to ~60 sections — content beyond that limit will be skipped. Consider splitting oversized files before uploading.`;
}

// The logo banner's background is intentionally hardcoded dark (see below) and
// does not currently follow the app's light/dark theme toggle, so this is
// pinned to "dark" rather than read from useTheme(). If the banner background
// is ever changed to follow the site theme, replace this constant with the
// `theme` value from useTheme() and the correct logo variant will follow
// automatically.
const LOGO_BANNER_BACKGROUND: "light" | "dark" = "dark";

export default function PdfUpload() {
  usePageTitle(
    "Accessibility Remediation Tools",
    "Convert PDF, Word, PowerPoint, Excel, and Google Docs to WCAG 2.1 AA-compliant accessible HTML using AI-powered remediation. Free, no login required.",
  );
  useEffect(() => {
    window.scrollTo(0, 0);
    trackEvent("pdf-upload", "page_view");
  }, []);
  const { isLoading: authLoading, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [copiedUploadError, setCopiedUploadError] = useState(false);
  // Pre-upload size heuristic: files held here are waiting for user confirmation
  // before the upload actually starts. null means no preflight in progress.
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [sizeWarning, setSizeWarning] = useState<string | null>(null);
  const [googleDocUrl, setGoogleDocUrl] = useState("");
  const [googleSheetUrl, setGoogleSheetUrl] = useState("");
  const [googleSlideUrl, setGoogleSlideUrl] = useState("");
  const [googleSheetTab, setGoogleSheetTab] = useState("");

  // Batch upload queue — used when multiple files are dropped at once.
  const [fileQueue, setFileQueue] = useState<Array<{
    id: string;
    file: File;
    status: "pending" | "uploading" | "done" | "error";
    conversionId?: number;
    error?: string;
  }>>([]);
  const isUploadingRef = useRef(false);

  // Process the queue one file at a time.
  useEffect(() => {
    const pending = fileQueue.find((f) => f.status === "pending");
    if (!pending || isUploadingRef.current) return;

    isUploadingRef.current = true;
    setFileQueue((prev) =>
      prev.map((f) => (f.id === pending.id ? { ...f, status: "uploading" } : f)),
    );

    (async () => {
      try {
        const formData = new FormData();
        formData.append("file", pending.file);
        const res = await fetch("/api/conversions/upload", {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        if (!res.ok) {
          const text = await res.text();
          throw parseConversionsUploadError(text);
        }
        const data = await res.json();
        setFileQueue((prev) =>
          prev.map((f) =>
            f.id === pending.id ? { ...f, status: "done", conversionId: data.id } : f,
          ),
        );
      } catch (err: any) {
        setFileQueue((prev) =>
          prev.map((f) =>
            f.id === pending.id
              ? { ...f, status: "error", error: err.message || "Upload failed" }
              : f,
          ),
        );
      } finally {
        isUploadingRef.current = false;
      }
    })();
  }, [fileQueue]);

  const { data: recentConversions } = useQuery<any[]>({
    queryKey: ["/api/conversions"],
    enabled: isAuthenticated,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/conversions/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        throw parseConversionsUploadError(text);
      }
      return res.json();
    },
    onSuccess: (data) => {
      navigate(`/pdf-accessibility/${data.id}`);
    },
    onError: (err: Error) => {
      setUploadError(err.message || "Upload failed. Please try again.");
    },
  });

  const googleDocMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await apiRequest("POST", "/api/conversions/import-google-doc", { url });
      return res.json();
    },
    onSuccess: (data) => {
      trackEvent("pdf-upload", "google_doc_import");
      navigate(`/pdf-accessibility/${data.id}`);
    },
    onError: (err: Error) => {
      const fallback = "Import failed. Please try again. If the problem persists, try refreshing the page.";
      let message = fallback;
      const raw = err.message || "";
      if (isSessionExpiredMessage(raw)) {
        setUploadError(raw);
        return;
      }
      if (!raw.trimStart().startsWith("<")) {
        try {
          const jsonPart = raw.replace(/^\d+:\s*/, "");
          const parsed = JSON.parse(jsonPart);
          if (parsed.error) message = parsed.error;
        } catch {}
      }
      setUploadError(message);
    },
  });

  const googleSheetMutation = useMutation({
    mutationFn: async ({ url, sheetName }: { url: string; sheetName?: string }) => {
      const res = await apiRequest("POST", "/api/conversions/import-google-sheet", {
        url,
        ...(sheetName ? { sheetName } : {}),
      });
      return res.json();
    },
    onSuccess: (data) => {
      trackEvent("pdf-upload", "google_sheet_import");
      navigate(`/pdf-accessibility/${data.id}`);
    },
    onError: (err: Error) => {
      const raw = err.message || "";
      if (isSessionExpiredMessage(raw)) {
        setUploadError(raw);
        return;
      }
      const fallback = "Import failed. Please try again. If the problem persists, try refreshing the page.";
      let message = fallback;
      if (!raw.trimStart().startsWith("<")) {
        try {
          const jsonPart = raw.replace(/^\d+:\s*/, "");
          const parsed = JSON.parse(jsonPart);
          if (parsed.error) message = parsed.error;
        } catch {}
      }
      setUploadError(message);
    },
  });

  const handleGoogleSheetImport = () => {
    setUploadError(null);
    const trimmed = googleSheetUrl.trim();
    if (!trimmed) {
      setUploadError("Please paste a Google Sheets URL.");
      return;
    }
    if (!trimmed.match(/docs\.google\.com\/spreadsheets\/d\//)) {
      setUploadError(
        "Invalid Google Sheets URL. Please paste a link like https://docs.google.com/spreadsheets/d/...",
      );
      return;
    }
    googleSheetMutation.mutate({
      url: trimmed,
      sheetName: googleSheetTab.trim() || undefined,
    });
  };

  const handleGoogleDocDownload = () => {
    setUploadError(null);
    const trimmed = googleDocUrl.trim();
    if (!trimmed) {
      setUploadError("Please paste a Google Docs, Sheets, or Slides URL.");
      return;
    }
    if (!trimmed.match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\//)) {
      setUploadError(
        "Invalid URL. Please paste a Google Docs (docs.google.com/document/d/...), Sheets (docs.google.com/spreadsheets/d/...), or Slides (docs.google.com/presentation/d/...) link.",
      );
      return;
    }
    if (trimmed.match(/docs\.google\.com\/spreadsheets\/d\//)) {
      googleSheetMutation.mutate({ url: trimmed });
    } else if (trimmed.match(/docs\.google\.com\/presentation\/d\//)) {
      googleSlideMutation.mutate(trimmed);
    } else {
      googleDocMutation.mutate(trimmed);
    }
  };

  const googleSlideMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await apiRequest("POST", "/api/conversions/import-google-slide", { url });
      return res.json();
    },
    onSuccess: (data) => {
      trackEvent("pdf-upload", "google_slide_import");
      navigate(`/pdf-accessibility/${data.id}`);
    },
    onError: (err: Error) => {
      const fallback = "Import failed. Please try again. If the problem persists, try refreshing the page.";
      let message = fallback;
      const raw = err.message || "";
      if (!raw.trimStart().startsWith("<")) {
        try {
          const jsonPart = raw.replace(/^\d+:\s*/, "");
          const parsed = JSON.parse(jsonPart);
          if (parsed.error) message = parsed.error;
        } catch {}
      }
      setUploadError(message);
    },
  });

  const handleGoogleSlideImport = () => {
    setUploadError(null);
    const trimmed = googleSlideUrl.trim();
    if (!trimmed) {
      setUploadError("Please paste a Google Slides URL.");
      return;
    }
    if (!trimmed.match(/docs\.google\.com\/presentation\/d\//)) {
      setUploadError(
        "Invalid Google Slides URL. Please paste a link like https://docs.google.com/presentation/d/...",
      );
      return;
    }
    googleSlideMutation.mutate(trimmed);
  };

  // Actually kick off the upload for the given files.
  // Called either immediately (no size warning) or after user confirmation.
  const startUpload = (files: File[]) => {
    setSizeWarning(null);
    setPendingFiles(null);

    if (files.length === 1 && fileQueue.length === 0) {
      // Single file, no existing queue: use the direct-navigate flow.
      uploadMutation.mutate(files[0]);
      return;
    }

    // Multiple files: add them all to the queue for sequential processing.
    const newItems = files.map((file) => ({
      id: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      status: "pending" as const,
    }));
    setFileQueue((prev) => [...prev, ...newItems]);
  };

  const handleFileDrop = (files: File[]) => {
    setUploadError(null);
    if (files.length === 0) return;

    // Pre-upload heuristic: if any file is large, hold the files and show a
    // confirmation prompt. Upload only starts after the user explicitly
    // confirms. This lets faculty decide whether to proceed or split the doc
    // before spending time on a long upload + extraction.
    const warning = getLargeSizeWarning(files);
    if (warning) {
      setSizeWarning(warning);
      setPendingFiles(files);
      return; // do NOT upload yet — wait for user confirmation
    }

    startUpload(files);
  };

  const handleConfirmUpload = () => {
    if (pendingFiles) startUpload(pendingFiles);
  };

  const handleCancelPending = () => {
    setSizeWarning(null);
    setPendingFiles(null);
  };

  if (authLoading) {
    return <LoadingScreen />;
  }

  const recent = isAuthenticated ? recentConversions?.slice(0, 5) || [] : [];

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="min-h-screen bg-background"
    >
      <header className="border-b bg-background/95 backdrop-blur sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isAuthenticated && (
              <button
                onClick={() => navigate("/pdf-accessibility/history")}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                data-testid="link-history"
              >
                <History className="w-4 h-4" />
                History
              </button>
            )}
            <button
              onClick={() => navigate("/pdf-accessibility/faq")}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              data-testid="link-faq"
            >
              <HelpCircle className="w-4 h-4" />
              FAQ
            </button>
            <ConverterHeader
              showLibrary={false}
              showHelp={false}
            />
          </div>
        </div>
      </header>

      {/* Hero section.
           The background is intentionally hardcoded as a dark gray gradient
           (from-gray-900 via-gray-800 to-gray-900) — it does NOT follow the
           app's light/dark theme toggle. The logo itself still swaps based on
           the active theme so it stays theme-aware if the background is ever
           changed to follow the app's light/dark mode. */}
      <section
        aria-labelledby="id-converter-heading"
        className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white py-16 px-4"
      >
        <div className="container mx-auto max-w-4xl text-center">
          <div className="flex justify-center mb-6" data-testid="cai-logo-area">
            <button
              onClick={() => navigate("/")}
              aria-label="Home — CAI Tools"
              data-testid="button-home-logo"
              className="flex-shrink-0"
            >
              <img
                src={LOGO_BANNER_BACKGROUND === "dark" ? caiLogoWhite : caiLogoDarkInk}
                alt="Center for Artificial Intelligence"
                className="h-20 md:h-24 w-auto"
                data-testid="img-cai-logo"
              />
            </button>
          </div>

          <h1
            id="id-converter-heading"
            className="text-3xl md:text-4xl font-bold mb-3 tracking-tight"
            data-testid="text-page-title"
          >
            Accessibility Remediation Tools
          </h1>
          <span className="inline-block text-xs font-semibold bg-white/10 border border-white/20 text-gray-200 px-3 py-1 rounded-full mb-6">
            ADA Title II · WCAG 2.1 AA
          </span>
          <p className="text-gray-300 max-w-2xl mx-auto text-base mb-10 leading-relaxed" data-testid="text-accessibility-tagline">
            A free, shared accessibility resource from the Bridgewater State University Center for Artificial Intelligence. Built to help Massachusetts state universities and community colleges work toward ADA Title II and WCAG 2.1 AA accessibility standards.
          </p>

        </div>
      </section>

      <div className="container mx-auto px-4 py-12 max-w-4xl">

        {uploadError && (
          <div
            className="w-full max-w-2xl mx-auto mb-6 p-4 bg-destructive/10 border border-destructive/20 text-destructive rounded-xl flex items-start gap-3 shadow-sm"
            role="alert"
            data-testid="text-upload-error"
          >
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex flex-col gap-2 flex-1">
              <div className="flex items-start gap-2">
                <p className="font-medium text-sm flex-1">{uploadError}</p>
                <button
                  type="button"
                  data-testid="button-copy-upload-error"
                  aria-label={copiedUploadError ? "Error message copied" : "Copy error message"}
                  onClick={() => {
                    navigator.clipboard.writeText(uploadError).then(() => {
                      setCopiedUploadError(true);
                      setTimeout(() => setCopiedUploadError(false), 2000);
                    }).catch(() => {
                      setCopiedUploadError(false);
                    });
                  }}
                  className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-destructive/30 bg-destructive/10 hover:bg-destructive/20 text-destructive transition-colors flex-shrink-0"
                >
                  {copiedUploadError ? (
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
              {isSessionExpiredMessage(uploadError) && (
                <button
                  onClick={() => {
                    const returnTo = window.location.pathname + window.location.search;
                    window.location.href = `/api/login?returnTo=${encodeURIComponent(returnTo)}`;
                  }}
                  className="self-start text-sm font-semibold underline underline-offset-2 hover:opacity-80 transition-opacity"
                  data-testid="button-sign-in-again"
                >
                  Sign in again
                </button>
              )}
            </div>
          </div>
        )}

        <div className="w-full max-w-2xl mx-auto mb-8 bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-muted border-b border-border flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary text-primary-foreground">
              <FileText className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h3
                className="font-bold text-foreground text-lg"
                data-testid="heading-upload-section"
              >
                Upload a Document
              </h3>
              <p className="text-sm text-muted-foreground">
                Drag and drop or click to browse — multiple files supported
              </p>
            </div>
          </div>
          <div className="p-6 space-y-3">
            <UploadDropzone
              onUpload={handleFileDrop}
              isUploading={uploadMutation.isPending}
            />
            <div
              className="rounded-xl border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 px-4 py-3 text-sm text-blue-800 dark:text-blue-300 flex items-start gap-2"
              role="note"
              data-testid="text-formatting-loss-notice"
            >
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-blue-500 dark:text-blue-400" aria-hidden="true" />
              <p>
                <span className="font-semibold">Formatting note:</span> The converted document will be clean, structured HTML. Colors, custom fonts, and visual layout from the original are intentionally removed — this is what makes the output WCAG-compliant and readable by screen readers.
              </p>
            </div>
            {sizeWarning && (
              <div
                className="rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-800 dark:text-amber-300"
                role="alertdialog"
                aria-live="assertive"
                aria-label="Large file warning"
                data-testid="text-size-warning"
              >
                <div className="flex items-start gap-2 mb-3">
                  <TriangleAlert className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
                  <p>
                    <span className="font-semibold">Heads up (rough estimate): </span>
                    {sizeWarning}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-6">
                  <button
                    type="button"
                    onClick={handleConfirmUpload}
                    className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                    data-testid="button-confirm-large-upload"
                  >
                    Upload anyway
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelPending}
                    className="px-3 py-1.5 rounded-lg border border-amber-400 dark:border-amber-600 bg-transparent hover:bg-amber-100 dark:hover:bg-amber-900/30 text-amber-800 dark:text-amber-300 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                    data-testid="button-cancel-large-upload"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Batch upload queue — shown when multiple files are being processed */}
        {fileQueue.length > 0 && (
          <div className="w-full max-w-2xl mx-auto mb-6">
            <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-3 bg-muted border-b border-border flex items-center justify-between">
                <h3 className="font-semibold text-sm text-foreground">
                  Upload Queue —{" "}
                  {fileQueue.filter((f) => f.status === "done").length}/{fileQueue.length} complete
                </h3>
                {fileQueue.every((f) => f.status === "done" || f.status === "error") && (
                  <button
                    onClick={() => { setFileQueue([]); setSizeWarning(null); }}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    data-testid="button-clear-queue"
                  >
                    Clear
                  </button>
                )}
              </div>
              <ul className="divide-y divide-border" role="list" aria-label="Upload queue">
                {fileQueue.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 px-5 py-3">
                    <div
                      className={cn(
                        "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs",
                        item.status === "done"
                          ? "bg-green-100 dark:bg-green-900/30 text-green-600"
                          : item.status === "error"
                          ? "bg-red-100 dark:bg-red-900/30 text-red-600"
                          : item.status === "uploading"
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground",
                      )}
                      aria-hidden="true"
                    >
                      {item.status === "done" ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : item.status === "error" ? (
                        <AlertCircle className="w-3.5 h-3.5" />
                      ) : item.status === "uploading" ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <span>·</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" title={item.file.name}>
                        {item.file.name}
                      </p>
                      {item.status === "error" && (
                        <div className="mt-0.5">
                          <p className="text-xs text-destructive">{item.error}</p>
                          {isSessionExpiredMessage(item.error || "") && (
                            <button
                              onClick={() => {
                                const returnTo = window.location.pathname + window.location.search;
                                window.location.href = `/api/login?returnTo=${encodeURIComponent(returnTo)}`;
                              }}
                              className="text-xs text-destructive font-semibold underline underline-offset-2 hover:opacity-80 transition-opacity"
                              data-testid={`button-sign-in-again-queue-${item.id}`}
                            >
                              Sign in again
                            </button>
                          )}
                        </div>
                      )}
                      {item.status === "uploading" && (
                        <p className="text-xs text-primary mt-0.5">Uploading…</p>
                      )}
                      {item.status === "pending" && (
                        <p className="text-xs text-muted-foreground mt-0.5">Waiting…</p>
                      )}
                      {item.file.size >= LARGE_FILE_THRESHOLD_BYTES && item.status !== "done" && item.status !== "error" && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5 flex items-center gap-1">
                          <TriangleAlert className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                          Large file — may be partially processed
                        </p>
                      )}
                    </div>
                    {item.status === "done" && item.conversionId && (
                      <button
                        onClick={() => navigate(`/pdf-accessibility/${item.conversionId}`)}
                        className="flex items-center gap-1 text-xs text-primary font-semibold hover:underline flex-shrink-0"
                        data-testid={`link-view-conversion-${item.conversionId}`}
                      >
                        View <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 w-full max-w-2xl mx-auto mb-4">

          {/* Google Workspace (Docs / Sheets / Slides) */}
          <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden flex flex-col">
            <div className="px-4 py-3 bg-muted border-b border-border flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
                <SiGoogledrive className="w-4 h-4" aria-hidden="true" />
              </div>
              <div>
                <h3
                  className="font-bold text-foreground text-sm"
                  data-testid="heading-google-section"
                >
                  Google Workspace
                </h3>
                <p className="text-xs text-muted-foreground">
                  Docs, Sheets, or Slides
                </p>
              </div>
            </div>
            <div className="p-4 flex flex-col flex-1" data-testid="google-doc-import-section">
              <div className="flex flex-col gap-2">
                <div className="relative">
                  <label htmlFor="google-doc-url" className="sr-only">
                    Google Workspace URL (Docs, Sheets, or Slides)
                  </label>
                  <SiGoogledrive
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <input
                    id="google-doc-url"
                    type="url"
                    value={googleDocUrl}
                    onChange={(e) => setGoogleDocUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleGoogleDocDownload();
                    }}
                    placeholder="Paste a Docs, Sheets, or Slides URL"
                    className="w-full pl-10 pr-3 py-2 border border-border rounded-xl bg-background text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
                    data-testid="input-google-doc-url"
                  />
                </div>
                <button
                  onClick={handleGoogleDocDownload}
                  disabled={!googleDocUrl.trim() || googleDocMutation.isPending || googleSheetMutation.isPending || googleSlideMutation.isPending}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-semibold shadow-sm hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:transform-none"
                  data-testid="button-google-doc-import"
                >
                  {(googleDocMutation.isPending || googleSheetMutation.isPending || googleSlideMutation.isPending) ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  )}
                  Import
                </button>
              </div>
              <p
                className="mt-2 text-xs text-muted-foreground"
                data-testid="text-google-doc-hint"
              >
                Share the document as "Anyone with the link" before importing.
              </p>
            </div>
          </div>

          {/* Google Sheets */}
          <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden flex flex-col">
            <div className="px-4 py-3 bg-muted border-b border-border flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-gradient-to-br from-emerald-500 to-green-600 text-white">
                <SiGooglesheets className="w-4 h-4" aria-hidden="true" />
              </div>
              <div>
                <h3
                  className="font-bold text-foreground text-sm"
                  data-testid="heading-google-sheet-section"
                >
                  Google Sheets
                </h3>
                <p className="text-xs text-muted-foreground">
                  Shared spreadsheet
                </p>
              </div>
            </div>
            <div className="p-4 flex flex-col flex-1" data-testid="google-sheet-import-section">
              <div className="flex flex-col gap-2">
                <div className="relative">
                  <label htmlFor="google-sheet-url" className="sr-only">
                    Google Sheets URL
                  </label>
                  <SiGooglesheets
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <input
                    id="google-sheet-url"
                    type="url"
                    value={googleSheetUrl}
                    onChange={(e) => setGoogleSheetUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleGoogleSheetImport();
                    }}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className="w-full pl-10 pr-3 py-2 border border-border rounded-xl bg-background text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
                    data-testid="input-google-sheet-url"
                    disabled={googleSheetMutation.isPending}
                  />
                </div>
                <button
                  onClick={handleGoogleSheetImport}
                  disabled={!googleSheetUrl.trim() || googleSheetMutation.isPending}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-semibold shadow-sm hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:transform-none"
                  data-testid="button-google-sheet-import"
                >
                  {googleSheetMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  )}
                  {googleSheetMutation.isPending ? "Importing…" : "Import"}
                </button>
              </div>
              <div className="mt-2">
                <label htmlFor="google-sheet-tab" className="block text-xs font-medium text-muted-foreground mb-1">
                  Tab <span className="font-normal">(optional)</span>
                </label>
                <input
                  id="google-sheet-tab"
                  type="text"
                  value={googleSheetTab}
                  onChange={(e) => setGoogleSheetTab(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleGoogleSheetImport();
                  }}
                  placeholder='e.g. "Sheet2" or 3'
                  className="w-full px-3 py-2 border border-border rounded-xl bg-background text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
                  data-testid="input-google-sheet-tab"
                  disabled={googleSheetMutation.isPending}
                />
              </div>
              <p
                className="mt-2 text-xs text-muted-foreground"
                data-testid="text-google-sheet-hint"
              >
                Share as "Anyone with the link" in Google Sheets.
              </p>
            </div>
          </div>

          {/* Google Slides */}
          <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden flex flex-col">
            <div className="px-4 py-3 bg-muted border-b border-border flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-white">
                <SiGoogleslides className="w-4 h-4" aria-hidden="true" />
              </div>
              <div>
                <h3
                  className="font-bold text-foreground text-sm"
                  data-testid="heading-google-slide-section"
                >
                  Google Slides
                </h3>
                <p className="text-xs text-muted-foreground">
                  Shared presentation
                </p>
              </div>
            </div>
            <div className="p-4 flex flex-col flex-1" data-testid="google-slide-import-section">
              <div className="flex flex-col gap-2">
                <div className="relative">
                  <label htmlFor="google-slide-url" className="sr-only">
                    Google Slides URL
                  </label>
                  <SiGoogleslides
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <input
                    id="google-slide-url"
                    type="url"
                    value={googleSlideUrl}
                    onChange={(e) => setGoogleSlideUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleGoogleSlideImport();
                    }}
                    placeholder="https://docs.google.com/presentation/d/..."
                    className="w-full pl-10 pr-3 py-2 border border-border rounded-xl bg-background text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
                    data-testid="input-google-slide-url"
                    disabled={googleSlideMutation.isPending}
                  />
                </div>
                <button
                  onClick={handleGoogleSlideImport}
                  disabled={!googleSlideUrl.trim() || googleSlideMutation.isPending}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-semibold shadow-sm hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:transform-none"
                  data-testid="button-google-slide-import"
                >
                  {googleSlideMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  )}
                  {googleSlideMutation.isPending ? "Importing…" : "Import"}
                </button>
              </div>
              <p
                className="mt-2 text-xs text-muted-foreground"
                data-testid="text-google-slide-hint"
              >
                Share as "Anyone with the link" in Google Slides.
              </p>
            </div>
          </div>

        </div>

        <div className="max-w-3xl mx-auto mt-6 mb-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            More Accessibility Remediation Tools
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              {
                path: "/accessibility-tools/url-scanner",
                icon: <Globe className="w-5 h-5 text-white" />,
                gradient: "from-sky-500 to-cyan-600",
                label: "URL Scanner",
                description: "Check any webpage for accessibility issues and WCAG violations.",
                testid: "link-tool-url-scanner",
                toolName: "tool:url-scanner" as const,
              },
              {
                path: "/accessibility-tools/color-contrast",
                icon: <Eye className="w-5 h-5 text-white" />,
                gradient: "from-amber-500 to-orange-600",
                label: "Color Contrast",
                description: "Verify foreground/background color combinations meet WCAG contrast ratios.",
                testid: "link-tool-color-contrast",
                toolName: "tool:color-contrast" as const,
              },
              {
                path: "/accessibility-tools/alt-text",
                icon: <Image className="w-5 h-5 text-white" />,
                gradient: "from-fuchsia-500 to-pink-600",
                label: "Alt Text",
                description: "Generate and review alternative text descriptions for images.",
                testid: "link-tool-alt-text",
                toolName: "tool:alt-text" as const,
              },
              {
                path: "/accessibility-tools/math-ocr",
                icon: <Calculator className="w-5 h-5 text-white" />,
                gradient: "from-rose-500 to-red-600",
                label: "Math OCR",
                description: "Extract and convert mathematical expressions into accessible formats.",
                testid: "link-tool-math-ocr",
                toolName: "tool:math-ocr" as const,
              },
            ].map((tool) => (
              <Link
                key={tool.testid}
                href={tool.path}
                className="flex items-center gap-4 rounded-lg border bg-card p-4 hover:bg-secondary/50 transition-colors group"
                data-testid={tool.testid}
                onClick={() => reportToolUsage(tool.toolName)}
              >
                <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${tool.gradient} flex items-center justify-center flex-shrink-0`}>
                  {tool.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-foreground text-sm group-hover:underline">{tool.label}</p>
                  <p className="text-xs text-muted-foreground">{tool.description}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {recent.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-foreground">Recent Conversions</h3>
              <button
                onClick={() => navigate("/pdf-accessibility/history")}
                className="text-sm text-primary font-medium hover:underline flex items-center gap-1"
                data-testid="link-view-all"
              >
                View all <ArrowRight className="w-3 h-3" />
              </button>
            </div>
            <div className="space-y-2">
              {recent.map((conv: any) => (
                <button
                  key={conv.id}
                  onClick={() => navigate(`/pdf-accessibility/${conv.id}`)}
                  className="w-full flex items-center gap-4 p-4 bg-card border rounded-xl hover:border-primary/30 transition-all text-left"
                  data-testid={`card-conversion-${conv.id}`}
                >
                  <FileText
                    className="w-5 h-5 text-primary flex-shrink-0"
                    aria-hidden="true"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">
                      {conv.originalFilename}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {conv.sourceType && conv.sourceType !== "pdf" && (
                        <span className="font-semibold mr-1">
                          {conv.sourceType === "google-doc"
                            ? "Google Doc"
                            : conv.sourceType === "google-sheet"
                              ? "Google Sheet"
                              : conv.sourceType === "google-slide"
                                ? "Google Slides"
                                : conv.sourceType === "docx"
                                  ? "DOCX"
                                  : conv.sourceType.toUpperCase()}
                        </span>
                      )}
                      {formatBytes(conv.fileSize)} ·{" "}
                      {format(new Date(conv.createdAt), "MMM d, yyyy")}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "text-xs font-semibold px-2.5 py-1 rounded-full",
                      conv.status === "completed"
                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                        : conv.status === "processing"
                          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                          : conv.status === "failed"
                            ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                            : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
                    )}
                  >
                    {conv.status === "completed"
                      ? "Accessible"
                      : conv.status === "processing"
                        ? "Processing"
                        : conv.status === "failed"
                          ? "Failed"
                          : "Uploaded"}
                  </span>
                  <ArrowRight
                    className="w-4 h-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <PoweredByFooter />
    </main>
  );
}

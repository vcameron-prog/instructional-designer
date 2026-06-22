import { useEffect, useState, useRef } from "react";
import { useLocation } from "wouter";
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
  Shield,
  Image,
  AlignLeft,
  LogIn,
  Info,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { HeaderControls } from "@/components/header-controls";
import { usePageTitle } from "@/hooks/use-page-title";
import { cn } from "@/lib/utils";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { LoadingScreen } from "@/components/loading-screen";
import { format } from "date-fns";
import { SiGoogledrive, SiGooglesheets, SiGoogleslides } from "react-icons/si";
import { apiRequest } from "@/lib/queryClient";
import { parseConversionsUploadError, isSessionExpiredMessage } from "@/lib/upload-error-utils";
import { UploadDropzone } from "@/components/UploadDropzone";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export default function PdfUpload() {
  usePageTitle("Accessibility Converter");
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [copiedUploadError, setCopiedUploadError] = useState(false);
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

  const handleFileDrop = (files: File[]) => {
    setUploadError(null);
    if (files.length === 0) return;

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
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 text-primary p-2 rounded-xl">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <h1
                className="font-bold text-foreground text-lg"
                data-testid="text-page-title"
              >
                Accessibility Converter
              </h1>
              <p className="text-xs text-muted-foreground">
                ADA Title II & WCAG 2.1 AA Compliance
              </p>
            </div>
          </div>
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
            <HeaderControls
              showHome={true}
              showLibrary={false}
              showHelp={false}
            />
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold text-foreground mb-3">
            Convert Documents to Accessible Formats
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Instantly remediate PDF, Word, PowerPoint, and Excel documents — or import directly from Google Docs, Google Sheets, or Google Slides — to meet ADA Title II and WCAG 2.1 AA requirements using advanced AI structural analysis and description generation.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10 max-w-3xl mx-auto">
          <div className="rounded-lg border bg-card p-5 flex flex-col items-center text-center gap-2">
            <Shield className="w-7 h-7 text-primary flex-shrink-0" />
            <h3 className="font-semibold text-foreground">Title II Compliant</h3>
            <p className="text-sm text-muted-foreground">Ensures your documents meet the rigorous standards required for state and local governments.</p>
          </div>
          <div className="rounded-lg border bg-card p-5 flex flex-col items-center text-center gap-2">
            <Image className="w-7 h-7 text-primary flex-shrink-0" />
            <h3 className="font-semibold text-foreground">AI Alt Text</h3>
            <p className="text-sm text-muted-foreground">Automatically detects images and charts, generating accurate semantic alternative text descriptions.</p>
          </div>
          <div className="rounded-lg border bg-card p-5 flex flex-col items-center text-center gap-2">
            <AlignLeft className="w-7 h-7 text-primary flex-shrink-0" />
            <h3 className="font-semibold text-foreground">Reading Order</h3>
            <p className="text-sm text-muted-foreground">Restructures complex multi-column layouts into a linear, logical reading order for screen readers.</p>
          </div>
        </div>

        {!isAuthenticated && !uploadMutation.isPending && !googleDocMutation.isPending && !googleSheetMutation.isPending && !googleSlideMutation.isPending && fileQueue.every((f) => f.status === "done" || f.status === "error") && (
          <div
            className="w-full max-w-2xl mx-auto mb-6 flex items-center justify-between gap-3 px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl text-sm"
            data-testid="banner-sign-in-nudge"
          >
            <p className="text-blue-700 dark:text-blue-300">
              BSU employees: sign in with your BSU account to automatically save your conversions to your history.
            </p>
            <a
              href="/api/login"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition-colors whitespace-nowrap"
              data-testid="link-sign-in"
            >
              <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
              Sign in
            </a>
          </div>
        )}

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
                  onClick={() => { window.location.href = "/api/login"; }}
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
          <div className="px-6 py-4 bg-secondary/50 border-b border-border flex items-center gap-3">
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
          <div className="p-6">
            <UploadDropzone
              onUpload={handleFileDrop}
              isUploading={uploadMutation.isPending}
            />
          </div>
        </div>

        {/* Batch upload queue — shown when multiple files are being processed */}
        {fileQueue.length > 0 && (
          <div className="w-full max-w-2xl mx-auto mb-6">
            <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-3 bg-secondary/50 border-b border-border flex items-center justify-between">
                <h3 className="font-semibold text-sm text-foreground">
                  Upload Queue —{" "}
                  {fileQueue.filter((f) => f.status === "done").length}/{fileQueue.length} complete
                </h3>
                {fileQueue.every((f) => f.status === "done" || f.status === "error") && (
                  <button
                    onClick={() => setFileQueue([])}
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
                              onClick={() => { window.location.href = "/api/login"; }}
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

        <div className="w-full max-w-2xl mx-auto mb-8 bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-secondary/50 border-b border-border flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary text-primary-foreground">
              <SiGoogledrive className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h3
                className="font-bold text-foreground text-lg"
                data-testid="heading-google-section"
              >
                Import from Google Workspace
              </h3>
              <p className="text-sm text-muted-foreground">
                Convert a shared Google Doc, Sheet, or Slide to an accessible format
              </p>
            </div>
          </div>
          <div className="p-6" data-testid="google-doc-import-section">
            <div>
              <div>
                <div>
                  <p className="text-sm font-semibold text-foreground mb-2">
                    Paste your Google Docs, Sheets, or Slides link and click Import
                  </p>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
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
                        placeholder="Paste a Google Docs, Sheets, or Slides URL"
                        className="w-full pl-10 pr-3 py-2.5 border border-border rounded-xl bg-background text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
                        data-testid="input-google-doc-url"
                      />
                    </div>
                    <button
                      onClick={handleGoogleDocDownload}
                      disabled={!googleDocUrl.trim() || googleDocMutation.isPending || googleSheetMutation.isPending || googleSlideMutation.isPending}
                      className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-semibold shadow-sm hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:transform-none"
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
                </div>
              </div>
            </div>
            <p
              className="mt-4 text-xs text-muted-foreground"
              data-testid="text-google-doc-hint"
            >
              The document must be shared as "Anyone with the link" for the
              import to work.
            </p>
          </div>
        </div>

        <div className="w-full max-w-2xl mx-auto mb-12 bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-secondary/50 border-b border-border flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary text-primary-foreground">
              <SiGooglesheets className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h3
                className="font-bold text-foreground text-lg"
                data-testid="heading-google-sheet-section"
              >
                Import from Google Sheets
              </h3>
              <p className="text-sm text-muted-foreground">
                Convert a shared Google Sheet to an accessible format
              </p>
            </div>
          </div>
          <div className="p-6" data-testid="google-sheet-import-section">
            <div className="flex gap-2">
              <div className="relative flex-1">
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
                  className="w-full pl-10 pr-3 py-2.5 border border-border rounded-xl bg-background text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
                  data-testid="input-google-sheet-url"
                  disabled={googleSheetMutation.isPending}
                />
              </div>
              <button
                onClick={handleGoogleSheetImport}
                disabled={!googleSheetUrl.trim() || googleSheetMutation.isPending}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-semibold shadow-sm hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:transform-none"
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
            <div className="mt-3">
              <label htmlFor="google-sheet-tab" className="block text-xs font-medium text-muted-foreground mb-1">
                Tab name or number <span className="font-normal">(optional — leave blank to import the first tab)</span>
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
              className="mt-3 text-xs text-muted-foreground"
              data-testid="text-google-sheet-hint"
            >
              The spreadsheet must be shared as "Anyone with the link" in Google
              Sheets.
            </p>
          </div>
        </div>

        <div className="w-full max-w-2xl mx-auto mb-12 bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-secondary/50 border-b border-border flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary text-primary-foreground">
              <SiGoogleslides className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h3
                className="font-bold text-foreground text-lg"
                data-testid="heading-google-slide-section"
              >
                Import from Google Slides
              </h3>
              <p className="text-sm text-muted-foreground">
                Convert a shared Google Slides presentation to an accessible format
              </p>
            </div>
          </div>
          <div className="p-6" data-testid="google-slide-import-section">
            <div className="flex gap-2">
              <div className="relative flex-1">
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
                  className="w-full pl-10 pr-3 py-2.5 border border-border rounded-xl bg-background text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
                  data-testid="input-google-slide-url"
                  disabled={googleSlideMutation.isPending}
                />
              </div>
              <button
                onClick={handleGoogleSlideImport}
                disabled={!googleSlideUrl.trim() || googleSlideMutation.isPending}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-semibold shadow-sm hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:transform-none"
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
              className="mt-4 text-xs text-muted-foreground"
              data-testid="text-google-slide-hint"
            >
              The presentation must be shared as "Anyone with the link" in Google
              Slides.
            </p>
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
        <div
          className="w-full max-w-2xl mx-auto mt-6 mb-4 flex items-start gap-3 px-4 py-3 bg-muted/50 border border-border rounded-xl text-sm"
          data-testid="banner-compliance-notice"
          role="note"
        >
          <Info className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-muted-foreground">
            This tool improves document accessibility but does not guarantee full WCAG 2.1 compliance. Automated remediation is a starting point — only a human reviewer can confirm a document is genuinely accessible. Each institution is responsible for verifying its own content.
          </p>
        </div>
      </div>
      <PoweredByFooter />
    </main>
  );
}

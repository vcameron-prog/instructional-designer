import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useDropzone } from "react-dropzone";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  UploadCloud,
  Loader2,
  AlertCircle,
  File,
  FileText,
  History,
  ArrowRight,
  HelpCircle,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { HeaderControls } from "@/components/header-controls";
import { usePageTitle } from "@/hooks/use-page-title";
import { cn } from "@/lib/utils";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { format } from "date-fns";
import { SiGoogledrive, SiGooglesheets } from "react-icons/si";
import { apiRequest } from "@/lib/queryClient";
import { parseConversionsUploadError } from "@/lib/upload-error-utils";

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
  const [googleDocUrl, setGoogleDocUrl] = useState("");
  const [googleSheetUrl, setGoogleSheetUrl] = useState("");

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

  const googleSheetMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await apiRequest("POST", "/api/conversions/import-google-sheet", { url });
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
    googleSheetMutation.mutate(trimmed);
  };

  const handleGoogleDocDownload = () => {
    setUploadError(null);
    const trimmed = googleDocUrl.trim();
    if (!trimmed) {
      setUploadError("Please paste a Google Docs URL.");
      return;
    }
    if (!trimmed.match(/docs\.google\.com\/document\/d\//)) {
      setUploadError(
        "Invalid Google Docs URL. Please paste a link like https://docs.google.com/document/d/...",
      );
      return;
    }
    const docIdMatch = trimmed.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (!docIdMatch) {
      setUploadError("Could not extract document ID from URL.");
      return;
    }
    const docId = docIdMatch[1];
    window.open(
      `https://docs.google.com/document/d/${docId}/export?format=docx`,
      "_blank",
    );
    setGoogleDocUrl("");
    setUploadError(null);
  };

  const onDrop = useCallback(
    (acceptedFiles: File[], rejectedFiles: any[]) => {
      setUploadError(null);
      if (rejectedFiles.length > 0) {
        setUploadError(
          "Please upload a valid PDF or Word (.docx) document under 20MB.",
        );
        return;
      }
      if (acceptedFiles.length > 0) {
        uploadMutation.mutate(acceptedFiles[0]);
      }
    },
    [uploadMutation],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        [".docx"],
    },
    maxFiles: 1,
    maxSize: 20 * 1024 * 1024,
    disabled: uploadMutation.isPending,
  });

  if (authLoading) {
    return (
      <main
        id="main-content"
        tabIndex={-1}
        className="min-h-screen flex items-center justify-center bg-background"
      >
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </main>
    );
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
            Upload a PDF or Word document and our AI will generate a WCAG 2.1 AA
            compliant accessible version. Download as Word (.docx) or HTML.
          </p>
        </div>

        {uploadError && (
          <div
            className="w-full max-w-2xl mx-auto mb-6 p-4 bg-destructive/10 border border-destructive/20 text-destructive rounded-xl flex items-center gap-3 shadow-sm"
            role="alert"
            data-testid="text-upload-error"
          >
            <AlertCircle className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
            <p className="font-medium text-sm">{uploadError}</p>
          </div>
        )}

        <div className="w-full max-w-2xl mx-auto mb-8 bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-secondary/50 border-b border-border flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary text-primary-foreground">
              <UploadCloud className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h3
                className="font-bold text-foreground text-lg"
                data-testid="heading-upload-section"
              >
                Upload a PDF or Word Document
              </h3>
              <p className="text-sm text-muted-foreground">
                Drag and drop or click to browse your files
              </p>
            </div>
          </div>
          <div className="p-6">
            <div
              {...getRootProps()}
              className={cn(
                "relative overflow-hidden group border-3 border-dashed rounded-2xl p-10 text-center transition-all duration-300 ease-out outline-none focus-visible:ring-4 focus-visible:ring-primary/20",
                isDragActive
                  ? "border-primary bg-primary/5 scale-[1.01]"
                  : "border-border hover:border-primary/50 hover:bg-secondary/50 bg-background",
                uploadMutation.isPending &&
                  "opacity-50 cursor-not-allowed pointer-events-none",
              )}
              data-testid="dropzone-upload"
            >
              <input
                {...getInputProps()}
                aria-label="Document File Upload"
                data-testid="input-file-upload"
              />
              <div className="flex flex-col items-center justify-center space-y-4">
                <div
                  className={cn(
                    "p-4 rounded-2xl transition-colors duration-300",
                    uploadMutation.isPending
                      ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                      : isDragActive
                        ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                        : "bg-secondary text-primary group-hover:bg-primary group-hover:text-primary-foreground",
                  )}
                >
                  {uploadMutation.isPending ? (
                    <Loader2
                      className="w-8 h-8 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <UploadCloud className="w-8 h-8" aria-hidden="true" />
                  )}
                </div>
                <div className="space-y-1">
                  <p className="text-lg font-bold text-foreground">
                    {uploadMutation.isPending
                      ? "Uploading & processing..."
                      : isDragActive
                        ? "Drop document here"
                        : "Select a document to remediate"}
                  </p>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                    {uploadMutation.isPending
                      ? "Your document is being prepared for accessibility remediation."
                      : "We will automatically generate a WCAG 2.1 AA compliant accessible version."}
                  </p>
                </div>
                {!uploadMutation.isPending && (
                  <div className="flex items-center gap-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    <span className="flex items-center gap-2 bg-background px-3 py-1.5 rounded-full border shadow-sm">
                      <File className="w-3.5 h-3.5" aria-hidden="true" />
                      PDF or DOCX up to 20MB
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

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
                Import from Google Docs
              </h3>
              <p className="text-sm text-muted-foreground">
                Convert a shared Google Doc to an accessible format
              </p>
            </div>
          </div>
          <div className="p-6" data-testid="google-doc-import-section">
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold mt-1">
                  1
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-foreground mb-2">
                    Paste your Google Docs link and click Download
                  </p>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <label htmlFor="google-doc-url" className="sr-only">
                        Google Docs URL
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
                        placeholder="https://docs.google.com/document/d/..."
                        className="w-full pl-10 pr-3 py-2.5 border border-border rounded-xl bg-background text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
                        data-testid="input-google-doc-url"
                      />
                    </div>
                    <button
                      onClick={handleGoogleDocDownload}
                      disabled={!googleDocUrl.trim()}
                      className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-semibold shadow-sm hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:transform-none"
                      data-testid="button-google-doc-import"
                    >
                      <ArrowRight className="w-4 h-4" aria-hidden="true" />
                      Download
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold mt-0.5">
                  2
                </div>
                <p className="text-sm font-semibold text-foreground mt-1">
                  Upload the downloaded Word file using the upload area above
                </p>
              </div>
            </div>
            <p
              className="mt-4 text-xs text-muted-foreground"
              data-testid="text-google-doc-hint"
            >
              The document must be shared as "Anyone with the link" for the
              download to work.
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
            <p
              className="mt-4 text-xs text-muted-foreground"
              data-testid="text-google-sheet-hint"
            >
              The spreadsheet must be shared as "Anyone with the link" in Google
              Sheets. Only the first sheet is imported.
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

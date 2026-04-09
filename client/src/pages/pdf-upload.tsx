import { useCallback, useState } from "react";
import { useLocation } from "wouter";
import { useDropzone } from "react-dropzone";
import { useMutation, useQuery } from "@tanstack/react-query";
import { UploadCloud, Loader2, AlertCircle, File, FileText, History, ArrowRight, HelpCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { HeaderControls } from "@/components/header-controls";
import { usePageTitle } from "@/hooks/use-page-title";
import { cn } from "@/lib/utils";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { format } from "date-fns";
import { SiGoogledrive } from "react-icons/si";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export default function PdfUpload() {
  usePageTitle("Document Accessibility Converter");
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [googleDocUrl, setGoogleDocUrl] = useState("");

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
        throw new Error(text || "Upload failed");
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

  const handleGoogleDocDownload = () => {
    setUploadError(null);
    const trimmed = googleDocUrl.trim();
    if (!trimmed) {
      setUploadError("Please paste a Google Docs URL.");
      return;
    }
    if (!trimmed.match(/docs\.google\.com\/document\/d\//)) {
      setUploadError("Invalid Google Docs URL. Please paste a link like https://docs.google.com/document/d/...");
      return;
    }
    const docIdMatch = trimmed.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (!docIdMatch) {
      setUploadError("Could not extract document ID from URL.");
      return;
    }
    const docId = docIdMatch[1];
    window.open(`https://docs.google.com/document/d/${docId}/export?format=docx`, "_blank");
    setGoogleDocUrl("");
    setUploadError(null);
  };

  const onDrop = useCallback(
    (acceptedFiles: File[], rejectedFiles: any[]) => {
      setUploadError(null);
      if (rejectedFiles.length > 0) {
        setUploadError("Please upload a valid PDF or Word (.docx) document under 20MB.");
        return;
      }
      if (acceptedFiles.length > 0) {
        uploadMutation.mutate(acceptedFiles[0]);
      }
    },
    [uploadMutation]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
    },
    maxFiles: 1,
    maxSize: 20 * 1024 * 1024,
    disabled: uploadMutation.isPending,
  });

  if (authLoading) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </main>
    );
  }

  const recent = isAuthenticated ? (recentConversions?.slice(0, 5) || []) : [];

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 text-primary p-2 rounded-xl">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <h1 className="font-bold text-foreground text-lg" data-testid="text-page-title">Document Accessibility Converter</h1>
              <p className="text-xs text-muted-foreground">ADA Title II & WCAG 2.1 AA Compliance</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isAuthenticated && <button
              onClick={() => navigate("/pdf-accessibility/history")}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              data-testid="link-history"
            >
              <History className="w-4 h-4" />
              History
            </button>}
            <button
              onClick={() => navigate("/pdf-accessibility/faq")}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              data-testid="link-faq"
            >
              <HelpCircle className="w-4 h-4" />
              FAQ
            </button>
            <button
              onClick={() => navigate("/")}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              data-testid="link-home"
            >
              Back to Tools
            </button>
            <HeaderControls showHome={false} showLibrary={false} showHelp={false} />
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold text-foreground mb-3">Convert Documents to Accessible Formats</h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Upload a PDF or Word document and our AI will generate a WCAG 2.1 AA compliant accessible version. Download as Word (.docx) or HTML.
          </p>
        </div>

        <div className="w-full max-w-2xl mx-auto mb-12">
          <div
            {...getRootProps()}
            className={cn(
              "relative overflow-hidden group border-3 border-dashed rounded-3xl p-12 text-center transition-all duration-300 ease-out outline-none focus-visible:ring-4 focus-visible:ring-primary/20",
              isDragActive
                ? "border-primary bg-primary/5 scale-[1.02]"
                : "border-border hover:border-primary/50 hover:bg-secondary/50 bg-card",
              uploadMutation.isPending && "opacity-50 cursor-not-allowed pointer-events-none"
            )}
            data-testid="dropzone-upload"
          >
            <input {...getInputProps()} aria-label="Document File Upload" data-testid="input-file-upload" />
            <div className="flex flex-col items-center justify-center space-y-6">
              <div
                className={cn(
                  "p-5 rounded-2xl transition-colors duration-300",
                  uploadMutation.isPending
                    ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                    : isDragActive
                      ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                      : "bg-secondary text-primary group-hover:bg-primary group-hover:text-primary-foreground"
                )}
              >
                {uploadMutation.isPending ? (
                  <Loader2 className="w-10 h-10 animate-spin" aria-hidden="true" />
                ) : (
                  <UploadCloud className="w-10 h-10" aria-hidden="true" />
                )}
              </div>
              <div className="space-y-2">
                <h3 className="text-2xl font-bold text-foreground">
                  {uploadMutation.isPending
                    ? "Uploading & processing..."
                    : isDragActive
                      ? "Drop document here"
                      : "Select a document to remediate"}
                </h3>
                <p className="text-muted-foreground font-medium max-w-sm mx-auto">
                  {uploadMutation.isPending
                    ? "Your document is being uploaded and prepared for accessibility remediation."
                    : "Drag and drop your PDF or Word document here, or click to browse. We will automatically generate an accessible WCAG 2.1 AA compliant version."}
                </p>
              </div>
              {!uploadMutation.isPending && (
                <div className="flex items-center gap-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <span className="flex items-center gap-2 bg-background px-4 py-2 rounded-full border shadow-sm">
                    <File className="w-4 h-4" aria-hidden="true" />
                    PDF or DOCX up to 20MB
                  </span>
                  <span className="bg-background px-4 py-2 rounded-full border shadow-sm">One document at a time</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4 mt-6">
            <div className="flex-1 border-t border-border" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">or import from Google Docs</span>
            <div className="flex-1 border-t border-border" />
          </div>

          <div className="mt-4 flex gap-2" data-testid="google-doc-import-section">
            <div className="relative flex-1">
              <SiGoogledrive className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <input
                type="url"
                value={googleDocUrl}
                onChange={(e) => setGoogleDocUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleGoogleDocDownload(); }}
                placeholder="Paste Google Docs link here..."
                className="w-full pl-10 pr-3 py-3 border border-border rounded-xl bg-background text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
                data-testid="input-google-doc-url"
              />
            </div>
            <button
              onClick={handleGoogleDocDownload}
              disabled={!googleDocUrl.trim()}
              className="inline-flex items-center gap-2 px-5 py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-semibold shadow-sm hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:transform-none"
              data-testid="button-google-doc-import"
            >
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
              Download
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground text-center" data-testid="text-google-doc-hint">
            Downloads your Google Doc as a Word file — then upload it above
          </p>

          {uploadError && (
            <div
              className="mt-4 p-4 bg-destructive/10 border border-destructive/20 text-destructive rounded-xl flex items-center gap-3 shadow-sm"
              role="alert"
              data-testid="text-upload-error"
            >
              <AlertCircle className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
              <p className="font-medium text-sm">{uploadError}</p>
            </div>
          )}
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

                  <FileText className="w-5 h-5 text-primary flex-shrink-0" aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">{conv.originalFilename}</p>
                    <p className="text-xs text-muted-foreground">
                      {conv.sourceType && conv.sourceType !== "pdf" && (
                        <span className="uppercase font-semibold mr-1">{conv.sourceType}</span>
                      )}
                      {formatBytes(conv.fileSize)} · {format(new Date(conv.createdAt), "MMM d, yyyy")}
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
                            : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                    )}
                  >
                    {conv.status === "completed" ? "Accessible" : conv.status === "processing" ? "Processing" : conv.status === "failed" ? "Failed" : "Uploaded"}
                  </span>
                  <ArrowRight className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
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

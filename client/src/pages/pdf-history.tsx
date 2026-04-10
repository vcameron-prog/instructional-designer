import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { FileText, Trash2, ArrowLeft, Loader2, Upload, ArrowRight } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { HeaderControls } from "@/components/header-controls";
import { usePageTitle } from "@/hooks/use-page-title";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { format } from "date-fns";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export default function PdfHistory() {
  usePageTitle("Conversion History");
  useEffect(() => { window.scrollTo(0, 0); }, []);
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();

  const { data: conversions, isLoading } = useQuery<any[]>({
    queryKey: ["/api/conversions"],
    enabled: isAuthenticated,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/conversions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversions"] });
    },
  });

  if (authLoading || isLoading) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </main>
    );
  }

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/pdf-accessibility")}
              className="text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="font-bold text-foreground text-lg" data-testid="text-page-title">Conversion History</h1>
              <p className="text-xs text-muted-foreground">{conversions?.length || 0} documents converted</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate("/pdf-accessibility")}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-bold shadow-sm hover:-translate-y-0.5 transition-all"
              data-testid="button-new-conversion"
            >
              <Upload className="w-4 h-4" />
              New Conversion
            </button>
            <HeaderControls showHome={true} showLibrary={false} showHelp={false} />
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {!conversions || conversions.length === 0 ? (
          <div className="text-center py-16">
            <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-50" />
            <h2 className="text-xl font-bold text-foreground mb-2">No conversions yet</h2>
            <p className="text-muted-foreground mb-6">Upload a document to get started with accessibility remediation.</p>
            <button
              onClick={() => navigate("/pdf-accessibility")}
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-xl font-bold shadow-md hover:-translate-y-0.5 transition-all"
              data-testid="button-upload-first"
            >
              <Upload className="w-5 h-5" />
              Upload Document
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {conversions.map((conv: any) => (
              <div
                key={conv.id}
                className="flex items-center gap-4 p-4 bg-card border rounded-xl hover:border-primary/30 transition-all group"
                data-testid={`card-history-${conv.id}`}
              >
                <button
                  onClick={() => navigate(`/pdf-accessibility/${conv.id}`)}
                  className="flex items-center gap-4 flex-1 min-w-0 text-left"
                  data-testid={`link-conversion-${conv.id}`}
                >
                  <FileText className="w-5 h-5 text-primary flex-shrink-0" aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">{conv.originalFilename}</p>
                    <p className="text-xs text-muted-foreground">
                      {conv.sourceType && (
                        <span className="uppercase font-semibold mr-1">{conv.sourceType}</span>
                      )}
                      {formatBytes(conv.fileSize)}
                      {conv.pageCount && ` · ${conv.pageCount} pages`}
                      {" · "}
                      {format(new Date(conv.createdAt), "MMM d, yyyy 'at' h:mm a")}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0",
                      conv.status === "completed"
                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                        : conv.status === "processing"
                          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                          : conv.status === "failed"
                            ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                            : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                    )}
                  >
                    {conv.status === "completed"
                      ? `Accessible${conv.complianceReport?.overallScore != null ? ` (${conv.complianceReport.overallScore}%)` : ""}`
                      : conv.status === "processing"
                        ? "Processing"
                        : conv.status === "failed"
                          ? "Failed"
                          : "Uploaded"}
                  </span>
                  <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm("Delete this conversion? This cannot be undone.")) {
                      deleteMutation.mutate(conv.id);
                    }
                  }}
                  disabled={deleteMutation.isPending}
                  className="text-muted-foreground hover:text-destructive transition-colors p-2 rounded-lg hover:bg-destructive/10 flex-shrink-0"
                  aria-label={`Delete ${conv.originalFilename}`}
                  data-testid={`button-delete-${conv.id}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <PoweredByFooter />
    </main>
  );
}

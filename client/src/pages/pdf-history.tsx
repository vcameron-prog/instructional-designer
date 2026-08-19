import { useEffect, useState, useMemo } from "react";
import { useLocation } from "wouter";
import caiLogo from "@assets/bsu-cai-logo.png";
import caiLogoWhite from "@assets/Center_for_AI_Apparel_&_Promotional_Items-WHITE_(1)_1775653892158.png";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  FileText,
  Trash2,
  Loader2,
  Upload,
  ArrowRight,
  Search,
  X,
  Download,
  ChevronDown,
  FileCode2,
  FileType,
  FileDown,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { ConverterHeader, BackButton } from "@/components/header-controls";
import { usePageTitle } from "@/hooks/use-page-title";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { pushFilterState } from "@/lib/nav-utils";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { LoadingScreen } from "@/components/loading-screen";
import { format, subDays, startOfDay } from "date-fns";
import { SiGoogledrive, SiGooglesheets, SiGoogleslides } from "react-icons/si";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

type DateRange = "7" | "30" | "all";
type SortOption = "newest" | "oldest" | "filename" | "status";

const STATUS_ORDER: Record<string, number> = {
  completed: 0,
  processing: 1,
  uploaded: 2,
  failed: 3,
};

function useConversionDownload() {
  const { toast } = useToast();
  const [downloading, setDownloading] = useState<Record<string, boolean>>({});

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadHtml = async (conv: any) => {
    const key = `html-${conv.id}`;
    setDownloading((p) => ({ ...p, [key]: true }));
    try {
      const resp = await fetch(`/api/conversions/${conv.id}/download`, {
        credentials: "include",
      });
      if (!resp.ok) throw new Error("Download failed");
      const html = await resp.text();
      triggerDownload(
        new Blob([html], { type: "text/html" }),
        (conv.originalFilename ?? "document").replace(/\.[^.]+$/, "") + "-accessible.html",
      );
    } catch {
      toast({ title: "Download failed", description: "Could not download the HTML file.", variant: "destructive" });
    } finally {
      setDownloading((p) => ({ ...p, [key]: false }));
    }
  };

  const downloadDocx = async (conv: any) => {
    const key = `docx-${conv.id}`;
    setDownloading((p) => ({ ...p, [key]: true }));
    try {
      const resp = await fetch(`/api/conversions/${conv.id}/download-docx`, {
        credentials: "include",
      });
      if (!resp.ok) throw new Error("Download failed");
      const blob = await resp.blob();
      triggerDownload(
        blob,
        (conv.originalFilename ?? "document").replace(/\.[^.]+$/, "") + "-accessible.docx",
      );
    } catch {
      toast({ title: "Download failed", description: "Could not download the Word file.", variant: "destructive" });
    } finally {
      setDownloading((p) => ({ ...p, [key]: false }));
    }
  };

  const downloadPdf = async (conv: any) => {
    const key = `pdf-${conv.id}`;
    setDownloading((p) => ({ ...p, [key]: true }));
    try {
      const resp = await fetch(`/api/conversions/${conv.id}/download-pdf`, {
        credentials: "include",
      });
      if (!resp.ok) throw new Error("Download failed");
      const blob = await resp.blob();
      triggerDownload(
        blob,
        (conv.originalFilename ?? "document").replace(/\.[^.]+$/, "") + "-accessible.pdf",
      );
    } catch {
      toast({ title: "Download failed", description: "Could not download the tagged PDF.", variant: "destructive" });
    } finally {
      setDownloading((p) => ({ ...p, [key]: false }));
    }
  };

  const isDownloadingRow = (id: number) =>
    !!(downloading[`html-${id}`] || downloading[`docx-${id}`] || downloading[`pdf-${id}`]);

  return { downloading, isDownloadingRow, downloadHtml, downloadDocx, downloadPdf };
}

export default function PdfHistory() {
  usePageTitle("Conversion History");
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const { downloading, isDownloadingRow, downloadHtml, downloadDocx, downloadPdf } = useConversionDownload();

  const [search, setSearch] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    return p.get("q") ?? "";
  });
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const p = new URLSearchParams(window.location.search);
    const r = p.get("range");
    return r === "7" || r === "30" ? r : "all";
  });
  const [sortBy, setSortBy] = useState<SortOption>("newest");

  useEffect(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    if (dateRange !== "all") params.set("range", dateRange);
    pushFilterState(params);
  }, [search, dateRange]);

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

  const filteredConversions = useMemo(() => {
    if (!conversions) return [];
    let result = [...conversions];

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((c) =>
        (c.originalFilename ?? "").toLowerCase().includes(q)
      );
    }

    if (dateRange !== "all") {
      const cutoff = startOfDay(subDays(new Date(), parseInt(dateRange)));
      result = result.filter(
        (c) => new Date(c.createdAt) >= cutoff
      );
    }

    if (sortBy === "oldest") {
      result.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    } else if (sortBy === "filename") {
      result.sort((a, b) =>
        (a.originalFilename ?? "").localeCompare(b.originalFilename ?? "", undefined, { sensitivity: "base" })
      );
    } else if (sortBy === "status") {
      result.sort((a, b) => {
        const sa = STATUS_ORDER[a.status] ?? 99;
        const sb = STATUS_ORDER[b.status] ?? 99;
        return sa !== sb ? sa - sb : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    } else {
      result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    return result;
  }, [conversions, search, dateRange, sortBy]);

  const isFiltering = search.trim() !== "" || dateRange !== "all";

  if (authLoading || isLoading) {
    return <LoadingScreen />;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background/95 backdrop-blur sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/")}
              aria-label="Home — CAI Tools"
              data-testid="button-home-logo"
              className="flex-shrink-0"
            >
              <img
                src={caiLogo}
                alt="Center for Artificial Intelligence"
                className="h-8 w-auto dark:hidden"
              />
              <img
                src={caiLogoWhite}
                alt="Center for Artificial Intelligence"
                className="h-8 w-auto hidden dark:block"
              />
            </button>
            <div className="w-px h-6 bg-border" aria-hidden="true" />
            <BackButton />
            <div>
              <h1
                className="font-bold text-foreground text-lg"
                data-testid="text-page-title"
              >
                Conversion History
              </h1>
              <p className="text-xs text-muted-foreground">
                {conversions?.length || 0} documents converted
              </p>
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
            <ConverterHeader
              showLibrary={false}
              showHelp={false}
            />
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {conversions && conversions.length > 0 && (
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <div className="relative flex-1">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                placeholder="Search by filename…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-9 py-2 rounded-xl border bg-card text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                data-testid="input-search"
                aria-label="Search conversions by filename"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Clear search"
                  data-testid="button-clear-search"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as DateRange)}
              className="px-3 py-2 rounded-xl border bg-card text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
              data-testid="select-date-range"
              aria-label="Filter by date range"
            >
              <option value="all">All time</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="px-3 py-2 rounded-xl border bg-card text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
              data-testid="select-sort"
              aria-label="Sort conversions"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="filename">Filename A–Z</option>
              <option value="status">Status</option>
            </select>
          </div>
        )}

        {!conversions || conversions.length === 0 ? (
          <div className="text-center py-16">
            <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-50" />
            <h2 className="text-xl font-bold text-foreground mb-2">
              No conversions yet
            </h2>
            <p className="text-muted-foreground mb-6">
              Upload a document to get started with accessibility remediation.
            </p>
            <button
              onClick={() => navigate("/pdf-accessibility")}
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-xl font-bold shadow-md hover:-translate-y-0.5 transition-all"
              data-testid="button-upload-first"
            >
              <Upload className="w-5 h-5" />
              Upload Document
            </button>
          </div>
        ) : filteredConversions.length === 0 ? (
          <div className="text-center py-16" data-testid="empty-filtered">
            <Search className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-50" />
            <h2 className="text-xl font-bold text-foreground mb-2">
              No conversions matching your search
            </h2>
            <p className="text-muted-foreground mb-4">
              {search.trim() && dateRange !== "all"
                ? `No results for "${search}" in the last ${dateRange} days.`
                : search.trim()
                  ? `No results for "${search}".`
                  : `No conversions in the last ${dateRange} days.`}
            </p>
            <button
              onClick={() => { setSearch(""); setDateRange("all"); }}
              className="inline-flex items-center gap-2 px-4 py-2 border rounded-xl text-sm font-medium text-foreground hover:bg-muted transition-colors"
              data-testid="button-clear-filters"
            >
              <X className="w-4 h-4" />
              Clear filters
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {isFiltering && (
              <p className="text-sm text-muted-foreground mb-1" aria-live="polite" data-testid="text-filter-count">
                Showing {filteredConversions.length} of {conversions.length} conversion{conversions.length !== 1 ? "s" : ""}
              </p>
            )}
            {filteredConversions.map((conv: any) => (
              <div
                key={conv.id}
                className={cn(
                  "flex items-center gap-4 p-4 bg-card border rounded-xl transition-all group",
                  isDownloadingRow(conv.id)
                    ? "border-primary/50 bg-primary/5 animate-pulse"
                    : "hover:border-primary/30",
                )}
                data-testid={`card-history-${conv.id}`}
                aria-busy={isDownloadingRow(conv.id)}
              >
                <button
                  onClick={() => navigate(`/pdf-accessibility/${conv.id}`)}
                  className="flex items-center gap-4 flex-1 min-w-0 text-left"
                  data-testid={`link-conversion-${conv.id}`}
                >
                  <FileText
                    className="w-5 h-5 text-primary flex-shrink-0"
                    aria-hidden="true"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate flex items-center gap-1.5">
                      {conv.originalFilename}
                      {isDownloadingRow(conv.id) && (
                        <Loader2
                          className="w-3.5 h-3.5 animate-spin text-primary flex-shrink-0"
                          aria-label="Download in progress"
                        />
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {conv.sourceType && conv.sourceType !== "pdf" && (
                        <span className="inline-flex items-center gap-1 font-semibold mr-1" data-testid={`label-source-type-${conv.id}`}>
                          {conv.sourceType === "google-doc" ? (
                            <>
                              <SiGoogledrive className="w-3 h-3 text-[#4285F4]" aria-hidden="true" />
                              Google Doc
                            </>
                          ) : conv.sourceType === "google-sheet" ? (
                            <>
                              <SiGooglesheets className="w-3 h-3 text-[#34A853]" aria-hidden="true" />
                              Google Sheet
                            </>
                          ) : conv.sourceType === "google-slide" ? (
                            <>
                              <SiGoogleslides className="w-3 h-3 text-[#F4B400]" aria-hidden="true" />
                              Google Slides
                            </>
                          ) : conv.sourceType === "docx" ? (
                            "Word (DOCX)"
                          ) : conv.sourceType === "doc" ? (
                            "Word (DOC)"
                          ) : conv.sourceType === "rtf" ? (
                            "RTF"
                          ) : conv.sourceType === "html" ? (
                            "HTML"
                          ) : conv.sourceType === "odt" ? (
                            "OpenDocument Text"
                          ) : conv.sourceType === "ods" ? (
                            "OpenDocument Spreadsheet"
                          ) : conv.sourceType === "odp" ? (
                            "OpenDocument Presentation"
                          ) : conv.sourceType === "epub" ? (
                            "EPUB"
                          ) : conv.sourceType === "csv" ? (
                            "CSV"
                          ) : (
                            conv.sourceType.toUpperCase()
                          )}
                        </span>
                      )}
                      {formatBytes(conv.fileSize)}
                      {conv.pageCount && ` · ${conv.pageCount} pages`}
                      {" · "}
                      {format(
                        new Date(conv.createdAt),
                        "MMM d, yyyy 'at' h:mm a",
                      )}
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
                            : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
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
                  <ArrowRight
                    className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-hidden="true"
                  />
                </button>
                {conv.status === "completed" ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        onClick={(e) => e.stopPropagation()}
                        disabled={
                          downloading[`html-${conv.id}`] ||
                          downloading[`docx-${conv.id}`] ||
                          downloading[`pdf-${conv.id}`]
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary/30 bg-primary/5 text-primary text-xs font-semibold hover:bg-primary/10 transition-colors flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label={`Download ${conv.originalFilename}`}
                        data-testid={`button-download-${conv.id}`}
                      >
                        {downloading[`html-${conv.id}`] ||
                        downloading[`docx-${conv.id}`] ||
                        downloading[`pdf-${conv.id}`] ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Download className="w-3.5 h-3.5" />
                        )}
                        <span className="hidden sm:inline">Download as…</span>
                        <ChevronDown className="w-3 h-3" aria-hidden="true" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadHtml(conv);
                        }}
                        data-testid={`menu-download-html-${conv.id}`}
                      >
                        <FileCode2 className="w-4 h-4 mr-2 text-muted-foreground" aria-hidden="true" />
                        HTML
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadDocx(conv);
                        }}
                        data-testid={`menu-download-docx-${conv.id}`}
                      >
                        <FileType className="w-4 h-4 mr-2 text-muted-foreground" aria-hidden="true" />
                        Word (.docx)
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadPdf(conv);
                        }}
                        data-testid={`menu-download-pdf-${conv.id}`}
                      >
                        <FileDown className="w-4 h-4 mr-2 text-muted-foreground" aria-hidden="true" />
                        Tagged PDF
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (
                      confirm("Delete this conversion? This cannot be undone.")
                    ) {
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
      </main>
      <PoweredByFooter />
    </div>
  );
}

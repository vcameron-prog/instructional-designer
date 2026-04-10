import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import DOMPurify from "dompurify";
import {
  FileText, Download, ArrowLeft, Loader2, FileCheck2,
  AlertTriangle, ShieldCheck, Cpu, Code, ChevronDown, Wand2,
  Info, Upload, ClipboardCopy, Check, Eye, Pencil, Save, X,
  GraduationCap, Share2, Globe, ExternalLink
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { HeaderControls } from "@/components/header-controls";
import { usePageTitle } from "@/hooks/use-page-title";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { format } from "date-fns";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from "recharts";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

type StatusType = "uploaded" | "processing" | "completed" | "failed" | "review" | "pass" | "fail" | "fixed" | "warning" | "accepted";

function StatusBadge({ status, className }: { status: StatusType; className?: string }) {
  const variants: Record<StatusType, string> = {
    uploaded: "bg-secondary text-secondary-foreground border-secondary-foreground/20",
    processing: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800",
    completed: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800",
    review: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    pass: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800",
    fixed: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800",
    warning: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800",
    fail: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800",
    accepted: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 border-violet-200 dark:border-violet-800",
  };
  const labels: Record<StatusType, string> = {
    uploaded: "Starting...", processing: "Remediating...", completed: "Accessible",
    review: "Review", failed: "Failed", pass: "Pass", fail: "Fail",
    fixed: "Fixed via AI", warning: "Manual Review", accepted: "Accepted Limitation",
  };
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border", variants[status], className)} data-testid={`badge-status-${status}`}>
      {labels[status]}
    </span>
  );
}

function ComplianceChart({ report }: { report: any }) {
  const data = [
    { name: "Passed", value: report.passCount, color: "hsl(142, 71%, 25%)" },
    { name: "Fixed (AI)", value: report.fixedCount, color: "hsl(142, 71%, 45%)" },
    { name: "Accepted", value: report.acceptedCount ?? 0, color: "hsl(263, 70%, 50%)" },
    { name: "Warning", value: report.warningCount, color: "hsl(35, 92%, 50%)" },
    { name: "Failed", value: report.failCount, color: "hsl(354, 84%, 45%)" },
  ].filter((item) => item.value > 0);

  if (data.length === 0) return <div className="h-48 flex items-center justify-center text-muted-foreground">No data</div>;

  return (
    <div className="h-48 w-full" role="img" aria-label={`Compliance chart: ${data.map((d) => `${d.name}: ${d.value}`).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" innerRadius={50} outerRadius={70} paddingAngle={5} dataKey="value" stroke="none">
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <RechartsTooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)" }} />
          <Legend verticalAlign="bottom" height={36} iconType="circle" />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function PdfConversion() {
  const params = useParams<{ id: string }>();
  const numericId = parseInt(params.id || "0", 10);
  const [, navigate] = useLocation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  usePageTitle("Conversion Details");
  useEffect(() => { window.scrollTo(0, 0); }, []);

  const { data: conversion, isLoading, isError } = useQuery<any>({
    queryKey: ["/api/conversions", numericId],
    enabled: numericId > 0,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.status === "processing" || data?.status === "uploaded" ? 3000 : false;
    },
  });

  const processMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/conversions/${id}/process`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversions", numericId] });
    },
  });

  const fixMutation = useMutation({
    mutationFn: async ({ id, issueIndex }: { id: number; issueIndex: number }) => {
      const res = await apiRequest("POST", `/api/conversions/${id}/fix-issue`, { issueIndex });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversions", numericId] });
    },
  });

  const acceptMutation = useMutation({
    mutationFn: async ({ id, issueIndex, justification }: { id: number; issueIndex: number; justification: string }) => {
      const res = await apiRequest("POST", `/api/conversions/${id}/accept-issue`, { issueIndex, justification });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversions", numericId] });
    },
  });

  const revertMutation = useMutation({
    mutationFn: async ({ id, issueIndex }: { id: number; issueIndex: number }) => {
      const res = await apiRequest("POST", `/api/conversions/${id}/revert-issue`, { issueIndex });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversions", numericId] });
    },
  });

  const updateHtmlMutation = useMutation({
    mutationFn: async ({ id, html }: { id: number; html: string }) => {
      const res = await apiRequest("PUT", `/api/conversions/${id}/html`, { html });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversions", numericId] });
    },
  });

  const [isDownloading, setIsDownloading] = useState(false);
  const [isDownloadingDocx, setIsDownloadingDocx] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [expandedIssues, setExpandedIssues] = useState<Set<string>>(new Set());
  const [fixingIndex, setFixingIndex] = useState<number | null>(null);
  const [fixError, setFixError] = useState<string | null>(null);
  const [acceptingIndex, setAcceptingIndex] = useState<number | null>(null);
  const [revertingIndex, setRevertingIndex] = useState<number | null>(null);
  const [justificationText, setJustificationText] = useState("");
  const [showAcceptForm, setShowAcceptForm] = useState<number | null>(null);
  const [activeInstructionTab, setActiveInstructionTab] = useState<"blackboard" | "share" | "website">("blackboard");
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const [htmlViewMode, setHtmlViewMode] = useState<"preview" | "edit">("preview");
  const [editedHtml, setEditedHtml] = useState("");
  const [htmlDirty, setHtmlDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");

  const sanitizedHtml = useMemo(() => {
    if (!conversion?.accessibleHtml) return "";
    return DOMPurify.sanitize(conversion.accessibleHtml, {
      ADD_TAGS: ["main", "nav", "header", "footer", "section", "article", "aside", "figure", "figcaption"],
      ADD_ATTR: ["role", "aria-label", "aria-labelledby", "aria-describedby", "aria-hidden", "tabindex", "lang", "scope"],
    });
  }, [conversion?.accessibleHtml]);

  const autoStartedRef = useRef<number | null>(null);

  useEffect(() => {
    if (conversion?.status === "uploaded" && !processMutation.isPending && autoStartedRef.current !== numericId) {
      autoStartedRef.current = numericId;
      processMutation.mutate(numericId);
    }
  }, [conversion?.status, processMutation.isPending, numericId]);

  const toggleIssue = useCallback((key: string) => {
    setExpandedIssues((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  const handleFixIssue = useCallback(
    (issueIndex: number) => {
      setFixingIndex(issueIndex);
      setFixError(null);
      fixMutation.mutate(
        { id: numericId, issueIndex },
        {
          onError: () => setFixError("Failed to fix this issue. Please try again."),
          onSettled: () => setFixingIndex(null),
        }
      );
    },
    [fixMutation, numericId]
  );

  const handleAcceptIssue = useCallback(
    (issueIndex: number) => {
      if (!justificationText.trim()) return;
      setAcceptingIndex(issueIndex);
      acceptMutation.mutate(
        { id: numericId, issueIndex, justification: justificationText.trim() },
        {
          onSettled: () => {
            setAcceptingIndex(null);
            setShowAcceptForm(null);
            setJustificationText("");
          },
        }
      );
    },
    [acceptMutation, numericId, justificationText]
  );

  const handleRevertIssue = useCallback(
    (issueIndex: number) => {
      setRevertingIndex(issueIndex);
      revertMutation.mutate(
        { id: numericId, issueIndex },
        { onSettled: () => setRevertingIndex(null) }
      );
    },
    [revertMutation, numericId]
  );

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const resp = await fetch(`/api/conversions/${numericId}/download`, { credentials: "include" });
      if (!resp.ok) return;
      const html = await resp.text();
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = conversion.originalFilename.replace(/\.pdf$/i, "") + "-accessible.html";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDownloadDocx = async () => {
    setIsDownloadingDocx(true);
    try {
      const resp = await fetch(`/api/conversions/${numericId}/download-docx`, { credentials: "include" });
      if (!resp.ok) return;
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = conversion.originalFilename.replace(/\.pdf$/i, "") + "-accessible.docx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setIsDownloadingDocx(false);
    }
  };

  const handleDownloadPdf = async () => {
    setIsDownloadingPdf(true);
    try {
      const resp = await fetch(`/api/conversions/${numericId}/download-pdf`, { credentials: "include" });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({ error: "PDF generation failed" }));
        toast({ title: "Download failed", description: errData.error || "Could not generate PDF", variant: "destructive" });
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = conversion.originalFilename.replace(/\.pdf$/i, "") + "-accessible.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Download failed", description: "An unexpected error occurred generating the PDF", variant: "destructive" });
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const handleCopyHtml = async () => {
    if (!conversion?.accessibleHtml) return;
    setCopyState("copying");
    try {
      await navigator.clipboard.writeText(conversion.accessibleHtml);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("error");
      setTimeout(() => setCopyState("idle"), 2000);
    }
  };

  if (authLoading || isLoading) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground font-medium">Loading document details...</p>
        </div>
      </main>
    );
  }

  if (isError || !conversion) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-16 max-w-xl text-center">
          <AlertTriangle className="w-12 h-12 mx-auto text-destructive mb-4" />
          <h1 className="text-2xl font-bold mb-2">Document Not Found</h1>
          <p className="text-muted-foreground mb-6">This conversion may have been deleted or does not exist.</p>
          <button onClick={() => navigate("/pdf-accessibility/history")} className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-xl font-bold" data-testid="button-back-history">
            <ArrowLeft className="w-4 h-4" /> Back to History
          </button>
        </div>
      </main>
    );
  }

  const report = conversion.complianceReport;
  const originalReport = conversion.originalComplianceReport;
  const improvement = report && originalReport ? report.overallScore - originalReport.overallScore : null;
  const displayStatus: StatusType = conversion.status === "completed" && report?.overallScore < 100 ? "review" : conversion.status;

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/pdf-accessibility/history")} className="text-muted-foreground hover:text-foreground transition-colors" data-testid="button-back">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="font-bold text-foreground text-lg truncate max-w-md" data-testid="text-filename">{conversion.originalFilename}</h1>
              <p className="text-xs text-muted-foreground">
                {formatBytes(conversion.fileSize)}
                {conversion.pageCount && ` · ${conversion.pageCount} pages`}
              </p>
            </div>
          </div>
          <HeaderControls showHome={true} showLibrary={false} showHelp={false} />
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 max-w-6xl space-y-6">
        <div className="bg-card border rounded-2xl p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 text-primary p-3 rounded-xl" aria-hidden="true">
                <FileText className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusBadge status={displayStatus} />
                  {conversion.ocrApplied && (
                    <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 px-2 py-0.5 rounded-full font-semibold">OCR Applied</span>
                  )}
                  <span className="text-xs text-muted-foreground">{format(new Date(conversion.createdAt), "MMM d, yyyy")}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(conversion.status === "failed" || (conversion.status === "uploaded" && processMutation.isError)) && (
                <button
                  onClick={() => { autoStartedRef.current = null; processMutation.mutate(numericId); }}
                  disabled={processMutation.isPending}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-bold shadow-sm disabled:opacity-50"
                  data-testid="button-retry"
                >
                  {processMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cpu className="w-4 h-4" />}
                  Retry
                </button>
              )}
              {conversion.status === "completed" && (
                <>
                  <button onClick={handleDownloadDocx} disabled={isDownloadingDocx} className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-bold shadow-sm hover:-translate-y-0.5 transition-all disabled:opacity-50" data-testid="button-download-docx">
                    {isDownloadingDocx ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                    Download Word
                  </button>
                  <button onClick={handleDownloadPdf} disabled={isDownloadingPdf} className="inline-flex items-center gap-2 px-4 py-2 bg-red-700 hover:bg-red-800 text-white rounded-xl text-sm font-bold shadow-sm shadow-red-700/20 hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:transform-none" data-testid="button-download-pdf">
                    {isDownloadingPdf ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <FileCheck2 className="w-4 h-4" aria-hidden="true" />}
                    Download PDF
                  </button>
                  <button onClick={handleDownload} disabled={isDownloading} className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-xl text-sm font-bold shadow-sm hover:-translate-y-0.5 transition-all disabled:opacity-50" data-testid="button-download-html">
                    {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    Download HTML
                  </button>
                  <button onClick={handleCopyHtml} disabled={copyState === "copying"} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold shadow-sm hover:-translate-y-0.5 transition-all disabled:opacity-50" data-testid="button-copy-html">
                    {copyState === "copied" ? <Check className="w-4 h-4" /> : <ClipboardCopy className="w-4 h-4" />}
                    {copyState === "copied" ? "Copied!" : "Copy HTML"}
                  </button>
                  <button onClick={() => navigate("/pdf-accessibility")} className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-xl text-sm font-bold shadow-sm" data-testid="button-convert-another">
                    <Upload className="w-4 h-4" />
                    Convert Another
                  </button>
                </>
              )}
            </div>
          </div>

          {(conversion.status === "uploaded" || conversion.status === "processing") && (
            <div className="mt-6 pt-6 border-t" role="status" aria-live="polite">
              <div className="flex items-center justify-between mb-3">
                <span className="font-bold flex items-center gap-2 text-primary">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {conversion.status === "uploaded" ? "Preparing Document" : "AI Remediation in Progress"}
                </span>
              </div>
              <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full animate-pulse w-1/3" />
              </div>
              {conversion.statusMessage && (
                <p className="mt-3 text-sm font-medium text-primary text-center" data-testid="text-status-message" aria-live="polite">
                  {conversion.statusMessage}
                </p>
              )}
              <p className="mt-2 text-sm text-muted-foreground text-center">
                {conversion.status === "uploaded"
                  ? "Your document is being prepared for AI remediation."
                  : "Analyzing layout, extracting text, generating alt text, and restructuring into WCAG 2.1 AA HTML. This may take a minute for large documents."}
              </p>
            </div>
          )}

          {conversion.status === "failed" && (
            <div className="mt-6 pt-6 border-t">
              <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 p-4 rounded-xl flex items-start gap-3" role="alert">
                <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div>
                  <h2 className="font-bold">Remediation Failed</h2>
                  <p className="text-sm mt-1">{conversion.errorMessage || "An error occurred. Please try again."}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {conversion.status === "completed" && (
          <div className="flex items-start gap-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-4" role="note">
            <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-blue-800 dark:text-blue-200 font-medium">
              <span className="font-bold">Reminder:</span> Review the output for accuracy and double check that the components of Title II remediation are accounted for.
            </p>
          </div>
        )}

        {conversion.status === "completed" && (
          <div className="bg-card border rounded-2xl p-5">
            <div className="flex items-start gap-3 mb-4">
              <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <h2 className="font-bold text-foreground">What to do with your accessible file</h2>
            </div>
            <div className="flex gap-1 mb-4 bg-secondary/50 rounded-xl p-1" role="tablist">
              {(["blackboard", "share", "website"] as const).map((tab) => (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={activeInstructionTab === tab}
                  onClick={() => setActiveInstructionTab(tab)}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-all",
                    activeInstructionTab === tab ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                  data-testid={`tab-${tab}`}
                >
                  {tab === "blackboard" && <GraduationCap className="w-4 h-4" />}
                  {tab === "share" && <Share2 className="w-4 h-4" />}
                  {tab === "website" && <Globe className="w-4 h-4" />}
                  {tab === "blackboard" ? "Blackboard" : tab === "share" ? "Share" : "Website"}
                </button>
              ))}
            </div>
            {activeInstructionTab === "blackboard" && (
              <div className="space-y-3 text-sm text-muted-foreground">
                <p className="font-semibold text-foreground text-xs uppercase">Method 1: Upload Word Document (Recommended)</p>
                <ol className="space-y-2 ml-4 list-decimal">
                  <li>Click the green "Download Word (.docx)" button or the red "Download PDF" button to save the file.</li>
                  <li>Log in to Blackboard and open your course.</li>
                  <li>In Course Content, click the + button, then Upload the .docx file.</li>
                  <li>Click Save and make the file visible to students.</li>
                </ol>
                <p className="font-semibold text-foreground text-xs uppercase mt-4">Method 2: Paste HTML Inline</p>
                <ol className="space-y-2 ml-4 list-decimal">
                  <li>Click "Copy HTML" to copy the accessible content.</li>
                  <li>In Blackboard, create a new Document and switch to HTML view.</li>
                  <li>Paste the HTML and save.</li>
                </ol>
              </div>
            )}
            {activeInstructionTab === "share" && (
              <div className="text-sm text-muted-foreground space-y-2">
                <p>Download the Word (.docx) file and share via email, Google Drive, OneDrive, or any file sharing service.</p>
                <p>The HTML version is also available for files that open directly in a browser.</p>
              </div>
            )}
            {activeInstructionTab === "website" && (
              <div className="text-sm text-muted-foreground space-y-2">
                <p>Use the HTML download to upload to your web server as an accessible version.</p>
                <p className="text-xs opacity-70">Best suited for users who manage their own web hosting.</p>
              </div>
            )}
          </div>
        )}

        {conversion.status === "completed" && report && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 space-y-6">
              <section className="bg-card border rounded-2xl p-6">
                <div className="flex items-center gap-2 mb-4 pb-3 border-b">
                  <ShieldCheck className="w-5 h-5 text-primary" />
                  <h2 className="text-lg font-bold">Compliance Score</h2>
                </div>

                {originalReport && (
                  <div className="flex items-center justify-between gap-4 mb-4">
                    <div className="flex flex-col items-center flex-1">
                      <p className="text-xs font-bold text-muted-foreground uppercase mb-1">Before</p>
                      <div className="relative flex items-center justify-center w-20 h-20">
                        <svg className="w-full h-full transform -rotate-90">
                          <circle cx="40" cy="40" r="32" fill="transparent" stroke="currentColor" strokeWidth="6" className="text-secondary" />
                          <circle cx="40" cy="40" r="32" fill="transparent" stroke="currentColor" strokeWidth="6"
                            strokeDasharray={`${2 * Math.PI * 32}`}
                            strokeDashoffset={`${2 * Math.PI * 32 * (1 - originalReport.overallScore / 100)}`}
                            className={cn("transition-all duration-1000", originalReport.overallScore >= 90 ? "text-green-600" : originalReport.overallScore >= 70 ? "text-amber-500" : "text-red-500")}
                          />
                        </svg>
                        <span className="absolute text-lg font-black">{originalReport.overallScore}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <ArrowLeft className="w-4 h-4 text-muted-foreground rotate-180" />
                      {improvement !== null && (
                        <span className={cn("text-sm font-black", improvement > 0 ? "text-green-600" : "text-muted-foreground")}>
                          {improvement > 0 ? `+${improvement}` : improvement}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col items-center flex-1">
                      <p className="text-xs font-bold text-primary uppercase mb-1">After</p>
                      <div className="relative flex items-center justify-center w-20 h-20">
                        <svg className="w-full h-full transform -rotate-90">
                          <circle cx="40" cy="40" r="32" fill="transparent" stroke="currentColor" strokeWidth="6" className="text-secondary" />
                          <circle cx="40" cy="40" r="32" fill="transparent" stroke="currentColor" strokeWidth="6"
                            strokeDasharray={`${2 * Math.PI * 32}`}
                            strokeDashoffset={`${2 * Math.PI * 32 * (1 - report.overallScore / 100)}`}
                            className={cn("transition-all duration-1000", report.overallScore >= 90 ? "text-green-600" : report.overallScore >= 70 ? "text-amber-500" : "text-red-500")}
                          />
                        </svg>
                        <span className="absolute text-lg font-black">{report.overallScore}</span>
                      </div>
                    </div>
                  </div>
                )}

                {!originalReport && (
                  <div className="flex flex-col items-center mb-4">
                    <div className="relative flex items-center justify-center w-28 h-28 mb-2">
                      <svg className="w-full h-full transform -rotate-90">
                        <circle cx="56" cy="56" r="48" fill="transparent" stroke="currentColor" strokeWidth="10" className="text-secondary" />
                        <circle cx="56" cy="56" r="48" fill="transparent" stroke="currentColor" strokeWidth="10"
                          strokeDasharray={`${2 * Math.PI * 48}`}
                          strokeDashoffset={`${2 * Math.PI * 48 * (1 - report.overallScore / 100)}`}
                          className={cn("transition-all duration-1000", report.overallScore >= 90 ? "text-green-600" : report.overallScore >= 70 ? "text-amber-500" : "text-red-500")}
                        />
                      </svg>
                      <span className="absolute text-2xl font-black">{report.overallScore}</span>
                    </div>
                    <p className="font-semibold text-muted-foreground text-sm">WCAG 2.1 Level AA</p>
                  </div>
                )}

                <ComplianceChart report={report} />

                <div className="grid grid-cols-2 gap-2 mt-4" data-testid="compliance-stats">
                  <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-2.5 rounded-xl text-center">
                    <p className="text-xl font-black text-green-700 dark:text-green-400">{report.passCount}</p>
                    <p className="text-xs font-bold text-green-600/80 uppercase">Passed</p>
                  </div>
                  <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-2.5 rounded-xl text-center">
                    <p className="text-xl font-black text-emerald-700 dark:text-emerald-400">{report.fixedCount}</p>
                    <p className="text-xs font-bold text-emerald-600/80 uppercase">AI Fixed</p>
                  </div>
                  <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-2.5 rounded-xl text-center">
                    <p className="text-xl font-black text-amber-700 dark:text-amber-400">{report.warningCount}</p>
                    <p className="text-xs font-bold text-amber-600/80 uppercase">Warnings</p>
                  </div>
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-2.5 rounded-xl text-center">
                    <p className="text-xl font-black text-red-700 dark:text-red-400">{report.failCount}</p>
                    <p className="text-xs font-bold text-red-600/80 uppercase">Failed</p>
                  </div>
                  {(report.acceptedCount ?? 0) > 0 && (
                    <div className="col-span-2 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 p-2.5 rounded-xl text-center">
                      <p className="text-xl font-black text-violet-700 dark:text-violet-400">{report.acceptedCount}</p>
                      <p className="text-xs font-bold text-violet-600/80 uppercase">Accepted</p>
                    </div>
                  )}
                </div>
              </section>
            </div>

            <div className="lg:col-span-2 space-y-6">
              {conversion.accessibleHtml && (
                <section className="bg-card border rounded-2xl overflow-hidden">
                  <div className="bg-secondary/50 border-b px-6 py-4 flex items-center justify-between">
                    <h2 className="flex items-center gap-2 font-bold">
                      <Code className="w-5 h-5" />
                      Accessible HTML
                    </h2>
                    <div className="flex items-center gap-1 bg-background/60 rounded-lg p-1">
                      <button onClick={() => setHtmlViewMode("preview")} className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all", htmlViewMode === "preview" ? "bg-primary text-primary-foreground" : "text-muted-foreground")} data-testid="button-preview-mode">
                        <Eye className="w-3.5 h-3.5" /> Preview
                      </button>
                      <button onClick={() => { if (htmlViewMode !== "edit") { setEditedHtml(conversion.accessibleHtml || ""); setHtmlDirty(false); } setHtmlViewMode("edit"); }} className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all", htmlViewMode === "edit" ? "bg-primary text-primary-foreground" : "text-muted-foreground")} data-testid="button-edit-mode">
                        <Pencil className="w-3.5 h-3.5" /> Edit
                      </button>
                    </div>
                  </div>
                  {htmlViewMode === "preview" ? (
                    <div className="p-6 max-h-[500px] overflow-y-auto" tabIndex={0} role="region" aria-label="HTML preview" data-testid="html-preview">
                      <div className="prose prose-slate max-w-none dark:prose-invert prose-headings:text-primary prose-a:text-blue-600 prose-a:underline prose-img:rounded-xl prose-img:border" dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />
                    </div>
                  ) : (
                    <div className="flex flex-col">
                      <div className="max-h-[500px] overflow-y-auto">
                        <textarea
                          value={editedHtml}
                          onChange={(e) => { setEditedHtml(e.target.value); setHtmlDirty(e.target.value !== conversion.accessibleHtml); }}
                          className="w-full p-4 font-mono text-sm bg-background min-h-[400px] focus:outline-none resize-none"
                          aria-label="Edit accessible HTML"
                          data-testid="textarea-html-edit"
                        />
                      </div>
                      {saveStatus === "saved" && (
                        <div role="status" className="px-4 py-2 bg-green-50 dark:bg-green-900/20 border-t text-green-700 dark:text-green-400 text-xs font-semibold flex items-center gap-2">
                          <Check className="w-3.5 h-3.5" /> HTML saved successfully
                        </div>
                      )}
                      <div className="flex items-center justify-between px-4 py-3 bg-secondary/50 border-t">
                        <p className="text-xs text-muted-foreground">
                          {htmlDirty ? <span className="text-amber-600 dark:text-amber-400 font-semibold">Unsaved changes</span> : "No unsaved changes"}
                        </p>
                        <div className="flex items-center gap-2">
                          <button onClick={() => { setEditedHtml(conversion.accessibleHtml || ""); setHtmlDirty(false); }} disabled={!htmlDirty} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-muted-foreground bg-background border rounded-lg disabled:opacity-50" data-testid="button-discard">
                            <X className="w-3.5 h-3.5" /> Discard
                          </button>
                          <button
                            onClick={() => {
                              setSaveStatus("idle");
                              updateHtmlMutation.mutate(
                                { id: numericId, html: editedHtml },
                                {
                                  onSuccess: () => { setHtmlDirty(false); setSaveStatus("saved"); setTimeout(() => setSaveStatus("idle"), 3000); },
                                  onError: () => { setSaveStatus("error"); setTimeout(() => setSaveStatus("idle"), 4000); },
                                }
                              );
                            }}
                            disabled={!htmlDirty || updateHtmlMutation.isPending}
                            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold bg-primary text-primary-foreground rounded-lg shadow-sm disabled:opacity-50"
                            data-testid="button-save-html"
                          >
                            {updateHtmlMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            {updateHtmlMutation.isPending ? "Saving..." : "Save Changes"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              )}

              <section className="bg-card border rounded-2xl p-6">
                <div className="flex items-center gap-2 mb-4 pb-3 border-b">
                  <FileCheck2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  <h2 className="text-lg font-bold">Audit Details</h2>
                </div>

                {fixError && (
                  <div role="alert" className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg text-sm font-medium">{fixError}</div>
                )}

                <div className="space-y-3" data-testid="audit-issues">
                  {report.issues.map((issue: any, i: number) => {
                    const key = `${issue.criterion}::${issue.title}::${i}`;
                    const isExpanded = expandedIssues.has(key);
                    const isFixable = issue.status === "fail" || issue.status === "warning";
                    const isFixing = fixingIndex === i;

                    return (
                      <div key={key} className={cn("rounded-xl border bg-background transition-all", isExpanded ? "border-primary/30 shadow-sm" : "hover:border-primary/20")}>
                        <button onClick={() => toggleIssue(key)} className="w-full flex items-center gap-3 p-3 text-left" aria-expanded={isExpanded} data-testid={`issue-toggle-${i}`}>
                          <StatusBadge status={issue.status} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-bold text-foreground text-sm">{issue.title}</h3>
                              <span className="text-xs font-mono bg-secondary text-secondary-foreground px-2 py-0.5 rounded font-bold">WCAG {issue.criterion} ({issue.level})</span>
                            </div>
                          </div>
                          <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
                        </button>

                        {isExpanded && (
                          <div className="px-3 pb-3 space-y-3 border-t pt-3">
                            <p className="text-sm text-muted-foreground">{issue.description}</p>
                            <p className="text-sm text-foreground/80">{issue.details}</p>
                            {issue.status === "accepted" && issue.justification && (
                              <div className="bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-lg p-3">
                                <p className="text-xs font-bold text-violet-600 dark:text-violet-400 uppercase mb-1">Justification</p>
                                <p className="text-sm text-muted-foreground">{issue.justification}</p>
                              </div>
                            )}
                            {isFixable && (
                              <div className="flex items-center gap-2 flex-wrap">
                                <button onClick={() => handleFixIssue(i)} disabled={isFixing || fixingIndex !== null} className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-bold shadow-sm disabled:opacity-50" data-testid={`button-fix-${i}`}>
                                  {isFixing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                                  {isFixing ? "Fixing..." : "Fix with AI"}
                                </button>
                                {showAcceptForm !== i && (
                                  <button onClick={() => { setShowAcceptForm(i); setJustificationText(""); }} disabled={fixingIndex !== null} className="inline-flex items-center gap-2 px-4 py-2 bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 border border-violet-200 dark:border-violet-800 rounded-lg text-sm font-bold disabled:opacity-50" data-testid={`button-accept-${i}`}>
                                    Mark as Accepted
                                  </button>
                                )}
                              </div>
                            )}
                            {showAcceptForm === i && isFixable && (
                              <div className="space-y-2">
                                <label className="block text-xs font-bold text-muted-foreground uppercase">Why can't this be fixed?</label>
                                <textarea value={justificationText} onChange={(e) => setJustificationText(e.target.value)} placeholder="Explain why this issue cannot be resolved..." className="w-full p-3 border rounded-lg text-sm bg-background resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/40" rows={3} data-testid={`textarea-justification-${i}`} />
                                <div className="flex items-center gap-2">
                                  <button onClick={() => handleAcceptIssue(i)} disabled={!justificationText.trim() || acceptingIndex !== null} className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-bold disabled:opacity-50" data-testid={`button-confirm-accept-${i}`}>
                                    {acceptingIndex === i ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                    {acceptingIndex === i ? "Accepting..." : "Confirm"}
                                  </button>
                                  <button onClick={() => { setShowAcceptForm(null); setJustificationText(""); }} className="px-4 py-2 text-sm font-bold text-muted-foreground hover:text-foreground">Cancel</button>
                                </div>
                              </div>
                            )}
                            {issue.status === "accepted" && (
                              <button onClick={() => handleRevertIssue(i)} disabled={revertingIndex !== null} className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground border rounded-lg text-sm font-bold disabled:opacity-50" data-testid={`button-revert-${i}`}>
                                {revertingIndex === i ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                {revertingIndex === i ? "Reverting..." : "Undo Acceptance"}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          </div>
        )}
      </div>
      <PoweredByFooter />
    </main>
  );
}

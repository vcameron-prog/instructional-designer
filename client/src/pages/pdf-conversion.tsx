import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import DOMPurify from "dompurify";
import {
  FileText,
  Download,
  ArrowLeft,
  Loader2,
  FileCheck2,
  AlertTriangle,
  ShieldCheck,
  Cpu,
  Code,
  Code2,
  ChevronDown,
  Wand2,
  Zap,
  Info,
  Upload,
  ClipboardCopy,
  Check,
  CheckCheck,
  Eye,
  Pencil,
  Save,
  X,
  GraduationCap,
  Share2,
  Globe,
  ExternalLink,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { HeaderControls } from "@/components/header-controls";
import { usePageTitle } from "@/hooks/use-page-title";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { format } from "date-fns";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  Legend,
} from "recharts";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

type StatusType =
  | "uploaded"
  | "processing"
  | "completed"
  | "failed"
  | "review"
  | "pass"
  | "fail"
  | "fixed"
  | "warning"
  | "accepted";

function StatusBadge({
  status,
  className,
}: {
  status: StatusType;
  className?: string;
}) {
  const variants: Record<StatusType, string> = {
    uploaded:
      "bg-secondary text-secondary-foreground border-secondary-foreground/20",
    processing:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800",
    completed:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800",
    review:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    pass: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800",
    fixed:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800",
    warning:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    failed:
      "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800",
    fail: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800",
    accepted:
      "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 border-violet-200 dark:border-violet-800",
  };
  const labels: Record<StatusType, string> = {
    uploaded: "Starting...",
    processing: "Remediating...",
    completed: "Accessible",
    review: "Review",
    failed: "Failed",
    pass: "Pass",
    fail: "Fail",
    fixed: "Fixed via AI",
    warning: "Manual Review",
    accepted: "Accepted Limitation",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border",
        variants[status],
        className,
      )}
      data-testid={`badge-status-${status}`}
    >
      {labels[status]}
    </span>
  );
}

function ComplianceChart({ report }: { report: any }) {
  const data = [
    { name: "Passed", value: report.passCount, color: "hsl(142, 71%, 25%)" },
    {
      name: "Fixed (AI)",
      value: report.fixedCount,
      color: "hsl(142, 71%, 45%)",
    },
    {
      name: "Accepted",
      value: report.acceptedCount ?? 0,
      color: "hsl(263, 70%, 50%)",
    },
    { name: "Warning", value: report.warningCount, color: "hsl(35, 92%, 50%)" },
    { name: "Failed", value: report.failCount, color: "hsl(354, 84%, 45%)" },
  ].filter((item) => item.value > 0);

  if (data.length === 0)
    return (
      <div className="h-48 flex items-center justify-center text-muted-foreground">
        No data
      </div>
    );

  return (
    <div
      className="h-48 w-full"
      role="img"
      aria-label={`Compliance chart: ${data.map((d) => `${d.name}: ${d.value}`).join(", ")}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={70}
            paddingAngle={5}
            dataKey="value"
            stroke="none"
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <RechartsTooltip
            contentStyle={{
              borderRadius: "12px",
              border: "none",
              boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
            }}
          />
          <Legend verticalAlign="bottom" height={36} iconType="circle" />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

const PIPELINE_STEPS = [
  {
    key: "extract",
    label: "Extracting text",
    description: "Reading document content and structure",
    thresholdSec: 0,
  },
  {
    key: "analyse",
    label: "Analysing structure",
    description: "Identifying headings, tables, and layout",
    thresholdSec: 12,
  },
  {
    key: "generate",
    label: "Generating accessible HTML",
    description: "Creating WCAG 2.1 AA compliant markup",
    thresholdSec: 25,
  },
  {
    key: "check",
    label: "Checking compliance",
    description: "Verifying accessibility standards",
    thresholdSec: 45,
  },
] as const;

function getActiveStep(elapsedSeconds: number): number {
  for (let i = PIPELINE_STEPS.length - 1; i >= 0; i--) {
    if (elapsedSeconds >= PIPELINE_STEPS[i].thresholdSec) return i;
  }
  return 0;
}

export default function PdfConversion() {
  const params = useParams<{ id: string }>();
  const numericId = parseInt(params.id || "0", 10);
  const [, navigate] = useLocation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  usePageTitle("Conversion Details");
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const {
    data: conversion,
    isLoading,
    isError,
  } = useQuery<any>({
    queryKey: ["/api/conversions", numericId],
    enabled: numericId > 0,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.status === "processing" || data?.status === "uploaded"
        ? 3000
        : false;
    },
  });

  const { data: deterministicFixersData } = useQuery<{ keys: string[] }>({
    queryKey: ["/api/deterministic-fixers"],
    staleTime: Infinity,
  });

  const deterministicFixerKeys = useMemo(
    () => new Set(deterministicFixersData?.keys ?? []),
    [deterministicFixersData],
  );

  const processMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/conversions/${id}/process`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/conversions", numericId],
      });
    },
  });

  const reprocessMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/conversions/${id}/reprocess`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversions", numericId] });
    },
    onError: (err: Error) => {
      toast({
        title: "Re-conversion failed",
        description: err.message || "Could not start re-conversion.",
        variant: "destructive",
      });
    },
  });

  const fixMutation = useMutation({
    mutationFn: async ({
      id,
      issueIndex,
    }: {
      id: number;
      issueIndex: number;
    }) => {
      const res = await apiRequest("POST", `/api/conversions/${id}/fix-issue`, {
        issueIndex,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/conversions", numericId],
      });
      if (data?.wasRetried) {
        toast({
          title: "Fix applied after retry",
          description: "The initial AI response was incomplete. A second attempt succeeded.",
        });
      }
    },
  });

  const acceptMutation = useMutation({
    mutationFn: async ({
      id,
      issueIndex,
      justification,
    }: {
      id: number;
      issueIndex: number;
      justification: string;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/conversions/${id}/accept-issue`,
        { issueIndex, justification },
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/conversions", numericId],
      });
    },
  });

  const revertMutation = useMutation({
    mutationFn: async ({
      id,
      issueIndex,
    }: {
      id: number;
      issueIndex: number;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/conversions/${id}/revert-issue`,
        { issueIndex },
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/conversions", numericId],
      });
    },
  });

  const updateHtmlMutation = useMutation({
    mutationFn: async ({ id, html }: { id: number; html: string }) => {
      const res = await apiRequest("PUT", `/api/conversions/${id}/html`, {
        html,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/conversions", numericId],
      });
    },
  });

  const [isDownloading, setIsDownloading] = useState(false);
  const [isDownloadingDocx, setIsDownloadingDocx] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [expandedIssues, setExpandedIssues] = useState<Set<string>>(new Set());
  const [fixingIndex, setFixingIndex] = useState<number | null>(null);
  const [fixError, setFixError] = useState<string | null>(null);
  const [fixAllProgress, setFixAllProgress] = useState<{ current: number; total: number } | null>(null);
  const [isFixingAll, setIsFixingAll] = useState(false);
  const [isFixingAllAria, setIsFixingAllAria] = useState(false);
  const [batchFixNotesSummary, setBatchFixNotesSummary] = useState<string[]>([]);
  const [copiedImageKeys, setCopiedImageKeys] = useState<Set<string>>(new Set());
  const [copiedAllKeys, setCopiedAllKeys] = useState<Set<number>>(new Set());
  const [acceptingIndex, setAcceptingIndex] = useState<number | null>(null);
  const [revertingIndex, setRevertingIndex] = useState<number | null>(null);
  const [justificationText, setJustificationText] = useState("");
  const [showAcceptForm, setShowAcceptForm] = useState<number | null>(null);
  const [activeInstructionTab, setActiveInstructionTab] = useState<
    "blackboard" | "share" | "website"
  >("blackboard");
  const [copyState, setCopyState] = useState<
    "idle" | "copying" | "copied" | "error"
  >("idle");
  const [htmlViewMode, setHtmlViewMode] = useState<"preview" | "edit">(
    "preview",
  );
  const [editedHtml, setEditedHtml] = useState("");
  const [htmlDirty, setHtmlDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">(
    "idle",
  );

  const sanitizedHtml = useMemo(() => {
    if (!conversion?.accessibleHtml) return "";
    return DOMPurify.sanitize(conversion.accessibleHtml, {
      ADD_TAGS: [
        "main",
        "nav",
        "header",
        "footer",
        "section",
        "article",
        "aside",
        "figure",
        "figcaption",
      ],
      ADD_ATTR: [
        "role",
        "aria-label",
        "aria-labelledby",
        "aria-describedby",
        "aria-hidden",
        "tabindex",
        "lang",
        "scope",
      ],
    });
  }, [conversion?.accessibleHtml]);

  const autoStartedRef = useRef<number | null>(null);
  const htmlPreviewRef = useRef<HTMLDivElement | null>(null);
  const hoverScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processingStartRef = useRef<number | null>(null);
  const lastStatusMessageRef = useRef<string | null | undefined>(undefined);
  const lastStatusChangeRef = useRef<number | null>(null);

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [secondsSinceStatusChange, setSecondsSinceStatusChange] = useState(0);

  const activeStep = useMemo(
    () => getActiveStep(elapsedSeconds),
    [elapsedSeconds],
  );

  const isProcessingOrUploaded =
    conversion?.status === "processing" || conversion?.status === "uploaded";

  useEffect(() => {
    if (isProcessingOrUploaded) {
      const serverStart = conversion?.processingStartedAt
        ? new Date(conversion.processingStartedAt).getTime()
        : null;
      // Always rebase to the server timestamp when it is available,
      // so a post-refresh poll immediately corrects the baseline.
      if (serverStart !== null) {
        processingStartRef.current = serverStart;
      } else if (processingStartRef.current === null) {
        processingStartRef.current = Date.now();
      }
      setElapsedSeconds(Math.floor((Date.now() - (processingStartRef.current ?? Date.now())) / 1000));
      const interval = setInterval(() => {
        const start = processingStartRef.current ?? Date.now();
        setElapsedSeconds(Math.floor((Date.now() - start) / 1000));
      }, 1000);
      return () => clearInterval(interval);
    } else {
      processingStartRef.current = null;
      setElapsedSeconds(0);
    }
  }, [isProcessingOrUploaded, conversion?.processingStartedAt]);

  useEffect(() => {
    const msg = conversion?.statusMessage ?? null;
    if (msg !== lastStatusMessageRef.current) {
      lastStatusMessageRef.current = msg;
      lastStatusChangeRef.current = Date.now();
      setSecondsSinceStatusChange(0);
    }
  }, [conversion?.statusMessage]);

  useEffect(() => {
    if (!isProcessingOrUploaded) {
      setSecondsSinceStatusChange(0);
      return;
    }
    const interval = setInterval(() => {
      const since = lastStatusChangeRef.current;
      if (since !== null) {
        setSecondsSinceStatusChange(Math.floor((Date.now() - since) / 1000));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [isProcessingOrUploaded]);

  useEffect(() => {
    if (
      conversion?.status === "uploaded" &&
      !processMutation.isPending &&
      autoStartedRef.current !== numericId
    ) {
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

  const jumpToImage = useCallback((originalIndex: number) => {
    if (htmlViewMode !== "preview") {
      setHtmlViewMode("preview");
    }
    setTimeout(() => {
      if (!htmlPreviewRef.current) return;
      const imgs = htmlPreviewRef.current.querySelectorAll("img");
      const target = imgs[originalIndex];
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("ring-2", "ring-amber-500", "ring-offset-2");
        setTimeout(() => {
          target.classList.remove("ring-2", "ring-amber-500", "ring-offset-2");
        }, 2000);
      }
    }, 50);
  }, [htmlViewMode]);

  const copyImageFilename = useCallback((filename: string, key: string) => {
    navigator.clipboard.writeText(filename).then(() => {
      setCopiedImageKeys((prev) => new Set(prev).add(key));
      setTimeout(() => {
        setCopiedImageKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }, 2000);
    }).catch(() => {
      toast({ title: "Copy failed", description: "Could not copy filename to clipboard.", variant: "destructive" });
    });
  }, [toast]);

  const highlightImage = useCallback((originalIndex: number) => {
    if (!htmlPreviewRef.current) return;
    const imgs = htmlPreviewRef.current.querySelectorAll("img");
    const target = imgs[originalIndex];
    if (target) {
      target.classList.add("ring-2", "ring-amber-500", "ring-offset-2");
    }
  }, []);

  const unhighlightImage = useCallback((originalIndex: number) => {
    if (!htmlPreviewRef.current) return;
    const imgs = htmlPreviewRef.current.querySelectorAll("img");
    const target = imgs[originalIndex];
    if (target) {
      target.classList.remove("ring-2", "ring-amber-500", "ring-offset-2");
    }
  }, []);

  useEffect(() => {
    if (!htmlPreviewRef.current) return;
    htmlPreviewRef.current.querySelectorAll("img").forEach((img) => {
      img.classList.remove("ring-2", "ring-amber-500", "ring-offset-2");
    });
  }, [htmlViewMode, expandedIssues]);

  useEffect(() => {
    return () => {
      if (hoverScrollTimerRef.current) {
        clearTimeout(hoverScrollTimerRef.current);
        hoverScrollTimerRef.current = null;
      }
    };
  }, []);

  const copyAllFilenames = useCallback((filenames: string[], issueIndex: number) => {
    const text = filenames.join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopiedAllKeys((prev) => new Set(prev).add(issueIndex));
      setTimeout(() => {
        setCopiedAllKeys((prev) => {
          const next = new Set(prev);
          next.delete(issueIndex);
          return next;
        });
      }, 2000);
    }).catch(() => {
      toast({ title: "Copy failed", description: "Could not copy filenames to clipboard.", variant: "destructive" });
    });
  }, [toast]);

  const handleFixIssue = useCallback(
    (issueIndex: number) => {
      setFixingIndex(issueIndex);
      setFixError(null);
      fixMutation.mutate(
        { id: numericId, issueIndex },
        {
          onError: () =>
            setFixError("Failed to fix this issue. Please try again."),
          onSettled: () => setFixingIndex(null),
        },
      );
    },
    [fixMutation, numericId],
  );

  const handleFixAll = useCallback(async () => {
    const report = (conversion as any)?.complianceReport;
    if (!report?.issues) return;
    const fixableIndices: number[] = report.issues
      .map((issue: any, i: number) => ({ issue, i }))
      .filter(({ issue }: { issue: any }) => issue.status === "fail" || issue.status === "warning")
      .map(({ i }: { i: number }) => i);
    if (fixableIndices.length === 0) return;

    setIsFixingAll(true);
    setFixError(null);
    setBatchFixNotesSummary([]);
    setFixAllProgress({ current: 0, total: fixableIndices.length });

    let anyRetried = false;
    const collectedFixNotes: string[] = [];
    try {
      for (let j = 0; j < fixableIndices.length; j++) {
        setFixAllProgress({ current: j + 1, total: fixableIndices.length });
        const issueIndex = fixableIndices[j];
        const res = await apiRequest("POST", `/api/conversions/${numericId}/fix-issue`, { issueIndex });
        const data = await res.json();
        if (data?.wasRetried) anyRetried = true;
        const note = data?.complianceReport?.issues?.[issueIndex]?.fixNotes;
        if (note && !collectedFixNotes.includes(note)) {
          collectedFixNotes.push(note);
        }
        await queryClient.invalidateQueries({ queryKey: ["/api/conversions", numericId] });
        // Re-fetch so subsequent iterations use updated HTML + indices
        await queryClient.fetchQuery({ queryKey: ["/api/conversions", numericId] });
      }
    } catch {
      setFixError("One or more fixes failed. The rest have been applied.");
    } finally {
      setIsFixingAll(false);
      setFixAllProgress(null);
      queryClient.invalidateQueries({ queryKey: ["/api/conversions", numericId] });
      if (collectedFixNotes.length > 0) {
        setBatchFixNotesSummary(collectedFixNotes);
      }
    }
    if (anyRetried) {
      toast({
        title: "One or more fixes required a retry",
        description: "The initial AI response was incomplete for some issues. A second attempt succeeded — the final result is still correct.",
      });
    }
  }, [conversion, numericId, toast]);

  const handleFixAllAria = useCallback(async () => {
    setIsFixingAllAria(true);
    setFixError(null);
    try {
      const res = await apiRequest("POST", `/api/conversions/${numericId}/fix-all-aria`);
      const data = await res.json();
      await queryClient.invalidateQueries({ queryKey: ["/api/conversions", numericId] });
      if (data?.wasRetried) {
        toast({
          title: "ARIA fixes applied",
          description: "One or more ARIA fixes required a retry — the final result is still correct.",
        });
      }
    } catch {
      setFixError("Failed to fix ARIA role issues. Please try again.");
    } finally {
      setIsFixingAllAria(false);
    }
  }, [numericId, toast]);

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
        },
      );
    },
    [acceptMutation, numericId, justificationText],
  );

  const handleRevertIssue = useCallback(
    (issueIndex: number) => {
      setRevertingIndex(issueIndex);
      revertMutation.mutate(
        { id: numericId, issueIndex },
        { onSettled: () => setRevertingIndex(null) },
      );
    },
    [revertMutation, numericId],
  );

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const resp = await fetch(`/api/conversions/${numericId}/download`, {
        credentials: "include",
      });
      if (!resp.ok) return;
      const html = await resp.text();
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        conversion.originalFilename.replace(/\.pdf$/i, "") + "-accessible.html";
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
      const resp = await fetch(`/api/conversions/${numericId}/download-docx`, {
        credentials: "include",
      });
      if (!resp.ok) return;
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        conversion.originalFilename.replace(/\.pdf$/i, "") + "-accessible.docx";
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
      const resp = await fetch(`/api/conversions/${numericId}/download-pdf`, {
        credentials: "include",
      });
      if (!resp.ok) {
        const errData = await resp
          .json()
          .catch(() => ({ error: "PDF generation failed" }));
        toast({
          title: "Download failed",
          description: errData.error || "Could not generate PDF",
          variant: "destructive",
        });
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        conversion.originalFilename.replace(/\.pdf$/i, "") + "-accessible.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast({
        title: "Download failed",
        description: "An unexpected error occurred generating the PDF",
        variant: "destructive",
      });
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
      <main
        id="main-content"
        tabIndex={-1}
        className="min-h-screen flex flex-col bg-background"
      >
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-4" />
            <p className="text-muted-foreground font-medium">
              Loading document details...
            </p>
          </div>
        </div>
        <PoweredByFooter />
      </main>
    );
  }

  if (isError || !conversion) {
    return (
      <main
        id="main-content"
        tabIndex={-1}
        className="min-h-screen flex flex-col bg-background"
      >
        <div className="flex-1 container mx-auto px-4 py-16 max-w-xl text-center">
          <AlertTriangle className="w-12 h-12 mx-auto text-destructive mb-4" />
          <h1 className="text-2xl font-bold mb-2">Document Not Found</h1>
          <p className="text-muted-foreground mb-6">
            This conversion may have been deleted or does not exist.
          </p>
          <button
            onClick={() => navigate("/pdf-accessibility/history")}
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-xl font-bold"
            data-testid="button-back-history"
          >
            <ArrowLeft className="w-4 h-4" /> Back to History
          </button>
        </div>
        <PoweredByFooter />
      </main>
    );
  }

  const report = conversion.complianceReport;
  const originalReport = conversion.originalComplianceReport;
  const improvement =
    report && originalReport
      ? report.overallScore - originalReport.overallScore
      : null;
  const displayStatus: StatusType =
    conversion.status === "completed" && report?.overallScore < 100
      ? "review"
      : conversion.status;

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="min-h-screen bg-background"
    >
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/pdf-accessibility/history")}
              className="text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1
                className="font-bold text-foreground text-lg truncate max-w-md"
                data-testid="text-filename"
              >
                {conversion.originalFilename}
              </h1>
              <p className="text-xs text-muted-foreground">
                {formatBytes(conversion.fileSize)}
                {conversion.pageCount && ` · ${conversion.pageCount} pages`}
              </p>
            </div>
          </div>
          <HeaderControls
            showHome={true}
            showLibrary={false}
            showHelp={false}
          />
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 space-y-6">
        <div className="bg-card border rounded-2xl p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div
                className="bg-primary/10 text-primary p-3 rounded-xl"
                aria-hidden="true"
              >
                <FileText className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusBadge status={displayStatus} />
                  {conversion.ocrApplied && (
                    <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 px-2 py-0.5 rounded-full font-semibold">
                      OCR Applied
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(conversion.createdAt), "MMM d, yyyy")}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(conversion.status === "failed" ||
                (conversion.status === "uploaded" &&
                  processMutation.isError)) && (
                <button
                  onClick={() => {
                    autoStartedRef.current = null;
                    processMutation.mutate(numericId);
                  }}
                  disabled={processMutation.isPending}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-bold shadow-sm disabled:opacity-50"
                  data-testid="button-retry"
                >
                  {processMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Cpu className="w-4 h-4" />
                  )}
                  Retry
                </button>
              )}
              {conversion.status === "completed" && (
                <>
                  <button
                    onClick={handleDownloadDocx}
                    disabled={isDownloadingDocx}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-bold shadow-sm hover:-translate-y-0.5 transition-all disabled:opacity-50"
                    data-testid="button-download-docx"
                  >
                    {isDownloadingDocx ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <FileText className="w-4 h-4" />
                    )}
                    Download Word
                  </button>
                  <button
                    onClick={handleDownloadPdf}
                    disabled={isDownloadingPdf}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-red-700 hover:bg-red-800 text-white rounded-xl text-sm font-bold shadow-sm shadow-red-700/20 hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:transform-none"
                    data-testid="button-download-pdf"
                  >
                    {isDownloadingPdf ? (
                      <Loader2
                        className="w-4 h-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <FileCheck2 className="w-4 h-4" aria-hidden="true" />
                    )}
                    Download PDF
                  </button>
                  <button
                    onClick={handleDownload}
                    disabled={isDownloading}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-xl text-sm font-bold shadow-sm hover:-translate-y-0.5 transition-all disabled:opacity-50"
                    data-testid="button-download-html"
                  >
                    {isDownloading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    Download HTML
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        disabled={isDownloading || isDownloadingDocx || isDownloadingPdf}
                        className="inline-flex items-center gap-2 px-4 py-2 border border-border bg-card text-foreground rounded-xl text-sm font-bold shadow-sm hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:transform-none"
                        data-testid="button-download-as"
                        aria-label="Download as a different format"
                      >
                        {(isDownloading || isDownloadingDocx || isDownloadingPdf) ? (
                          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Download className="w-4 h-4" aria-hidden="true" />
                        )}
                        Download as…
                        <ChevronDown className="w-3.5 h-3.5 opacity-70" aria-hidden="true" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem
                        onClick={handleDownload}
                        disabled={isDownloading}
                        data-testid="menu-download-html"
                        className="gap-2 cursor-pointer"
                      >
                        {isDownloading ? (
                          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Code className="w-4 h-4" aria-hidden="true" />
                        )}
                        HTML
                        <span className="ml-auto text-xs text-muted-foreground">(.html)</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={handleDownloadDocx}
                        disabled={isDownloadingDocx}
                        data-testid="menu-download-docx"
                        className="gap-2 cursor-pointer"
                      >
                        {isDownloadingDocx ? (
                          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <FileText className="w-4 h-4" aria-hidden="true" />
                        )}
                        Word Document
                        <span className="ml-auto text-xs text-muted-foreground">(.docx)</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={handleDownloadPdf}
                        disabled={isDownloadingPdf}
                        data-testid="menu-download-pdf"
                        className="gap-2 cursor-pointer"
                      >
                        {isDownloadingPdf ? (
                          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <FileCheck2 className="w-4 h-4" aria-hidden="true" />
                        )}
                        Tagged PDF
                        <span className="ml-auto text-xs text-muted-foreground">(.pdf)</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <button
                    onClick={handleCopyHtml}
                    disabled={copyState === "copying"}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold shadow-sm hover:-translate-y-0.5 transition-all disabled:opacity-50"
                    data-testid="button-copy-html"
                  >
                    {copyState === "copied" ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <ClipboardCopy className="w-4 h-4" />
                    )}
                    {copyState === "copied" ? "Copied!" : "Copy HTML"}
                  </button>
                  <button
                    onClick={() => reprocessMutation.mutate(numericId)}
                    disabled={reprocessMutation.isPending}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-sm font-bold shadow-sm hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:transform-none"
                    data-testid="button-reprocess"
                    title="Re-run AI conversion using stored extracted text"
                  >
                    {reprocessMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Wand2 className="w-4 h-4" />
                    )}
                    Re-convert
                  </button>
                  <button
                    onClick={() => navigate("/pdf-accessibility")}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-xl text-sm font-bold shadow-sm"
                    data-testid="button-convert-another"
                  >
                    <Upload className="w-4 h-4" />
                    Convert Another
                  </button>
                </>
              )}
            </div>
          </div>

          {(conversion.status === "uploaded" ||
            conversion.status === "processing") && (
            <div
              className="mt-6 pt-6 border-t"
              role="status"
              aria-live="polite"
              aria-label="Document processing progress"
            >
              {/* Header row */}
              <div className="flex items-center justify-between mb-5">
                <p className="font-bold text-primary flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  {conversion.status === "uploaded" ? "Preparing…" : "AI Remediation in Progress"}
                </p>
                {elapsedSeconds > 0 && (
                  <span
                    className="text-xs text-muted-foreground tabular-nums bg-secondary px-2 py-0.5 rounded-full"
                    data-testid="text-elapsed-timer"
                    aria-label={`Elapsed time: ${Math.floor(elapsedSeconds / 60)} minutes ${elapsedSeconds % 60} seconds`}
                  >
                    {Math.floor(elapsedSeconds / 60) > 0
                      ? `${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s`
                      : `${elapsedSeconds}s`}
                  </span>
                )}
              </div>

              {/* Vertical step list */}
              <ol className="space-y-3 mb-4" data-testid="processing-steps-list">
                {PIPELINE_STEPS.map((step, i) => {
                  const done = activeStep > i;
                  const active = activeStep === i;
                  const pending = activeStep < i;
                  return (
                    <li
                      key={step.key}
                      className={cn(
                        "flex items-start gap-3 rounded-xl px-4 py-3 transition-all",
                        done    ? "bg-green-50 dark:bg-green-950/20" :
                        active  ? "bg-primary/8 border border-primary/20 shadow-sm" :
                                  "bg-secondary/40",
                      )}
                      data-testid={`step-${step.key}`}
                      aria-current={active ? "step" : undefined}
                    >
                      {/* Step icon */}
                      <div className={cn(
                        "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 border-2 transition-all mt-0.5",
                        done    ? "bg-green-600 border-green-600 text-white" :
                        active  ? "bg-primary border-primary text-primary-foreground" :
                                  "bg-background border-border text-muted-foreground",
                      )}>
                        {done   ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> :
                         active ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> :
                                  <span className="text-xs font-bold">{i + 1}</span>}
                      </div>

                      {/* Step label + description */}
                      <div className="min-w-0 flex-1">
                        <p className={cn(
                          "text-sm font-semibold leading-tight",
                          done    ? "text-green-700 dark:text-green-400" :
                          active  ? "text-primary" :
                                    "text-muted-foreground",
                        )}>
                          {step.label}
                          {done && (
                            <span className="ml-2 text-[10px] font-normal text-green-600 dark:text-green-500 uppercase tracking-wide">
                              Done
                            </span>
                          )}
                        </p>
                        <p className={cn(
                          "text-xs mt-0.5 leading-snug",
                          active ? "text-primary/70" : "text-muted-foreground/70",
                        )}>
                          {step.description}
                        </p>
                      </div>

                      {/* Active step status badge */}
                      {active && (
                        <span className="text-[10px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5 whitespace-nowrap">
                          In progress
                        </span>
                      )}
                      {pending && (
                        <span className="text-[10px] font-medium text-muted-foreground/60 flex-shrink-0 mt-0.5 whitespace-nowrap">
                          Waiting
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>

              {secondsSinceStatusChange >= 60 && (
                <p
                  className="mt-2 text-xs text-amber-600 dark:text-amber-400 text-center"
                  data-testid="text-stale-progress-message"
                  aria-live="polite"
                >
                  Still working — processing large documents in parallel can take a few minutes.
                </p>
              )}
              <p className="mt-1.5 text-xs text-muted-foreground text-center">
                Large documents may take a few minutes — this page updates automatically.
              </p>
            </div>
          )}

          {conversion.status === "failed" && (
            <div className="mt-6 pt-6 border-t">
              <div
                className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 p-4 rounded-xl flex items-start gap-3"
                role="alert"
              >
                <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div>
                  <h2 className="font-bold">Remediation Failed</h2>
                  <p className="text-sm mt-1">
                    {conversion.errorMessage ||
                      "An error occurred. Please try again."}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {conversion.status === "completed" && (
          <div
            className="flex items-start gap-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-4"
            role="note"
          >
            <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-blue-800 dark:text-blue-200 font-medium">
              <span className="font-bold">Reminder:</span> Review the output for
              accuracy and double check that the components of Title II
              remediation are accounted for.
            </p>
          </div>
        )}

        {conversion.status === "completed" && (
          <div className="bg-card border rounded-2xl p-5">
            <div className="flex items-start gap-3 mb-4">
              <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <h2 className="font-bold text-foreground">
                What to do with your accessible file
              </h2>
            </div>
            <div
              className="flex gap-1 mb-4 bg-secondary/50 rounded-xl p-1"
              role="tablist"
            >
              {(["blackboard", "share", "website"] as const).map((tab) => (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={activeInstructionTab === tab}
                  onClick={() => setActiveInstructionTab(tab)}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-all",
                    activeInstructionTab === tab
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  data-testid={`tab-${tab}`}
                >
                  {tab === "blackboard" && (
                    <GraduationCap className="w-4 h-4" />
                  )}
                  {tab === "share" && <Share2 className="w-4 h-4" />}
                  {tab === "website" && <Globe className="w-4 h-4" />}
                  {tab === "blackboard"
                    ? "Blackboard"
                    : tab === "share"
                      ? "Share"
                      : "Website"}
                </button>
              ))}
            </div>
            {activeInstructionTab === "blackboard" && (
              <div className="space-y-3 text-sm text-muted-foreground">
                <p className="font-semibold text-foreground text-xs uppercase">
                  Method 1: Upload Word Document (Recommended)
                </p>
                <ol className="space-y-2 ml-4 list-decimal">
                  <li>
                    Click the green "Download Word (.docx)" button or the red
                    "Download PDF" button to save the file.
                  </li>
                  <li>Log in to Blackboard and open your course.</li>
                  <li>
                    In Course Content, click the + button, then Upload the .docx
                    file.
                  </li>
                  <li>Click Save and make the file visible to students.</li>
                </ol>
                <p className="font-semibold text-foreground text-xs uppercase mt-4">
                  Method 2: Paste HTML Inline
                </p>
                <ol className="space-y-2 ml-4 list-decimal">
                  <li>Click "Copy HTML" to copy the accessible content.</li>
                  <li>
                    In Blackboard, create a new Document and switch to HTML
                    view.
                  </li>
                  <li>Paste the HTML and save.</li>
                </ol>
              </div>
            )}
            {activeInstructionTab === "share" && (
              <div className="text-sm text-muted-foreground space-y-2">
                <p>
                  Download the Word (.docx) file and share via email, Google
                  Drive, OneDrive, or any file sharing service.
                </p>
                <p>
                  The HTML version is also available for files that open
                  directly in a browser.
                </p>
              </div>
            )}
            {activeInstructionTab === "website" && (
              <div className="text-sm text-muted-foreground space-y-2">
                <p>
                  Use the HTML download to upload to your web server as an
                  accessible version.
                </p>
                <p className="text-xs opacity-70">
                  Best suited for users who manage their own web hosting.
                </p>
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
                      <p className="text-xs font-bold text-muted-foreground uppercase mb-1">
                        Before
                      </p>
                      <div className="relative flex items-center justify-center w-20 h-20">
                        <svg className="w-full h-full transform -rotate-90">
                          <circle
                            cx="40"
                            cy="40"
                            r="32"
                            fill="transparent"
                            stroke="currentColor"
                            strokeWidth="6"
                            className="text-secondary"
                          />
                          <circle
                            cx="40"
                            cy="40"
                            r="32"
                            fill="transparent"
                            stroke="currentColor"
                            strokeWidth="6"
                            strokeDasharray={`${2 * Math.PI * 32}`}
                            strokeDashoffset={`${2 * Math.PI * 32 * (1 - originalReport.overallScore / 100)}`}
                            className={cn(
                              "transition-all duration-1000",
                              originalReport.overallScore >= 90
                                ? "text-green-600"
                                : originalReport.overallScore >= 70
                                  ? "text-amber-500"
                                  : "text-red-500",
                            )}
                          />
                        </svg>
                        <span className="absolute text-lg font-black">
                          {originalReport.overallScore}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <ArrowLeft className="w-4 h-4 text-muted-foreground rotate-180" />
                      {improvement !== null && (
                        <span
                          className={cn(
                            "text-sm font-black",
                            improvement > 0
                              ? "text-green-600"
                              : "text-muted-foreground",
                          )}
                        >
                          {improvement > 0 ? `+${improvement}` : improvement}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col items-center flex-1">
                      <p className="text-xs font-bold text-primary uppercase mb-1">
                        After
                      </p>
                      <div className="relative flex items-center justify-center w-20 h-20">
                        <svg className="w-full h-full transform -rotate-90">
                          <circle
                            cx="40"
                            cy="40"
                            r="32"
                            fill="transparent"
                            stroke="currentColor"
                            strokeWidth="6"
                            className="text-secondary"
                          />
                          <circle
                            cx="40"
                            cy="40"
                            r="32"
                            fill="transparent"
                            stroke="currentColor"
                            strokeWidth="6"
                            strokeDasharray={`${2 * Math.PI * 32}`}
                            strokeDashoffset={`${2 * Math.PI * 32 * (1 - report.overallScore / 100)}`}
                            className={cn(
                              "transition-all duration-1000",
                              report.overallScore >= 90
                                ? "text-green-600"
                                : report.overallScore >= 70
                                  ? "text-amber-500"
                                  : "text-red-500",
                            )}
                          />
                        </svg>
                        <span className="absolute text-lg font-black">
                          {report.overallScore}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {!originalReport && (
                  <div className="flex flex-col items-center mb-4">
                    <div className="relative flex items-center justify-center w-28 h-28 mb-2">
                      <svg className="w-full h-full transform -rotate-90">
                        <circle
                          cx="56"
                          cy="56"
                          r="48"
                          fill="transparent"
                          stroke="currentColor"
                          strokeWidth="10"
                          className="text-secondary"
                        />
                        <circle
                          cx="56"
                          cy="56"
                          r="48"
                          fill="transparent"
                          stroke="currentColor"
                          strokeWidth="10"
                          strokeDasharray={`${2 * Math.PI * 48}`}
                          strokeDashoffset={`${2 * Math.PI * 48 * (1 - report.overallScore / 100)}`}
                          className={cn(
                            "transition-all duration-1000",
                            report.overallScore >= 90
                              ? "text-green-600"
                              : report.overallScore >= 70
                                ? "text-amber-500"
                                : "text-red-500",
                          )}
                        />
                      </svg>
                      <span className="absolute text-2xl font-black">
                        {report.overallScore}
                      </span>
                    </div>
                    <p className="font-semibold text-muted-foreground text-sm">
                      WCAG 2.1 Level AA
                    </p>
                  </div>
                )}

                <ComplianceChart report={report} />

                <div
                  className="grid grid-cols-2 gap-2 mt-4"
                  data-testid="compliance-stats"
                >
                  <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-2.5 rounded-xl text-center">
                    <p className="text-xl font-black text-green-700 dark:text-green-400">
                      {report.passCount}
                    </p>
                    <p className="text-xs font-bold text-green-600/80 uppercase">
                      Passed
                    </p>
                  </div>
                  <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-2.5 rounded-xl text-center">
                    <p className="text-xl font-black text-emerald-700 dark:text-emerald-400">
                      {report.fixedCount}
                    </p>
                    <p className="text-xs font-bold text-emerald-600/80 uppercase">
                      AI Fixed
                    </p>
                  </div>
                  <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-2.5 rounded-xl text-center">
                    <p className="text-xl font-black text-amber-700 dark:text-amber-400">
                      {report.warningCount}
                    </p>
                    <p className="text-xs font-bold text-amber-600/80 uppercase">
                      Warnings
                    </p>
                  </div>
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-2.5 rounded-xl text-center">
                    <p className="text-xl font-black text-red-700 dark:text-red-400">
                      {report.failCount}
                    </p>
                    <p className="text-xs font-bold text-red-600/80 uppercase">
                      Failed
                    </p>
                  </div>
                  {(report.acceptedCount ?? 0) > 0 && (
                    <div className="col-span-2 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 p-2.5 rounded-xl text-center">
                      <p className="text-xl font-black text-violet-700 dark:text-violet-400">
                        {report.acceptedCount}
                      </p>
                      <p className="text-xs font-bold text-violet-600/80 uppercase">
                        Accepted
                      </p>
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
                      <button
                        onClick={() => setHtmlViewMode("preview")}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all",
                          htmlViewMode === "preview"
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground",
                        )}
                        data-testid="button-preview-mode"
                      >
                        <Eye className="w-3.5 h-3.5" /> Preview
                      </button>
                      <button
                        onClick={() => {
                          if (htmlViewMode !== "edit") {
                            setEditedHtml(conversion.accessibleHtml || "");
                            setHtmlDirty(false);
                          }
                          setHtmlViewMode("edit");
                        }}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all",
                          htmlViewMode === "edit"
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground",
                        )}
                        data-testid="button-edit-mode"
                      >
                        <Pencil className="w-3.5 h-3.5" /> Edit
                      </button>
                    </div>
                  </div>
                  {htmlViewMode === "preview" ? (
                    <div
                      ref={htmlPreviewRef}
                      className="p-6 max-h-[500px] overflow-y-auto"
                      tabIndex={0}
                      role="region"
                      aria-label="HTML preview"
                      data-testid="html-preview"
                    >
                      <div
                        className="prose prose-slate max-w-none dark:prose-invert prose-headings:text-primary prose-a:text-blue-600 prose-a:underline prose-img:rounded-xl prose-img:border"
                        dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
                      />
                    </div>
                  ) : (
                    <div className="flex flex-col">
                      <div className="max-h-[500px] overflow-y-auto">
                        <textarea
                          value={editedHtml}
                          onChange={(e) => {
                            setEditedHtml(e.target.value);
                            setHtmlDirty(
                              e.target.value !== conversion.accessibleHtml,
                            );
                          }}
                          className="w-full p-4 font-mono text-sm bg-background min-h-[400px] focus:outline-none resize-none"
                          aria-label="Edit accessible HTML"
                          data-testid="textarea-html-edit"
                        />
                      </div>
                      {saveStatus === "saved" && (
                        <div
                          role="status"
                          className="px-4 py-2 bg-green-50 dark:bg-green-900/20 border-t text-green-700 dark:text-green-400 text-xs font-semibold flex items-center gap-2"
                        >
                          <Check className="w-3.5 h-3.5" /> HTML saved
                          successfully
                        </div>
                      )}
                      <div className="flex items-center justify-between px-4 py-3 bg-secondary/50 border-t">
                        <p className="text-xs text-muted-foreground">
                          {htmlDirty ? (
                            <span className="text-amber-600 dark:text-amber-400 font-semibold">
                              Unsaved changes
                            </span>
                          ) : (
                            "No unsaved changes"
                          )}
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setEditedHtml(conversion.accessibleHtml || "");
                              setHtmlDirty(false);
                            }}
                            disabled={!htmlDirty}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-muted-foreground bg-background border rounded-lg disabled:opacity-50"
                            data-testid="button-discard"
                          >
                            <X className="w-3.5 h-3.5" /> Discard
                          </button>
                          <button
                            onClick={() => {
                              setSaveStatus("idle");
                              updateHtmlMutation.mutate(
                                { id: numericId, html: editedHtml },
                                {
                                  onSuccess: () => {
                                    setHtmlDirty(false);
                                    setSaveStatus("saved");
                                    setTimeout(
                                      () => setSaveStatus("idle"),
                                      3000,
                                    );
                                  },
                                  onError: () => {
                                    setSaveStatus("error");
                                    setTimeout(
                                      () => setSaveStatus("idle"),
                                      4000,
                                    );
                                  },
                                },
                              );
                            }}
                            disabled={
                              !htmlDirty || updateHtmlMutation.isPending
                            }
                            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold bg-primary text-primary-foreground rounded-lg shadow-sm disabled:opacity-50"
                            data-testid="button-save-html"
                          >
                            {updateHtmlMutation.isPending ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Save className="w-3.5 h-3.5" />
                            )}
                            {updateHtmlMutation.isPending
                              ? "Saving..."
                              : "Save Changes"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              )}

              <section className="bg-card border rounded-2xl p-6">
                <div className="flex items-center gap-2 mb-4 pb-3 border-b flex-wrap">
                  <FileCheck2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  <h2 className="text-lg font-bold flex-1">Audit Details</h2>
                  {(() => {
                    const ariaIssueCount = report.issues.filter(
                      (issue: any) =>
                        issue.title.includes("ARIA") &&
                        (issue.status === "fail" || issue.status === "warning")
                    ).length;
                    if (ariaIssueCount < 2) return null;
                    return (
                      <button
                        onClick={handleFixAllAria}
                        disabled={isFixingAllAria || isFixingAll || fixingIndex !== null}
                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-bold shadow-sm disabled:opacity-50 transition-colors"
                        data-testid="button-fix-all-aria"
                        aria-label={`Fix all ${ariaIssueCount} ARIA role issues`}
                      >
                        {isFixingAllAria ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Fixing ARIA…
                          </>
                        ) : (
                          <>
                            <Zap className="w-3.5 h-3.5" />
                            Fix all ARIA ({ariaIssueCount})
                          </>
                        )}
                      </button>
                    );
                  })()}
                  {(() => {
                    const fixableCount = report.issues.filter(
                      (issue: any) => issue.status === "fail" || issue.status === "warning"
                    ).length;
                    if (fixableCount === 0) return null;
                    return (
                      <button
                        onClick={handleFixAll}
                        disabled={isFixingAll || isFixingAllAria || fixingIndex !== null}
                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-bold shadow-sm disabled:opacity-50"
                        data-testid="button-fix-all"
                        aria-label={`Fix all ${fixableCount} issues with AI`}
                      >
                        {isFixingAll ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            {fixAllProgress
                              ? `Fixing ${fixAllProgress.current} of ${fixAllProgress.total}…`
                              : "Fixing…"}
                          </>
                        ) : (
                          <>
                            <CheckCheck className="w-3.5 h-3.5" />
                            Fix All ({fixableCount})
                          </>
                        )}
                      </button>
                    );
                  })()}
                </div>

                {fixError && (
                  <div
                    role="alert"
                    className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg text-sm font-medium"
                  >
                    {fixError}
                  </div>
                )}

                {batchFixNotesSummary.length > 0 && (
                  <div
                    className="mb-4 rounded-lg border bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800 p-3 space-y-2"
                    role="note"
                    data-testid="batch-fix-notes-summary"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wide flex items-center gap-1.5">
                        <Info className="w-3.5 h-3.5" aria-hidden="true" />
                        Heading Level Notes
                      </p>
                      <button
                        onClick={() => setBatchFixNotesSummary([])}
                        className="text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-200 transition-colors"
                        aria-label="Dismiss heading level notes"
                        data-testid="button-dismiss-batch-fix-notes"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <ul className="space-y-1">
                      {batchFixNotesSummary.map((note, idx) => (
                        <li
                          key={idx}
                          className="text-sm text-blue-900 dark:text-blue-200"
                          data-testid={`batch-fix-note-${idx}`}
                        >
                          {note}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="space-y-3" data-testid="audit-issues">
                  {report.issues.map((issue: any, i: number) => {
                    const key = `${issue.criterion}::${issue.title}::${i}`;
                    const isExpanded = expandedIssues.has(key);
                    const isFixable =
                      issue.status === "fail" || issue.status === "warning";
                    const isFixing = fixingIndex === i;
                    const isInstant = deterministicFixerKeys.has(`${issue.criterion}::${issue.title}`);

                    return (
                      <div
                        key={key}
                        className={cn(
                          "rounded-xl border bg-background transition-all",
                          isExpanded
                            ? "border-primary/30 shadow-sm"
                            : "hover:border-primary/20",
                        )}
                      >
                        <button
                          onClick={() => toggleIssue(key)}
                          className="w-full flex items-center gap-3 p-3 text-left"
                          aria-expanded={isExpanded}
                          data-testid={`issue-toggle-${i}`}
                        >
                          <StatusBadge status={issue.status} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-bold text-foreground text-sm">
                                {issue.title}
                              </h3>
                              <span className="text-xs font-mono bg-secondary text-secondary-foreground px-2 py-0.5 rounded font-bold">
                                WCAG {issue.criterion} ({issue.level})
                              </span>
                              {isFixable && (
                                isInstant ? (
                                  <span
                                    className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
                                    data-testid={`badge-fix-type-${i}`}
                                  >
                                    <Zap className="w-3 h-3" aria-hidden="true" />
                                    Instant fix
                                  </span>
                                ) : (
                                  <span
                                    className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 border border-violet-200 dark:border-violet-800"
                                    data-testid={`badge-fix-type-${i}`}
                                  >
                                    <Wand2 className="w-3 h-3" aria-hidden="true" />
                                    AI-powered
                                  </span>
                                )
                              )}
                            </div>
                          </div>
                          <ChevronDown
                            className={cn(
                              "w-4 h-4 text-muted-foreground transition-transform",
                              isExpanded && "rotate-180",
                            )}
                          />
                        </button>

                        {isExpanded && (
                          <div className="px-3 pb-3 space-y-3 border-t pt-3">
                            <p className="text-sm text-muted-foreground">
                              {issue.description}
                            </p>
                            <p className="text-sm text-foreground/80">
                              {issue.details}
                            </p>
                            {(issue.title === "ARIA Button Role on Non-Button Element" ||
                              issue.title === "ARIA Heading Role on Non-Heading Element" ||
                              issue.title === "ARIA Combobox Role on Non-Combobox Element" ||
                              issue.title === "ARIA Grid Role on Non-Table Element" ||
                              issue.title === "ARIA Tab Role on Non-Interactive Element") && (
                                <div
                                  className="rounded-lg border bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800 p-3 space-y-2"
                                  data-testid={`aria-misuse-callout-${i}`}
                                >
                                  <p className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wide flex items-center gap-1.5">
                                    <Code2 className="w-3.5 h-3.5" aria-hidden="true" />
                                    What this fix does
                                  </p>
                                  <p
                                    className="text-sm text-amber-900 dark:text-amber-200 font-medium"
                                    data-testid={`aria-misuse-recommendation-${i}`}
                                  >
                                    {issue.title === "ARIA Button Role on Non-Button Element"
                                      ? "Swaps non-button elements that have role=\"button\" for a native <button> element. This gives keyboard users and screen readers full interactive support without relying on ARIA."
                                      : issue.title === "ARIA Heading Role on Non-Heading Element"
                                      ? "Swaps non-heading elements that have role=\"heading\" for the appropriate native <h1>–<h6> element. This restores the correct document outline that screen readers use to navigate."
                                      : issue.title === "ARIA Combobox Role on Non-Combobox Element"
                                      ? "Swaps non-input elements that have role=\"combobox\" for a native <select> element. The element's tag changes from something like <div> or <span> to <select>, keeping all existing attributes. A native element provides built-in keyboard support that assistive technology expects."
                                      : issue.title === "ARIA Grid Role on Non-Table Element"
                                      ? "Swaps non-table elements that have role=\"grid\" for a native <table> element. The element's tag changes from something like <div> to <table>, keeping all existing attributes. A native table element lets screen readers announce rows and columns correctly."
                                      : "Swaps non-interactive elements that have role=\"tab\" for a native <button> element. The element's tag changes from something like <div> or <span> to <button>, keeping all existing attributes. A native <button> is focusable by keyboard and announced correctly by screen readers without extra ARIA."}
                                  </p>
                                  {(() => {
                                    const countMatch = issue.details?.match(/Found (\d+) element/);
                                    const tagsMatch = issue.details?.match(/\(e\.g\. ([^)]+)\)/);
                                    if (!countMatch || !tagsMatch) return null;
                                    const count = parseInt(countMatch[1], 10);
                                    const sampledTags = tagsMatch[1].split(", ").map((t: string) => t.trim());
                                    const ariaRole =
                                      issue.title === "ARIA Button Role on Non-Button Element" ? "button"
                                      : issue.title === "ARIA Heading Role on Non-Heading Element" ? "heading"
                                      : issue.title === "ARIA Combobox Role on Non-Combobox Element" ? "combobox"
                                      : issue.title === "ARIA Grid Role on Non-Table Element" ? "grid"
                                      : "tab";
                                    const targetTag =
                                      issue.title === "ARIA Heading Role on Non-Heading Element" ? "h1–h6"
                                      : issue.title === "ARIA Combobox Role on Non-Combobox Element" ? "select"
                                      : issue.title === "ARIA Grid Role on Non-Table Element" ? "table"
                                      : "button";
                                    return (
                                      <div
                                        className="border-t border-amber-200 dark:border-amber-800 pt-2"
                                        data-testid={`aria-diff-preview-${i}`}
                                      >
                                        <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1.5">
                                          {count === 1 ? "1 element" : `${count} elements`} will be replaced:
                                        </p>
                                        <ul className="space-y-1" aria-label="Elements to be replaced">
                                          {sampledTags.map((tag: string, idx: number) => {
                                            const openTag = tag.replace(">", ` role="${ariaRole}">`);
                                            return (
                                              <li
                                                key={idx}
                                                className="flex items-center gap-2 font-mono text-xs flex-wrap"
                                                data-testid={`aria-diff-row-${i}-${idx}`}
                                              >
                                                <span className="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-700 whitespace-nowrap">
                                                  {openTag}
                                                </span>
                                                <span className="text-amber-600 dark:text-amber-400 font-bold font-sans" aria-hidden="true">→</span>
                                                <span className="px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-700 whitespace-nowrap">
                                                  {"<"}{targetTag}{">"}
                                                </span>
                                              </li>
                                            );
                                          })}
                                          {count > sampledTags.length && (
                                            <li
                                              className="text-xs text-amber-700/70 dark:text-amber-400/70 pl-0.5"
                                              data-testid={`aria-diff-more-${i}`}
                                            >
                                              + {count - sampledTags.length} more element{count - sampledTags.length !== 1 ? "s" : ""}
                                            </li>
                                          )}
                                        </ul>
                                      </div>
                                    );
                                  })()}
                                </div>
                              )}
                            {issue.fixNotes && (
                              <div
                                className="rounded-lg border bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800 p-3 space-y-1.5"
                                data-testid={`heading-fix-notes-${i}`}
                                role="note"
                              >
                                <p className="text-xs font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wide flex items-center gap-1.5">
                                  <Info className="w-3.5 h-3.5" aria-hidden="true" />
                                  Heading Level Note
                                </p>
                                <p
                                  className="text-sm text-blue-900 dark:text-blue-200"
                                  data-testid={`heading-fix-notes-text-${i}`}
                                >
                                  {issue.fixNotes}
                                </p>
                              </div>
                            )}
                            {issue.criterion === "1.1.1" &&
                              issue.imageItems &&
                              issue.imageItems.length > 0 && (
                                <div className="rounded-lg border bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800 p-3 space-y-2">
                                  <div className="flex items-center justify-between">
                                    <p className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wide">
                                      Images missing alt text
                                    </p>
                                    <button
                                      onClick={() => copyAllFilenames(issue.imageItems.map((item: any) => item.label), i)}
                                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800/60 border border-amber-300 dark:border-amber-700 transition-colors"
                                      data-testid={`button-copy-all-filenames-${i}`}
                                      title={`Copy all ${issue.imageItems.length} filename${issue.imageItems.length === 1 ? "" : "s"}`}
                                      aria-label={`Copy all ${issue.imageItems.length} filename${issue.imageItems.length === 1 ? "" : "s"}`}
                                    >
                                      {copiedAllKeys.has(i) ? (
                                        <Check className="w-3 h-3" />
                                      ) : (
                                        <ClipboardCopy className="w-3 h-3" />
                                      )}
                                      {copiedAllKeys.has(i) ? "Copied!" : `Copy all (${issue.imageItems.length})`}
                                    </button>
                                  </div>
                                  <ul className="space-y-1.5" data-testid="missing-alt-image-list">
                                    {issue.imageItems.map((item: any, imgIdx: number) => (
                                      <li
                                        key={imgIdx}
                                        className="flex items-center gap-2 rounded px-1 -mx-1 transition-colors hover:bg-amber-100/60 dark:hover:bg-amber-900/20 cursor-default"
                                        data-testid={`missing-alt-image-item-${imgIdx}`}
                                        onMouseEnter={() => {
                                          highlightImage(item.originalIndex);
                                          if (hoverScrollTimerRef.current) clearTimeout(hoverScrollTimerRef.current);
                                          hoverScrollTimerRef.current = setTimeout(() => {
                                            hoverScrollTimerRef.current = null;
                                            if (htmlPreviewRef.current) {
                                              const imgs = htmlPreviewRef.current.querySelectorAll("img");
                                              const target = imgs[item.originalIndex];
                                              if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
                                            }
                                          }, 800);
                                        }}
                                        onMouseLeave={() => {
                                          unhighlightImage(item.originalIndex);
                                          if (hoverScrollTimerRef.current) {
                                            clearTimeout(hoverScrollTimerRef.current);
                                            hoverScrollTimerRef.current = null;
                                          }
                                        }}
                                      >
                                        {item.src ? (
                                          <img
                                            src={item.src}
                                            alt=""
                                            aria-hidden="true"
                                            className="w-10 h-10 object-cover rounded border border-amber-300 dark:border-amber-700 flex-shrink-0 bg-muted"
                                            data-testid={`missing-alt-thumbnail-${imgIdx}`}
                                          />
                                        ) : (
                                          <div
                                            className="w-10 h-10 rounded border border-amber-300 dark:border-amber-700 flex-shrink-0 bg-muted flex items-center justify-center"
                                            aria-hidden="true"
                                          >
                                            <FileText className="w-4 h-4 text-muted-foreground" />
                                          </div>
                                        )}
                                        <span
                                          className="text-sm text-foreground/80 flex-1 truncate"
                                          data-testid={`missing-alt-label-${imgIdx}`}
                                        >
                                          {item.label}
                                        </span>
                                        <button
                                          onClick={() => copyImageFilename(item.label, `${i}-${imgIdx}`)}
                                          className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800/60 border border-amber-300 dark:border-amber-700 transition-colors"
                                          data-testid={`button-copy-filename-${imgIdx}`}
                                          title="Copy filename"
                                          aria-label={`Copy filename: ${item.label}`}
                                        >
                                          {copiedImageKeys.has(`${i}-${imgIdx}`) ? (
                                            <Check className="w-3 h-3" />
                                          ) : (
                                            <ClipboardCopy className="w-3 h-3" />
                                          )}
                                        </button>
                                        <button
                                          onClick={() => jumpToImage(item.originalIndex)}
                                          className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800/60 border border-amber-300 dark:border-amber-700 transition-colors"
                                          data-testid={`button-jump-to-image-${imgIdx}`}
                                        >
                                          <Eye className="w-3 h-3" />
                                          Jump to
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            {issue.status === "accepted" &&
                              issue.justification && (
                                <div className="bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-lg p-3">
                                  <p className="text-xs font-bold text-violet-600 dark:text-violet-400 uppercase mb-1">
                                    Justification
                                  </p>
                                  <p className="text-sm text-muted-foreground">
                                    {issue.justification}
                                  </p>
                                </div>
                              )}
                            {isFixable && (
                              <div className="flex items-center gap-2 flex-wrap">
                                <button
                                  onClick={() => handleFixIssue(i)}
                                  disabled={isFixing || fixingIndex !== null || isFixingAll}
                                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-bold shadow-sm disabled:opacity-50"
                                  data-testid={`button-fix-${i}`}
                                >
                                  {isFixing ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : isInstant ? (
                                    <Zap className="w-4 h-4" />
                                  ) : (
                                    <Wand2 className="w-4 h-4" />
                                  )}
                                  {isFixing ? "Fixing..." : isInstant ? "Fix instantly" : "Fix with AI"}
                                </button>
                                {showAcceptForm !== i && (
                                  <button
                                    onClick={() => {
                                      setShowAcceptForm(i);
                                      setJustificationText("");
                                    }}
                                    disabled={fixingIndex !== null || isFixingAll}
                                    className="inline-flex items-center gap-2 px-4 py-2 bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 border border-violet-200 dark:border-violet-800 rounded-lg text-sm font-bold disabled:opacity-50"
                                    data-testid={`button-accept-${i}`}
                                  >
                                    Mark as Accepted
                                  </button>
                                )}
                              </div>
                            )}
                            {showAcceptForm === i && isFixable && (
                              <div className="space-y-2">
                                <label className="block text-xs font-bold text-muted-foreground uppercase">
                                  Why can't this be fixed?
                                </label>
                                <textarea
                                  value={justificationText}
                                  onChange={(e) =>
                                    setJustificationText(e.target.value)
                                  }
                                  placeholder="Explain why this issue cannot be resolved..."
                                  className="w-full p-3 border rounded-lg text-sm bg-background resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                                  rows={3}
                                  data-testid={`textarea-justification-${i}`}
                                />
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => handleAcceptIssue(i)}
                                    disabled={
                                      !justificationText.trim() ||
                                      acceptingIndex !== null
                                    }
                                    className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-bold disabled:opacity-50"
                                    data-testid={`button-confirm-accept-${i}`}
                                  >
                                    {acceptingIndex === i ? (
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : null}
                                    {acceptingIndex === i
                                      ? "Accepting..."
                                      : "Confirm"}
                                  </button>
                                  <button
                                    onClick={() => {
                                      setShowAcceptForm(null);
                                      setJustificationText("");
                                    }}
                                    className="px-4 py-2 text-sm font-bold text-muted-foreground hover:text-foreground"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}
                            {issue.status === "accepted" && (
                              <button
                                onClick={() => handleRevertIssue(i)}
                                disabled={revertingIndex !== null}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground border rounded-lg text-sm font-bold disabled:opacity-50"
                                data-testid={`button-revert-${i}`}
                              >
                                {revertingIndex === i ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : null}
                                {revertingIndex === i
                                  ? "Reverting..."
                                  : "Undo Acceptance"}
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

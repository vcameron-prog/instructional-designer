import { useState, useEffect, type ReactNode } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  ],
  attributes: {
    ...defaultSchema.attributes,
    th: [...(defaultSchema.attributes?.th || []), "scope", "colSpan", "rowSpan"],
    td: [...(defaultSchema.attributes?.td || []), "colSpan", "rowSpan"],
    col: [...(defaultSchema.attributes?.col || []), "span"],
    table: [...(defaultSchema.attributes?.table || []), "summary"],
  },
};
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { HeaderControls } from "@/components/header-controls";
import { ArrowLeft, Copy, Download, FileText, RefreshCw, CheckCircle, AlertTriangle, Lightbulb, ChevronDown, ChevronRight, Loader2, Library, Link2, Link2Off, History, RotateCcw, Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TOOLS, LOADING_MESSAGES } from "@/lib/constants";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { usePageTitle } from "@/hooks/use-page-title";
import { useAuth } from "@/hooks/use-auth";
import type { Course, GeneratedContent, ContentVersion } from "@shared/schema";

interface AppConfig {
  versionHistoryLimit: number;
}

  const COLLAPSED_HEADING_PATTERNS = [
    /submission\s*(requirements|guidelines)?/i,
    /blackboard/i,
    /grading\s*(criteria|rubric|overview)?/i,
    /resources?\s*(and\s*support|&\s*support|materials)?/i,
    /support\s*materials/i,
    /reference/i, /bibliography/i,
    /\budl\b/i, /universal\s*design\s*for\s*learning/i,
    /cultural\s*(relevance|responsiveness|inclusivity)/i,
    /\bsel\b/i, /social[- ]emotional\s*learning/i,
    /ai[- ]powered/i, /inclusive\s*design/i, /accessibility\s*(features|check)?/i,
    /research\s*(reasoning|basis|citations?|references?|framework|pedagog)?/i,
    /timeline\s*(and\s*milestones)?/i,
    /citation/i, /rubric\s*criteria/i,
    /milestone/i,
  ];

function isCollapsedSection(heading: string): boolean {
  return COLLAPSED_HEADING_PATTERNS.some((p) => p.test(heading));
}

interface ContentSection {
  heading: string;
  body: string;
  collapsed: boolean;
}

function splitContentIntoSections(markdown: string): ContentSection[] {
  const lines = markdown.split("\n");
  const sections: ContentSection[] = [];
  let currentHeading = "";
  let currentLines: string[] = [];
  let insideCodeFence = false;

  for (const line of lines) {
    if (/^```/.test(line)) {
      insideCodeFence = !insideCodeFence;
    }

    const h2Match = !insideCodeFence && line.match(/^##\s+(.+)$/);
    if (h2Match) {
      if (currentHeading || currentLines.length > 0) {
        sections.push({
          heading: currentHeading,
          body: currentLines.join("\n").trim(),
          collapsed: currentHeading ? isCollapsedSection(currentHeading) : false,
        });
      }
      currentHeading = h2Match[1].replace(/\*\*/g, "").trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentHeading || currentLines.length > 0) {
    sections.push({
      heading: currentHeading,
      body: currentLines.join("\n").trim(),
      collapsed: currentHeading ? isCollapsedSection(currentHeading) : false,
    });
  }

  return sections;
}

interface AccessibilityIssue {
  type: string;
  severity: "warning" | "suggestion";
  message: string;
  fix: string;
  fixType?: string;
}

const checkAccessibility = (content: string): AccessibilityIssue[] => {
  const issues: AccessibilityIssue[] = [];

  const headingMatches = content.match(/^#{1,6}\s|^[A-Z][A-Z\s]{5,}$/gm) || [];
  if (headingMatches.length === 0 && content.length > 500) {
    issues.push({
      type: "structure",
      severity: "suggestion",
      message: "Consider adding clear section headings to improve navigation",
      fix: 'Add headings like "## Overview" or "## Learning Objectives" to organize content',
    });
  }

  const paragraphs = content.split(/\n\n+/);
  const longParagraphs = paragraphs.filter(p => p.length > 800 && !p.includes("|"));
  if (longParagraphs.length > 0) {
    issues.push({
      type: "readability",
      severity: "suggestion",
      message: `${longParagraphs.length} paragraph(s) may be too long for easy reading`,
      fix: "Break long paragraphs into smaller chunks of 3-4 sentences each",
    });
  }

  if (content.match(/\[click here\]|\[here\]|\[link\]/gi)) {
    issues.push({
      type: "accessibility",
      severity: "warning",
      message: 'Avoid vague link text like "click here" or "here"',
      fix: "Use descriptive link text that explains the destination (e.g., [BSU Academic Calendar])",
      fixType: "fix-vague-link-text",
    });
  }

  if (content.match(/\b(red|green|blue|yellow|orange|purple)\s+(text|items?|sections?|parts?)\b/gi)) {
    issues.push({
      type: "accessibility",
      severity: "warning",
      message: "Information may rely on color alone to convey meaning",
      fix: "Use additional indicators like icons, labels, or patterns alongside color",
    });
  }

  const allCapsMatches = content.match(/\b[A-Z]{10,}\b/g) || [];
  if (allCapsMatches.length > 3) {
    issues.push({
      type: "readability",
      severity: "suggestion",
      message: "Excessive use of ALL CAPS text can reduce readability",
      fix: "Use bold or heading styles instead of all caps for emphasis",
      fixType: "fix-all-caps",
    });
  }

  // Check for heading level skips (e.g., h1 → h3 without h2)
  const headingLevelMatches = [...content.matchAll(/^(#{1,6})\s/gm)];
  if (headingLevelMatches.length > 1) {
    let prevLevel = headingLevelMatches[0][1].length;
    for (let h = 1; h < headingLevelMatches.length; h++) {
      const currentLevel = headingLevelMatches[h][1].length;
      if (currentLevel > prevLevel + 1) {
        issues.push({
          type: "structure",
          severity: "warning",
          message: `Heading level skipped: h${prevLevel} jumps to h${currentLevel} — screen readers may lose context`,
          fix: `Add an h${prevLevel + 1} heading between the h${prevLevel} and h${currentLevel} headings to maintain a logical hierarchy`,
          fixType: "fix-heading-skip",
        });
        break;
      }
      prevLevel = currentLevel;
    }
  }

  // Check for residual markdown tables that were not converted
  if (/^\|[\s\S]*?\|[\s\S]*?\n\|[\s\-:|]+\|/m.test(content)) {
    issues.push({
      type: "accessibility",
      severity: "warning",
      message: "Markdown pipe table detected — may not be accessible to screen readers",
      fix: "Replace markdown tables (| col | col |) with HTML <table> elements that include <caption> and <th scope> attributes",
      fixType: "convert-markdown-tables",
    });
  }

  // Check for HTML tables missing <caption> or <thead>
  const tableMatches = [...content.matchAll(/<table[\s>]/gi)];
  let reportedMissingCaption = false;
  let reportedMissingThead = false;
  for (const tableMatch of tableMatches) {
    const tableStart = tableMatch.index ?? 0;
    // Find the closing </table> tag to scope the check to this table only
    const tableEnd = content.indexOf("</table>", tableStart);
    const tableBlock = tableEnd > tableStart
      ? content.slice(tableStart, tableEnd + 8)
      : content.slice(tableStart, tableStart + 600);

    if (!reportedMissingCaption && !/<caption[\s>]/i.test(tableBlock)) {
      issues.push({
        type: "accessibility",
        severity: "warning",
        message: "HTML table found without a <caption> element",
        fix: "Add a <caption> element immediately after <table> to describe the table's purpose for screen reader users",
        fixType: "fix-html-table-caption",
      });
      reportedMissingCaption = true;
    }

    if (!reportedMissingThead && !/<thead[\s>]/i.test(tableBlock)) {
      issues.push({
        type: "accessibility",
        severity: "warning",
        message: "HTML table found without a <thead> element",
        fix: "Add a <thead> with <th scope=\"col\"> for each column so screen readers can identify column headers",
        fixType: "fix-html-table-thead",
      });
      reportedMissingThead = true;
    }

    if (reportedMissingCaption && reportedMissingThead) break;
  }

  return issues;
};

type DiffLine = { type: "unchanged" | "removed" | "added"; text: string };

type WordSpan = { text: string; changed: boolean };

function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((t) => t.length > 0);
}

function computeWordDiff(removed: string, added: string): { removedSpans: WordSpan[]; addedSpans: WordSpan[] } {
  const a = tokenize(removed);
  const b = tokenize(added);
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const removedSpans: WordSpan[] = [];
  const addedSpans: WordSpan[] = [];
  let i = m, j = n;
  const ops: Array<{ op: "same" | "remove" | "add"; text: string }> = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.unshift({ op: "same", text: a[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ op: "add", text: b[j - 1] });
      j--;
    } else {
      ops.unshift({ op: "remove", text: a[i - 1] });
      i--;
    }
  }
  for (const op of ops) {
    if (op.op === "same") {
      removedSpans.push({ text: op.text, changed: false });
      addedSpans.push({ text: op.text, changed: false });
    } else if (op.op === "remove") {
      removedSpans.push({ text: op.text, changed: true });
    } else {
      addedSpans.push({ text: op.text, changed: true });
    }
  }
  return { removedSpans, addedSpans };
}

function computeLineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const result: DiffLine[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.unshift({ type: "unchanged", text: a[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: "added", text: b[j - 1] });
      j--;
    } else {
      result.unshift({ type: "removed", text: a[i - 1] });
      i--;
    }
  }
  return result;
}

function buildDiffHunks(diff: DiffLine[], context = 2): Array<DiffLine | "ellipsis"> {
  const changed = new Set<number>();
  diff.forEach((line, idx) => { if (line.type !== "unchanged") changed.add(idx); });
  if (changed.size === 0) return [];
  const visible = new Set<number>();
  changed.forEach((idx) => {
    for (let k = Math.max(0, idx - context); k <= Math.min(diff.length - 1, idx + context); k++) {
      visible.add(k);
    }
  });
  const result: Array<DiffLine | "ellipsis"> = [];
  let prev = -1;
  Array.from(visible).sort((a, b) => a - b).forEach((idx) => {
    if (prev !== -1 && idx > prev + 1) result.push("ellipsis");
    result.push(diff[idx]);
    prev = idx;
  });
  return result;
}

function extractChildrenText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(extractChildrenText).join("");
  if (children && typeof children === "object" && "props" in (children as object)) {
    return extractChildrenText((children as { props: { children?: React.ReactNode } }).props.children);
  }
  return "";
}

export default function ResultPage() {
  const params = useParams();
  const courseId = params.id ? parseInt(params.id) : undefined;
  const isAnon = params.contentId === "anon";
  const contentId = isAnon ? undefined : (params.contentId ? parseInt(params.contentId) : undefined);
  const [location, navigate] = useLocation();
  const { toast } = useToast();
  const { isAuthenticated } = useAuth();

  const isStandalone = location.startsWith("/quick-tools");
  const backPath = isStandalone ? "/quick-tools" : `/course/${courseId}/tools`;

  const [copied, setCopied] = useState(false);
  const [showAccessibility, setShowAccessibility] = useState(false);
  const [refinementOpen, setRefinementOpen] = useState(false);
  const [refinementRequest, setRefinementRequest] = useState("");
  const [isRefining, setIsRefining] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [saveLibraryOpen, setSaveLibraryOpen] = useState(false);
  const [libraryTitle, setLibraryTitle] = useState("");
  const [libraryDescription, setLibraryDescription] = useState("");
  const [expandedSections, setExpandedSections] = useState<Record<number, boolean>>({});
  const [fixingIssue, setFixingIssue] = useState<string | null>(null);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewFixType, setPreviewFixType] = useState<string | null>(null);
  const [previewBefore, setPreviewBefore] = useState("");
  const [previewAfter, setPreviewAfter] = useState("");
  const [skipPreview, setSkipPreview] = useState(() => localStorage.getItem("a11y-skip-preview") === "true");
  const [captionDialogOpen, setCaptionDialogOpen] = useState(false);
  const [captionTexts, setCaptionTexts] = useState<string[]>(["Table summary"]);
  const [captionEditText, setCaptionEditText] = useState("Table summary");
  const [captionEditMode, setCaptionEditMode] = useState<"add" | "edit">("add");

  useEffect(() => {
    setExpandedSections({});
  }, [contentId]);

  useEffect(() => {
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    });
  }, [contentId, isAnon]);

  const { data: course } = useQuery<Course>({
    queryKey: ["/api/courses", courseId],
    enabled: !!courseId && !isStandalone,
  });

  const { data: versions } = useQuery<ContentVersion[]>({
    queryKey: ["/api/content", contentId, "versions"],
    enabled: !!contentId && versionHistoryOpen,
    staleTime: 0,
  });

  useEffect(() => {
    if (versions && versions.length > 0 && selectedVersionId === null) {
      setSelectedVersionId(versions[0].id);
    }
  }, [versions]);

  const anonData = isAnon ? queryClient.getQueryData<GeneratedContent>(["/api/standalone-content", "anon"]) : undefined;

  const { data: fetchedContent, isLoading } = useQuery<GeneratedContent>({
    queryKey: isStandalone ? ["/api/standalone-content", contentId] : ["/api/content", contentId],
    enabled: !!contentId && !isAnon,
  });

  const { data: appConfig } = useQuery<AppConfig>({
    queryKey: ["/api/config"],
  });

  const content = isAnon ? (anonData as GeneratedContent | undefined) : fetchedContent;

  usePageTitle(content ? content.toolName + " Result" : "Result");

  const refineMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/content/${contentId}/refine`, {
        refinementRequest,
      });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/content", contentId] });
      queryClient.invalidateQueries({ queryKey: ["/api/standalone-content", contentId] });
      queryClient.invalidateQueries({ queryKey: ["/api/content", contentId, "versions"] });
      setRefinementOpen(false);
      setRefinementRequest("");
      setIsRefining(false);
      toast({ title: "Content refined successfully!" });
    },
    onError: (error) => {
      toast({ title: "Refinement failed", description: error.message, variant: "destructive" });
      setIsRefining(false);
    },
  });

  const saveToLibraryMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/library", {
        title: libraryTitle || content?.toolName,
        toolType: content?.toolType,
        content: content?.content,
        description: libraryDescription,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library"] });
      setSaveLibraryOpen(false);
      setLibraryTitle("");
      setLibraryDescription("");
      toast({ title: "Saved as template!", description: "You can access this template from the Content Library to use in any course." });
    },
    onError: (error) => {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    },
  });

  const toggleApprovalMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("PATCH", `/api/content/${contentId}/approval`, {
        isApproved: !content?.isApproved,
      });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/content", contentId] });
      queryClient.invalidateQueries({ queryKey: ["/api/courses", courseId, "content"] });
      const isNowApproved = data.isApproved;
      toast({ 
        title: isNowApproved ? "Added to Course Materials" : "Removed from Course Materials",
        description: isNowApproved 
          ? "This content will inform other tools in this course." 
          : "This content will no longer influence other tools."
      });
    },
    onError: (error) => {
      toast({ title: "Failed to update", description: error.message, variant: "destructive" });
    },
  });

  const undoFixMutation = useMutation({
    mutationFn: async (versionId: number) => {
      const response = await apiRequest("POST", `/api/content/${contentId}/restore-version`, { versionId });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/content", contentId] });
      queryClient.invalidateQueries({ queryKey: ["/api/standalone-content", contentId] });
      queryClient.invalidateQueries({ queryKey: ["/api/content", contentId, "versions"] });
      toast({
        title: "Fix undone",
        description: appConfig
          ? `Content restored to the version before the fix. Up to ${appConfig.versionHistoryLimit} versions are kept.`
          : "Content restored to the version before the fix.",
      });
    },
    onError: (error) => {
      toast({ title: "Undo failed", description: error.message, variant: "destructive" });
    },
  });

  const restoreVersionMutation = useMutation({
    mutationFn: async (versionId: number) => {
      const response = await apiRequest("POST", `/api/content/${contentId}/restore-version`, { versionId });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/content", contentId] });
      queryClient.invalidateQueries({ queryKey: ["/api/standalone-content", contentId] });
      queryClient.invalidateQueries({ queryKey: ["/api/content", contentId, "versions"] });
      setVersionHistoryOpen(false);
      setSelectedVersionId(null);
      toast({ title: "Version restored", description: "Content has been restored to the selected version." });
    },
    onError: (error) => {
      toast({ title: "Restore failed", description: error.message, variant: "destructive" });
    },
  });

  const applyFixMutation = useMutation({
    mutationFn: async ({ fixType, captionTexts, captionText }: { fixType: string; captionTexts?: string[]; captionText?: string }) => {
      const body: Record<string, unknown> = { fixType };
      if (captionTexts !== undefined) body.captionTexts = captionTexts;
      if (captionText !== undefined) body.captionText = captionText;
      const response = await apiRequest("POST", `/api/content/${contentId}/fix-accessibility`, body);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/content", contentId] });
      queryClient.invalidateQueries({ queryKey: ["/api/standalone-content", contentId] });
      queryClient.invalidateQueries({ queryKey: ["/api/content", contentId, "versions"] });
      setFixingIssue(null);
      const preFixVersionId: number | null = data?.preFixVersionId ?? null;
      toast({
        title: "Fix applied successfully!",
        description: appConfig
          ? `Up to ${appConfig.versionHistoryLimit} versions are kept.`
          : undefined,
        action: preFixVersionId
          ? (
            <ToastAction
              altText="Undo fix"
              onClick={() => undoFixMutation.mutate(preFixVersionId)}
              data-testid="button-undo-fix"
            >
              Undo
            </ToastAction>
          )
          : undefined,
      });
    },
    onError: (error) => {
      toast({ title: "Fix failed", description: error.message, variant: "destructive" });
      setFixingIssue(null);
    },
  });

  const countTablesWithoutCaptions = (html: string): number => {
    const tableRegex = /<table(?:\s[^>]*)?>[\s\S]*?<\/table>/gi;
    let count = 0;
    let match;
    while ((match = tableRegex.exec(html)) !== null) {
      if (!/<caption[\s>]/i.test(match[0])) count++;
    }
    return count;
  };

  const openCaptionDialog = () => {
    const count = content ? countTablesWithoutCaptions(content.content) : 1;
    setCaptionTexts(Array(Math.max(1, count)).fill("Table summary"));
    setCaptionDialogOpen(true);
  };

  const handleApplyFix = (fixType: string) => {
    if (fixType === "fix-html-table-caption") {
      openCaptionDialog();
      return;
    }
    setFixingIssue(fixType);
    applyFixMutation.mutate({ fixType });
  };

  const handleEditCaption = (currentCaption: string) => {
    setCaptionEditMode("edit");
    setCaptionEditText(currentCaption);
    setCaptionDialogOpen(true);
  };

  const handleApplyCaptionFix = () => {
    setCaptionDialogOpen(false);
    if (captionEditMode === "edit") {
      setFixingIssue("edit-html-table-caption");
      applyFixMutation.mutate({ fixType: "edit-html-table-caption", captionText: captionEditText });
    } else {
      setFixingIssue("fix-html-table-caption");
      applyFixMutation.mutate({ fixType: "fix-html-table-caption", captionTexts });
    }
  };

  const previewFixMutation = useMutation({
    mutationFn: async (fixType: string) => {
      const response = await apiRequest("POST", `/api/content/${contentId}/preview-fix`, { fixType });
      return response.json() as Promise<{ before: string; after: string }>;
    },
    onSuccess: (data, fixType) => {
      setPreviewBefore(data.before);
      setPreviewAfter(data.after);
      setPreviewFixType(fixType);
      setPreviewOpen(true);
    },
    onError: (error) => {
      toast({ title: "Preview failed", description: error.message, variant: "destructive" });
    },
  });

  const handlePreviewFix = (fixType: string) => {
    setPreviewFixType(fixType);
    previewFixMutation.mutate(fixType);
  };

  const handleToggleSkipPreview = (value: boolean) => {
    setSkipPreview(value);
    localStorage.setItem("a11y-skip-preview", value ? "true" : "false");
  };

  const handleFixThis = (fixType: string) => {
    if (fixType === "fix-html-table-caption") {
      openCaptionDialog();
      return;
    }
    if (skipPreview) {
      handleApplyFix(fixType);
    } else {
      handlePreviewFix(fixType);
    }
  };

  const handleConfirmFix = () => {
    if (!previewFixType) return;
    setPreviewOpen(false);
    handleApplyFix(previewFixType);
  };

  const handleCopy = async () => {
    if (!content) return;
    await navigator.clipboard.writeText(content.content);
    setCopied(true);
    toast({ title: "Copied to clipboard!" });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadText = () => {
    if (!content) return;
    const blob = new Blob([content.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const filename = course
      ? `${content.toolName.replace(/\s/g, "_")}_${course.courseNumber}.txt`
      : `${content.toolName.replace(/\s/g, "_")}.txt`;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadWord = async () => {
    if (!content) return;
    try {
      const response = await fetch(`/api/content/${contentId}/export-docx`);
      if (!response.ok) {
        throw new Error("Export failed");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const filename = course 
        ? `${content.toolName.replace(/\s+/g, "_")}_${course.courseNumber}.docx`
        : `${content.toolName.replace(/\s+/g, "_")}.docx`;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Word document downloaded!" });
    } catch (error) {
      toast({ title: "Export failed", description: "Could not generate Word document", variant: "destructive" });
    }
  };

  const handleRefine = () => {
    if (!refinementRequest.trim()) {
      toast({ title: "Please describe what changes you'd like to make", variant: "destructive" });
      return;
    }
    setIsRefining(true);
    let index = 0;
    setLoadingMessage("Processing your refinement request...");
    const refinementMessages = [
      "Processing your refinement request...",
      "Analyzing requested changes...",
      "Updating content structure...",
      "Incorporating your feedback...",
      "Finalizing refined version...",
    ];
    const interval = setInterval(() => {
      index = (index + 1) % refinementMessages.length;
      setLoadingMessage(refinementMessages[index]);
    }, 2000);
    
    refineMutation.mutate(undefined, {
      onSettled: () => clearInterval(interval),
    });
  };

  function getVersionLabel(version: ContentVersion): string {
    if (version.refinementRequest === "accessibility-fix-snapshot") {
      return "Before accessibility fix";
    }
    if (version.refinementRequest === "Previous version") {
      return "Before refinement";
    }
    return version.refinementRequest || "Saved version";
  }

  const selectedVersion = versions?.find(v => v.id === selectedVersionId) ?? null;

  const tool = content ? TOOLS.find(t => t.id === content.toolType) : null;
  const accessibilityIssues = content ? checkAccessibility(content.content) : [];

  if (isLoading) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-background flex items-center justify-center">
        <div role="status" aria-live="polite" className="flex items-center gap-2">
          <Loader2 className="w-8 h-8 animate-spin text-primary" aria-hidden="true" />
          <span className="sr-only">Loading generated content</span>
        </div>
      </main>
    );
  }

  if (!content) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="p-6 text-center">
            <p className="text-muted-foreground">Content not found</p>
            <Button className="mt-4" onClick={() => navigate(backPath)}>
              Return to Tools
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (isRefining) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-gradient-to-br from-primary/5 to-accent/5 flex items-center justify-center">
        <Card className="max-w-lg w-full mx-4">
          <CardContent className="p-12 text-center" role="status" aria-live="polite">
            <div className="w-20 h-20 mx-auto mb-8 relative">
              <div className="absolute inset-0 bg-secondary/20 rounded-full animate-ping" aria-hidden="true" />
              <div className="relative w-full h-full bg-secondary rounded-full flex items-center justify-center">
                <RefreshCw className="w-10 h-10 text-white animate-spin-slow" aria-hidden="true" />
              </div>
            </div>
            <h2 className="text-2xl font-bold mb-4">Refining Your Content</h2>
            <p className="text-muted-foreground mb-6 animate-pulse-subtle">
              {loadingMessage}
            </p>
            <div className="flex justify-center gap-1" aria-hidden="true">
              {[0, 1, 2].map(i => (
                <div
                  key={i}
                  className="w-2 h-2 bg-secondary rounded-full animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate(backPath)}
                aria-label="Back to tools"
                data-testid="button-back-tools"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h1 className="text-xl font-bold">{content.toolName}</h1>
                  {course && (
                    <p className="text-sm text-muted-foreground">{course.courseName} ({course.courseNumber})</p>
                  )}
                </div>
              </div>
            </div>
            <HeaderControls variant="light" showHome={true} />
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <Card className="mb-6">
          <CardContent className="py-3 px-4">
            <div className="flex flex-wrap gap-2 items-center">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopy}
                data-testid="button-copy"
              >
                {copied ? <CheckCircle className="w-4 h-4 mr-1.5" /> : <Copy className="w-4 h-4 mr-1.5" />}
                <span aria-live="polite">{copied ? "Copied!" : "Copy"}</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadText}
                data-testid="button-download-txt"
              >
                <Download className="w-4 h-4 mr-1.5" />
                .txt
              </Button>
              {!isAnon && <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadWord}
                data-testid="button-download-docx"
              >
                <FileText className="w-4 h-4 mr-1.5" />
                .docx
              </Button>}
              {!isStandalone && (
              <Button
                variant={content.isApproved ? "default" : "outline"}
                size="sm"
                onClick={() => toggleApprovalMutation.mutate()}
                disabled={toggleApprovalMutation.isPending}
                aria-pressed={content.isApproved}
                aria-label={content.isApproved ? "Connected to course. Click to disconnect." : "Not connected. Click to connect to course."}
                data-testid="button-toggle-approval"
              >
                <span aria-live="polite">
                {content.isApproved ? (
                  <>
                    <Link2 className="w-4 h-4 mr-1.5 inline" />
                    Connected
                  </>
                ) : (
                  <>
                    <Link2Off className="w-4 h-4 mr-1.5 inline" />
                    Connect to Course
                  </>
                )}
                </span>
              </Button>
              )}
              {isAuthenticated && <Dialog open={saveLibraryOpen} onOpenChange={setSaveLibraryOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="button-save-library"
                  >
                    <Library className="w-4 h-4 mr-1.5" />
                    Save as Template
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Save as Template</DialogTitle>
                    <DialogDescription>
                      Save this content to reuse across other courses
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="library-title">Title</Label>
                      <Input
                        id="library-title"
                        placeholder={content?.toolName}
                        value={libraryTitle}
                        onChange={(e) => setLibraryTitle(e.target.value)}
                        data-testid="input-library-title"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="library-description">Description (optional)</Label>
                      <Textarea
                        id="library-description"
                        placeholder="Add notes about this content..."
                        value={libraryDescription}
                        onChange={(e) => setLibraryDescription(e.target.value)}
                        data-testid="textarea-library-description"
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setSaveLibraryOpen(false)}>
                      Cancel
                    </Button>
                    <Button 
                      onClick={() => saveToLibraryMutation.mutate()}
                      disabled={saveToLibraryMutation.isPending}
                      data-testid="button-confirm-save-library"
                    >
                      {saveToLibraryMutation.isPending ? "Saving..." : "Save Template"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>}
            </div>
          </CardContent>
        </Card>
        <Collapsible open={showAccessibility} onOpenChange={setShowAccessibility} className="mb-6">
            <Card className={accessibilityIssues.length === 0 ? "border-green-500" : "border-primary"}>
              <CollapsibleTrigger asChild>
                <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {accessibilityIssues.length === 0 ? (
                        <div className="w-10 h-10 bg-green-500/10 rounded-lg flex items-center justify-center" data-testid="icon-accessibility-all-clear">
                          <CheckCircle className="w-5 h-5 text-green-500" />
                        </div>
                      ) : (
                        <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                          <Lightbulb className="w-5 h-5 text-primary" />
                        </div>
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-lg">Accessibility Check</CardTitle>
                          {accessibilityIssues.length === 0 ? (
                            <Badge
                              className="bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30 hover:bg-green-500/15"
                              variant="outline"
                              data-testid="badge-accessibility-all-clear"
                            >
                              ✓ All Clear
                            </Badge>
                          ) : accessibilityIssues.some(i => i.severity === "warning") ? (
                            <Badge
                              className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/15"
                              variant="outline"
                              data-testid="badge-accessibility-count"
                            >
                              {accessibilityIssues.length} issue{accessibilityIssues.length !== 1 ? "s" : ""}
                            </Badge>
                          ) : (
                            <Badge
                              className="bg-primary/10 text-primary border-primary/30 hover:bg-primary/10"
                              variant="outline"
                              data-testid="badge-accessibility-count"
                            >
                              {accessibilityIssues.length} suggestion{accessibilityIssues.length !== 1 ? "s" : ""}
                            </Badge>
                          )}
                        </div>
                        <CardDescription>
                          {accessibilityIssues.length === 0
                            ? "Looks good! No accessibility issues detected."
                            : accessibilityIssues.some(i => i.severity === "warning")
                              ? `${accessibilityIssues.length} issue${accessibilityIssues.length !== 1 ? "s" : ""} found — review before distributing`
                              : `${accessibilityIssues.length} suggestion${accessibilityIssues.length !== 1 ? "s" : ""} to improve accessibility`}
                        </CardDescription>
                      </div>
                    </div>
                    <ChevronDown className={`w-5 h-5 transition-transform ${showAccessibility ? "rotate-180" : ""}`} />
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0 space-y-3">
                  <div className="flex items-center gap-2 pb-1 border-b border-border/50">
                    <input
                      id="skip-preview-toggle"
                      type="checkbox"
                      className="w-4 h-4 accent-primary cursor-pointer"
                      checked={skipPreview}
                      onChange={(e) => handleToggleSkipPreview(e.target.checked)}
                      data-testid="checkbox-skip-preview"
                    />
                    <label
                      htmlFor="skip-preview-toggle"
                      className="text-sm text-muted-foreground cursor-pointer select-none"
                    >
                      Apply fixes directly without previewing
                    </label>
                  </div>
                  {accessibilityIssues.map((issue, index) => (
                    <div
                      key={index}
                      className={`p-4 rounded-lg border-l-4 ${
                        issue.severity === "warning"
                          ? "bg-secondary/10 border-secondary"
                          : "bg-primary/5 border-primary"
                      }`}
                      data-testid={`accessibility-issue-${index}`}
                    >
                      <div className="flex items-start gap-3">
                        {issue.severity === "warning" ? (
                          <AlertTriangle className="w-5 h-5 text-secondary mt-0.5 shrink-0" />
                        ) : (
                          <Lightbulb className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <Badge variant="outline" className="mb-2 text-xs">
                              {issue.type}
                            </Badge>
                            {issue.fixType && !isAnon && contentId && (
                              <div className="mb-2 flex items-center gap-1.5">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-1.5 text-xs h-7 px-2"
                                  disabled={fixingIssue === issue.fixType || applyFixMutation.isPending || previewFixMutation.isPending}
                                  onClick={() => handleFixThis(issue.fixType!)}
                                  data-testid={`button-fix-${issue.fixType}`}
                                >
                                  {fixingIssue === issue.fixType ? (
                                    <>
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                      Fixing…
                                    </>
                                  ) : previewFixMutation.isPending && previewFixType === issue.fixType ? (
                                    <>
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                      Loading…
                                    </>
                                  ) : (
                                    <>
                                      <CheckCircle className="w-3 h-3" />
                                      Fix this
                                    </>
                                  )}
                                </Button>
                                {!skipPreview && (
                                  <button
                                    className="text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors leading-none"
                                    disabled={fixingIssue !== null || applyFixMutation.isPending || previewFixMutation.isPending}
                                    onClick={() => handleApplyFix(issue.fixType!)}
                                    data-testid={`button-fix-direct-${issue.fixType}`}
                                  >
                                    Apply directly
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                          <p className="font-medium">{issue.message}</p>
                          <p className="text-sm text-muted-foreground mt-1">
                            <strong>Fix:</strong> {issue.fix}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
            <div>
              <CardTitle>Generated Content</CardTitle>
              <CardDescription>
                Created on {new Date(content.createdAt).toLocaleDateString()} at{" "}
                {new Date(content.createdAt).toLocaleTimeString()}
              </CardDescription>
            </div>
            {isAuthenticated && !isAnon && contentId && (
            <div className="flex items-center gap-2">
              <Dialog open={versionHistoryOpen} onOpenChange={(open) => { setVersionHistoryOpen(open); if (!open) setSelectedVersionId(null); }}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="gap-2" data-testid="button-version-history">
                    <History className="w-4 h-4" />
                    History
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col">
                  <DialogHeader>
                    <DialogTitle>Version History</DialogTitle>
                    <DialogDescription>
                      Browse all saved versions and restore any previous state
                    </DialogDescription>
                  </DialogHeader>
                  <div className="flex flex-col sm:flex-row gap-4 flex-1 min-h-0 overflow-hidden">
                    <div className="sm:w-64 shrink-0 flex flex-col min-h-0">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                        {versions?.length ?? 0} saved version{versions?.length !== 1 ? "s" : ""}
                      </p>
                      {!versions ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : versions.length === 0 ? (
                        <div className="py-8 text-center">
                          <History className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                          <p className="text-sm text-muted-foreground">No saved versions yet.</p>
                          <p className="text-xs text-muted-foreground mt-1">Versions are saved automatically when you refine or apply accessibility fixes.</p>
                        </div>
                      ) : (
                        <ScrollArea className="flex-1">
                          <div className="space-y-1 pr-2">
                            {versions.map((version) => (
                              <button
                                key={version.id}
                                className={`w-full text-left rounded-md px-3 py-2.5 transition-colors border ${
                                  selectedVersionId === version.id
                                    ? "bg-primary/10 border-primary/30"
                                    : "bg-background hover:bg-muted border-transparent hover:border-border"
                                }`}
                                onClick={() => setSelectedVersionId(version.id)}
                                data-testid={`version-item-${version.id}`}
                              >
                                <p className="text-sm font-medium leading-snug line-clamp-2">{getVersionLabel(version)}</p>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {new Date(version.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                                  {" · "}
                                  {new Date(version.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                                </p>
                              </button>
                            ))}
                          </div>
                        </ScrollArea>
                      )}
                    </div>
                    <div className="flex-1 flex flex-col min-h-0 border rounded-md overflow-hidden">
                      {selectedVersion ? (
                        <>
                          <div className="px-4 py-3 border-b bg-muted/30 shrink-0 flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium">{getVersionLabel(selectedVersion)}</p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(selectedVersion.createdAt).toLocaleString()}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              className="gap-1.5 shrink-0"
                              onClick={() => restoreVersionMutation.mutate(selectedVersion.id)}
                              disabled={restoreVersionMutation.isPending}
                              data-testid="button-restore-version"
                            >
                              {restoreVersionMutation.isPending ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <RotateCcw className="w-3.5 h-3.5" />
                              )}
                              Restore this version
                            </Button>
                          </div>
                          <ScrollArea className="flex-1 p-4">
                            <div className="prose prose-sm max-w-none dark:prose-invert whitespace-pre-wrap text-sm text-foreground leading-relaxed font-mono" data-testid="version-preview-content">
                              {selectedVersion.content}
                            </div>
                          </ScrollArea>
                        </>
                      ) : (
                        <div className="flex-1 flex items-center justify-center">
                          <div className="text-center">
                            <History className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                            <p className="text-sm text-muted-foreground">Select a version to preview its content</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            <Dialog open={refinementOpen} onOpenChange={setRefinementOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="gap-2" data-testid="button-refine">
                  <RefreshCw className="w-4 h-4" />
                  Refine
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Refine Your Content</DialogTitle>
                  <DialogDescription>
                    Describe the changes you'd like to make to improve this content
                  </DialogDescription>
                </DialogHeader>
                {appConfig && (
                  <p className="text-xs text-muted-foreground" data-testid="text-version-history-limit">
                    Showing up to {appConfig.versionHistoryLimit} versions
                  </p>
                )}
                <Textarea
                  placeholder="e.g., Make the rubric more detailed, add more UDL accommodations, simplify the language..."
                  value={refinementRequest}
                  onChange={(e) => setRefinementRequest(e.target.value)}
                  className="min-h-32"
                  data-testid="textarea-refinement"
                />
                <DialogFooter>
                  <Button variant="outline" onClick={() => setRefinementOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleRefine} className="gap-2" data-testid="button-submit-refine">
                    <RefreshCw className="w-4 h-4" />
                    Refine Content
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            </div>
            )}
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[600px] pr-4">
              <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-primary prose-headings:font-bold prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-p:text-foreground prose-li:text-foreground prose-strong:text-foreground prose-table:text-sm">
                {(() => {
                  const sections = splitContentIntoSections(content.content);
                  const markdownComponents: Components = {
                    table: ({ node, children, ...props }) => (
                      <div className="overflow-x-auto my-4">
                        <table {...props} className="min-w-full border-collapse border border-border">
                          {children}
                        </table>
                      </div>
                    ),
                    caption: ({ node, children, ...props }) => {
                      const captionText = extractChildrenText(children);
                      return (
                        <caption {...props} className="text-sm text-muted-foreground mb-2 caption-top group/cap">
                          {children}
                          {!isAnon && contentId && (
                            <button
                              className="ml-1.5 opacity-0 group-hover/cap:opacity-100 transition-opacity inline-flex items-center text-muted-foreground hover:text-foreground focus:opacity-100 focus:outline-none"
                              onClick={(e) => { e.preventDefault(); handleEditCaption(captionText); }}
                              title="Edit caption"
                              type="button"
                              data-testid="button-edit-caption"
                              aria-label="Edit table caption"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          )}
                        </caption>
                      );
                    },
                    thead: ({ node, children, ...props }) => (
                      <thead {...props} className="bg-muted">{children}</thead>
                    ),
                    th: ({ node, children, ...props }) => (
                      <th {...props} className="border border-border px-3 py-2 text-left font-semibold text-foreground">
                        {children}
                      </th>
                    ),
                    td: ({ node, children, ...props }) => (
                      <td {...props} className="border border-border px-3 py-2 text-foreground">
                        {children}
                      </td>
                    ),
                    h1: ({ children }) => (
                      <h1 className="text-2xl font-bold text-primary mt-6 mb-3">{children}</h1>
                    ),
                    h2: ({ children }) => (
                      <h2 className="text-xl font-bold text-primary mt-5 mb-2">{children}</h2>
                    ),
                    h3: ({ children }) => (
                      <h3 className="text-lg font-semibold text-primary mt-4 mb-2">{children}</h3>
                    ),
                    ul: ({ children }) => (
                      <ul className="list-disc pl-6 my-2 space-y-1">{children}</ul>
                    ),
                    ol: ({ children }) => (
                      <ol className="list-decimal pl-6 my-2 space-y-1">{children}</ol>
                    ),
                    li: ({ children }) => (
                      <li className="text-foreground">{children}</li>
                    ),
                    p: ({ children }) => (
                      <p className="my-2 text-foreground leading-relaxed">{children}</p>
                    ),
                    strong: ({ children }) => (
                      <strong className="font-semibold text-foreground">{children}</strong>
                    ),
                    hr: () => (
                      <hr className="my-4 border-border" />
                    ),
                  };

                  if (sections.length <= 1) {
                    return (
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]} components={markdownComponents}>
                        {content.content}
                      </ReactMarkdown>
                    );
                  }

                  return sections.map((section, idx) => {
                    if (!section.heading) {
                      return (
                        <div key={idx} data-testid={`section-intro-${idx}`}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]} components={markdownComponents}>
                            {section.body}
                          </ReactMarkdown>
                        </div>
                      );
                    }

                    if (!section.collapsed) {
                      return (
                        <div key={idx} data-testid={`section-expanded-${idx}`}>
                          <h2 className="text-xl font-bold text-primary mt-5 mb-2">{section.heading}</h2>
                          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]} components={markdownComponents}>
                            {section.body}
                          </ReactMarkdown>
                        </div>
                      );
                    }

                    const isOpen = expandedSections[idx] ?? false;
                    const sectionWordCount = section.body.trim().split(/\s+/).filter(Boolean).length;
                    return (
                      <Collapsible key={idx} open={isOpen} onOpenChange={(open) => setExpandedSections(prev => ({ ...prev, [idx]: open }))}>
                        <div className="flex items-center gap-2 mt-5 mb-2">
                          <CollapsibleTrigger asChild>
                            <button
                              className="flex items-center gap-2 min-w-0 flex-1 text-left group cursor-pointer hover:bg-muted/50 rounded-md px-2 py-1 -mx-2 transition-colors"
                              data-testid={`collapsible-trigger-${idx}`}
                            >
                              <ChevronRight className={`w-4 h-4 text-primary transition-transform shrink-0 ${isOpen ? "rotate-90" : ""}`} />
                              <h2 className="text-xl font-bold text-primary">{section.heading}</h2>
                            </button>
                          </CollapsibleTrigger>
                          <Badge
                            className="bg-primary/10 text-primary border-primary/30 hover:bg-primary/10 shrink-0"
                            variant="outline"
                            data-testid={`badge-section-wordcount-${idx}`}
                          >
                            {sectionWordCount} word{sectionWordCount !== 1 ? "s" : ""}
                          </Badge>
                        </div>
                        <CollapsibleContent>
                          <div data-testid={`collapsible-content-${idx}`}>
                            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]} components={markdownComponents}>
                              {section.body}
                            </ReactMarkdown>
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  });
                })()}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <div className="mt-8 flex justify-center">
          <Button
            variant="outline"
            size="lg"
            onClick={() => navigate(isStandalone ? `/quick-tools/${content.toolType}` : `/course/${courseId}/tool/${content.toolType}`)}
            className="gap-2"
            data-testid="button-create-another"
          >
            Create Another {tool?.name || "Item"}
          </Button>
        </div>
      </div>
      <PoweredByFooter />

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl" data-testid="dialog-fix-preview">
          <DialogHeader>
            <DialogTitle>Preview Fix</DialogTitle>
            <DialogDescription>
              Review what will change before applying the fix. Lines in{" "}
              <span className="text-red-600 dark:text-red-400 font-medium">red</span> will be removed and lines in{" "}
              <span className="text-green-600 dark:text-green-400 font-medium">green</span> will be added.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-80 rounded border bg-muted/30 p-3 font-mono text-xs leading-relaxed" data-testid="diff-preview-scroll">
            {(() => {
              const diff = computeLineDiff(previewBefore, previewAfter);
              const hunks = buildDiffHunks(diff);
              if (hunks.length === 0) {
                return <p className="text-muted-foreground italic">No changes would be made by this fix.</p>;
              }
              const elements: ReactNode[] = [];
              let i2 = 0;
              while (i2 < hunks.length) {
                const item = hunks[i2];
                if (item === "ellipsis") {
                  elements.push(
                    <div key={i2} className="text-muted-foreground text-center py-0.5 select-none">···</div>
                  );
                  i2++;
                  continue;
                }
                const next = hunks[i2 + 1];
                const isPair =
                  item.type === "removed" &&
                  next !== undefined &&
                  next !== "ellipsis" &&
                  next.type === "added";
                if (isPair) {
                  const nextLine = next as DiffLine;
                  const { removedSpans, addedSpans } = computeWordDiff(item.text, nextLine.text);
                  elements.push(
                    <div key={i2} className="bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-200 px-2 py-0.5 rounded-sm whitespace-pre-wrap break-all" data-testid="diff-line-removed">
                      <span className="select-none mr-1 opacity-60">−</span>
                      {removedSpans.map((s, si) =>
                        s.changed
                          ? <mark key={si} className="bg-red-300 dark:bg-red-700 text-red-900 dark:text-red-100 rounded-sm px-0.5" data-testid="diff-word-removed">{s.text}</mark>
                          : <span key={si}>{s.text}</span>
                      )}
                    </div>
                  );
                  elements.push(
                    <div key={i2 + 1} className="bg-green-100 dark:bg-green-950 text-green-800 dark:text-green-200 px-2 py-0.5 rounded-sm whitespace-pre-wrap break-all" data-testid="diff-line-added">
                      <span className="select-none mr-1 opacity-60">+</span>
                      {addedSpans.map((s, si) =>
                        s.changed
                          ? <mark key={si} className="bg-green-300 dark:bg-green-700 text-green-900 dark:text-green-100 rounded-sm px-0.5" data-testid="diff-word-added">{s.text}</mark>
                          : <span key={si}>{s.text}</span>
                      )}
                    </div>
                  );
                  i2 += 2;
                  continue;
                }
                if (item.type === "removed") {
                  elements.push(
                    <div key={i2} className="bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-200 px-2 py-0.5 rounded-sm whitespace-pre-wrap break-all" data-testid="diff-line-removed">
                      <span className="select-none mr-1 opacity-60">−</span>{item.text || " "}
                    </div>
                  );
                } else if (item.type === "added") {
                  elements.push(
                    <div key={i2} className="bg-green-100 dark:bg-green-950 text-green-800 dark:text-green-200 px-2 py-0.5 rounded-sm whitespace-pre-wrap break-all" data-testid="diff-line-added">
                      <span className="select-none mr-1 opacity-60">+</span>{item.text || " "}
                    </div>
                  );
                } else {
                  elements.push(
                    <div key={i2} className="text-muted-foreground px-2 py-0.5 whitespace-pre-wrap break-all" data-testid="diff-line-unchanged">
                      <span className="select-none mr-1 opacity-40"> </span>{item.text || " "}
                    </div>
                  );
                }
                i2++;
              }
              return elements;
            })()}
          </ScrollArea>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => setPreviewOpen(false)}
              data-testid="button-preview-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmFix}
              disabled={fixingIssue !== null || applyFixMutation.isPending}
              data-testid="button-preview-confirm"
            >
              {applyFixMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                  Applying…
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4 mr-1.5" />
                  Apply fix
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={captionDialogOpen} onOpenChange={(open) => { if (!open) setCaptionDialogOpen(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {captionEditMode === "edit" ? "Edit Table Caption" : `Set Table ${captionTexts.length > 1 ? "Captions" : "Caption"}`}
            </DialogTitle>
            <DialogDescription>
              {captionEditMode === "edit"
                ? "Update the caption to better describe what this table contains. Captions help screen reader users understand the table's purpose."
                : captionTexts.length > 1
                  ? `Enter a meaningful caption for each of the ${captionTexts.length} tables missing a caption. Good captions help screen reader users understand each table's purpose.`
                  : "Enter a meaningful caption that describes what this table contains. A good caption helps screen reader users understand the table's purpose."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-72 overflow-y-auto pr-1">
            {captionEditMode === "edit" ? (
              <div className="space-y-1">
                <Label htmlFor="caption-input-edit">Caption text</Label>
                <Input
                  id="caption-input-edit"
                  value={captionEditText}
                  onChange={(e) => setCaptionEditText(e.target.value)}
                  placeholder="e.g., Weekly assignment schedule"
                  onKeyDown={(e) => { if (e.key === "Enter") handleApplyCaptionFix(); }}
                  data-testid="input-caption-text"
                  autoFocus
                />
              </div>
            ) : captionTexts.map((text, index) => (
              <div key={index} className="space-y-1">
                <Label htmlFor={`caption-input-${index}`}>
                  {captionTexts.length > 1 ? `Table ${index + 1} caption` : "Caption text"}
                </Label>
                <Input
                  id={`caption-input-${index}`}
                  value={text}
                  onChange={(e) => {
                    const updated = [...captionTexts];
                    updated[index] = e.target.value;
                    setCaptionTexts(updated);
                  }}
                  placeholder="e.g., Weekly assignment schedule"
                  onKeyDown={(e) => { if (e.key === "Enter" && index === captionTexts.length - 1) handleApplyCaptionFix(); }}
                  data-testid={`input-caption-text-${index}`}
                  autoFocus={index === 0}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCaptionDialogOpen(false)} data-testid="button-cancel-caption">
              Cancel
            </Button>
            <Button
              onClick={handleApplyCaptionFix}
              className="gap-2"
              disabled={captionEditMode === "edit" ? !captionEditText.trim() : captionTexts.some((t) => !t.trim())}
              data-testid="button-apply-caption"
            >
              <CheckCircle className="w-4 h-4" />
              {captionEditMode === "edit" ? "Save Caption" : `Apply ${captionTexts.length > 1 ? "Captions" : "Caption"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

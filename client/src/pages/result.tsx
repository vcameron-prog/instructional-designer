import { useState, useEffect } from "react";
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
import { ArrowLeft, Copy, Download, FileText, RefreshCw, CheckCircle, AlertTriangle, Lightbulb, ChevronDown, ChevronRight, Loader2, Library, Link2, Link2Off } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TOOLS, LOADING_MESSAGES } from "@/lib/constants";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { usePageTitle } from "@/hooks/use-page-title";
import { useAuth } from "@/hooks/use-auth";
import type { Course, GeneratedContent } from "@shared/schema";

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
      });
      reportedMissingCaption = true;
    }

    if (!reportedMissingThead && !/<thead[\s>]/i.test(tableBlock)) {
      issues.push({
        type: "accessibility",
        severity: "warning",
        message: "HTML table found without a <thead> element",
        fix: "Add a <thead> with <th scope=\"col\"> for each column so screen readers can identify column headers",
      });
      reportedMissingThead = true;
    }

    if (reportedMissingCaption && reportedMissingThead) break;
  }

  return issues;
};

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
      toast({ title: "Fix undone", description: "Content restored to the version before the fix." });
    },
    onError: (error) => {
      toast({ title: "Undo failed", description: error.message, variant: "destructive" });
    },
  });

  const applyFixMutation = useMutation({
    mutationFn: async (fixType: string) => {
      const response = await apiRequest("POST", `/api/content/${contentId}/fix-accessibility`, { fixType });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/content", contentId] });
      queryClient.invalidateQueries({ queryKey: ["/api/standalone-content", contentId] });
      setFixingIssue(null);
      const preFixVersionId: number | null = data?.preFixVersionId ?? null;
      toast({
        title: "Fix applied successfully!",
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

  const handleApplyFix = (fixType: string) => {
    setFixingIssue(fixType);
    applyFixMutation.mutate(fixType);
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
                              <Button
                                size="sm"
                                variant="outline"
                                className="mb-2 gap-1.5 text-xs h-7 px-2"
                                disabled={fixingIssue === issue.fixType || applyFixMutation.isPending}
                                onClick={() => handleApplyFix(issue.fixType!)}
                                data-testid={`button-fix-${issue.fixType}`}
                              >
                                {fixingIssue === issue.fixType ? (
                                  <>
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    Fixing…
                                  </>
                                ) : (
                                  <>
                                    <CheckCircle className="w-3 h-3" />
                                    Fix this
                                  </>
                                )}
                              </Button>
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
            {isAuthenticated && !isAnon && <Dialog open={refinementOpen} onOpenChange={setRefinementOpen}>
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
            </Dialog>}
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
                    caption: ({ node, children, ...props }) => (
                      <caption {...props} className="text-sm text-muted-foreground mb-2 caption-top">
                        {children}
                      </caption>
                    ),
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
                        <CollapsibleTrigger asChild>
                          <button
                            className="flex items-center gap-2 w-full text-left group mt-5 mb-2 cursor-pointer hover:bg-muted/50 rounded-md px-2 py-1 -mx-2 transition-colors"
                            data-testid={`collapsible-trigger-${idx}`}
                          >
                            <ChevronRight className={`w-4 h-4 text-primary transition-transform shrink-0 ${isOpen ? "rotate-90" : ""}`} />
                            <h2 className="text-xl font-bold text-primary">{section.heading}</h2>
                            <Badge
                              className="bg-primary/10 text-primary border-primary/30 hover:bg-primary/10 ml-1 shrink-0"
                              variant="outline"
                              data-testid={`badge-section-wordcount-${idx}`}
                            >
                              {sectionWordCount} word{sectionWordCount !== 1 ? "s" : ""}
                            </Badge>
                          </button>
                        </CollapsibleTrigger>
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
    </main>
  );
}

import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  ArrowLeft, Copy, Download, FileText, CheckCircle, Loader2, ExternalLink,
  AlertTriangle, Lightbulb, ChevronDown, Library, Wand2,
} from "lucide-react";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { HeaderControls } from "@/components/header-controls";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { usePageTitle } from "@/hooks/use-page-title";
import { useAuth } from "@/hooks/use-auth";
import { isSessionExpiredMessage } from "@/lib/upload-error-utils";
import type { GeneratedContent } from "@shared/schema";

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

const mdComponents: Components = {
  table: ({ children, ...props }) => (
    <div className="overflow-x-auto my-4">
      <table className="w-full border-collapse text-sm" {...props}>{children}</table>
    </div>
  ),
  thead: ({ children, ...props }) => (
    <thead className="bg-muted" {...props}>{children}</thead>
  ),
  th: ({ children, ...props }) => (
    <th className="border border-border px-3 py-2 text-left font-semibold" {...props}>{children}</th>
  ),
  td: ({ children, ...props }) => (
    <td className="border border-border px-3 py-2" {...props}>{children}</td>
  ),
  caption: ({ children, ...props }) => (
    <caption className="text-sm text-muted-foreground mb-2 text-left font-medium" {...props}>{children}</caption>
  ),
};

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

  if (content.match(/\[(click here|here|link|read more|learn more|go here|this page|more info|more|click|this link|this article|this resource|view here|find out more|see here|details|info)\]/gi)) {
    issues.push({
      type: "accessibility",
      severity: "warning",
      message: 'Avoid vague link text like "click here", "read more", or "learn more"',
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

  if (/^\|[\s\S]*?\|[\s\S]*?\n\|[\s\-:|]+\|/m.test(content)) {
    issues.push({
      type: "accessibility",
      severity: "warning",
      message: "Markdown pipe table detected — may not be accessible to screen readers",
      fix: "Replace markdown tables (| col | col |) with HTML <table> elements that include <caption> and <th scope> attributes",
      fixType: "convert-markdown-tables",
    });
  }

  const tableMatches = [...content.matchAll(/<table[\s>]/gi)];
  let reportedMissingCaption = false;
  let reportedMissingThead = false;
  for (const tableMatch of tableMatches) {
    const tableStart = tableMatch.index ?? 0;
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

  if (/role\s*=\s*["']?combobox["']?/i.test(content) && !/<(select|input)[^>]*role\s*=\s*["']?combobox/i.test(content)) {
    issues.push({
      type: "accessibility",
      severity: "warning",
      message: 'ARIA role="combobox" found on a non-native element',
      fix: 'Replace non-input elements that use role="combobox" with a native <select> or <input> element for proper keyboard and screen reader support',
      fixType: "fix-aria-combobox",
    });
  }

  if (/role\s*=\s*["']?grid["']?/i.test(content) && !/<table[^>]*role\s*=\s*["']?grid/i.test(content)) {
    issues.push({
      type: "accessibility",
      severity: "warning",
      message: 'ARIA role="grid" found on a non-table element',
      fix: 'Replace non-table elements that use role="grid" with a native <table> element so screen readers can announce rows and columns correctly',
      fixType: "fix-aria-grid",
    });
  }

  if (/role\s*=\s*["']?tab["']?/i.test(content) && !/<(button|a)[^>]*role\s*=\s*["']?tab/i.test(content)) {
    issues.push({
      type: "accessibility",
      severity: "warning",
      message: 'ARIA role="tab" found on a non-interactive element',
      fix: 'Replace non-interactive elements that use role="tab" with a native <button> or <a> element for full keyboard accessibility',
      fixType: "fix-aria-tab",
    });
  }

  return issues;
};

interface ContentPanelProps {
  label: string;
  contentId: number;
  badgeColor: string;
  testIdPrefix: string;
}

function ContentPanel({ label, contentId, badgeColor, testIdPrefix }: ContentPanelProps) {
  const { toast } = useToast();
  const { isAuthenticated } = useAuth();
  const [copied, setCopied] = useState(false);
  const [, navigate] = useLocation();

  const [showAccessibility, setShowAccessibility] = useState(false);
  const [fixingIssue, setFixingIssue] = useState<string | null>(null);

  const [refinementOpen, setRefinementOpen] = useState(false);
  const [refinementRequest, setRefinementRequest] = useState("");

  const [saveLibraryOpen, setSaveLibraryOpen] = useState(false);
  const [libraryTitle, setLibraryTitle] = useState("");
  const [libraryDescription, setLibraryDescription] = useState("");

  const { data: content, isLoading } = useQuery<GeneratedContent>({
    queryKey: ["/api/standalone-content", contentId],
  });

  const accessibilityIssues = content ? checkAccessibility(content.content) : [];

  const applyFixMutation = useMutation({
    mutationFn: async ({ fixType }: { fixType: string }) => {
      const response = await apiRequest("POST", `/api/content/${contentId}/fix-accessibility`, { fixType });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/standalone-content", contentId] });
      setFixingIssue(null);
      toast({ title: "Fix applied successfully!" });
    },
    onError: (error) => {
      setFixingIssue(null);
      if (isSessionExpiredMessage(error.message)) return;
      toast({ title: "Fix failed", description: error.message, variant: "destructive" });
    },
  });

  const refineMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/content/${contentId}/refine`, { refinementRequest });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/standalone-content", contentId] });
      setRefinementOpen(false);
      setRefinementRequest("");
      toast({ title: "Content refined successfully!" });
    },
    onError: (error) => {
      if (isSessionExpiredMessage(error.message)) return;
      toast({ title: "Refinement failed", description: error.message, variant: "destructive" });
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
      if (isSessionExpiredMessage(error.message)) return;
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    },
  });

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
    a.download = `${content.toolName.replace(/\s+/g, "_")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadWord = async () => {
    if (!content) return;
    try {
      const response = await fetch(`/api/content/${contentId}/export-docx`);
      if (!response.ok) throw new Error("Export failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${content.toolName.replace(/\s+/g, "_")}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Word document downloaded!" });
    } catch {
      toast({ title: "Export failed", description: "Could not generate Word document", variant: "destructive" });
    }
  };

  const handleApplyFix = (fixType: string) => {
    setFixingIssue(fixType);
    applyFixMutation.mutate({ fixType });
  };

  const handleRefine = () => {
    if (!refinementRequest.trim()) {
      toast({ title: "Please describe what changes you'd like to make", variant: "destructive" });
      return;
    }
    refineMutation.mutate();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${badgeColor}`}>
              {label}
            </span>
            {content && <span className="text-sm font-medium text-foreground">{content.toolName}</span>}
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleCopy} data-testid={`button-copy-${testIdPrefix}`}>
              {copied ? <CheckCircle className="w-4 h-4 mr-1.5" /> : <Copy className="w-4 h-4 mr-1.5" />}
              <span aria-live="polite">{copied ? "Copied!" : "Copy"}</span>
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownloadText} data-testid={`button-download-txt-${testIdPrefix}`}>
              <Download className="w-4 h-4 mr-1.5" />
              .txt
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownloadWord} data-testid={`button-download-docx-${testIdPrefix}`}>
              <FileText className="w-4 h-4 mr-1.5" />
              .docx
            </Button>
            {content && (
              <Dialog open={refinementOpen} onOpenChange={setRefinementOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" data-testid={`button-refine-${testIdPrefix}`}>
                    <Wand2 className="w-4 h-4 mr-1.5" />
                    Improve this
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Improve {label}</DialogTitle>
                    <DialogDescription>
                      Describe changes you'd like to make and AI will refine the content.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3 py-2">
                    <Textarea
                      placeholder="e.g. Make the rubric criteria more specific, add a category for citations..."
                      value={refinementRequest}
                      onChange={(e) => setRefinementRequest(e.target.value)}
                      rows={4}
                      data-testid={`textarea-refinement-${testIdPrefix}`}
                    />
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => { setRefinementOpen(false); setRefinementRequest(""); }}>
                      Cancel
                    </Button>
                    <Button
                      onClick={handleRefine}
                      disabled={refineMutation.isPending || !refinementRequest.trim()}
                      data-testid={`button-confirm-refine-${testIdPrefix}`}
                    >
                      {refineMutation.isPending ? (
                        <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Refining…</>
                      ) : (
                        "Refine"
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
            {isAuthenticated && content && (
              <Dialog open={saveLibraryOpen} onOpenChange={setSaveLibraryOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" data-testid={`button-save-library-${testIdPrefix}`}>
                    <Library className="w-4 h-4 mr-1.5" />
                    Save as Template
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Save {label} as Template</DialogTitle>
                    <DialogDescription>
                      Save this content to reuse across other courses
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor={`library-title-${testIdPrefix}`}>Title</Label>
                      <Input
                        id={`library-title-${testIdPrefix}`}
                        placeholder={content?.toolName}
                        value={libraryTitle}
                        onChange={(e) => setLibraryTitle(e.target.value)}
                        data-testid={`input-library-title-${testIdPrefix}`}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`library-description-${testIdPrefix}`}>Description (optional)</Label>
                      <Textarea
                        id={`library-description-${testIdPrefix}`}
                        placeholder="Add notes about this content..."
                        value={libraryDescription}
                        onChange={(e) => setLibraryDescription(e.target.value)}
                        data-testid={`textarea-library-description-${testIdPrefix}`}
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
                      data-testid={`button-confirm-save-library-${testIdPrefix}`}
                    >
                      {saveToLibraryMutation.isPending ? "Saving..." : "Save Template"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(`/quick-tools/result/${contentId}`)}
              data-testid={`button-open-full-${testIdPrefix}`}
            >
              <ExternalLink className="w-4 h-4 mr-1.5" />
              Open full page
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
            <Loader2 className="w-6 h-6 animate-spin text-primary" aria-hidden="true" />
            <span className="sr-only">Loading {label.toLowerCase()} content</span>
          </div>
        )}
        {!isLoading && !content && (
          <p className="text-muted-foreground text-sm">Content not found.</p>
        )}
        {content && (
          <>
            <Collapsible open={showAccessibility} onOpenChange={setShowAccessibility} className="mb-4">
              <Card className={`border ${accessibilityIssues.length === 0 ? "border-green-500" : "border-primary"}`}>
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-3 px-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {accessibilityIssues.length === 0 ? (
                          <CheckCircle className="w-4 h-4 text-green-500 shrink-0" data-testid={`icon-a11y-clear-${testIdPrefix}`} />
                        ) : (
                          <Lightbulb className="w-4 h-4 text-primary shrink-0" />
                        )}
                        <CardTitle className="text-sm font-semibold">Accessibility Check</CardTitle>
                        {accessibilityIssues.length === 0 ? (
                          <Badge
                            className="bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30 hover:bg-green-500/15 text-xs"
                            variant="outline"
                            data-testid={`badge-a11y-clear-${testIdPrefix}`}
                          >
                            ✓ All Clear
                          </Badge>
                        ) : accessibilityIssues.some(i => i.severity === "warning") ? (
                          <Badge
                            className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/15 text-xs"
                            variant="outline"
                            data-testid={`badge-a11y-count-${testIdPrefix}`}
                          >
                            {accessibilityIssues.length} issue{accessibilityIssues.length !== 1 ? "s" : ""}
                          </Badge>
                        ) : (
                          <Badge
                            className="bg-primary/10 text-primary border-primary/30 hover:bg-primary/10 text-xs"
                            variant="outline"
                            data-testid={`badge-a11y-count-${testIdPrefix}`}
                          >
                            {accessibilityIssues.length} suggestion{accessibilityIssues.length !== 1 ? "s" : ""}
                          </Badge>
                        )}
                      </div>
                      <ChevronDown className={`w-4 h-4 transition-transform ${showAccessibility ? "rotate-180" : ""}`} />
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0 px-4 pb-4 space-y-3">
                    {accessibilityIssues.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No accessibility issues detected.</p>
                    ) : (
                      accessibilityIssues.map((issue, index) => (
                        <div
                          key={index}
                          className={`p-3 rounded-lg border-l-4 ${
                            issue.severity === "warning"
                              ? "bg-secondary/10 border-secondary"
                              : "bg-primary/5 border-primary"
                          }`}
                          data-testid={`a11y-issue-${testIdPrefix}-${index}`}
                        >
                          <div className="flex items-start gap-2">
                            {issue.severity === "warning" ? (
                              <AlertTriangle className="w-4 h-4 text-secondary mt-0.5 shrink-0" />
                            ) : (
                              <Lightbulb className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                                <Badge variant="outline" className="text-xs">
                                  {issue.type}
                                </Badge>
                                {issue.fixType && contentId && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="gap-1.5 text-xs h-7 px-2"
                                    disabled={fixingIssue === issue.fixType || applyFixMutation.isPending}
                                    onClick={() => handleApplyFix(issue.fixType!)}
                                    data-testid={`button-fix-${testIdPrefix}-${issue.fixType}`}
                                  >
                                    {fixingIssue === issue.fixType ? (
                                      <><Loader2 className="w-3 h-3 animate-spin" />Fixing…</>
                                    ) : (
                                      <><CheckCircle className="w-3 h-3" />Fix this</>
                                    )}
                                  </Button>
                                )}
                              </div>
                              <p className="text-sm font-medium">{issue.message}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                <strong>Fix:</strong> {issue.fix}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            <div className="prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
                components={mdComponents}
              >
                {content.content}
              </ReactMarkdown>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function ResultBatchPage() {
  const params = useParams();
  const [, navigate] = useLocation();

  const assignmentId = params.assignmentId ? parseInt(params.assignmentId) : 0;
  const rubricId = params.rubricId ? parseInt(params.rubricId) : 0;

  usePageTitle("Assignment & Rubric Results");

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate("/quick-tools")}
                aria-label="Back to Quick Tools"
                data-testid="button-back-tools"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h1 className="text-xl font-bold">Assignment &amp; Rubric</h1>
                  <p className="text-sm text-muted-foreground">Both generated together — each saved independently to your library</p>
                </div>
              </div>
            </div>
            <HeaderControls variant="light" showHome={true} />
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 max-w-5xl space-y-8">
        <ContentPanel
          label="Your Assignment"
          contentId={assignmentId}
          badgeColor="bg-primary/10 text-primary"
          testIdPrefix="assignment"
        />
        <ContentPanel
          label="Your Rubric"
          contentId={rubricId}
          badgeColor="bg-secondary/10 text-secondary-foreground"
          testIdPrefix="rubric"
        />
      </div>

      <PoweredByFooter />
    </main>
  );
}

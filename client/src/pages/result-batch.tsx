import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Copy, Download, FileText, CheckCircle, Loader2, ExternalLink } from "lucide-react";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { HeaderControls } from "@/components/header-controls";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { usePageTitle } from "@/hooks/use-page-title";
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

interface ContentPanelProps {
  label: string;
  contentId: number;
  badgeColor: string;
  testIdPrefix: string;
}

function ContentPanel({ label, contentId, badgeColor, testIdPrefix }: ContentPanelProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [, navigate] = useLocation();

  const { data: content, isLoading } = useQuery<GeneratedContent>({
    queryKey: ["/api/standalone-content", contentId],
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
          <div className="prose prose-sm max-w-none dark:prose-invert">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
              components={mdComponents}
            >
              {content.content}
            </ReactMarkdown>
          </div>
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

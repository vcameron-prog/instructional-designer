import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Globe, AlertCircle, RefreshCw, CheckCircle, ChevronDown, ChevronUp } from "lucide-react";
import { HeaderControls, BackButton } from "@/components/header-controls";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { usePageTitle } from "@/hooks/use-page-title";
import { apiRequest } from "@/lib/queryClient";

interface ScanIssue {
  title: string;
  severity: "critical" | "major" | "minor";
  criterion: string;
  description: string;
  recommendation: string;
}

interface ScanResult {
  url: string;
  score: number;
  summary: string;
  issues: ScanIssue[];
  passed: string[];
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "destructive",
  major: "secondary",
  minor: "outline",
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: "Critical",
  major: "Major",
  minor: "Minor",
};

function IssueCard({ issue }: { issue: ScanIssue }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-border rounded-lg p-4" data-testid={`issue-card-${issue.severity}`}>
      <button
        className="w-full flex items-start gap-3 text-left"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <Badge variant={(SEVERITY_COLORS[issue.severity] as any) || "secondary"}>
              {SEVERITY_LABELS[issue.severity]}
            </Badge>
            <span className="text-xs text-muted-foreground font-mono">{issue.criterion}</span>
          </div>
          <p className="font-semibold text-foreground text-sm">{issue.title}</p>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" aria-hidden="true" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" aria-hidden="true" />
        )}
      </button>
      {expanded && (
        <div className="mt-3 space-y-2 text-sm">
          <div>
            <p className="font-medium text-muted-foreground text-xs uppercase tracking-wider mb-0.5">Issue</p>
            <p className="text-foreground">{issue.description}</p>
          </div>
          <div>
            <p className="font-medium text-muted-foreground text-xs uppercase tracking-wider mb-0.5">How to Fix</p>
            <p className="text-foreground">{issue.recommendation}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreMeter({ score }: { score: number }) {
  const color = score >= 80 ? "text-emerald-600 dark:text-emerald-400" : score >= 60 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";
  const label = score >= 80 ? "Good" : score >= 60 ? "Needs Work" : "Poor";
  return (
    <div className="text-center">
      <p className={`text-5xl font-bold ${color}`} data-testid="text-scan-score">{score}</p>
      <p className="text-muted-foreground text-sm mt-1">{label} accessibility score</p>
    </div>
  );
}

export default function UrlScannerPage() {
  usePageTitle("URL Accessibility Scanner");
  const [, navigate] = useLocation();
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function scan() {
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      let scanUrl = url.trim();
      if (scanUrl && !/^https?:\/\//i.test(scanUrl)) scanUrl = `https://${scanUrl}`;
      const res = await apiRequest("POST", "/api/tools/url-scanner", { url: scanUrl });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");
      setResult(data);
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const criticalIssues = result?.issues.filter(i => i.severity === "critical") ?? [];
  const majorIssues = result?.issues.filter(i => i.severity === "major") ?? [];
  const minorIssues = result?.issues.filter(i => i.severity === "minor") ?? [];

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-background">
      <nav aria-label="Back navigation" className="absolute top-4 left-4 z-20">
        <BackButton />
      </nav>
      <nav aria-label="User menu" className="absolute top-4 right-4 z-20">
        <HeaderControls showLogout={false} showLogin={false} />
      </nav>

      <div className="container mx-auto px-4 py-10 max-w-2xl">
        <div className="mb-6">
          <button
            onClick={() => navigate("/accessibility")}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
            data-testid="button-back"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Back to Accessibility Tools
          </button>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-sky-500 to-cyan-600 flex items-center justify-center flex-shrink-0">
              <Globe className="w-5 h-5 text-white" aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">URL Accessibility Scanner</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            Check any public webpage for WCAG 2.1 accessibility issues using AI analysis.
          </p>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Scan a Webpage</CardTitle>
            <CardDescription>
              Enter the full URL of any publicly accessible page. The page must not require a login.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="input-url">Page URL</Label>
              <Input
                id="input-url"
                type="url"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setResult(null); setError(null); }}
                placeholder="https://example.com/page"
                data-testid="input-scan-url"
                onKeyDown={(e) => { if (e.key === "Enter" && url) scan(); }}
              />
            </div>
            <Button
              onClick={scan}
              disabled={loading || !url.trim()}
              className="w-full"
              data-testid="button-scan"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                  Scanning… (this may take up to 30 seconds)
                </>
              ) : (
                <>
                  <Globe className="w-4 h-4 mr-2" aria-hidden="true" />
                  Scan for Accessibility Issues
                </>
              )}
            </Button>

            {error && (
              <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm" role="alert" data-testid="text-scan-error">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
                {error}
              </div>
            )}
          </CardContent>
        </Card>

        {result && (
          <div className="space-y-6" data-testid="scan-results">
            <Card>
              <CardContent className="pt-6">
                <ScoreMeter score={result.score} />
                <p className="mt-4 text-sm text-foreground text-center max-w-sm mx-auto">{result.summary}</p>
                <div className="mt-4 flex justify-center gap-4 text-sm">
                  {criticalIssues.length > 0 && (
                    <span className="text-red-600 dark:text-red-400 font-semibold">{criticalIssues.length} critical</span>
                  )}
                  {majorIssues.length > 0 && (
                    <span className="text-amber-600 dark:text-amber-400 font-semibold">{majorIssues.length} major</span>
                  )}
                  {minorIssues.length > 0 && (
                    <span className="text-muted-foreground">{minorIssues.length} minor</span>
                  )}
                  {result.issues.length === 0 && (
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">No issues found</span>
                  )}
                </div>
              </CardContent>
            </Card>

            {result.issues.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Issues Found ({result.issues.length})
                </h2>
                <div className="space-y-2">
                  {[...criticalIssues, ...majorIssues, ...minorIssues].map((issue, i) => (
                    <IssueCard key={i} issue={issue} />
                  ))}
                </div>
              </div>
            )}

            {result.passed.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Passing Checks ({result.passed.length})
                </h2>
                <div className="space-y-1.5">
                  {result.passed.map((item, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm text-foreground">
                      <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              This scan uses AI analysis of the page&apos;s HTML. Results are a starting point and may not catch all issues — always verify with a human reviewer and assistive technology testing.
            </p>
          </div>
        )}
      </div>
      <PoweredByFooter />
    </main>
  );
}

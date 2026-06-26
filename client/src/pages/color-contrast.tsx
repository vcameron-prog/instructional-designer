import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Eye, CheckCircle, XCircle, AlertCircle, RefreshCw } from "lucide-react";
import { HeaderControls, BackButton } from "@/components/header-controls";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { usePageTitle } from "@/hooks/use-page-title";
import { apiRequest } from "@/lib/queryClient";

interface ContrastResult {
  ratio: number;
  aa_normal: boolean;
  aa_large: boolean;
  aaa_normal: boolean;
  aaa_large: boolean;
  foreground: string;
  background: string;
}

function PassFail({ pass, label }: { pass: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
      <span className="text-sm text-foreground">{label}</span>
      {pass ? (
        <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 text-sm font-semibold">
          <CheckCircle className="w-4 h-4" aria-hidden="true" />
          Pass
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400 text-sm font-semibold">
          <XCircle className="w-4 h-4" aria-hidden="true" />
          Fail
        </span>
      )}
    </div>
  );
}

function ratingSeverity(result: ContrastResult) {
  if (result.aa_normal) return "good";
  if (result.aa_large) return "ok";
  return "poor";
}

export default function ColorContrastPage() {
  usePageTitle("Color Contrast Checker");
  const [, navigate] = useLocation();
  const [foreground, setForeground] = useState("#000000");
  const [background, setBackground] = useState("#ffffff");
  const [result, setResult] = useState<ContrastResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function checkContrast() {
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/tools/color-contrast", { foreground, background });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to check contrast");
      setResult(data);
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function swap() {
    const tmp = foreground;
    setForeground(background);
    setBackground(tmp);
    setResult(null);
  }

  const previewFg = foreground.match(/^#[0-9a-fA-F]{3,6}$/) ? foreground : "#000000";
  const previewBg = background.match(/^#[0-9a-fA-F]{3,6}$/) ? background : "#ffffff";

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 flex items-center justify-between px-4 py-2 bg-background/95 backdrop-blur-sm border-b border-border">
        <nav aria-label="Back navigation">
          <BackButton />
        </nav>
        <nav aria-label="User menu">
          <HeaderControls showLogout={false} showLogin={false} />
        </nav>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-2xl">
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
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center flex-shrink-0">
              <Eye className="w-5 h-5 text-white" aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Color Contrast Checker</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            Verify foreground/background color combinations meet WCAG 2.1 contrast ratios.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Enter Colors</CardTitle>
            <CardDescription>
              Use hex codes (e.g. <code>#1a2b3c</code> or <code>#fff</code>)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="input-foreground">Foreground (text)</Label>
                <div className="flex items-center gap-2">
                  <div
                    className="w-9 h-9 rounded border border-border flex-shrink-0"
                    style={{ backgroundColor: previewFg }}
                    aria-hidden="true"
                  />
                  <Input
                    id="input-foreground"
                    value={foreground}
                    onChange={(e) => { setForeground(e.target.value); setResult(null); }}
                    placeholder="#000000"
                    data-testid="input-foreground"
                    className="font-mono"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="input-background">Background</Label>
                <div className="flex items-center gap-2">
                  <div
                    className="w-9 h-9 rounded border border-border flex-shrink-0"
                    style={{ backgroundColor: previewBg }}
                    aria-hidden="true"
                  />
                  <Input
                    id="input-background"
                    value={background}
                    onChange={(e) => { setBackground(e.target.value); setResult(null); }}
                    placeholder="#ffffff"
                    data-testid="input-background"
                    className="font-mono"
                  />
                </div>
              </div>
            </div>

            <div
              className="rounded-lg p-6 text-center border border-border"
              style={{ backgroundColor: previewBg }}
              aria-label="Color preview"
            >
              <p className="text-2xl font-bold" style={{ color: previewFg }}>
                Sample Heading Text
              </p>
              <p className="text-sm mt-1" style={{ color: previewFg }}>
                This is what normal body text looks like with your color combination.
              </p>
              <p className="text-xl font-semibold mt-2" style={{ color: previewFg }}>
                Large Text Sample
              </p>
            </div>

            <div className="flex gap-3">
              <Button
                onClick={checkContrast}
                disabled={loading}
                className="flex-1"
                data-testid="button-check-contrast"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                    Checking…
                  </>
                ) : "Check Contrast"}
              </Button>
              <Button
                variant="outline"
                onClick={swap}
                disabled={loading}
                data-testid="button-swap-colors"
                aria-label="Swap foreground and background colors"
              >
                ⇄ Swap
              </Button>
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm" role="alert" data-testid="text-contrast-error">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
                {error}
              </div>
            )}

            {result && (
              <div className="space-y-4" data-testid="contrast-result">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Contrast Ratio</p>
                    <p className="text-4xl font-bold text-foreground" data-testid="text-contrast-ratio">
                      {result.ratio.toFixed(2)}:1
                    </p>
                  </div>
                  <Badge
                    variant={ratingSeverity(result) === "good" ? "default" : ratingSeverity(result) === "ok" ? "secondary" : "destructive"}
                    className="text-base px-4 py-2"
                    data-testid="badge-contrast-rating"
                  >
                    {ratingSeverity(result) === "good" ? "AA Pass" : ratingSeverity(result) === "ok" ? "Large Text Only" : "Fails WCAG"}
                  </Badge>
                </div>

                <div className="border border-border rounded-lg p-4">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    WCAG 2.1 Results
                  </h2>
                  <PassFail pass={result.aa_normal} label="AA — Normal text (≥ 4.5:1)" />
                  <PassFail pass={result.aa_large} label="AA — Large text / UI (≥ 3:1)" />
                  <PassFail pass={result.aaa_normal} label="AAA — Normal text (≥ 7:1)" />
                  <PassFail pass={result.aaa_large} label="AAA — Large text (≥ 4.5:1)" />
                </div>

                <p className="text-xs text-muted-foreground">
                  <strong>Large text</strong> is defined as 18pt (24px) or 14pt (18.67px) bold. Normal text applies to all smaller text.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <PoweredByFooter />
    </main>
  );
}

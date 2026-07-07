import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Calculator, AlertCircle, RefreshCw, Upload, Copy, Check } from "lucide-react";
import { HeaderControls, BackButton } from "@/components/header-controls";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { usePageTitle } from "@/hooks/use-page-title";

const DEFAULT_MAX_UPLOAD_MB = 5;

interface MathOcrResult {
  plainText: string;
  latex: string;
  mathml: string;
  description: string;
}

function CopyField({ label, value, testId }: { label: string; value: string; testId: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
        <button
          onClick={copy}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          aria-label={copied ? `${label} copied` : `Copy ${label}`}
          data-testid={testId}
        >
          {copied ? (
            <><Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" /> Copied</>
          ) : (
            <><Copy className="w-3.5 h-3.5" aria-hidden="true" /> Copy</>
          )}
        </button>
      </div>
      <pre className="bg-muted rounded-lg px-3 py-2.5 text-xs font-mono whitespace-pre-wrap break-all">{value}</pre>
    </div>
  );
}

export default function MathOcrPage() {
  usePageTitle(
    "Math OCR",
    "Extract and convert mathematical equations from images into accessible LaTeX or plain-text representations using AI-powered optical character recognition.",
  );
  const [, navigate] = useLocation();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<MathOcrResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: config } = useQuery<{ imageUploadMaxMB?: number }>({
    queryKey: ["/api/config"],
  });
  const maxUploadMB = config?.imageUploadMaxMB ?? DEFAULT_MAX_UPLOAD_MB;

  function handleFile(f: File) {
    if (!f.type.startsWith("image/")) {
      setError("Please upload an image file (JPEG, PNG, GIF, or WebP).");
      return;
    }
    if (f.size > maxUploadMB * 1024 * 1024) {
      setError(`Image must be under ${maxUploadMB} MB.`);
      return;
    }
    setFile(f);
    setResult(null);
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(f);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  async function extract() {
    if (!file) return;
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);

      const res = await fetch("/api/tools/math-ocr", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to extract math content");
      setResult(data);
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

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
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-rose-500 to-red-600 flex items-center justify-center flex-shrink-0">
              <Calculator className="w-5 h-5 text-white" aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Math OCR</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            Upload an image containing mathematical expressions and get accessible text, LaTeX, and MathML representations.
          </p>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Upload a Math Image</CardTitle>
            <CardDescription>
              Equations, formulas, expressions from textbooks, slides, or handwriting — JPEG, PNG, GIF, or WebP up to {maxUploadMB} MB
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-secondary/20 transition-colors"
              role="button"
              tabIndex={0}
              aria-label="Click or drag and drop an image here"
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click(); }}
              data-testid="dropzone-math-image"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="sr-only"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                data-testid="input-math-file"
              />
              {preview ? (
                <div className="space-y-3">
                  <img
                    src={preview}
                    alt="Math image preview"
                    className="max-h-48 max-w-full mx-auto rounded-lg object-contain bg-white dark:bg-gray-900 p-2"
                  />
                  <p className="text-sm text-muted-foreground">{file?.name}</p>
                  <p className="text-xs text-primary">Click to change image</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="w-10 h-10 text-muted-foreground mx-auto" aria-hidden="true" />
                  <p className="text-sm font-medium text-foreground">Click to upload or drag an image here</p>
                  <p className="text-xs text-muted-foreground">Works best with clear, high-contrast images</p>
                </div>
              )}
            </div>

            <Button
              onClick={extract}
              disabled={loading || !file}
              className="w-full"
              data-testid="button-extract-math"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                  Extracting math… (this may take a moment)
                </>
              ) : (
                <>
                  <Calculator className="w-4 h-4 mr-2" aria-hidden="true" />
                  Extract Math Content
                </>
              )}
            </Button>

            {error && (
              <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm" role="alert" data-testid="text-math-error">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
                {error}
              </div>
            )}
          </CardContent>
        </Card>

        {result && (
          <Card data-testid="math-result">
            <CardHeader>
              <CardTitle className="text-lg">Extracted Math Content</CardTitle>
              {result.description && (
                <CardDescription>{result.description}</CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-5">
              <CopyField
                label="Plain Text (screen reader friendly)"
                value={result.plainText}
                testId="button-copy-plain"
              />
              <CopyField
                label="LaTeX"
                value={result.latex}
                testId="button-copy-latex"
              />
              <CopyField
                label="MathML"
                value={result.mathml}
                testId="button-copy-mathml"
              />

              <div className="space-y-2 pt-2 border-t border-border">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Accessibility Tips</p>
                <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                  <li>Use the <strong>plain text</strong> version as an image alt attribute for simple expressions</li>
                  <li>Embed <strong>MathML</strong> in HTML for screen reader support (<code>aria-label</code> on the math element)</li>
                  <li>For PDFs, use the <strong>LaTeX</strong> source with a tagged PDF workflow</li>
                </ul>
              </div>

              <p className="text-xs text-muted-foreground">
                Review all outputs carefully. Complex notation or handwriting may require manual correction.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
      <PoweredByFooter />
    </main>
  );
}

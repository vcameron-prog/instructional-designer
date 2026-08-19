import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Image, AlertCircle, RefreshCw, Upload, Copy, Check } from "lucide-react";
import { HeaderControls, BackButton } from "@/components/header-controls";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { usePageTitle } from "@/hooks/use-page-title";
import { trackEvent } from "@/hooks/use-analytics";

interface AltTextResult {
  altText: string;
  isDecorative: boolean;
  characterCount: number;
}

const DEFAULT_MAX_UPLOAD_MB = 5;

export default function AltTextGeneratorPage() {
  usePageTitle(
    "Alt Text Generator",
    "Generate accurate, descriptive alt text for images using AI. Upload any image and get descriptive alternative text, informed by WCAG guidance, to improve accessibility.",
  );
  const [, navigate] = useLocation();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [context, setContext] = useState("");
  const [result, setResult] = useState<AltTextResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { trackEvent("alt-text", "page_view"); }, []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

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

  async function generate() {
    if (!file) return;
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      if (context.trim()) formData.append("context", context.trim());

      const res = await fetch("/api/tools/alt-text", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate alt text");
      setResult(data);
      trackEvent("alt-text", "tool_result");
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 flex items-center justify-between px-4 py-2 bg-background/95 backdrop-blur-sm border-b border-border">
        <nav aria-label="Back navigation">
          <BackButton />
        </nav>
        <nav aria-label="User menu">
          <HeaderControls showLogout={false} showLogin={false} />
        </nav>
      </header>

      <main id="main-content" tabIndex={-1}>

      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <button
            onClick={() => navigate("/accessibility")}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
            data-testid="button-back"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Back to Accessibility Remediation Tools
          </button>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-fuchsia-500 to-pink-600 flex items-center justify-center flex-shrink-0">
              <Image className="w-5 h-5 text-white" aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Alt Text Generator</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            Upload an image and get AI-generated alternative text following WCAG 2.1 guidelines.
          </p>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Upload an Image</CardTitle>
            <CardDescription>
              JPEG, PNG, GIF, or WebP — up to {maxUploadMB} MB
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div
              ref={dropRef}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-secondary/20 transition-colors"
              role="button"
              tabIndex={0}
              aria-label="Click or drag and drop an image here"
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click(); } }}
              data-testid="dropzone-image"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="sr-only"
                aria-label="Upload an image for alt text generation (JPEG, PNG, GIF, or WebP)"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                data-testid="input-image-file"
              />
              {preview ? (
                <div className="space-y-3">
                  <img
                    src={preview}
                    alt="Uploaded preview"
                    className="max-h-48 max-w-full mx-auto rounded-lg object-contain"
                  />
                  <p className="text-sm text-muted-foreground">{file?.name}</p>
                  <p className="text-xs text-primary">Click to change image</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="w-10 h-10 text-muted-foreground mx-auto" aria-hidden="true" />
                  <p className="text-sm font-medium text-foreground">Click to upload or drag an image here</p>
                  <p className="text-xs text-muted-foreground">JPEG, PNG, GIF, WebP up to {maxUploadMB} MB</p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="input-context">
                Context <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea
                id="input-context"
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="Describe where this image will appear, e.g. 'a chart from a biology textbook showing cell division stages'"
                rows={2}
                data-testid="input-context"
              />
            </div>

            <Button
              onClick={generate}
              disabled={loading || !file}
              className="w-full"
              data-testid="button-generate-alt"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                  Generating…
                </>
              ) : (
                <>
                  <Image className="w-4 h-4 mr-2" aria-hidden="true" />
                  Generate Alt Text
                </>
              )}
            </Button>

            <span
              role="status"
              aria-live="polite"
              className="sr-only"
              data-testid="status-alt-progress"
            >
              {loading
                ? "Uploading image and generating alt text. Please wait."
                : result
                  ? "Alt text generated. Results are below."
                  : ""}
            </span>

            {error && (
              <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm" role="alert" data-testid="text-alt-error">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
                {error}
              </div>
            )}
          </CardContent>
        </Card>

        {result && (
          <Card data-testid="alt-result">
            <CardHeader>
              <CardTitle className="text-lg">Generated Alt Text</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {result.isDecorative ? (
                <div className="p-4 bg-muted rounded-lg space-y-2">
                  <p className="font-semibold text-foreground">Decorative Image</p>
                  <p className="text-sm text-muted-foreground">
                    This image appears to be decorative. Use <code className="text-xs bg-muted px-1 py-0.5 rounded">alt=""</code> (empty alt attribute) in your HTML.
                  </p>
                  <code className="block text-xs bg-muted px-3 py-2 rounded font-mono">
                    {`<img src="..." alt="" role="presentation" />`}
                  </code>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="relative p-4 bg-muted rounded-lg">
                    <p className="text-foreground pr-10" data-testid="text-generated-alt">{result.altText}</p>
                    <button
                      onClick={() => copy(result.altText)}
                      className="absolute top-3 right-3 p-1.5 rounded hover:bg-muted transition-colors"
                      aria-label={copied ? "Copied" : "Copy alt text"}
                      data-testid="button-copy-alt"
                    >
                      {copied ? (
                        <Check className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                      ) : (
                        <Copy className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">{result.characterCount} characters</p>

                  <div className="space-y-1.5">
                    <p className="text-sm font-medium text-muted-foreground">HTML usage:</p>
                    <code className="block text-xs bg-muted px-3 py-2 rounded font-mono break-all">
                      {`<img src="..." alt="${result.altText}" />`}
                    </code>
                  </div>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Review the generated text carefully. AI descriptions may miss nuanced meaning or context specific to your audience.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
      </main>
      <PoweredByFooter />
    </div>
  );
}

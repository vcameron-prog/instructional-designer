import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { HeaderControls } from "@/components/header-controls";
import { usePageTitle } from "@/hooks/use-page-title";
import { ArrowLeft, Settings, Wand2 } from "lucide-react";

const SKIP_PREVIEW_KEY = "a11y-skip-preview";

export default function SettingsPage() {
  usePageTitle("Preferences | BSU AI Course Assistant");
  const [, navigate] = useLocation();

  const [skipPreview, setSkipPreview] = useState(
    () => localStorage.getItem(SKIP_PREVIEW_KEY) === "true"
  );

  const handleToggleSkipPreview = (value: boolean) => {
    setSkipPreview(value);
    localStorage.setItem(SKIP_PREVIEW_KEY, value ? "true" : "false");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-background/95 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/")}
            className="gap-2"
            data-testid="button-back-home"
          >
            <ArrowLeft className="w-4 h-4" />
            Home
          </Button>
          <HeaderControls showHome={false} showSettings={false} />
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="flex-1 max-w-3xl mx-auto w-full px-4 py-10 space-y-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Settings className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Preferences</h1>
            <p className="text-sm text-muted-foreground">Customize how the app behaves for you</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-primary" />
              <CardTitle className="text-base">Accessibility Fixes</CardTitle>
            </div>
            <CardDescription>
              Control how fixes are applied when reviewing AI-generated content
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3">
              <input
                id="settings-skip-preview-toggle"
                type="checkbox"
                className="mt-0.5 w-4 h-4 accent-primary cursor-pointer shrink-0"
                checked={skipPreview}
                onChange={(e) => handleToggleSkipPreview(e.target.checked)}
                data-testid="checkbox-settings-skip-preview"
              />
              <div>
                <label
                  htmlFor="settings-skip-preview-toggle"
                  className="text-sm font-medium cursor-pointer select-none"
                >
                  Apply fixes directly without previewing
                </label>
                <p className="text-sm text-muted-foreground mt-0.5">
                  When enabled, clicking "Fix this" on an accessibility issue will apply the fix immediately instead of showing a before/after preview first.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>

      <PoweredByFooter />
    </div>
  );
}

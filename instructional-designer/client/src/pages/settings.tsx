import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { HeaderControls } from "@/components/header-controls";
import { usePageTitle } from "@/hooks/use-page-title";
import { useAuth } from "@/hooks/use-auth";
import { ArrowLeft, Settings, Wand2, Globe, LayoutList, Zap, Cloud, CloudOff } from "lucide-react";
import { TOOLS } from "@/lib/constants";
import { apiRequest } from "@/lib/queryClient";

const SKIP_PREVIEW_KEY = "a11y-skip-preview";
const AUTO_EXPAND_KEY = "bsu-auto-expand-sections";
const DEFAULT_LANGUAGE_KEY = "bsu-default-language";
const PREFERRED_TOOL_KEY = "bsu-preferred-quick-tool";

const QUICK_TOOL_IDS = ["assignment", "rubric", "alignment", "airesistant", "accessibility", "aistudent"];

const LANGUAGE_OPTIONS = [
  { value: "English", label: "English" },
  { value: "Spanish", label: "Spanish (Español)" },
  { value: "French", label: "French (Français)" },
  { value: "Portuguese", label: "Portuguese (Português)" },
  { value: "Haitian Creole", label: "Haitian Creole (Kreyòl ayisyen)" },
];

interface UserPreferences {
  skipPreview?: boolean;
  autoExpand?: boolean;
  defaultLanguage?: string;
  preferredTool?: string;
}

export default function SettingsPage() {
  usePageTitle("Preferences | BSU AI Course Assistant");
  const [, navigate] = useLocation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();

  const [skipPreview, setSkipPreview] = useState(
    () => localStorage.getItem(SKIP_PREVIEW_KEY) === "true"
  );
  const [autoExpand, setAutoExpand] = useState(
    () => localStorage.getItem(AUTO_EXPAND_KEY) === "true"
  );
  const [defaultLanguage, setDefaultLanguage] = useState(
    () => localStorage.getItem(DEFAULT_LANGUAGE_KEY) || "English"
  );
  const [preferredTool, setPreferredTool] = useState(
    () => localStorage.getItem(PREFERRED_TOOL_KEY) || ""
  );
  const [hydrated, setHydrated] = useState(false);

  const { data: serverPrefs, isLoading: prefsLoading } = useQuery<UserPreferences>({
    queryKey: ["/api/preferences"],
    queryFn: async () => {
      const res = await fetch("/api/preferences", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch preferences");
      return res.json();
    },
    enabled: isAuthenticated && !authLoading,
    staleTime: 1000 * 60 * 5,
    retry: false,
  });

  useEffect(() => {
    if (!isAuthenticated || prefsLoading || hydrated) return;
    if (!serverPrefs) return;

    if (serverPrefs.skipPreview !== undefined) {
      setSkipPreview(serverPrefs.skipPreview);
      localStorage.setItem(SKIP_PREVIEW_KEY, serverPrefs.skipPreview ? "true" : "false");
    }
    if (serverPrefs.autoExpand !== undefined) {
      setAutoExpand(serverPrefs.autoExpand);
      localStorage.setItem(AUTO_EXPAND_KEY, serverPrefs.autoExpand ? "true" : "false");
    }
    if (serverPrefs.defaultLanguage) {
      setDefaultLanguage(serverPrefs.defaultLanguage);
      localStorage.setItem(DEFAULT_LANGUAGE_KEY, serverPrefs.defaultLanguage);
    }
    if (serverPrefs.preferredTool !== undefined) {
      setPreferredTool(serverPrefs.preferredTool ?? "");
      if (serverPrefs.preferredTool) {
        localStorage.setItem(PREFERRED_TOOL_KEY, serverPrefs.preferredTool);
      } else {
        localStorage.removeItem(PREFERRED_TOOL_KEY);
      }
    }
    setHydrated(true);
  }, [serverPrefs, prefsLoading, isAuthenticated, hydrated]);

  const saveMutation = useMutation({
    mutationFn: async (patch: Partial<UserPreferences>) => {
      return apiRequest("PATCH", "/api/preferences", patch);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/preferences"] });
    },
  });

  const persist = (patch: Partial<UserPreferences>) => {
    if (isAuthenticated) {
      saveMutation.mutate(patch);
    }
  };

  const handleToggleSkipPreview = (value: boolean) => {
    setSkipPreview(value);
    localStorage.setItem(SKIP_PREVIEW_KEY, value ? "true" : "false");
    persist({ skipPreview: value });
  };

  const handleToggleAutoExpand = (value: boolean) => {
    setAutoExpand(value);
    localStorage.setItem(AUTO_EXPAND_KEY, value ? "true" : "false");
    persist({ autoExpand: value });
  };

  const handleLanguageChange = (value: string) => {
    setDefaultLanguage(value);
    localStorage.setItem(DEFAULT_LANGUAGE_KEY, value);
    persist({ defaultLanguage: value });
  };

  const handlePreferredToolChange = (value: string) => {
    setPreferredTool(value);
    if (value) {
      localStorage.setItem(PREFERRED_TOOL_KEY, value);
    } else {
      localStorage.removeItem(PREFERRED_TOOL_KEY);
    }
    persist({ preferredTool: value });
  };

  const quickTools = TOOLS.filter(t => QUICK_TOOL_IDS.includes(t.id));
  const isSyncing = saveMutation.isPending;

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
          <HeaderControls showSettings={false} />
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="flex-1 max-w-3xl mx-auto w-full px-4 py-10 space-y-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Settings className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">Preferences</h1>
            <p className="text-sm text-muted-foreground">Customize how the app behaves for you</p>
          </div>
          {isAuthenticated && (
            <div
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
              data-testid="status-sync"
              aria-live="polite"
            >
              {isSyncing ? (
                <>
                  <Cloud className="w-3.5 h-3.5 animate-pulse" />
                  <span>Saving…</span>
                </>
              ) : (
                <>
                  <Cloud className="w-3.5 h-3.5 text-green-500" />
                  <span>Synced to your account</span>
                </>
              )}
            </div>
          )}
          {!isAuthenticated && !authLoading && (
            <div
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
              data-testid="status-local-only"
            >
              <CloudOff className="w-3.5 h-3.5" />
              <span>Saved locally only</span>
            </div>
          )}
        </div>

        {/* Content Generation */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-primary" />
              <CardTitle className="text-base">Content Generation</CardTitle>
            </div>
            <CardDescription>
              Default settings applied when AI generates course materials
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-1.5">
              <label
                htmlFor="settings-language-select"
                className="text-sm font-medium"
              >
                Default content language
              </label>
              <p className="text-sm text-muted-foreground">
                AI-generated content will be written in this language unless you specify otherwise.
              </p>
              <select
                id="settings-language-select"
                value={defaultLanguage}
                onChange={(e) => handleLanguageChange(e.target.value)}
                className="mt-1 w-full max-w-xs rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
                data-testid="select-settings-language"
              >
                {LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>

        {/* Result Display */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <LayoutList className="w-4 h-4 text-primary" />
              <CardTitle className="text-base">Result Display</CardTitle>
            </div>
            <CardDescription>
              Control how generated content is shown on result pages
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3">
              <input
                id="settings-auto-expand-toggle"
                type="checkbox"
                className="mt-0.5 w-4 h-4 accent-primary cursor-pointer shrink-0"
                checked={autoExpand}
                onChange={(e) => handleToggleAutoExpand(e.target.checked)}
                data-testid="checkbox-settings-auto-expand"
              />
              <div>
                <label
                  htmlFor="settings-auto-expand-toggle"
                  className="text-sm font-medium cursor-pointer select-none"
                >
                  Expand all sections by default
                </label>
                <p className="text-sm text-muted-foreground mt-0.5">
                  When enabled, supplementary sections like grading criteria, UDL notes, and resources will be fully expanded instead of collapsed when you first view a result.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Accessibility Fixes */}
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

        {/* Quick Tools */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              <CardTitle className="text-base">Quick Tools</CardTitle>
            </div>
            <CardDescription>
              Set a preferred tool to highlight when using Quick Tools
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <label
              htmlFor="settings-preferred-tool-select"
              className="text-sm font-medium"
            >
              Preferred Quick Tool
            </label>
            <p className="text-sm text-muted-foreground">
              Your preferred tool will be highlighted with a "Preferred" badge on the Quick Tools page for easy access.
            </p>
            <select
              id="settings-preferred-tool-select"
              value={preferredTool}
              onChange={(e) => handlePreferredToolChange(e.target.value)}
              className="mt-1 w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
              data-testid="select-settings-preferred-tool"
            >
              <option value="">No preference</option>
              {quickTools.map((tool) => (
                <option key={tool.id} value={tool.id}>{tool.name}</option>
              ))}
            </select>
          </CardContent>
        </Card>
      </main>

      <PoweredByFooter />
    </div>
  );
}

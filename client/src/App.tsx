import { lazy, Suspense, useEffect, useRef } from "react";
import { Switch, Route, useLocation, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { ThemeProvider } from "@/components/theme-provider";
import { FontSizeProvider } from "@/components/font-size-provider";
import { ProtectedRoute } from "@/components/protected-route";
import { ROUTE_VISIBILITY } from "@/lib/route-visibility";

// ---------------------------------------------------------------------------
// Route registry
//
// Path metadata (requiresAuth, showSignIn) lives in
// client/src/lib/route-visibility.ts — the single source of truth shared with
// the Playwright sign-in button visibility spec.  Add every new page there
// first, then add its component to ROUTE_COMPONENTS below.
// ---------------------------------------------------------------------------

const NotFound                  = lazy(() => import("@/pages/not-found"));
const CaiLandingPage            = lazy(() => import("@/pages/cai-landing"));
const PdfUpload                 = lazy(() => import("@/pages/pdf-upload"));
const PdfHistory                = lazy(() => import("@/pages/pdf-history"));
const PdfConversion             = lazy(() => import("@/pages/pdf-conversion"));
const PdfFaq                    = lazy(() => import("@/pages/pdf-faq"));
const SettingsPage              = lazy(() => import("@/pages/settings"));
const HelpPage                  = lazy(() => import("@/pages/help"));
const AdminDashboard            = lazy(() => import("@/pages/admin-dashboard"));
const UrlScannerPage            = lazy(() => import("@/pages/url-scanner"));
const ColorContrastPage         = lazy(() => import("@/pages/color-contrast"));
const AltTextGeneratorPage      = lazy(() => import("@/pages/alt-text-generator"));
const MathOcrPage               = lazy(() => import("@/pages/math-ocr"));

function AccessibilityRedirect() {
  return <Redirect to="/pdf-accessibility" />;
}

const ROUTE_COMPONENTS: Record<string, React.ComponentType> = {
  "/":                          CaiLandingPage,
  "/accessibility":             AccessibilityRedirect,
  "/pdf-accessibility":         PdfUpload,
  "/pdf-accessibility/history": PdfHistory,
  "/pdf-accessibility/faq":     PdfFaq,
  "/pdf-accessibility/:id":     PdfConversion,
  "/accessibility-tools/url-scanner":    UrlScannerPage,
  "/accessibility-tools/color-contrast": ColorContrastPage,
  "/accessibility-tools/alt-text":       AltTextGeneratorPage,
  "/accessibility-tools/math-ocr":       MathOcrPage,
  "/settings":                  SettingsPage,
  "/help":                      HelpPage,
  "/admin":                     AdminDashboard,
};

interface RouteConfig {
  path: string;
  component: React.ComponentType;
  requiresAuth: boolean;
}

const ROUTES: RouteConfig[] = ROUTE_VISIBILITY.map(({ path, requiresAuth }) => ({
  path,
  requiresAuth,
  component: ROUTE_COMPONENTS[path],
}));

function FocusManager() {
  const [location] = useLocation();
  const prevLocation = useRef(location);

  useEffect(() => {
    if (prevLocation.current !== location) {
      prevLocation.current = location;
      const main = document.getElementById("main-content");
      if (main) {
        main.focus({ preventScroll: false });
      }
    }
  }, [location]);

  return null;
}

function SlowSignInNotice() {
  const { toast } = useToast();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("signin") === "slow") {
      params.delete("signin");
      const newSearch = params.toString();
      const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : "") + window.location.hash;
      window.history.replaceState(null, "", newUrl);
      toast({
        title: "Session timed out",
        description: "Your session timed out — you've been signed back in.",
        duration: 6000,
      });
    }
  }, [toast]);

  return null;
}

function Router() {
  return (
    <Suspense fallback={<div aria-live="polite" aria-label="Loading page" />}>
      <Switch>
        {ROUTES.map(({ path, component: Component, requiresAuth }) => (
          <Route key={path} path={path}>
            {requiresAuth
              ? () => <ProtectedRoute component={Component} />
              : () => <Component />}
          </Route>
        ))}
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <FontSizeProvider>
          <TooltipProvider>
            <a href="#main-content" className="skip-nav">
              Skip to main content
            </a>
            <Toaster />
            <FocusManager />
            <SlowSignInNotice />
            <Router />
          </TooltipProvider>
        </FontSizeProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;

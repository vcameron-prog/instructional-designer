import { useEffect, useRef } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import NotFound from "@/pages/not-found";
import CaiLandingPage from "@/pages/cai-landing";
import PdfUpload from "@/pages/pdf-upload";
import PdfHistory from "@/pages/pdf-history";
import PdfConversion from "@/pages/pdf-conversion";
import PdfFaq from "@/pages/pdf-faq";
import SettingsPage from "@/pages/settings";
import HelpPage from "@/pages/help";
import AdminDashboard from "@/pages/admin-dashboard";
import { ThemeProvider } from "@/components/theme-provider";
import { FontSizeProvider } from "@/components/font-size-provider";
import { ProtectedRoute } from "@/components/protected-route";

// ---------------------------------------------------------------------------
// Route registry
//
// Add every new page here. Setting `requiresAuth: true` automatically wraps
// the page in <ProtectedRoute> so unauthenticated users are redirected before
// any data fetches fire.  Setting `requiresAuth: false` explicitly marks a
// route as intentionally public — reviewers can audit this list at a glance
// without scanning the whole Router tree.
//
// PUBLIC routes (no sign-in required)
//   /                        Landing page
//   /accessibility           PDF upload (also reachable as /pdf-accessibility)
//   /pdf-accessibility       PDF upload alias
//   /pdf-accessibility/faq   FAQ – no user data
//   /pdf-accessibility/:id   Conversion view – anonymous token guards ownership
//   /help                    Static help content
//
// PROTECTED routes (sign-in required)
//   /pdf-accessibility/history   User's conversion history
//   /settings                    User account settings
//   /admin                       Admin dashboard (also gated by ADMIN_USER_IDS)
// ---------------------------------------------------------------------------

interface RouteConfig {
  path: string;
  component: React.ComponentType;
  requiresAuth: boolean;
}

const ROUTES: RouteConfig[] = [
  { path: "/",                          component: CaiLandingPage,  requiresAuth: false },
  { path: "/accessibility",             component: PdfUpload,       requiresAuth: false },
  { path: "/pdf-accessibility",         component: PdfUpload,       requiresAuth: false },
  { path: "/pdf-accessibility/history", component: PdfHistory,      requiresAuth: true  },
  { path: "/pdf-accessibility/faq",     component: PdfFaq,          requiresAuth: false },
  { path: "/pdf-accessibility/:id",     component: PdfConversion,   requiresAuth: false },
  { path: "/settings",                  component: SettingsPage,    requiresAuth: true  },
  { path: "/help",                      component: HelpPage,        requiresAuth: false },
  { path: "/admin",                     component: AdminDashboard,  requiresAuth: true  },
];

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

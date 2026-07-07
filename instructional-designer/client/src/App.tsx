import { lazy, Suspense, useEffect, useRef } from "react";
import { Router, Switch, Route, useParams, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { FontSizeProvider } from "@/components/font-size-provider";

const NotFound              = lazy(() => import("@/pages/not-found"));
const LandingPage           = lazy(() => import("@/pages/landing"));
const CourseForm            = lazy(() => import("@/pages/course-form"));
const ToolSelection         = lazy(() => import("@/pages/tool-selection"));
const ToolForm              = lazy(() => import("@/pages/tool-form"));
const ResultPage            = lazy(() => import("@/pages/result"));
const ResultBatchPage       = lazy(() => import("@/pages/result-batch"));
const HelpPage              = lazy(() => import("@/pages/help"));
const ResearchPage          = lazy(() => import("@/pages/research"));
const LibraryPage           = lazy(() => import("@/pages/library"));
const QuickToolsPage        = lazy(() => import("@/pages/quick-tools"));
const AdminDashboard        = lazy(() => import("@/pages/admin-dashboard"));
const SettingsPage          = lazy(() => import("@/pages/settings"));
const AccessibilityToolsPage = lazy(() => import("@/pages/accessibility-tools"));
const UrlScannerPage        = lazy(() => import("@/pages/url-scanner"));
const ColorContrastPage     = lazy(() => import("@/pages/color-contrast"));
const AltTextGeneratorPage  = lazy(() => import("@/pages/alt-text-generator"));
const MathOcrPage           = lazy(() => import("@/pages/math-ocr"));

function NewCourseWrapper() {
  return <CourseForm />;
}

function EditCourseWrapper() {
  const params = useParams();
  const courseId = params.id ? parseInt(params.id) : undefined;
  return <CourseForm courseId={courseId} />;
}

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

function AppRouter() {
  return (
    <Router base="/faculty">
    <Suspense fallback={<div aria-live="polite" aria-label="Loading page" />}>
    <Switch>
      <Route path="/" component={LandingPage} />
      <Route path="/bsu" component={LandingPage} />
      <Route path="/new-course" component={NewCourseWrapper} />
      <Route path="/course/:id/edit" component={EditCourseWrapper} />
      <Route path="/course/:id/tools" component={ToolSelection} />
      <Route path="/course/:id/tool/:toolId" component={ToolForm} />
      <Route path="/course/:id/result/:contentId" component={ResultPage} />
      <Route path="/course/:id/result-batch/:assignmentId/:rubricId" component={ResultBatchPage} />
      <Route path="/quick-tools" component={QuickToolsPage} />
      <Route path="/quick-tools/result/:contentId" component={ResultPage} />
      <Route path="/quick-tools/result-batch/:assignmentId/:rubricId" component={ResultBatchPage} />
      <Route path="/quick-tools/:toolId" component={ToolForm} />
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/help" component={HelpPage} />
      <Route path="/research" component={ResearchPage} />
      <Route path="/library" component={LibraryPage} />
      <Route path="/accessibility-tools" component={AccessibilityToolsPage} />
      <Route path="/accessibility-tools/url-scanner" component={UrlScannerPage} />
      <Route path="/accessibility-tools/color-contrast" component={ColorContrastPage} />
      <Route path="/accessibility-tools/alt-text" component={AltTextGeneratorPage} />
      <Route path="/accessibility-tools/math-ocr" component={MathOcrPage} />
      <Route component={NotFound} />
    </Switch>
    </Suspense>
    </Router>
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
            <AppRouter />
          </TooltipProvider>
        </FontSizeProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;

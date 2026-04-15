import { useEffect, useRef } from "react";
import { Switch, Route, useParams, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import LandingPage from "@/pages/landing";
import CourseForm from "@/pages/course-form";
import ToolSelection from "@/pages/tool-selection";
import ToolForm from "@/pages/tool-form";
import ResultPage from "@/pages/result";
import HelpPage from "@/pages/help";
import ResearchPage from "@/pages/research";
import LibraryPage from "@/pages/library";
import QuickToolsPage from "@/pages/quick-tools";
import PdfUpload from "@/pages/pdf-upload";
import PdfHistory from "@/pages/pdf-history";
import PdfConversion from "@/pages/pdf-conversion";
import PdfFaq from "@/pages/pdf-faq";
import AdminDashboard from "@/pages/admin-dashboard";
import { WelcomeModal } from "@/components/welcome-modal";
import { ThemeProvider } from "@/components/theme-provider";
import { FontSizeProvider } from "@/components/font-size-provider";

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

function Router() {
  return (
    <Switch>
      <Route path="/" component={LandingPage} />
      <Route path="/new-course" component={NewCourseWrapper} />
      <Route path="/course/:id/edit" component={EditCourseWrapper} />
      <Route path="/course/:id/tools" component={ToolSelection} />
      <Route path="/course/:id/tool/:toolId" component={ToolForm} />
      <Route path="/course/:id/result/:contentId" component={ResultPage} />
      <Route path="/quick-tools" component={QuickToolsPage} />
      <Route path="/quick-tools/:toolId" component={ToolForm} />
      <Route path="/quick-tools/result/:contentId" component={ResultPage} />
      <Route path="/pdf-accessibility" component={PdfUpload} />
      <Route path="/pdf-accessibility/history" component={PdfHistory} />
      <Route path="/pdf-accessibility/faq" component={PdfFaq} />
      <Route path="/pdf-accessibility/:id" component={PdfConversion} />
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/help" component={HelpPage} />
      <Route path="/research" component={ResearchPage} />
      <Route path="/library" component={LibraryPage} />
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
            <WelcomeModal />
            <Toaster />
            <FocusManager />
            <Router />
          </TooltipProvider>
        </FontSizeProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;

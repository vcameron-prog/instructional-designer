import { Switch, Route, useParams } from "wouter";
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
import { WelcomeModal } from "@/components/welcome-modal";

function NewCourseWrapper() {
  return <CourseForm />;
}

function EditCourseWrapper() {
  const params = useParams();
  const courseId = params.id ? parseInt(params.id) : undefined;
  return <CourseForm courseId={courseId} />;
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
      <TooltipProvider>
        <WelcomeModal />
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

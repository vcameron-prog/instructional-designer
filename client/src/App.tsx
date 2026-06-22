import { useEffect, useRef } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import CaiLandingPage from "@/pages/cai-landing";
import PdfUpload from "@/pages/pdf-upload";
import PdfHistory from "@/pages/pdf-history";
import PdfConversion from "@/pages/pdf-conversion";
import PdfFaq from "@/pages/pdf-faq";
import SettingsPage from "@/pages/settings";
import HelpPage from "@/pages/help";
import { ThemeProvider } from "@/components/theme-provider";
import { FontSizeProvider } from "@/components/font-size-provider";

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
      <Route path="/" component={PdfUpload} />
      <Route path="/accessibility" component={PdfUpload} />
      <Route path="/pdf-accessibility" component={PdfUpload} />
      <Route path="/pdf-accessibility/history" component={PdfHistory} />
      <Route path="/pdf-accessibility/faq" component={PdfFaq} />
      <Route path="/pdf-accessibility/:id" component={PdfConversion} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/help" component={HelpPage} />
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
            <Router />
          </TooltipProvider>
        </FontSizeProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;

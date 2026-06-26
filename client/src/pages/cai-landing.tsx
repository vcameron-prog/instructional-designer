import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BookOpen, ArrowRight, Users, GraduationCap, FileText, Shield, Zap, LayoutDashboard } from "lucide-react";
import { HeaderControls } from "@/components/header-controls";
import { usePageTitle } from "@/hooks/use-page-title";
import caiLogoWhite from "@assets/Center_for_AI_Apparel_&_Promotional_Items-WHITE_(1)_1775653892158.png";

export default function CaiLandingPage() {
  useEffect(() => { window.scrollTo(0, 0); }, []);
  usePageTitle("CAI Tools — Bridgewater State University");
  const [, navigate] = useLocation();

  const { data: isAdmin } = useQuery<boolean>({
    queryKey: ["/api/admin/check"],
    queryFn: async () => {
      const res = await fetch("/api/admin/check", { credentials: "include" });
      return res.status === 200;
    },
    retry: false,
  });

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-background/95 backdrop-blur sticky top-0 z-20">
        <div className="container mx-auto px-4 py-2 flex items-center justify-end">
          <nav aria-label="Display preferences">
            <HeaderControls showLibrary={false} showHelp={false} showSettings={false} showLogout={false} showLogin={false} />
          </nav>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="flex-1">

      {/* CAI logo banner — always dark so the white logo stays legible */}
      <div className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 py-8 flex justify-center">
        <img
          src={caiLogoWhite}
          alt="Center for Artificial Intelligence"
          className="h-20 md:h-24 w-auto"
          data-testid="img-cai-logo"
        />
      </div>

      {/* Accessibility Converter section — shown first */}
      <section aria-labelledby="converter-heading" className="py-16 px-4 bg-secondary/30">
        <div className="container mx-auto max-w-4xl">
          <div className="flex flex-col md:flex-row items-center gap-10">
            <div className="flex-1">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-muted text-muted-foreground text-xs font-semibold mb-4">
                <Shield className="w-3.5 h-3.5" />
                ADA Title II · WCAG 2.1 AA
              </div>
              <h2
                id="converter-heading"
                className="text-2xl md:text-3xl font-bold text-foreground mb-3"
                data-testid="heading-converter"
              >
                Accessibility Converter
              </h2>
              <p className="text-muted-foreground mb-6 max-w-lg">
                A free, shared accessibility resource from the Bridgewater State University Center for Artificial Intelligence. Built to help Massachusetts state universities and community colleges work toward ADA Title II and WCAG 2.1 AA accessibility standards.
              </p>
              <Button
                size="lg"
                onClick={() => navigate("/accessibility")}
                className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 text-base px-8 py-6 rounded-xl font-semibold shadow-lg"
                data-testid="button-open-converter"
              >
                <FileText className="w-5 h-5" />
                Open Accessibility Converter
                <ArrowRight className="w-5 h-5" />
              </Button>
            </div>
            <div className="flex-shrink-0 grid grid-cols-1 gap-3 w-full md:w-72">
              <div className="flex items-start gap-3 p-4 bg-card border border-border rounded-xl">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
                  <FileText className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="font-semibold text-foreground text-sm">PDF, Word, PowerPoint &amp; Excel</p>
                  <p className="text-xs text-muted-foreground">Upload any common document format</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 bg-card border border-border rounded-xl">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0">
                  <Zap className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="font-semibold text-foreground text-sm">AI-Powered Remediation</p>
                  <p className="text-xs text-muted-foreground">Alt text, heading structure, reading order</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 bg-card border border-border rounded-xl">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                  <Shield className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="font-semibold text-foreground text-sm">No Login Needed</p>
                  <p className="text-xs text-muted-foreground">Public tool — free to use instantly</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Hero section with CAI branding.
           The background is intentionally hardcoded as a dark gray gradient
           (from-gray-900 via-gray-800 to-gray-900) — it does NOT follow the
           app's light/dark theme toggle.  Because this section is always dark,
           the white-only CAI logo (caiLogoWhite) is always legible here and
           no theme-aware logo swap is needed. */}
      <section
        aria-labelledby="id-hero-heading"
        className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white py-20 px-4"
      >
        <div className="container mx-auto max-w-4xl text-center">
          {/* White logo — always visible because the hero background is always dark */}
          <div className="flex justify-center mb-4" data-testid="cai-logo-area">
            <img
              src={caiLogoWhite}
              alt="Center for Artificial Intelligence"
              className="h-20 md:h-24 w-auto"
              data-testid="img-cai-logo"
            />
          </div>

          <h1
            id="id-hero-heading"
            className="text-2xl md:text-4xl font-bold mb-4 tracking-tight"
            style={{ textWrap: "balance" }}
            data-testid="heading-id-main"
          >
            AI-Powered Course Design for BSU Faculty
          </h1>
          <p
            className="text-lg md:text-xl text-gray-300 max-w-2xl mx-auto mb-10"
            style={{ textWrap: "balance" }}
            data-testid="text-id-subtitle"
          >
            Create assignments, rubrics, syllabi, and UDL-aligned course materials in minutes —
            powered by AI and built specifically for Bridgewater State University instructors.
          </p>

          <a
            href="/faculty"
            className="inline-flex items-center gap-2 bg-white text-gray-900 hover:bg-gray-100 text-base px-8 py-6 rounded-xl font-semibold shadow-lg transition-colors"
            data-testid="button-open-id-app"
          >
            <GraduationCap className="w-5 h-5" />
            Open Instructional Designer
            <ArrowRight className="w-5 h-5" />
          </a>
        </div>
      </section>

      {/* What it does section */}
      <section aria-labelledby="features-heading" className="py-16 px-4 bg-background">
        <div className="container mx-auto max-w-4xl">
          <h2 id="features-heading" className="text-2xl md:text-3xl font-bold text-center text-foreground mb-10" data-testid="heading-features">
            What the Instructional Designer Does
          </h2>

          <div className="grid gap-6 md:grid-cols-3">
            <Card className="border border-border" data-testid="card-feature-course-materials">
              <CardContent className="p-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center mx-auto mb-4">
                  <BookOpen className="w-7 h-7 text-white" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">AI-Generated Course Materials</h3>
                <p className="text-sm text-muted-foreground">
                  Generate complete assignments, rubrics, syllabi, and learning modules from a simple course description — ready to drop into your LMS.
                </p>
              </CardContent>
            </Card>

            <Card className="border border-border" data-testid="card-feature-udl">
              <CardContent className="p-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mx-auto mb-4">
                  <Users className="w-7 h-7 text-white" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">UDL &amp; Inclusive Design</h3>
                <p className="text-sm text-muted-foreground">
                  Every output automatically incorporates Universal Design for Learning, Cultural Relevance, and Social-Emotional Learning frameworks.
                </p>
              </CardContent>
            </Card>

            <Card className="border border-border" data-testid="card-feature-bsu">
              <CardContent className="p-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center mx-auto mb-4">
                  <GraduationCap className="w-7 h-7 text-white" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">Built for BSU Faculty</h3>
                <p className="text-sm text-muted-foreground">
                  Uses BSU's official syllabus template and AI policy framework, with professional DOCX export for seamless upload to Blackboard Ultra.
                </p>
              </CardContent>
            </Card>
          </div>

        </div>
      </section>

      <footer className="py-10 px-4 bg-background border-t border-border" data-testid="footer-cai">
        <div className="container mx-auto max-w-2xl text-center space-y-3">
          <p className="text-xs text-muted-foreground" data-testid="text-cai-footer-note">
            Content generated by this tool is not stored or shared, and user data is not used to train AI models.
            AI-generated content may contain errors — please review all materials carefully.
          </p>
          {isAdmin && (
            <p className="text-xs text-muted-foreground">
              <button
                onClick={() => navigate("/admin")}
                className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground transition-colors"
                data-testid="link-footer-admin-dashboard"
              >
                <LayoutDashboard className="w-3 h-3" />
                Admin Dashboard
              </button>
            </p>
          )}
        </div>
      </footer>
      </main>
    </div>
  );
}

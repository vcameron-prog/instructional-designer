import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BookOpen, ArrowRight, Users, GraduationCap } from "lucide-react";
import { HeaderControls } from "@/components/header-controls";
import { usePageTitle } from "@/hooks/use-page-title";
import caiLogoWhite from "@assets/Center_for_AI_Apparel_&_Promotional_Items-WHITE_(1)_1775653892158.png";

const ID_APP_URL = import.meta.env.VITE_ID_APP_URL as string | undefined;

function openIdApp() {
  if (!ID_APP_URL) return;
  const isExternal = /^https?:\/\//i.test(ID_APP_URL);
  if (isExternal) {
    window.open(ID_APP_URL, "_blank", "noopener,noreferrer");
  } else {
    window.location.href = ID_APP_URL;
  }
}

export default function CaiLandingPage() {
  useEffect(() => { window.scrollTo(0, 0); }, []);
  usePageTitle("BSU Instructional Designer");

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-background">

      {/* Top-right controls (theme toggle, font size only — no login) */}
      <nav aria-label="Display preferences" className="absolute top-4 right-4 z-20">
        <HeaderControls showHome={false} showLibrary={false} showHelp={false} showSettings={false} showLogout={false} showLogin={false} />
      </nav>

      {/* Hero section with CAI branding */}
      <section
        aria-labelledby="id-hero-heading"
        className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white py-20 px-4"
      >
        <div className="container mx-auto max-w-4xl text-center">
          {/* CAI logo */}
          <div className="flex justify-center mb-8" data-testid="cai-logo-area">
            <img
              src={caiLogoWhite}
              alt="Center for Artificial Intelligence"
              className="h-20 md:h-24 w-auto"
              data-testid="img-cai-logo"
            />
          </div>

          <h1
            id="id-hero-heading"
            className="text-3xl md:text-5xl font-bold mb-4 tracking-tight"
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

          <Button
            size="lg"
            className="gap-2 bg-white text-gray-900 hover:bg-gray-100 text-base px-8 py-6 rounded-xl font-semibold shadow-lg"
            onClick={openIdApp}
            disabled={!ID_APP_URL}
            data-testid="button-open-id-app"
          >
            <GraduationCap className="w-5 h-5" />
            Open Instructional Designer
            <ArrowRight className="w-5 h-5" />
          </Button>
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
        <div className="container mx-auto max-w-2xl text-center">
          <p className="text-xs text-muted-foreground" data-testid="text-cai-footer-note">
            Content generated by this tool is not stored or shared, and user data is not used to train AI models.
            AI-generated content may contain errors — please review all materials carefully.
          </p>
        </div>
      </footer>
    </main>
  );
}

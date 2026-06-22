import { useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Shield, ArrowRight, Globe, Building2, GraduationCap, Accessibility } from "lucide-react";
import { HeaderControls } from "@/components/header-controls";
import { usePageTitle } from "@/hooks/use-page-title";
import caiLogoWhite from "@assets/Center_for_AI_Apparel_&_Promotional_Items-WHITE_(1)_1775653892158.png";

export default function CaiLandingPage() {
  const [, navigate] = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, []);
  usePageTitle("Massachusetts Accessibility Converter");

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-background">

      {/* Top-right controls (theme toggle, font size only — no login) */}
      <nav aria-label="Display preferences" className="absolute top-4 right-4 z-20">
        <HeaderControls showHome={false} showLibrary={false} showHelp={false} showSettings={false} showLogout={false} showLogin={false} />
      </nav>

      {/* Hero section with CAI branding */}
      <section
        aria-labelledby="cai-hero-heading"
        className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white py-20 px-4"
      >
        <div className="container mx-auto max-w-4xl text-center">
          {/* CAI logo — replace attached_assets/Center_for_AI_Apparel_&_Promotional_Items-WHITE_(1)_1775653892158.png to update */}
          <div className="flex justify-center mb-8" data-testid="cai-logo-area">
            <img
              src={caiLogoWhite}
              alt="Center for Artificial Intelligence"
              className="h-20 md:h-24 w-auto"
              data-testid="img-cai-logo"
            />
          </div>

          <h1
            id="cai-hero-heading"
            className="text-3xl md:text-5xl font-bold mb-4 tracking-tight"
            data-testid="heading-cai-main"
          >
            Accessible Documents for All Massachusetts Colleges
          </h1>
          <p
            className="text-lg md:text-xl text-gray-300 max-w-2xl mx-auto mb-10"
            style={{ textWrap: "balance" }}
            data-testid="text-cai-subtitle"
          >
            A free, shared accessibility resource from the BSU Center for Artificial Intelligence — helping
            Massachusetts state universities and community colleges meet ADA Title II &amp; WCAG 2.1 AA standards.
          </p>

          <Button
            size="lg"
            className="gap-2 bg-white text-gray-900 hover:bg-gray-100 text-base px-8 py-6 rounded-xl font-semibold shadow-lg"
            onClick={() => navigate("/accessibility")}
            data-testid="button-open-converter"
          >
            <Accessibility className="w-5 h-5" />
            Open Accessibility Converter
            <ArrowRight className="w-5 h-5" />
          </Button>

          <p className="mt-4 text-sm text-gray-400 flex items-center justify-center gap-1.5" data-testid="text-no-login">
            <Globe className="w-3.5 h-3.5" />
            No account required — open to everyone
          </p>
        </div>
      </section>

      {/* What it does section */}
      <section aria-labelledby="features-heading" className="py-16 px-4 bg-background">
        <div className="container mx-auto max-w-4xl">
          <h2 id="features-heading" className="text-2xl md:text-3xl font-bold text-center text-foreground mb-10" data-testid="heading-features">
            What the Converter Does
          </h2>

          <div className="grid gap-6 md:grid-cols-3">
            <Card className="border border-border" data-testid="card-feature-convert">
              <CardContent className="p-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center mx-auto mb-4">
                  <Shield className="w-7 h-7 text-white" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">PDF &amp; Word Documents</h3>
                <p className="text-sm text-muted-foreground">
                  Upload PDFs and DOCX files and receive fully accessible HTML output that screen readers can navigate.
                </p>
              </CardContent>
            </Card>

            <Card className="border border-border" data-testid="card-feature-google">
              <CardContent className="p-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mx-auto mb-4">
                  <Globe className="w-7 h-7 text-white" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">Google Docs</h3>
                <p className="text-sm text-muted-foreground">
                  Paste a publicly shared Google Doc URL and get a WCAG-compliant version instantly.
                </p>
              </CardContent>
            </Card>

            <Card className="border border-border" data-testid="card-feature-wcag">
              <CardContent className="p-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center mx-auto mb-4">
                  <Accessibility className="w-7 h-7 text-white" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">WCAG 2.1 AA Compliance</h3>
                <p className="text-sm text-muted-foreground">
                  AI-powered checks and fixes for headings, color contrast, alt text, and more — with a detailed compliance report.
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="mt-10 text-center">
            <Button
              size="lg"
              onClick={() => navigate("/accessibility")}
              className="gap-2"
              data-testid="button-open-converter-2"
            >
              <Accessibility className="w-4 h-4" />
              Convert a Document
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* Institution callout */}
      <section aria-labelledby="statewide-heading" className="py-12 px-4 bg-muted/40 border-y border-border">
        <div className="container mx-auto max-w-3xl text-center">
          <Building2 className="w-8 h-8 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
          <h2 id="statewide-heading" className="text-lg font-semibold text-foreground mb-2" data-testid="heading-statewide">
            A Shared Resource for the Massachusetts State University System
          </h2>
          <p className="text-sm text-muted-foreground max-w-xl mx-auto" style={{ textWrap: "balance" }} data-testid="text-statewide">
            Built by Bridgewater State University's Center for Artificial Intelligence and offered freely to all
            Massachusetts state and community colleges to help meet ADA Title II accessibility mandates.
          </p>
        </div>
      </section>

      {/* BSU Faculty login link */}
      <footer className="py-10 px-4 bg-background border-t border-border" data-testid="footer-cai">
        <div className="container mx-auto max-w-2xl text-center space-y-3">
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <GraduationCap className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            <span className="text-sm" data-testid="text-bsu-faculty-prompt">
              BSU Faculty?{" "}
              <a
                href={import.meta.env.VITE_ID_APP_URL || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-primary underline hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                data-testid="link-bsu-faculty-login"
              >
                Log in to the Instructional Design Tools →
              </a>
            </span>
          </div>
          <p className="text-xs text-muted-foreground" data-testid="text-cai-footer-note">
            Content generated by this tool is not stored or shared, and user data is not used to train AI models.
            AI-generated content may contain errors — please review all materials carefully.
          </p>
        </div>
      </footer>
    </main>
  );
}

import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import bsuCaiLogo from "@assets/bsu-cai-logo.png";
import {
  Sparkles,
  FolderOpen,
  ArrowRight,
  HelpCircle,
  Library,
  FlaskConical,
  Shield,
  Zap,
  LayoutDashboard,
  Lock,
  Globe,
  Settings,
} from "lucide-react";
import { SiGoogle } from "react-icons/si";
import { useAuth } from "@/hooks/use-auth";
import { HeaderControls } from "@/components/header-controls";
import { usePageTitle } from "@/hooks/use-page-title";
import type { Course } from "@shared/schema";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isSessionExpiredMessage } from "@/lib/upload-error-utils";
import { useToast } from "@/hooks/use-toast";
import { CourseCard } from "@/components/course-card";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { LoadingScreen } from "@/components/loading-screen";


function isBsuEmail(email?: string | null): boolean {
  return !!email && email.toLowerCase().endsWith("@bridgew.edu");
}

function getConverterUrl(): string {
  if (import.meta.env.DEV) {
    return `${window.location.protocol}//${window.location.hostname}/accessibility`;
  }
  return import.meta.env.VITE_CONVERTER_APP_URL || `${window.location.protocol}//${window.location.hostname}/accessibility`;
}

export default function LandingPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user, isLoading: isAuthLoading, isAuthenticated } = useAuth();
  useEffect(() => { window.scrollTo(0, 0); }, []);

  const isBsu = isBsuEmail(user?.email);

  const { data: courses = [], isLoading } = useQuery<Course[]>({
    queryKey: ["/api/courses"],
    enabled: isAuthenticated && isBsu,
  });

  const { data: adminCheck } = useQuery<{ isAdmin: boolean }>({
    queryKey: ["/api/admin/check"],
    enabled: isAuthenticated,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/courses/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/courses"] });
      toast({ title: "Course deleted" });
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/courses/${id}/duplicate`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/courses"] });
      toast({ title: "Course duplicated", description: `Created "${data.courseName}"` });
    },
    onError: (error: Error) => {
      if (isSessionExpiredMessage(error.message)) return;
      toast({ title: "Failed to duplicate course", variant: "destructive" });
    },
  });

  const rolloverMutation = useMutation({
    mutationFn: async ({ id, semester, contentIds }: { id: number; semester: string; contentIds: number[] }) => {
      const res = await apiRequest("POST", `/api/courses/${id}/rollover`, { semester, contentIds });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/courses"] });
      navigate(`/course/${data.id}/tools`);
      toast({ title: "New semester created", description: `${data.courseName} — ${data.semester}` });
    },
    onError: () => {
      toast({ title: "Failed to create new semester course", variant: "destructive" });
    },
  });

  usePageTitle("Home");

  if (isAuthLoading) {
    return <LoadingScreen message="Loading..." />;
  }

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-background relative overflow-hidden">
      <nav aria-label="User menu" className="absolute top-4 right-4 z-20 flex items-center gap-2">
        {user && (
          <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-1.5 mr-1" data-testid="user-info">
            <Avatar className="w-7 h-7">
              <AvatarImage src={user.profileImageUrl || undefined} alt={user.firstName || "User"} />
              <AvatarFallback className="text-xs bg-primary/10 text-primary">
                {user.firstName?.[0] || user.email?.[0]?.toUpperCase() || "U"}
              </AvatarFallback>
            </Avatar>
            <span className="text-foreground text-sm hidden md:inline" data-testid="text-user-name">
              {user.firstName || user.email?.split("@")[0] || "User"}
            </span>
          </div>
        )}
        <HeaderControls showLogout={isAuthenticated} showLogin={false} />
      </nav>

      <div className="relative z-10 container mx-auto px-4 py-12 md:py-20">
        <div className="text-center mb-12 animate-fade-in-up">
          <div className="inline-block mb-8">
            <img
              src={bsuCaiLogo}
              alt="BSU Center for Artificial Intelligence"
              className="h-16 md:h-20 w-auto dark:bg-white/95 dark:rounded-xl dark:px-4 dark:py-2"
              data-testid="img-hero-logo"
            />
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground mb-4 tracking-tight">
            Instructional Designer
          </h1>
        </div>

        {/* Non-BSU user warning */}
        {isAuthenticated && !isBsu && (
          <div
            className="mb-8 max-w-4xl mx-auto bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex items-start gap-3"
            role="alert"
            data-testid="banner-non-bsu"
          >
            <Shield className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                Signed in as {user?.email}
              </p>
              <p className="text-sm text-amber-800 dark:text-amber-200 mt-0.5">
                The instructional design tools and quick tools require a <strong>@bridgew.edu</strong> account. The Accessibility Converter below is open to everyone.
              </p>
            </div>
          </div>
        )}

        <div className="max-w-5xl mx-auto space-y-10">

          {/* ── Three main tiles in a unified 3-column grid ── */}
          <section aria-labelledby="tools-section-heading">
            <h2 id="tools-section-heading" className="sr-only">Tools</h2>

            {/* Signed in as BSU user — show all three tiles equally */}
            {isBsu ? (
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <Card
                    className="group cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-xl bg-card border border-emerald-200/60 dark:border-emerald-800/40"
                    onClick={() => { window.open(getConverterUrl(), "_blank", "noopener noreferrer"); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); window.open(getConverterUrl(), "_blank", "noopener noreferrer"); } }}
                    tabIndex={0}
                    role="button"
                    aria-label="Accessibility Converter — open to everyone"
                    data-testid="card-pdf-accessibility"
                  >
                    <CardContent className="p-8 text-center flex flex-col items-center">
                      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center mb-6 group-hover:scale-105 transition-transform">
                        <Shield className="w-10 h-10 text-white" />
                      </div>
                      <div className="mb-2">
                        <div className="inline-flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-full px-3 py-1 text-xs font-semibold">
                          <Globe className="w-3.5 h-3.5" aria-hidden="true" />
                          Open to everyone
                        </div>
                      </div>
                      <CardTitle className="text-2xl mb-3">Accessibility Converter</CardTitle>
                      <CardDescription className="text-base mb-4" style={{ textWrap: "balance" }}>
                        Convert PDFs, Word documents, and Google Docs into WCAG 2.1 AA compliant accessible documents.
                      </CardDescription>
                      <Button variant="outline" className="mt-auto gap-2" data-testid="button-pdf-accessibility">
                        Convert a Document <ArrowRight className="w-4 h-4" />
                      </Button>
                    </CardContent>
                  </Card>

                  <Card
                    className="group cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-xl bg-card border-0"
                    onClick={() => navigate("/quick-tools")}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/quick-tools"); } }}
                    tabIndex={0}
                    role="button"
                    aria-label="Quick Tools"
                    data-testid="card-quick-tools"
                  >
                    <CardContent className="p-8 text-center">
                      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-amber-500 to-yellow-400 flex items-center justify-center mx-auto mb-6 group-hover:scale-105 transition-transform">
                        <Zap className="w-10 h-10 text-white" />
                      </div>
                      <CardTitle className="text-2xl mb-3">Quick Tools</CardTitle>
                      <CardDescription className="text-base" style={{ textWrap: "balance" }}>
                        Create a one-off assignment, rubric, or other material without setting up a full course
                      </CardDescription>
                      <Button variant="outline" className="mt-6 gap-2" data-testid="button-quick-tools">
                        Browse Tools <ArrowRight className="w-4 h-4" />
                      </Button>
                    </CardContent>
                  </Card>

                  <Card
                    className="group cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-xl bg-card border-0"
                    onClick={() => navigate("/new-course")}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/new-course"); } }}
                    tabIndex={0}
                    role="button"
                    aria-label="Design a new course"
                    data-testid="card-new-course"
                  >
                    <CardContent className="p-8 text-center">
                      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center mx-auto mb-6 group-hover:scale-105 transition-transform">
                        <Sparkles className="w-10 h-10 text-white" />
                      </div>
                      <CardTitle className="text-2xl mb-3">Design a New Course</CardTitle>
                      <CardDescription className="text-base" style={{ textWrap: "balance" }}>
                        Begin with course information and create complete course materials from scratch
                      </CardDescription>
                      <Button className="mt-6 gap-2" data-testid="button-start-new">
                        Get Started <ArrowRight className="w-4 h-4" />
                      </Button>
                    </CardContent>
                  </Card>
                </div>

                {courses.length > 0 && (
                  <Card className="bg-card border-0">
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                          <FolderOpen className="w-6 h-6 text-primary" />
                        </div>
                        <div>
                          <CardTitle className="text-xl">Your Courses</CardTitle>
                          <CardDescription>Resume or duplicate existing courses</CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2 max-h-96 overflow-y-auto">
                      {isLoading ? (
                        <div className="space-y-2">
                          {[1, 2].map(i => (
                            <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />
                          ))}
                        </div>
                      ) : (
                        courses.map((course) => (
                          <CourseCard
                            key={course.id}
                            course={course}
                            onNavigate={() => navigate(`/course/${course.id}/tools`)}
                            onDuplicate={() => duplicateMutation.mutate(course.id)}
                            onDelete={() => deleteMutation.mutate(course.id)}
                            onRollover={(semester, contentIds) => rolloverMutation.mutate({ id: course.id, semester, contentIds })}
                            isDuplicating={duplicateMutation.isPending}
                            isRollingOver={rolloverMutation.isPending}
                          />
                        ))
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>
            ) : (
              /* Not signed in (or non-BSU) — show all three tiles, two dimmed with sign-in prompt */
              <div className="space-y-6">
                <div className="grid gap-4 md:grid-cols-3">
                  {/* Accessibility Converter — always accessible */}
                  <Card
                    className="group cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-xl bg-card border border-emerald-200/60 dark:border-emerald-800/40"
                    onClick={() => { window.open(getConverterUrl(), "_blank", "noopener noreferrer"); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); window.open(getConverterUrl(), "_blank", "noopener noreferrer"); } }}
                    tabIndex={0}
                    role="button"
                    aria-label="Accessibility Converter — open to everyone"
                    data-testid="card-pdf-accessibility"
                  >
                    <CardContent className="p-8 text-center flex flex-col items-center">
                      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center mb-6 group-hover:scale-105 transition-transform">
                        <Shield className="w-10 h-10 text-white" />
                      </div>
                      <div className="mb-2">
                        <div className="inline-flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-full px-3 py-1 text-xs font-semibold">
                          <Globe className="w-3.5 h-3.5" aria-hidden="true" />
                          Open to everyone
                        </div>
                      </div>
                      <CardTitle className="text-2xl mb-3">Accessibility Converter</CardTitle>
                      <CardDescription className="text-base mb-4" style={{ textWrap: "balance" }}>
                        Convert PDFs, Word documents, and Google Docs into WCAG 2.1 AA compliant accessible documents.
                      </CardDescription>
                      <Button variant="outline" className="mt-auto gap-2" data-testid="button-pdf-accessibility">
                        Convert a Document <ArrowRight className="w-4 h-4" />
                      </Button>
                    </CardContent>
                  </Card>

                  {/* Quick Tools — dimmed/locked */}
                  <div className="rounded-xl border bg-muted/30 p-8 text-center opacity-50 pointer-events-none select-none" aria-hidden="true">
                    <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-amber-500 to-yellow-400 flex items-center justify-center mx-auto mb-6">
                      <Zap className="w-10 h-10 text-white" />
                    </div>
                    <p className="text-xl font-semibold text-foreground mb-3">Quick Tools</p>
                    <p className="text-sm text-muted-foreground" style={{ textWrap: "balance" }}>One-off assignments, rubrics &amp; more without a full course</p>
                  </div>

                  {/* Course Design — dimmed/locked */}
                  <div className="rounded-xl border bg-muted/30 p-8 text-center opacity-50 pointer-events-none select-none" aria-hidden="true">
                    <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center mx-auto mb-6">
                      <Sparkles className="w-10 h-10 text-white" />
                    </div>
                    <p className="text-xl font-semibold text-foreground mb-3">Design a New Course</p>
                    <p className="text-sm text-muted-foreground" style={{ textWrap: "balance" }}>Full course materials from scratch</p>
                  </div>
                </div>

                <Card className="bg-card border border-dashed border-muted-foreground/30" data-testid="card-bsu-locked">
                  <CardContent className="p-8 text-center">
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-4">
                      <Lock className="w-7 h-7 text-primary" />
                    </div>
                    <h3 className="text-lg font-semibold text-foreground mb-2">
                      BSU Employee Access Required
                    </h3>
                    <p className="text-muted-foreground text-sm max-w-sm mx-auto mb-6" style={{ textWrap: "balance" }}>
                      These tools are available to Bridgewater State University employees. Sign in with your <strong>@bridgew.edu</strong> Google account to get started.
                    </p>
                    <Button
                      size="lg"
                      className="gap-2"
                      onClick={() => window.location.href = "/api/login"}
                      data-testid="button-login-bsu"
                    >
                      <SiGoogle size={18} />
                      Sign In with BSU Account
                    </Button>
                    <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                      <Shield className="w-3.5 h-3.5" />
                      <span>Use your @bridgew.edu Google account</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </section>
        </div>

        {/* Footer links */}
        <div className="mt-12 flex flex-wrap justify-center gap-3">
          <Button
            variant="outline"
            onClick={() => navigate("/help")}
            data-testid="button-help-footer"
          >
            <HelpCircle className="w-4 h-4 mr-2" />
            Help &amp; Tips
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate("/research")}
            data-testid="button-research-footer"
          >
            <FlaskConical className="w-4 h-4 mr-2" />
            Research &amp; Theory
          </Button>
          {isBsu && (
            <Button
              variant="outline"
              onClick={() => navigate("/library")}
              data-testid="button-library-footer"
            >
              <Library className="w-4 h-4 mr-2" />
              Content Library
            </Button>
          )}
          {isAuthenticated && (
            <Button
              variant="outline"
              onClick={() => navigate("/settings")}
              data-testid="button-settings-footer"
            >
              <Settings className="w-4 h-4 mr-2" />
              Preferences
            </Button>
          )}
          {adminCheck?.isAdmin && (
            <Button
              variant="outline"
              onClick={() => navigate("/admin")}
              data-testid="button-admin-dashboard"
            >
              <LayoutDashboard className="w-4 h-4 mr-2" />
              Admin Dashboard
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground text-center max-w-2xl mx-auto mt-6">
          This tool improves document accessibility but does not guarantee full WCAG 2.1 compliance. Automated remediation is a starting point. Only a human reviewer can confirm that a document is genuinely accessible. Each institution is responsible for verifying its own content.
        </p>

      </div>
      <PoweredByFooter />
    </main>
  );
}

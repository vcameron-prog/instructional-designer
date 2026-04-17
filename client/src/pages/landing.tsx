import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  GraduationCap, 
  Sparkles, 
  FolderOpen, 
  ArrowRight, 
  HelpCircle,
  Library,
  FlaskConical,
  User,
  Shield,
  Users,
  Loader2,
  Zap,
  LayoutDashboard,
  X,
  TrendingUp,
  CheckCircle2,
  Clock,
  ShieldCheck
} from "lucide-react";
import { SiGoogle } from "react-icons/si";
import bsuAiLogo from "@assets/Center_for_AI_Apparel_&_Promotional_Items-WHITE_(1)_1775653892158.png";
import { useAuth } from "@/hooks/use-auth";
import { HeaderControls } from "@/components/header-controls";
import { usePageTitle } from "@/hooks/use-page-title";
import type { Course } from "@shared/schema";
import { format } from "date-fns";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CourseCard } from "@/components/course-card";

const WHATS_NEW_KEY = "whats-new-converter-v2-dismissed";

const converterUpdates = [
  {
    icon: TrendingUp,
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    title: "Higher compliance scores",
    detail: "Documents now consistently score 50+ points higher after conversion — proper headings, landmarks, table headers, and alt text included automatically.",
  },
  {
    icon: ShieldCheck,
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-50 dark:bg-blue-950/40",
    title: "More accurate auditing",
    detail: "Fixed double-counting of checks that inflated failure counts. The audit now only flags clear, actionable violations.",
  },
  {
    icon: Clock,
    color: "text-violet-600 dark:text-violet-400",
    bg: "bg-violet-50 dark:bg-violet-950/40",
    title: "Faster & more reliable",
    detail: "Most conversions finish in under 15 seconds. Built-in timeout protection and automatic retries prevent conversions from hanging.",
  },
  {
    icon: CheckCircle2,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950/40",
    title: "Better quality HTML output",
    detail: "Upgraded AI model produces higher-quality accessible HTML with correct language attributes, heading hierarchy, and ARIA landmarks.",
  },
];

function WhatsNewBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      className="mb-8 max-w-4xl mx-auto border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/20 rounded-xl p-5"
      role="region"
      aria-label="What's new in the Accessibility Converter"
      data-testid="banner-whats-new"
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white text-xs px-2 py-0.5" data-testid="badge-whats-new">
            What's New
          </Badge>
          <span className="font-semibold text-foreground text-sm">
            Accessibility Converter — Updated
          </span>
        </div>
        <button
          onClick={onDismiss}
          className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 rounded p-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          aria-label="Dismiss what's new banner"
          data-testid="button-dismiss-whats-new"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {converterUpdates.map(({ icon: Icon, color, bg, title, detail }) => (
          <div key={title} className={`flex gap-3 rounded-lg p-3 ${bg}`}>
            <div className="flex-shrink-0 mt-0.5">
              <Icon className={`w-4 h-4 ${color}`} aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground leading-snug">{title}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LoginPage() {
  usePageTitle("Sign In");
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-background relative overflow-hidden">
      <div className="absolute top-4 right-4 z-20">
        <HeaderControls showLogout={false} showLibrary={false} />
      </div>

      <div className="relative z-10 container mx-auto px-4 py-12 md:py-20 flex flex-col items-center justify-center min-h-screen">
        <div className="text-center mb-12 animate-fade-in-up">
          <div className="inline-flex items-center justify-center w-24 h-24 bg-gradient-to-br from-primary to-accent rounded-3xl mb-8 shadow-2xl">
            <GraduationCap className="w-14 h-14 text-white" />
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground mb-4 tracking-tight">
            BSU Instructional Design Tool
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed mb-8" style={{ textWrap: "balance" }}>
            Create comprehensive, UDL-aligned course materials ready for Blackboard Ultra
          </p>
        </div>

        <Card className="max-w-md w-full bg-card border shadow-2xl">
          <CardContent className="p-8 text-center">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center mx-auto mb-6">
              <User className="w-10 h-10 text-white" />
            </div>
            <CardTitle className="text-2xl mb-3">Welcome, Faculty</CardTitle>
            <CardDescription className="text-base mb-6" style={{ textWrap: "balance" }}>
              Sign in to create and manage your course materials. Your work is private and secure.
            </CardDescription>
            <Button 
              size="lg" 
              className="w-full gap-2" 
              onClick={() => window.location.href = "/api/login"}
              data-testid="button-login"
            >
              <SiGoogle size={18} />
              Sign In with Google
            </Button>
            <div className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Shield className="w-4 h-4" />
              <span>Secure authentication via Google</span>
            </div>
          </CardContent>
        </Card>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl">
          <div className="bg-card rounded-lg p-4 text-center border shadow-sm">
            <Sparkles className="w-8 h-8 mx-auto mb-2 text-primary" />
            <p className="font-medium text-foreground">AI-Powered</p>
            <p className="text-sm text-muted-foreground" style={{ textWrap: "balance" }}>Generate complete course materials</p>
          </div>
          <div className="bg-card rounded-lg p-4 text-center border shadow-sm">
            <Users className="w-8 h-8 mx-auto mb-2 text-primary" />
            <p className="font-medium text-foreground">UDL-Aligned</p>
            <p className="text-sm text-muted-foreground" style={{ textWrap: "balance" }}>Inclusive design principles</p>
          </div>
          <div className="bg-card rounded-lg p-4 text-center border shadow-sm">
            <Shield className="w-8 h-8 mx-auto mb-2 text-primary" />
            <p className="font-medium text-foreground">Private & Secure</p>
            <p className="text-sm text-muted-foreground" style={{ textWrap: "balance" }}>Your data stays yours</p>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center gap-4">
          <img src={bsuAiLogo} alt="BSU Center for Artificial Intelligence" className="h-12 brightness-0 dark:brightness-100" data-testid="img-bsu-ai-logo" />
          <p className="text-center text-muted-foreground text-sm" style={{ textWrap: "balance" }}>
            Powered by AI to help BSU faculty create accessible, engaging course materials
          </p>
          <p className="text-center text-muted-foreground/70 text-xs" style={{ textWrap: "balance" }}>
            Your data is not used to train AI models
          </p>
        </div>
      </div>
    </main>
  );
}

export default function LandingPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user, isLoading: isAuthLoading, isAuthenticated } = useAuth();
  const [showWhatsNew, setShowWhatsNew] = useState(
    () => localStorage.getItem(WHATS_NEW_KEY) !== "1"
  );

  function dismissWhatsNew() {
    localStorage.setItem(WHATS_NEW_KEY, "1");
    setShowWhatsNew(false);
  }

  useEffect(() => { window.scrollTo(0, 0); }, []);

  const { data: courses = [], isLoading } = useQuery<Course[]>({
    queryKey: ["/api/courses"],
    enabled: isAuthenticated,
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
    onError: () => {
      toast({ title: "Failed to duplicate course", variant: "destructive" });
    },
  });

  usePageTitle("Home");

  if (isAuthLoading) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-background flex items-center justify-center" role="status">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" aria-hidden="true" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </main>
    );
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
        {!isAuthenticated && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => window.location.href = "/api/login"}
            data-testid="button-login-header"
          >
            <SiGoogle size={14} />
            Sign In
          </Button>
        )}
        <HeaderControls showLogout={isAuthenticated} />
      </nav>
      
      <div className="relative z-10 container mx-auto px-4 py-12 md:py-20">
        <div className="text-center mb-12 animate-fade-in-up">
          <div className="inline-flex items-center justify-center w-24 h-24 bg-gradient-to-br from-primary to-accent rounded-3xl mb-8 shadow-2xl">
            <GraduationCap className="w-14 h-14 text-white" />
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground mb-4 tracking-tight">
            BSU Instructional Design Tool
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed" style={{ textWrap: "balance" }}>
            Create comprehensive, UDL-aligned course materials ready for Blackboard Ultra
          </p>
        </div>

        {showWhatsNew && (
          <WhatsNewBanner onDismiss={dismissWhatsNew} />
        )}

        {!isAuthenticated && (
          <div className="mb-8 max-w-4xl mx-auto bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap" data-testid="banner-sign-in">
            <div className="flex items-center gap-3">
              <Shield className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
              <p className="text-sm text-blue-800 dark:text-blue-200 font-medium" style={{ textWrap: "balance" }}>
                You're using the tool as a guest. Sign in to save your courses, access history, and use all features.
              </p>
            </div>
            <Button
              size="sm"
              className="gap-2 flex-shrink-0"
              onClick={() => window.location.href = "/api/login"}
              data-testid="button-login-banner"
            >
              <SiGoogle size={14} />
              Sign In with Google
            </Button>
          </div>
        )}

        <div className={`grid gap-6 max-w-4xl mx-auto ${isAuthenticated && courses.length > 0 ? "md:grid-cols-2" : "md:grid-cols-2 max-w-2xl"}`}>
          <Card 
            className="group cursor-pointer transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl bg-card border-0"
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
            className="group cursor-pointer transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl bg-card border-0"
            onClick={() => navigate("/accessibility")}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/accessibility"); } }}
            tabIndex={0}
            role="button"
            aria-label="Accessibility Converter"
            data-testid="card-pdf-accessibility"
          >
            <CardContent className="p-8 text-center">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center mx-auto mb-6 group-hover:scale-105 transition-transform">
                <Shield className="w-10 h-10 text-white" />
              </div>
              <CardTitle className="text-2xl mb-3">Accessibility Converter</CardTitle>
              <CardDescription className="text-base" style={{ textWrap: "balance" }}>
                Convert PDFs into ADA Title II & WCAG 2.1 AA compliant accessible documents
              </CardDescription>
              <Button variant="outline" className="mt-6 gap-2" data-testid="button-pdf-accessibility">
                Convert Document <ArrowRight className="w-4 h-4" />
              </Button>
            </CardContent>
          </Card>

          {isAuthenticated && <Card 
            className="group cursor-pointer transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl bg-card border-0 md:col-span-2"
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
                Begin with course information and create materials from scratch
              </CardDescription>
              <Button className="mt-6 gap-2" data-testid="button-start-new">
                Get Started <ArrowRight className="w-4 h-4" />
              </Button>
            </CardContent>
          </Card>}

          {isAuthenticated && courses.length > 0 && (
            <Card className="bg-card border-0 md:col-span-2">
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
                      isDuplicating={duplicateMutation.isPending}
                    />
                  ))
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="mt-12 flex flex-wrap justify-center gap-3">
          <Button 
            variant="outline" 
            onClick={() => navigate("/help")}
            data-testid="button-help-footer"
          >
            <HelpCircle className="w-4 h-4 mr-2" />
            Help & Tips
          </Button>
          <Button 
            variant="outline" 
            onClick={() => navigate("/research")}
            data-testid="button-research-footer"
          >
            <FlaskConical className="w-4 h-4 mr-2" />
            Research & Theory
          </Button>
          {isAuthenticated && <Button 
            variant="outline" 
            onClick={() => navigate("/library")}
            data-testid="button-library-footer"
          >
            <Library className="w-4 h-4 mr-2" />
            Content Library
          </Button>}
          {adminCheck?.isAdmin && <Button 
            variant="outline" 
            onClick={() => navigate("/admin")}
            data-testid="button-admin-dashboard"
          >
            <LayoutDashboard className="w-4 h-4 mr-2" />
            Admin Dashboard
          </Button>}
        </div>

        <div className="mt-10 flex flex-col items-center gap-4">
          <img src={bsuAiLogo} alt="BSU Center for Artificial Intelligence" className="h-12 brightness-0 dark:brightness-100" data-testid="img-bsu-ai-logo-auth" />
          <p className="text-center text-muted-foreground text-sm" style={{ textWrap: "balance" }}>
            Powered by AI to help BSU faculty create accessible, engaging course materials
          </p>
        </div>
      </div>
    </main>
  );
}

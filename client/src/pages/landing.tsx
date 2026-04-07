import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { 
  GraduationCap, 
  Sparkles, 
  FolderOpen, 
  ArrowRight, 
  Trash2, 
  Copy, 
  HelpCircle,
  Library,
  CheckCircle,
  FileText,
  BookOpen,
  Calendar,
  Layout,
  Target,
  FlaskConical,
  User,
  Shield,
  Users,
  Loader2,
  Zap
} from "lucide-react";
import { SiGoogle } from "react-icons/si";
import { useAuth } from "@/hooks/use-auth";
import { HeaderControls } from "@/components/header-controls";
import { usePageTitle } from "@/hooks/use-page-title";
import type { Course, GeneratedContent } from "@shared/schema";
import { format } from "date-fns";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TOOLS } from "@/lib/constants";

const toolIconMap: Record<string, any> = {
  syllabus: BookOpen,
  schedule: Calendar,
  assignment: FileText,
  module: Layout,
  rubric: CheckCircle,
  aipolicy: Sparkles,
  alignment: Target,
};

function LoginPage() {
  usePageTitle("Sign In");
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-gradient-to-br from-primary via-primary/90 to-primary/80 relative overflow-hidden">
      <div className="absolute inset-0 pattern-dots text-white/10 opacity-50" aria-hidden="true" />
      
      <div className="absolute top-4 right-4 z-20">
        <HeaderControls variant="dark" showLogout={false} showLibrary={false} />
      </div>

      <div className="relative z-10 container mx-auto px-4 py-12 md:py-20 flex flex-col items-center justify-center min-h-screen">
        <div className="text-center mb-12 animate-fade-in-up">
          <div className="inline-flex items-center justify-center w-24 h-24 bg-gradient-to-br from-primary to-accent rounded-3xl mb-8 shadow-2xl border-4 border-white/20">
            <GraduationCap className="w-14 h-14 text-white" />
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-4 tracking-tight">
            BSU Instructional Design Tool
          </h1>
          <p className="text-lg md:text-xl text-white/90 max-w-2xl mx-auto leading-relaxed mb-8">
            Create comprehensive, UDL-aligned course materials ready for Blackboard Ultra
          </p>
        </div>

        <Card className="max-w-md w-full bg-card border-0 shadow-2xl">
          <CardContent className="p-8 text-center">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center mx-auto mb-6">
              <User className="w-10 h-10 text-white" />
            </div>
            <CardTitle className="text-2xl mb-3">Welcome, Faculty</CardTitle>
            <CardDescription className="text-base mb-6">
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
          <div className="bg-white/10 rounded-lg p-4 text-center text-white">
            <Sparkles className="w-8 h-8 mx-auto mb-2" />
            <p className="font-medium">AI-Powered</p>
            <p className="text-sm text-white/70">Generate complete course materials</p>
          </div>
          <div className="bg-white/10 rounded-lg p-4 text-center text-white">
            <Users className="w-8 h-8 mx-auto mb-2" />
            <p className="font-medium">UDL-Aligned</p>
            <p className="text-sm text-white/70">Inclusive design principles</p>
          </div>
          <div className="bg-white/10 rounded-lg p-4 text-center text-white">
            <Shield className="w-8 h-8 mx-auto mb-2" />
            <p className="font-medium">Private & Secure</p>
            <p className="text-sm text-white/70">Your data stays yours</p>
          </div>
        </div>

        <p className="mt-10 text-center text-white/70 text-sm">
          Powered by AI to help BSU faculty create accessible, engaging course materials
        </p>
        <p className="text-center text-white/50 text-xs mt-2">
          Your data is not used to train AI models
        </p>
      </div>
    </main>
  );
}

export default function LandingPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user, isLoading: isAuthLoading, isAuthenticated } = useAuth();

  const { data: courses = [], isLoading } = useQuery<Course[]>({
    queryKey: ["/api/courses"],
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
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-gradient-to-br from-primary via-primary/90 to-primary/80 flex items-center justify-center" role="status">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-white animate-spin mx-auto mb-4" aria-hidden="true" />
          <p className="text-white/80">Loading...</p>
        </div>
      </main>
    );
  }

  // Show login page if not authenticated
  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-gradient-to-br from-primary via-primary/90 to-primary/80 relative overflow-hidden">
      <div className="absolute inset-0 pattern-dots text-white/10 opacity-50" aria-hidden="true" />
      
      <nav aria-label="User menu" className="absolute top-4 right-4 z-20 flex items-center gap-2">
        {user && (
          <div className="flex items-center gap-2 bg-white/10 rounded-lg px-3 py-1.5 mr-1" data-testid="user-info">
            <Avatar className="w-7 h-7">
              <AvatarImage src={user.profileImageUrl || undefined} alt={user.firstName || "User"} />
              <AvatarFallback className="text-xs bg-white/20 text-white">
                {user.firstName?.[0] || user.email?.[0]?.toUpperCase() || "U"}
              </AvatarFallback>
            </Avatar>
            <span className="text-white text-sm hidden md:inline" data-testid="text-user-name">
              {user.firstName || user.email?.split("@")[0] || "User"}
            </span>
          </div>
        )}
        <HeaderControls variant="dark" />
      </nav>
      
      <div className="relative z-10 container mx-auto px-4 py-12 md:py-20">
        <div className="text-center mb-12 animate-fade-in-up">
          <div className="inline-flex items-center justify-center w-24 h-24 bg-gradient-to-br from-primary to-accent rounded-3xl mb-8 shadow-2xl border-4 border-white/20">
            <GraduationCap className="w-14 h-14 text-white" />
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-4 tracking-tight">
            BSU Instructional Design Tool
          </h1>
          <p className="text-lg md:text-xl text-white/90 max-w-2xl mx-auto leading-relaxed">
            Create comprehensive, UDL-aligned course materials ready for Blackboard Ultra
          </p>
        </div>

        <div className={`grid gap-6 max-w-4xl mx-auto ${courses.length > 0 ? "md:grid-cols-2" : "md:grid-cols-2 max-w-2xl"}`}>
          <Card 
            className="group cursor-pointer transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl bg-card border-0"
            onClick={() => navigate("/new-course")}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/new-course"); } }}
            tabIndex={0}
            role="button"
            aria-label="Start a new course"
            data-testid="card-new-course"
          >
            <CardContent className="p-8 text-center">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center mx-auto mb-6 group-hover:scale-105 transition-transform">
                <Sparkles className="w-10 h-10 text-white" />
              </div>
              <CardTitle className="text-2xl mb-3">Start New Course</CardTitle>
              <CardDescription className="text-base">
                Begin with course information and create materials from scratch
              </CardDescription>
              <Button className="mt-6 gap-2" data-testid="button-start-new">
                Get Started <ArrowRight className="w-4 h-4" />
              </Button>
            </CardContent>
          </Card>

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
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-secondary to-primary flex items-center justify-center mx-auto mb-6 group-hover:scale-105 transition-transform">
                <Zap className="w-10 h-10 text-white" />
              </div>
              <CardTitle className="text-2xl mb-3">Quick Tools</CardTitle>
              <CardDescription className="text-base">
                Create a one-off assignment, rubric, or other material without setting up a full course
              </CardDescription>
              <Button variant="outline" className="mt-6 gap-2" data-testid="button-quick-tools">
                Browse Tools <ArrowRight className="w-4 h-4" />
              </Button>
            </CardContent>
          </Card>

          <Card 
            className="group cursor-pointer transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl bg-card border-0"
            onClick={() => navigate("/pdf-accessibility")}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/pdf-accessibility"); } }}
            tabIndex={0}
            role="button"
            aria-label="PDF Accessibility Converter"
            data-testid="card-pdf-accessibility"
          >
            <CardContent className="p-8 text-center">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center mx-auto mb-6 group-hover:scale-105 transition-transform">
                <Shield className="w-10 h-10 text-white" />
              </div>
              <CardTitle className="text-2xl mb-3">PDF Accessibility</CardTitle>
              <CardDescription className="text-base">
                Convert PDFs into ADA Title II & WCAG 2.1 AA compliant accessible documents
              </CardDescription>
              <Button variant="outline" className="mt-6 gap-2" data-testid="button-pdf-accessibility">
                Convert PDF <ArrowRight className="w-4 h-4" />
              </Button>
            </CardContent>
          </Card>

          {courses.length > 0 && (
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
            className="bg-white/10 border-white/30 text-white hover:bg-white/20"
            onClick={() => navigate("/help")}
            data-testid="button-help-footer"
          >
            <HelpCircle className="w-4 h-4 mr-2" />
            Help & Tips
          </Button>
          <Button 
            variant="outline" 
            className="bg-white/10 border-white/30 text-white hover:bg-white/20"
            onClick={() => navigate("/research")}
            data-testid="button-research-footer"
          >
            <FlaskConical className="w-4 h-4 mr-2" />
            Research & Theory
          </Button>
          <Button 
            variant="outline" 
            className="bg-white/10 border-white/30 text-white hover:bg-white/20"
            onClick={() => navigate("/library")}
            data-testid="button-library-footer"
          >
            <Library className="w-4 h-4 mr-2" />
            Template Library
          </Button>
        </div>

        <p className="mt-10 text-center text-white/70 text-sm">
          Powered by AI to help BSU faculty create accessible, engaging course materials
        </p>
      </div>
    </main>
  );
}

function CourseCard({ 
  course, 
  onNavigate, 
  onDuplicate, 
  onDelete,
  isDuplicating 
}: { 
  course: Course; 
  onNavigate: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  isDuplicating: boolean;
}) {
  const { data: contents = [] } = useQuery<GeneratedContent[]>({
    queryKey: ["/api/courses", course.id, "content"],
  });

  const toolsGenerated = new Set(contents.map(c => c.toolType));
  const isSample = course.courseName.includes("[SAMPLE]");

  return (
    <div className="p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors group">
      <div className="flex items-start justify-between gap-2">
        <button
          className="flex-1 text-left"
          onClick={onNavigate}
          data-testid={`button-course-${course.id}`}
        >
          <p className="font-semibold text-foreground">
            {course.courseName}
            {isSample && (
              <span className="ml-2 text-xs text-muted-foreground font-normal">(Example)</span>
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            {course.courseNumber} • {course.semester}
          </p>
          {toolsGenerated.size > 0 && (
            <div className="flex items-center gap-1 mt-2">
              <span className="text-xs text-muted-foreground mr-1">Created:</span>
              {TOOLS.filter(t => toolsGenerated.has(t.id)).slice(0, 4).map(tool => {
                const Icon = toolIconMap[tool.id] || FileText;
                return (
                  <Tooltip key={tool.id}>
                    <TooltipTrigger asChild>
                      <div className="w-5 h-5 rounded bg-primary/10 flex items-center justify-center">
                        <Icon className="w-3 h-3 text-primary" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{tool.name}</p>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
              {toolsGenerated.size > 4 && (
                <span className="text-xs text-muted-foreground">+{toolsGenerated.size - 4} more</span>
              )}
            </div>
          )}
        </button>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
                disabled={isDuplicating}
                aria-label={`Duplicate ${course.courseName}`}
                data-testid={`button-duplicate-course-${course.id}`}
              >
                <Copy className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Duplicate course</p>
            </TooltipContent>
          </Tooltip>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Delete ${course.courseName}`}
                data-testid={`button-delete-course-${course.id}`}
              >
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Course?</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete "{course.courseName}"? This will permanently remove all saved work and cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onDelete}
                  className="bg-destructive hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}

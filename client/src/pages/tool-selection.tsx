import { useLocation, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, BookOpen, Calendar, FileText, Layout, CheckCircle, Sparkles, Target, ArrowRight, FolderOpen, Loader2, Scale, ShieldCheck, Link2, HelpCircle, GraduationCap, Library, Eye } from "lucide-react";
import { TOOLS } from "@/lib/constants";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { HeaderControls } from "@/components/header-controls";
import type { Course, GeneratedContent } from "@shared/schema";

const iconMap: Record<string, any> = {
  BookOpen,
  Calendar,
  FileText,
  Layout,
  CheckCircle,
  Sparkles,
  Target,
  Scale,
  ShieldCheck,
  Eye,
};

const colorMap: Record<string, string> = {
  primary: "bg-primary",
  secondary: "bg-secondary",
  accent: "bg-accent",
};

export default function ToolSelection() {
  const params = useParams();
  const courseId = params.id ? parseInt(params.id) : undefined;
  const [, navigate] = useLocation();

  const { data: course, isLoading: isLoadingCourse } = useQuery<Course>({
    queryKey: ["/api/courses", courseId],
    enabled: !!courseId,
  });

  const { data: generatedContents = [] } = useQuery<GeneratedContent[]>({
    queryKey: ["/api/courses", courseId, "content"],
    enabled: !!courseId,
  });

  if (isLoadingCourse) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!course) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="p-6 text-center">
            <p className="text-muted-foreground">Course not found</p>
            <Button className="mt-4" onClick={() => navigate("/")}>
              Return Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getContentCount = (toolId: string) => {
    return generatedContents.filter(c => c.toolType === toolId).length;
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-gradient-to-r from-primary to-primary/80 text-white py-8 relative">
        <div className="absolute top-4 right-4 z-20">
          <HeaderControls variant="dark" showHome={true} />
        </div>
        <div className="container mx-auto px-4">
          <Button
            variant="ghost"
            className="text-white hover:bg-white/10 mb-4"
            onClick={() => navigate("/")}
            data-testid="button-back-home"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
          
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">{course.courseName}</h1>
              <p className="text-white/80 mt-1">
                {course.courseNumber} • {course.semester} • {course.instructor}
              </p>
            </div>
            <Button
              variant="outline"
              className="bg-white/10 border-white/20 text-white hover:bg-white/20 w-fit"
              onClick={() => navigate(`/course/${courseId}/edit`)}
              data-testid="button-edit-course"
            >
              Edit Course Info
            </Button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-2">Select a Design Tool</h2>
          <p className="text-muted-foreground">
            Choose a tool to create or enhance course materials for your class
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((tool, index) => {
            const Icon = iconMap[tool.icon];
            const bgColor = colorMap[tool.color];
            const contentCount = getContentCount(tool.id);

            return (
              <Card
                key={tool.id}
                className="group cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-lg animate-fade-in-up"
                style={{ animationDelay: `${index * 50}ms` }}
                onClick={() => navigate(`/course/${courseId}/tool/${tool.id}`)}
                data-testid={`card-tool-${tool.id}`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className={`w-12 h-12 rounded-xl ${bgColor} flex items-center justify-center text-white group-hover:scale-110 transition-transform`}>
                      <Icon className="w-6 h-6" />
                    </div>
                    {contentCount > 0 && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full">
                        <FolderOpen className="w-3 h-3" />
                        {contentCount} saved
                      </div>
                    )}
                  </div>
                  <CardTitle className="text-lg mt-3 group-hover:text-primary transition-colors">
                    {tool.name}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-sm leading-relaxed">
                    {tool.description}
                  </CardDescription>
                  <Button variant="ghost" className="mt-4 p-0 h-auto text-primary font-medium group-hover:gap-2 transition-all">
                    Get Started <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {generatedContents.filter(c => c.isApproved).length > 0 && (
          <div className="mt-12">
            <div className="flex items-center gap-2 mb-4">
              <Link2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              <h3 className="text-xl font-bold">Connected Course Materials</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              These materials will inform other tools when generating new content for this course.
            </p>
            <div className="space-y-3">
              {generatedContents.filter(c => c.isApproved).map((content) => {
                const tool = TOOLS.find(t => t.id === content.toolType);
                const Icon = tool ? iconMap[tool.icon] : FileText;
                
                return (
                  <Card
                    key={content.id}
                    className="cursor-pointer hover-elevate active-elevate-2 border-blue-200 dark:border-blue-800"
                    onClick={() => navigate(`/course/${courseId}/result/${content.id}`)}
                    data-testid={`card-connected-${content.id}`}
                  >
                    <CardContent className="flex items-center gap-4 p-4">
                      <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                        <Icon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{content.toolName}</p>
                        <p className="text-sm text-muted-foreground">
                          Created {new Date(content.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <Link2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {generatedContents.length > 0 && (
          <div className="mt-12">
            <h3 className="text-xl font-bold mb-4">Previously Generated Content</h3>
            <div className="space-y-3">
              {generatedContents.slice(0, 5).map((content) => {
                const tool = TOOLS.find(t => t.id === content.toolType);
                const Icon = tool ? iconMap[tool.icon] : FileText;
                
                return (
                  <Card
                    key={content.id}
                    className="cursor-pointer hover-elevate active-elevate-2"
                    onClick={() => navigate(`/course/${courseId}/result/${content.id}`)}
                    data-testid={`card-content-${content.id}`}
                  >
                    <CardContent className="flex items-center gap-4 p-4">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Icon className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium truncate">{content.toolName}</p>
                          {content.isApproved && (
                            <Link2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Created {new Date(content.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground" />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-12 pt-8 border-t">
          <div className="flex flex-wrap justify-center gap-4">
            <Button
              variant="outline"
              onClick={() => navigate(`/help?from=/course/${courseId}/tools`)}
              data-testid="button-help"
            >
              <HelpCircle className="w-4 h-4 mr-2" />
              Help & Tips
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate(`/research?from=/course/${courseId}/tools`)}
              data-testid="button-research"
            >
              <GraduationCap className="w-4 h-4 mr-2" />
              Research & Theory
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate(`/library?from=/course/${courseId}/tools`)}
              data-testid="button-library"
            >
              <Library className="w-4 h-4 mr-2" />
              Template Library
            </Button>
          </div>
        </div>
      </div>
      <PoweredByFooter />
    </div>
  );
}

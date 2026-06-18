import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Loader2, Sparkles, BookOpen, Calendar, FileText, Layout, CheckCircle, Target, Scale, ShieldCheck, Eye, Bot } from "lucide-react";
import { TOOLS, BSU_CALENDAR, LOADING_MESSAGES, COURSE_LEVELS } from "@/lib/constants";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PoweredByFooter } from "@/components/powered-by-footer";
import { HeaderControls } from "@/components/header-controls";
import type { Course } from "@shared/schema";
import { UdlTips } from "@/components/udl-tips";
import { AccessibilityTips } from "@/components/accessibility-tips";
import { usePageTitle } from "@/hooks/use-page-title";
import { useQuickToolContext } from "@/hooks/use-quick-tool-context";

interface ToolFormField {
  name: string;
  label: string;
  type: "text" | "textarea" | "select" | "checkbox-group" | "date" | "number";
  options?: string[];
  placeholder?: string;
  required?: boolean;
  helper?: string;
}

const getFormFields = (toolId: string): ToolFormField[] => {
  const fields: Record<string, ToolFormField[]> = {
    assignment: [
      { name: "assignmentType", label: "Assignment Type", type: "select", options: ["Essay/Paper", "Research Project", "Problem Set", "Lab Report", "Presentation", "Discussion", "Creative Project", "Case Study"], required: true },
      { name: "learningObjectives", label: "Key Learning Objectives", type: "textarea", placeholder: "What should students learn from this assignment?", required: true },
      { name: "duration", label: "Estimated Time to Complete", type: "select", options: ["1 hour (single class activity)", "2 hours", "3 hours", "4 hours", "5 hours", "1 week", "2 weeks", "3 weeks", "4 weeks", "Semester-long project"], required: true },
      { name: "inclusiveDesignOptions", label: "Inclusive Design Frameworks to Include", type: "checkbox-group", options: [
        "UDL (Universal Design for Learning)",
        "Cultural Relevance & Inclusivity",
        "SEL (Social-Emotional Learning)",
        "Accessibility Features",
        "AI-Powered Student Activities",
      ], helper: "Select which research-based frameworks to incorporate. Each framework adds specific guidance grounded in educational theory." },
      { name: "additionalContext", label: "Additional Context", type: "textarea", placeholder: "Any specific requirements, constraints, or preferences?" },
    ],
    rubric: [
      { name: "assessmentType", label: "What are you assessing?", type: "text", placeholder: "e.g., Research paper, presentation", required: true },
      { name: "totalPoints", label: "Total Points", type: "number", placeholder: "e.g., 100", required: true },
      { name: "criteria", label: "Key Evaluation Criteria", type: "textarea", placeholder: "What aspects should be evaluated?", required: true },
      { name: "levels", label: "Performance Levels", type: "select", options: ["3 levels", "4 levels", "5 levels"], required: true },
      { name: "additionalContext", label: "Additional Context", type: "textarea", placeholder: "Any specific requirements?" },
    ],
    module: [
      { name: "moduleTitle", label: "Module Title/Topic", type: "text", required: true },
      { name: "moduleDuration", label: "Module Duration", type: "select", options: ["1 week", "2 weeks", "3 weeks", "4 weeks"], required: true },
      { name: "learningOutcomes", label: "Learning Outcomes", type: "textarea", placeholder: "What should students be able to do after this module?", required: true },
      { name: "additionalContext", label: "Additional Context", type: "textarea", placeholder: "Any required readings, activities, or constraints?" },
    ],
    syllabus: [
      { name: "revisionGoals", label: "What would you like to enhance?", type: "checkbox-group", options: [
        "Add Universal Design for Learning (UDL) principles",
        "Incorporate cultural relevance and inclusivity",
        "Modernize pedagogy and teaching approaches",
        "Improve clarity and student-friendliness",
        "Add or revise assessment strategies",
        "Update course policies",
        "Enhance accessibility features",
      ], required: true },
      { name: "currentSyllabusText", label: "Current Syllabus Content", type: "textarea", placeholder: "Paste your current syllabus here (or add to what you provided in Course Info)...", helper: "If you already pasted your syllabus in the Course Info section, you can skip this or add additional content here." },
      { name: "specificConcerns", label: "Specific Areas of Concern", type: "textarea", placeholder: "Are there specific sections you want to focus on?" },
      { name: "additionalContext", label: "Additional Context", type: "textarea", placeholder: "Any other information?" },
    ],
    schedule: [
      { name: "startDate", label: "Course Start Date", type: "date", required: true },
      { name: "endDate", label: "Course End Date", type: "date", required: true },
      { name: "courseFormat", label: "Course Format", type: "select", options: ["Weekly (Traditional Semester)", "Bi-Weekly", "Module-Based", "Accelerated (8-week)"], required: true },
      { name: "numberOfWeeks", label: "Number of Weeks", type: "select", options: ["4", "5", "8", "10", "12", "14", "15", "16"], required: true },
      { name: "meetingPattern", label: "Meeting Pattern", type: "select", options: ["Once per week", "Twice per week", "Three times per week", "Online asynchronous", "Hybrid"], required: true },
      { name: "meetingDays", label: "Meeting Days (if applicable)", type: "text", placeholder: "e.g., Monday/Wednesday" },
      { name: "majorTopics", label: "Major Topics to Cover", type: "textarea", placeholder: "List the main topics or units...", required: true },
      { name: "assessments", label: "Major Assessments", type: "textarea", placeholder: "List key assessments and their timing...", required: true },
      { name: "additionalContext", label: "Additional Context", type: "textarea", placeholder: "Any other constraints?" },
    ],
    aipolicy: [
      { name: "aiStance", label: "Your General Stance on AI Use", type: "select", options: [
        "AI use prohibited entirely",
        "AI use prohibited for most work, allowed for specific tasks",
        "AI use allowed with restrictions and disclosure",
        "AI use encouraged as a learning tool",
        "Varies by assignment - need a matrix",
      ], required: true },
      { name: "aiTools", label: "Which AI Tools Are You Addressing?", type: "checkbox-group", options: [
        "ChatGPT / Claude / other chatbots",
        "AI writing assistants (Grammarly AI, etc.)",
        "AI image generators (DALL-E, Midjourney)",
        "AI coding assistants (GitHub Copilot)",
        "AI research tools (Elicit, Consensus)",
        "AI translation tools",
        "Other AI tools",
      ], required: true },
      { name: "keyAssignments", label: "Key Assignments to Address", type: "textarea", placeholder: "List your major assignments (e.g., research paper, presentations, problem sets, discussions)...", required: true },
      { name: "concerns", label: "Your Primary Concerns", type: "checkbox-group", options: [
        "Academic integrity",
        "Students missing learning opportunities",
        "Equity (not all students have equal access)",
        "Accuracy/hallucinations in AI output",
        "Students not developing critical skills",
        "Citation and plagiarism issues",
        "Preparing students for AI-enabled workplaces",
      ], required: true },
      { name: "additionalContext", label: "Additional Context", type: "textarea", placeholder: "Any specific situations or concerns you want addressed?" },
    ],
    alignment: [
      { name: "learningOutcomes", label: "Course Learning Outcomes", type: "textarea", placeholder: "List all your course learning outcomes (copy from syllabus or Course Info)...", required: true, helper: "Tip: Copy these from your syllabus for accuracy" },
      { name: "assignments", label: "Assignments and Assessments", type: "textarea", placeholder: 'List all assignments with brief descriptions (e.g., "Research Paper - 20% - Students analyze a historical event")...', required: true },
      { name: "checkType", label: "What Would You Like to Check?", type: "checkbox-group", options: [
        "Which outcomes each assignment addresses",
        "Gaps - outcomes not assessed by any assignment",
        "Overlaps - outcomes assessed multiple times",
        "Suggestions for better alignment",
        "Bloom's taxonomy level analysis",
      ], required: true },
      { name: "additionalContext", label: "Additional Context", type: "textarea", placeholder: "Any specific concerns about alignment?" },
    ],
    grading: [
      { name: "currentGradingApproach", label: "Current Grading Approach", type: "textarea", placeholder: "Describe your current grading system (categories, weights, late policies, etc.)...", helper: "Include any existing policies you want to reconsider or keep" },
      { name: "gradingPhilosophy", label: "Your Grading Philosophy Goals", type: "checkbox-group", options: [
        "Focus on content mastery over compliance",
        "Reduce impact of late penalties on final grades",
        "Allow revision and resubmission opportunities",
        "Use standards-based or specifications grading",
        "Eliminate or reduce participation/attendance grades",
        "Create more transparent grading criteria",
        "Reduce grade anxiety and promote learning",
      ], required: true },
      { name: "assessmentTypes", label: "Types of Assessments in Your Course", type: "checkbox-group", options: [
        "Exams/Quizzes",
        "Papers/Essays",
        "Projects",
        "Presentations",
        "Discussions/Participation",
        "Labs/Practicals",
        "Homework/Problem Sets",
        "Portfolios",
        "Reflections/Journals",
      ], required: true },
      { name: "challenges", label: "Current Grading Challenges", type: "checkbox-group", options: [
        "Students focus on points rather than learning",
        "Late work management is burdensome",
        "Grading feels subjective or inconsistent",
        "Participation grades seem unfair",
        "Students don't engage with feedback",
        "Grade distribution doesn't reflect learning",
        "Students with life challenges are penalized",
      ] },
      { name: "constraints", label: "Constraints to Consider", type: "textarea", placeholder: "Any departmental requirements, accreditation standards, or other constraints?" },
      { name: "additionalContext", label: "Additional Context", type: "textarea", placeholder: "Any other information about your course or students?" },
    ],
    airesistant: [
      { name: "existingAssignment", label: "Paste Your Current Assignment", type: "textarea", placeholder: "Copy and paste your existing assignment instructions here...", required: true, helper: "Include the full assignment prompt, instructions, and any rubric details" },
      { name: "assignmentType", label: "Assignment Type", type: "select", options: ["Essay/Paper", "Research Project", "Discussion Post", "Problem Set", "Lab Report", "Presentation", "Creative Project", "Case Study", "Exam/Quiz", "Other"], required: true },
      { name: "whatYouWant", label: "What Would You Like?", type: "checkbox-group", options: [
        "Vulnerability analysis - how easily can AI complete this?",
        "Specific enhancement recommendations",
        "Revised assignment with AI-resistant features",
        "Alternative assessment options",
        "Detection strategies for AI-generated work",
      ], required: true },
      { name: "constraints", label: "Constraints to Keep in Mind", type: "checkbox-group", options: [
        "Must remain a written assignment",
        "Limited class time available",
        "Large enrollment course",
        "Online/asynchronous delivery",
        "Students have varied access to technology",
        "Departmental requirements for format",
      ] },
      { name: "additionalContext", label: "Additional Context", type: "textarea", placeholder: "Any other information about your course, students, or concerns?" },
    ],
    accessibility: [
      { name: "contentToAnalyze", label: "Paste Your Assignment or Course Content", type: "textarea", placeholder: "Copy and paste the assignment instructions, syllabus section, or course materials you want to analyze for accessibility...", required: true, helper: "Include as much detail as possible for a comprehensive analysis" },
      { name: "contentType", label: "Content Type", type: "select", options: ["Assignment Instructions", "Syllabus Section", "Discussion Prompt", "Quiz/Exam", "Learning Module", "Course Materials/Readings", "Rubric", "Other"], required: true },
      { name: "analysisAreas", label: "Areas to Analyze", type: "checkbox-group", options: [
        "Document structure and readability",
        "Cognitive load and complexity",
        "Time and pacing considerations",
        "Alternative format options",
        "Assistive technology compatibility",
        "UDL alignment check",
        "Language clarity and simplicity",
      ], required: true },
      { name: "studentPopulation", label: "Student Population Considerations", type: "checkbox-group", options: [
        "Students with visual impairments",
        "Students with hearing impairments",
        "Students with learning disabilities",
        "English language learners",
        "Students with attention/executive function challenges",
        "Students with physical/motor disabilities",
        "Neurodiverse students",
      ], helper: "Select specific populations to tailor recommendations" },
      { name: "additionalContext", label: "Additional Context", type: "textarea", placeholder: "Any specific accessibility concerns or accommodations you're already aware of?" },
    ],
    aistudent: [
      { name: "activityType", label: "AI Activity Type", type: "select", options: [
        "AI Debate / Socratic Dialogue",
        "AI-Assisted Drafting & Revision",
        "AI as Research Assistant",
        "AI Code Review / Pair Programming",
        "AI-Generated Content Analysis",
        "AI Tutoring / Study Partner",
        "AI Data Analysis",
        "Custom AI Activity",
      ], required: true },
      { name: "learningObjectives", label: "Key Learning Objectives", type: "textarea", placeholder: "What should students learn from this activity?", required: true },
      { name: "aiToolRecommendation", label: "Recommended AI Tool", type: "select", options: [
        "Claude",
        "ChatGPT",
        "Any AI Assistant",
        "Multiple AI Tools (comparison activity)",
      ], required: true },
      { name: "studentLevel", label: "Student AI Experience Level", type: "select", options: [
        "Beginner (first time using AI)",
        "Intermediate (some AI experience)",
        "Advanced (regular AI users)",
      ], required: true },
      { name: "criticalThinkingFocus", label: "Critical Thinking Focus Areas", type: "checkbox-group", options: [
        "Evaluating AI output accuracy",
        "Identifying AI bias and limitations",
        "Comparing AI vs. human approaches",
        "Prompt engineering skills",
        "Ethical considerations of AI use",
      ], required: true, helper: "Select which critical thinking skills students should develop through this activity." },
      { name: "guardrails", label: "Activity Guardrails", type: "checkbox-group", options: [
        "Require AI interaction logs/screenshots",
        "Reflection component required",
        "Human revision required after AI use",
        "Peer review of AI-assisted work",
        "Citation of AI contributions",
      ], helper: "Select safeguards to ensure meaningful student engagement with the AI tool." },
      { name: "additionalContext", label: "Additional Context", type: "textarea", placeholder: "Any specific requirements, constraints, or preferences for the activity?" },
    ],
  };

  return fields[toolId] || [];
};

const toolIconMap: Record<string, any> = {
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
  Bot,
};

export default function ToolForm() {
  const params = useParams();
  const courseId = params.id ? parseInt(params.id) : undefined;
  const toolId = params.toolId;
  const [location, navigate] = useLocation();
  const { toast } = useToast();

  const isStandalone = location.startsWith("/quick-tools");

  const { subject: savedSubject, courseLevel: savedCourseLevel, setSubject: persistSubject, setCourseLevel: persistCourseLevel, clearContext } = useQuickToolContext();

  const [formData, setFormData] = useState<Record<string, any>>(() =>
    isStandalone
      ? { subject: savedSubject, courseLevel: savedCourseLevel }
      : {}
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");

  const tool = TOOLS.find(t => t.id === toolId);

  usePageTitle(tool ? tool.name : "Tool");

  // Scroll to top when component mounts
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [toolId]);
  const formFields = getFormFields(toolId || "");

  const { data: course } = useQuery<Course>({
    queryKey: ["/api/courses", courseId],
    enabled: !!courseId && !isStandalone,
  });

  // Auto-fill schedule dates when semester is known
  useEffect(() => {
    if (toolId === "schedule" && course?.semester && BSU_CALENDAR[course.semester]) {
      const calendar = BSU_CALENDAR[course.semester];
      setFormData(prev => ({
        ...prev,
        startDate: prev.startDate || calendar.startDate,
        endDate: prev.endDate || calendar.endDate,
      }));
    }
  }, [toolId, course?.semester]);

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (isStandalone) {
        const response = await apiRequest("POST", "/api/generate-standalone", {
          toolId,
          toolName: tool?.name,
          formData,
        });
        return response.json();
      }
      const response = await apiRequest("POST", `/api/courses/${courseId}/generate`, {
        toolId,
        toolName: tool?.name,
        formData,
      });
      return response.json();
    },
    onSuccess: (data) => {
      if (isStandalone) {
        if (data.id) {
          navigate(`/quick-tools/result/${data.id}`);
        } else {
          queryClient.setQueryData(["/api/standalone-content", "anon"], data);
          navigate(`/quick-tools/result/anon`);
        }
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/courses", courseId, "content"] });
        navigate(`/course/${courseId}/result/${data.id}`);
      }
    },
    onError: (error) => {
      toast({ title: "Generation failed", description: error.message, variant: "destructive" });
      setIsGenerating(false);
    },
  });

  useEffect(() => {
    if (isGenerating) {
      let index = 0;
      setLoadingMessage(LOADING_MESSAGES[0]);
      const interval = setInterval(() => {
        index = (index + 1) % LOADING_MESSAGES.length;
        setLoadingMessage(LOADING_MESSAGES[index]);
      }, 2500);
      return () => clearInterval(interval);
    }
  }, [isGenerating]);

  const handleInputChange = (name: string, value: any) => {
    setFormData(prev => ({ ...prev, [name]: value }));
    if (isStandalone) {
      if (name === "subject") persistSubject(value);
      if (name === "courseLevel") persistCourseLevel(value);
    }
  };

  const handleCheckboxChange = (name: string, option: string, checked: boolean) => {
    setFormData(prev => {
      const current = prev[name] || [];
      if (checked) {
        return { ...prev, [name]: [...current, option] };
      } else {
        return { ...prev, [name]: current.filter((o: string) => o !== option) };
      }
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Basic validation
    for (const field of formFields) {
      if (field.required) {
        const value = formData[field.name];
        if (!value || (Array.isArray(value) && value.length === 0)) {
          toast({ title: `${field.label} is required`, variant: "destructive" });
          document.getElementById(field.name)?.focus();
          return;
        }
      }
    }

    setIsGenerating(true);
    generateMutation.mutate();
  };

  const backPath = isStandalone ? "/quick-tools" : `/course/${courseId}/tools`;

  if (!tool) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen flex flex-col bg-background">
        <div className="flex-1 flex items-center justify-center">
          <Card className="max-w-md">
            <CardContent className="p-6 text-center">
              <p className="text-muted-foreground">Tool not found</p>
              <Button className="mt-4" onClick={() => navigate(backPath)}>
                Return to Tools
              </Button>
            </CardContent>
          </Card>
        </div>
        <PoweredByFooter />
      </main>
    );
  }

  if (isGenerating) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen flex flex-col bg-gradient-to-br from-primary/5 to-accent/5">
        <div className="flex-1 flex items-center justify-center">
          <Card className="max-w-lg w-full mx-4">
            <CardContent className="p-12 text-center" role="status" aria-live="polite">
              <div className="w-20 h-20 mx-auto mb-8 relative">
                <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping" />
                <div className="relative w-full h-full bg-primary rounded-full flex items-center justify-center">
                  <Sparkles className="w-10 h-10 text-white animate-pulse" aria-hidden="true" />
                </div>
              </div>
              <h2 className="text-2xl font-bold mb-4">Generating Your {tool.name}</h2>
              <p className="text-muted-foreground mb-6 animate-pulse-subtle">
                {loadingMessage}
              </p>
              <div className="flex justify-center gap-1" aria-hidden="true">
                {[0, 1, 2].map(i => (
                  <div
                    key={i}
                    className="w-2 h-2 bg-primary rounded-full animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
        <PoweredByFooter />
      </main>
    );
  }

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate(backPath)}
                aria-label="Back to tools"
                data-testid="button-back-tools"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  {(() => { const ToolIcon = toolIconMap[tool.icon] || Sparkles; return <ToolIcon className="w-5 h-5 text-primary" />; })()}
                </div>
                <div>
                  <h1 className="text-xl font-bold">{tool.name}</h1>
                  <p className="text-sm text-muted-foreground">{tool.description}</p>
                </div>
              </div>
            </div>
            <HeaderControls variant="light" showHome={true} />
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto space-y-6">
          {course && !isStandalone && (
            <Card className="bg-muted/30">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">
                  Creating for: <span className="font-medium text-foreground">{course.courseName}</span> ({course.courseNumber})
                </p>
              </CardContent>
            </Card>
          )}

          {isStandalone && (
            <Card className="bg-muted/30">
              <CardHeader className="pb-3 pt-4 px-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <CardTitle className="text-sm font-medium text-muted-foreground">Course Context (Optional)</CardTitle>
                    <CardDescription className="text-xs">Adding subject and level helps generate more tailored content</CardDescription>
                  </div>
                  {(formData.subject || formData.courseLevel) && (
                    <button
                      type="button"
                      onClick={() => {
                        clearContext();
                        setFormData(prev => ({ ...prev, subject: "", courseLevel: "" }));
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                      data-testid="button-clear-context"
                    >
                      Clear saved context
                    </button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0 grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="standalone-subject" className="text-sm">Subject / Department</Label>
                  <Input
                    id="standalone-subject"
                    placeholder="e.g., Psychology, Biology"
                    value={formData.subject || ""}
                    onChange={(e) => handleInputChange("subject", e.target.value)}
                    data-testid="input-standalone-subject"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="standalone-level" className="text-sm">Course Level</Label>
                  <Select
                    value={formData.courseLevel || ""}
                    onValueChange={(value) => handleInputChange("courseLevel", value)}
                  >
                    <SelectTrigger id="standalone-level" data-testid="select-standalone-level">
                      <SelectValue placeholder="Select level" />
                    </SelectTrigger>
                    <SelectContent>
                      {COURSE_LEVELS.map(level => (
                        <SelectItem key={level} value={level}>{level}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          )}

          {toolId && toolId !== "accessibility" && <UdlTips toolId={toolId} />}
          {toolId === "accessibility" && <AccessibilityTips />}

          <Card>
            <CardHeader>
              <CardTitle>Tool Configuration</CardTitle>
              <CardDescription>Customize your {tool.name.toLowerCase()}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {formFields.map((field) => (
                <div key={field.name} className="space-y-2">
                  <Label htmlFor={field.name}>
                    {field.label}
                    {field.required && <span className="text-destructive ml-1">*</span>}
                  </Label>
                  
                  {field.type === "text" && (
                    <Input
                      id={field.name}
                      placeholder={field.placeholder}
                      value={formData[field.name] || ""}
                      onChange={(e) => handleInputChange(field.name, e.target.value)}
                      aria-required={field.required ? "true" : undefined}
                      data-testid={`input-${field.name}`}
                    />
                  )}

                  {field.type === "number" && (
                    <Input
                      id={field.name}
                      type="number"
                      placeholder={field.placeholder}
                      value={formData[field.name] || ""}
                      onChange={(e) => handleInputChange(field.name, e.target.value)}
                      aria-required={field.required ? "true" : undefined}
                      data-testid={`input-${field.name}`}
                    />
                  )}

                  {field.type === "date" && (
                    <Input
                      id={field.name}
                      type="date"
                      value={formData[field.name] || ""}
                      onChange={(e) => handleInputChange(field.name, e.target.value)}
                      aria-required={field.required ? "true" : undefined}
                      data-testid={`input-${field.name}`}
                    />
                  )}

                  {field.type === "textarea" && (
                    <Textarea
                      id={field.name}
                      placeholder={field.placeholder}
                      value={formData[field.name] || ""}
                      onChange={(e) => handleInputChange(field.name, e.target.value)}
                      className="min-h-28"
                      aria-required={field.required ? "true" : undefined}
                      data-testid={`textarea-${field.name}`}
                    />
                  )}

                  {field.type === "select" && field.options && (
                    <Select
                      value={formData[field.name] || ""}
                      onValueChange={(value) => handleInputChange(field.name, value)}
                    >
                      <SelectTrigger data-testid={`select-${field.name}`} aria-required={field.required ? "true" : undefined}>
                        <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
                      </SelectTrigger>
                      <SelectContent>
                        {field.options.map((option) => (
                          <SelectItem key={option} value={option}>{option}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  {field.type === "checkbox-group" && field.options && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {field.options.map((option) => (
                        <div key={option} className="flex items-start gap-3">
                          <Checkbox
                            id={`${field.name}-${option}`}
                            checked={(formData[field.name] || []).includes(option)}
                            onCheckedChange={(checked) => handleCheckboxChange(field.name, option, !!checked)}
                            data-testid={`checkbox-${field.name}-${option.slice(0, 20)}`}
                          />
                          <Label
                            htmlFor={`${field.name}-${option}`}
                            className="text-sm font-normal leading-tight cursor-pointer"
                          >
                            {option}
                          </Label>
                        </div>
                      ))}
                    </div>
                  )}

                  {field.helper && (
                    <p className="text-sm text-muted-foreground">{field.helper}</p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="flex justify-end gap-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate(backPath)}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
            <Button type="submit" className="gap-2" data-testid="button-generate">
              <Sparkles className="w-4 h-4" />
              Generate {tool.name}
            </Button>
          </div>
        </form>
      </div>
      <PoweredByFooter />
    </main>
  );
}

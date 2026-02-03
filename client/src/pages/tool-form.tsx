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
import { ArrowLeft, Loader2, Sparkles } from "lucide-react";
import { TOOLS, BSU_CALENDAR, LOADING_MESSAGES } from "@/lib/constants";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Course } from "@shared/schema";

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
      { name: "duration", label: "Time to Complete", type: "text", placeholder: "e.g., 2 weeks, 1 week" },
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
  };

  return fields[toolId] || [];
};

export default function ToolForm() {
  const params = useParams();
  const courseId = params.id ? parseInt(params.id) : undefined;
  const toolId = params.toolId;
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [formData, setFormData] = useState<Record<string, any>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");

  const tool = TOOLS.find(t => t.id === toolId);
  const formFields = getFormFields(toolId || "");

  const { data: course } = useQuery<Course>({
    queryKey: ["/api/courses", courseId],
    enabled: !!courseId,
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
      const response = await apiRequest("POST", `/api/courses/${courseId}/generate`, {
        toolId,
        toolName: tool?.name,
        formData,
      });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/courses", courseId, "content"] });
      navigate(`/course/${courseId}/result/${data.id}`);
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
          return;
        }
      }
    }

    setIsGenerating(true);
    generateMutation.mutate();
  };

  if (!tool) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="p-6 text-center">
            <p className="text-muted-foreground">Tool not found</p>
            <Button className="mt-4" onClick={() => navigate(`/course/${courseId}/tools`)}>
              Return to Tools
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isGenerating) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 to-accent/5 flex items-center justify-center">
        <Card className="max-w-lg w-full mx-4">
          <CardContent className="p-12 text-center">
            <div className="w-20 h-20 mx-auto mb-8 relative">
              <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping" />
              <div className="relative w-full h-full bg-primary rounded-full flex items-center justify-center">
                <Sparkles className="w-10 h-10 text-white animate-pulse" />
              </div>
            </div>
            <h2 className="text-2xl font-bold mb-4">Generating Your {tool.name}</h2>
            <p className="text-muted-foreground mb-6 animate-pulse-subtle">
              {loadingMessage}
            </p>
            <div className="flex justify-center gap-1">
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
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-primary text-white py-6">
        <div className="container mx-auto px-4">
          <Button
            variant="ghost"
            className="text-white hover:bg-white/10 mb-4"
            onClick={() => navigate(`/course/${courseId}/tools`)}
            data-testid="button-back-tools"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Tools
          </Button>
          <h1 className="text-3xl font-bold">{tool.name}</h1>
          <p className="text-white/80 mt-2">{tool.description}</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto space-y-6">
          {course && (
            <Card className="bg-muted/30">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">
                  Creating for: <span className="font-medium text-foreground">{course.courseName}</span> ({course.courseNumber})
                </p>
              </CardContent>
            </Card>
          )}

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
                      data-testid={`input-${field.name}`}
                    />
                  )}

                  {field.type === "date" && (
                    <Input
                      id={field.name}
                      type="date"
                      value={formData[field.name] || ""}
                      onChange={(e) => handleInputChange(field.name, e.target.value)}
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
                      data-testid={`textarea-${field.name}`}
                    />
                  )}

                  {field.type === "select" && field.options && (
                    <Select
                      value={formData[field.name] || ""}
                      onValueChange={(value) => handleInputChange(field.name, value)}
                    >
                      <SelectTrigger data-testid={`select-${field.name}`}>
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
              onClick={() => navigate(`/course/${courseId}/tools`)}
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
    </div>
  );
}

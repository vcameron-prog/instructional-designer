import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { 
  GraduationCap, 
  Sparkles, 
  FileText, 
  CheckCircle, 
  ArrowRight,
  BookOpen,
  Lightbulb
} from "lucide-react";

const WELCOME_SHOWN_KEY = "bsu_id_welcome_shown";

const steps = [
  {
    icon: GraduationCap,
    title: "Welcome to BSU Accessibility Tool",
    description: "This tool helps you create comprehensive, UDL-aligned course materials ready for Blackboard Ultra. Let's take a quick tour!",
  },
  {
    icon: FileText,
    title: "Enter Your Course Information",
    description: "Start by entering your course details - name, number, learning outcomes, and any existing syllabus. This information helps generate tailored content.",
  },
  {
    icon: Sparkles,
    title: "Choose Your Design Tools",
    description: "Select from 7 powerful tools: Syllabus Editor, Schedule Designer, Assignment Design, Module Design, Rubric Builder, AI Policy Generator, and Alignment Checker.",
  },
  {
    icon: BookOpen,
    title: "Universal Design for Learning",
    description: "All generated content incorporates UDL principles - multiple means of engagement, representation, and action/expression - making your course accessible to all learners.",
  },
  {
    icon: Lightbulb,
    title: "Review & Refine",
    description: "Generated content includes accessibility checks. You can copy, download, or refine content until it's perfect. Your work is saved automatically.",
  },
  {
    icon: CheckCircle,
    title: "You're Ready!",
    description: "Your courses and generated materials are saved so you can return anytime. Need help? Look for the help icon throughout the app.",
  },
];

export function WelcomeModal() {
  const [open, setOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    const hasSeenWelcome = localStorage.getItem(WELCOME_SHOWN_KEY);
    if (!hasSeenWelcome) {
      setOpen(true);
    }
  }, []);

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handleComplete = () => {
    localStorage.setItem(WELCOME_SHOWN_KEY, "true");
    setOpen(false);
  };

  const handleSkip = () => {
    localStorage.setItem(WELCOME_SHOWN_KEY, "true");
    setOpen(false);
  };

  const step = steps[currentStep];
  const Icon = step.icon;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-welcome">
        <DialogHeader className="text-center">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
            <Icon className="w-8 h-8 text-primary" />
          </div>
          <DialogTitle className="text-xl">{step.title}</DialogTitle>
          <DialogDescription className="text-base leading-relaxed pt-2">
            {step.description}
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-center gap-1.5 py-4" role="group" aria-label={`Step ${currentStep + 1} of ${steps.length}`}>
          {steps.map((_, index) => (
            <div
              key={index}
              className={`w-2 h-2 rounded-full transition-colors ${
                index === currentStep ? "bg-primary" : "bg-muted"
              }`}
              aria-hidden="true"
            />
          ))}
        </div>
        <p className="sr-only" aria-live="polite">Step {currentStep + 1} of {steps.length}: {steps[currentStep].title}</p>

        <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
          <Button variant="ghost" onClick={handleSkip} data-testid="button-skip-tour">
            Skip Tour
          </Button>
          <Button onClick={handleNext} className="gap-2" data-testid="button-next-step">
            {currentStep < steps.length - 1 ? (
              <>
                Next <ArrowRight className="w-4 h-4" />
              </>
            ) : (
              "Get Started"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function resetWelcome() {
  localStorage.removeItem(WELCOME_SHOWN_KEY);
}

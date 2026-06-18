import { useState, useEffect, useRef } from "react";
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
    title: "Welcome to Accessibility Tool",
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

  const primaryButtonRef = useRef<HTMLButtonElement>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    const hasSeenWelcome = localStorage.getItem(WELCOME_SHOWN_KEY);
    if (!hasSeenWelcome) {
      setOpen(true);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    primaryButtonRef.current?.focus();
  }, [currentStep, open]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      const mainHeading = document.querySelector<HTMLElement>("main h1, h1, main");
      if (mainHeading) {
        mainHeading.setAttribute("tabindex", "-1");
        mainHeading.focus();
        mainHeading.addEventListener(
          "blur",
          () => mainHeading.removeAttribute("tabindex"),
          { once: true }
        );
      }
    }
  };

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handleComplete = () => {
    localStorage.setItem(WELCOME_SHOWN_KEY, "true");
    handleOpenChange(false);
  };

  const handleSkip = () => {
    localStorage.setItem(WELCOME_SHOWN_KEY, "true");
    handleOpenChange(false);
  };

  const step = steps[currentStep];
  const Icon = step.icon;
  const isLastStep = currentStep === steps.length - 1;

  const primaryButtonLabel = isLastStep
    ? "Get Started — close the welcome tour"
    : `Next — go to step ${currentStep + 2} of ${steps.length}, ${steps[currentStep + 1].title}`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-welcome">
        <DialogHeader className="text-center">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
            <Icon className="w-8 h-8 text-primary" aria-hidden="true" />
          </div>
          <DialogTitle className="text-xl">{step.title}</DialogTitle>
          <DialogDescription className="text-base leading-relaxed pt-2">
            {step.description}
          </DialogDescription>
        </DialogHeader>

        <div
          className="flex justify-center gap-1.5 py-4"
          role="img"
          aria-label={`Step ${currentStep + 1} of ${steps.length}`}
        >
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
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          Step {currentStep + 1} of {steps.length}: {steps[currentStep].title}
        </p>

        <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
          <Button
            variant="ghost"
            onClick={handleSkip}
            data-testid="button-skip-tour"
            aria-label="Skip tour and close this dialog"
          >
            Skip Tour
          </Button>
          <Button
            ref={primaryButtonRef}
            onClick={handleNext}
            className="gap-2"
            data-testid="button-next-step"
            aria-label={primaryButtonLabel}
          >
            {!isLastStep ? (
              <>
                Next <ArrowRight className="w-4 h-4" aria-hidden="true" />
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

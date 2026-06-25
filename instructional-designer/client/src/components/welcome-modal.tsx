import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const WELCOME_KEY = "bsu_id_welcome_shown";

const STEPS = [
  {
    title: "Welcome to Instructional Designer",
    description:
      "This tool helps BSU faculty create inclusive, UDL-aligned course materials with AI assistance.",
  },
  {
    title: "Enter Your Course Information",
    description:
      "Start by adding your course details — subject, level, and learning outcomes — so the AI can tailor its suggestions.",
  },
  {
    title: "Choose Your Design Tools",
    description:
      "Select from assignments, rubrics, syllabi, learning modules, and more to generate ready-to-use content.",
  },
  {
    title: "Universal Design for Learning",
    description:
      "All generated content automatically incorporates UDL principles, Cultural Relevance, and SEL frameworks.",
  },
  {
    title: "Review & Refine",
    description:
      "Preview, edit, and refine any generated document. Export to Word or copy directly into your LMS.",
  },
  {
    title: "You're Ready!",
    description:
      "You're all set to start creating accessible course materials. You can reopen this tour any time from the help menu.",
  },
];

const TOTAL_STEPS = STEPS.length;

export function WelcomeModal() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const nextBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const shown = localStorage.getItem(WELCOME_KEY);
    if (!shown) {
      setOpen(true);
    }
  }, []);

  function dismiss() {
    localStorage.setItem(WELCOME_KEY, "true");
    setOpen(false);
  }

  function handleNext() {
    if (step < TOTAL_STEPS - 1) {
      setStep((s) => s + 1);
    } else {
      dismiss();
    }
  }

  useEffect(() => {
    if (open && nextBtnRef.current) {
      nextBtnRef.current.focus();
    }
  }, [step, open]);

  const isLastStep = step === TOTAL_STEPS - 1;
  const nextAriaLabel = isLastStep
    ? "close the welcome tour"
    : `Go to step ${step + 2} of ${TOTAL_STEPS}: ${STEPS[step + 1].title}`;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) dismiss(); }}>
      <DialogContent data-testid="dialog-welcome" className="max-w-lg">
        {/* Accessible live region for screen readers */}
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {`Step ${step + 1} of ${TOTAL_STEPS}: ${STEPS[step].title}`}
        </div>

        {/* Step indicator */}
        <div
          aria-label={`Step ${step + 1} of ${TOTAL_STEPS}: ${STEPS[step].title}`}
          className="flex gap-1.5 justify-center mb-2"
          role="group"
        >
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-2 w-2 rounded-full ${
                i === step ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>

        <DialogHeader>
          <DialogTitle>{STEPS[step].title}</DialogTitle>
          <DialogDescription>{STEPS[step].description}</DialogDescription>
        </DialogHeader>

        <div className="flex justify-between items-center mt-4 gap-2">
          <Button
            variant="ghost"
            data-testid="button-skip-tour"
            onClick={dismiss}
          >
            Skip Tour
          </Button>

          <Button
            data-testid="button-next-step"
            ref={nextBtnRef}
            aria-label={nextAriaLabel}
            onClick={handleNext}
          >
            {isLastStep ? "Get Started" : "Next"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

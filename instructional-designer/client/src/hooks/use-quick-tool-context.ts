import { useState, useCallback } from "react";

const STORAGE_KEY = "bsu-quick-tool-context";

interface QuickToolContext {
  subject: string;
  courseLevel: string;
}

function loadContext(): QuickToolContext {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        subject: typeof parsed.subject === "string" ? parsed.subject : "",
        courseLevel: typeof parsed.courseLevel === "string" ? parsed.courseLevel : "",
      };
    }
  } catch {
  }
  return { subject: "", courseLevel: "" };
}

function saveContext(ctx: QuickToolContext) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
  } catch {
  }
}

export function useQuickToolContext() {
  const [context, setContextState] = useState<QuickToolContext>(loadContext);

  const setSubject = useCallback((subject: string) => {
    setContextState(prev => {
      const next = { ...prev, subject };
      saveContext(next);
      return next;
    });
  }, []);

  const setCourseLevel = useCallback((courseLevel: string) => {
    setContextState(prev => {
      const next = { ...prev, courseLevel };
      saveContext(next);
      return next;
    });
  }, []);

  const clearContext = useCallback(() => {
    const empty: QuickToolContext = { subject: "", courseLevel: "" };
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
    }
    setContextState(empty);
  }, []);

  return {
    subject: context.subject,
    courseLevel: context.courseLevel,
    setSubject,
    setCourseLevel,
    clearContext,
  };
}

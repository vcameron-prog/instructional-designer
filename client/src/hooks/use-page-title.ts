import { useEffect } from "react";

export function usePageTitle(title: string) {
  useEffect(() => {
    const base = "Accessibility Tool";
    document.title = title ? `${title} | ${base}` : base;
    return () => {
      document.title = base;
    };
  }, [title]);
}

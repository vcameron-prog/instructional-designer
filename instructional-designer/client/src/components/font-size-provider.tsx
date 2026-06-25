import { createContext, useContext, useEffect, useState } from "react";

type FontSize = "small" | "medium" | "large" | "xlarge";

interface FontSizeContextType {
  fontSize: FontSize;
  setFontSize: (size: FontSize) => void;
  increaseFontSize: () => void;
  decreaseFontSize: () => void;
}

const fontSizeMap: Record<FontSize, string> = {
  small: "14px",
  medium: "16px",
  large: "18px",
  xlarge: "20px",
};

const fontSizeOrder: FontSize[] = ["small", "medium", "large", "xlarge"];

const FontSizeContext = createContext<FontSizeContextType | undefined>(undefined);

export function FontSizeProvider({ children }: { children: React.ReactNode }) {
  const [fontSize, setFontSize] = useState<FontSize>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("bsu-font-size") as FontSize;
      if (stored && fontSizeOrder.includes(stored)) return stored;
    }
    return "medium";
  });

  useEffect(() => {
    document.documentElement.style.fontSize = fontSizeMap[fontSize];
    localStorage.setItem("bsu-font-size", fontSize);
  }, [fontSize]);

  const increaseFontSize = () => {
    const currentIndex = fontSizeOrder.indexOf(fontSize);
    if (currentIndex < fontSizeOrder.length - 1) {
      setFontSize(fontSizeOrder[currentIndex + 1]);
    }
  };

  const decreaseFontSize = () => {
    const currentIndex = fontSizeOrder.indexOf(fontSize);
    if (currentIndex > 0) {
      setFontSize(fontSizeOrder[currentIndex - 1]);
    }
  };

  return (
    <FontSizeContext.Provider value={{ fontSize, setFontSize, increaseFontSize, decreaseFontSize }}>
      {children}
    </FontSizeContext.Provider>
  );
}

export function useFontSize() {
  const context = useContext(FontSizeContext);
  if (!context) {
    throw new Error("useFontSize must be used within a FontSizeProvider");
  }
  return context;
}

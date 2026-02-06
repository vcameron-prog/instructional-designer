import { Moon, Sun, Minus, Plus, Type, Library, HelpCircle, LogOut, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTheme } from "@/components/theme-provider";
import { useFontSize } from "@/components/font-size-provider";
import { useLocation } from "wouter";

interface HeaderControlsProps {
  variant?: "light" | "dark";
  showHome?: boolean;
  showLibrary?: boolean;
  showHelp?: boolean;
  showLogout?: boolean;
}

export function HeaderControls({
  variant = "light",
  showHome = false,
  showLibrary = true,
  showHelp = true,
  showLogout = true,
}: HeaderControlsProps) {
  const { theme, toggleTheme } = useTheme();
  const { fontSize, increaseFontSize, decreaseFontSize } = useFontSize();
  const [, navigate] = useLocation();

  const isDark = variant === "dark";
  const btnVariant = isDark ? "ghost" : "outline";
  const btnClass = isDark ? "text-white" : "";
  const groupClass = isDark
    ? "flex items-center bg-white/10 rounded-lg"
    : "flex items-center bg-muted/50 rounded-lg";
  const typeClass = isDark ? "w-4 h-4 text-white mx-1" : "w-4 h-4 text-muted-foreground mx-1";
  const fontBtnClass = isDark ? "text-white" : "";

  return (
    <div className="flex items-center gap-1" data-testid="header-controls">
      <div className={groupClass}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={btnVariant}
              size="icon"
              className={fontBtnClass}
              onClick={decreaseFontSize}
              disabled={fontSize === "small"}
              data-testid="button-font-decrease"
              aria-label="Decrease font size"
            >
              <Minus className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent><p>Decrease text size</p></TooltipContent>
        </Tooltip>
        <Type className={typeClass} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={btnVariant}
              size="icon"
              className={fontBtnClass}
              onClick={increaseFontSize}
              disabled={fontSize === "xlarge"}
              data-testid="button-font-increase"
              aria-label="Increase font size"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent><p>Increase text size</p></TooltipContent>
        </Tooltip>
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={btnVariant}
            size="icon"
            className={btnClass}
            onClick={toggleTheme}
            data-testid="button-theme-toggle"
            aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
          >
            {theme === "light" ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{theme === "light" ? "Dark mode (easier on eyes)" : "Light mode"}</p>
        </TooltipContent>
      </Tooltip>

      {showHome && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={btnVariant}
              size="icon"
              className={btnClass}
              onClick={() => navigate("/")}
              data-testid="button-home"
              aria-label="Go to home"
            >
              <Home className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent><p>Home</p></TooltipContent>
        </Tooltip>
      )}

      {showLibrary && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={btnVariant}
              size="icon"
              className={btnClass}
              onClick={() => navigate("/library")}
              data-testid="button-library"
              aria-label="Template library"
            >
              <Library className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent><p>Template Library</p></TooltipContent>
        </Tooltip>
      )}

      {showHelp && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={btnVariant}
              size="icon"
              className={btnClass}
              onClick={() => navigate("/help")}
              data-testid="button-help"
              aria-label="Help & tips"
            >
              <HelpCircle className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent><p>Help & Tips</p></TooltipContent>
        </Tooltip>
      )}

      {showLogout && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={btnVariant}
              size="icon"
              className={btnClass}
              onClick={() => window.location.href = "/api/logout"}
              data-testid="button-logout"
              aria-label="Sign out"
            >
              <LogOut className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent><p>Sign out</p></TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

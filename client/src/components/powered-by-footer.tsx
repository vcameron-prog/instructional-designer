import { Sparkles } from "lucide-react";

export function PoweredByFooter() {
  return (
    <footer className="border-t mt-12 py-6 bg-muted/30" data-testid="footer-powered-by">
      <div className="container mx-auto px-4">
        <p className="text-center text-sm text-muted-foreground flex items-center justify-center gap-2" data-testid="text-powered-by">
          <Sparkles className="w-4 h-4" />
          Powered by AI to help Bridgewater State University faculty create accessible, engaging course materials
        </p>
      </div>
    </footer>
  );
}

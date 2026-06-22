import { Loader2 } from "lucide-react";
import { PoweredByFooter } from "@/components/powered-by-footer";

interface LoadingScreenProps {
  message?: string;
}

export function LoadingScreen({ message }: LoadingScreenProps) {
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen flex flex-col bg-background">
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center" role="status" aria-live="polite">
          <Loader2 className="w-10 h-10 text-primary animate-spin mx-auto mb-4" aria-hidden="true" />
          {message && <p className="text-muted-foreground">{message}</p>}
        </div>
      </div>
      <PoweredByFooter />
    </main>
  );
}

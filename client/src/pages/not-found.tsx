import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, Home } from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";
import { useLocation } from "wouter";

export default function NotFound() {
  usePageTitle("Page Not Found");
  const [, navigate] = useLocation();
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen w-full flex items-center justify-center bg-background">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-destructive" aria-hidden="true" />
            <h1 className="text-2xl font-bold text-foreground">404 Page Not Found</h1>
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            The page you're looking for doesn't exist or has been moved.
          </p>

          <Button
            className="mt-6 gap-2"
            onClick={() => navigate("/")}
            data-testid="button-home"
          >
            <Home className="w-4 h-4" />
            Go Home
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

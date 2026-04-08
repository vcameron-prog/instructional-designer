import { Sparkles, Shield } from "lucide-react";
import bsuAiLogo from "@assets/Center_for_AI_Apparel_&_Promotional_Items-WHITE_(1)_1775653892158.png";

export function PoweredByFooter() {
  return (
    <footer className="mt-12 py-8 bg-[hsl(var(--primary))]" data-testid="footer-powered-by">
      <div className="container mx-auto px-4 space-y-4">
        <div className="flex justify-center">
          <img
            src={bsuAiLogo}
            alt="BSU Center for Artificial Intelligence"
            className="h-12"
            data-testid="img-bsu-ai-logo"
          />
        </div>
        <p className="text-center text-sm text-white/80 flex items-center justify-center gap-2" style={{ textWrap: "balance" }} data-testid="text-powered-by">
          <Sparkles className="w-4 h-4 flex-shrink-0" />
          Powered by AI to help Bridgewater State University faculty create accessible, engaging course materials
        </p>
        <p className="text-center text-xs text-white/60 flex items-center justify-center gap-2" style={{ textWrap: "balance" }} data-testid="text-privacy">
          <Shield className="w-3 h-3 flex-shrink-0" />
          Your course information and generated content are stored securely and are not shared with other users. Content generation uses AI services but your data is not used to train AI models.
        </p>
      </div>
    </footer>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/auth/AuthContext";
import { Sparkles } from "lucide-react";
import { MarketingWorkspace } from "@/components/marketing/MarketingWorkspace";
import "@/components/marketing/marketing-redesign.css";

export const Route = createFileRoute("/marketing")({
  component: MarketingPage,
});

function MarketingPage() {
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  if (!companyId) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Faça login para acessar o Marketing IA.
      </div>
    );
  }

  return (
    <div translate="no" className="notranslate marketing-redesign p-4 md:p-6 w-full min-w-0 max-w-6xl mx-auto space-y-4">
      <header className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-xl font-semibold">Marketing IA</h1>
          <p className="text-xs text-muted-foreground">
            Crie conteúdos, organize seu acervo e publique no Instagram, Facebook e WhatsApp.
          </p>
        </div>
      </header>

      <MarketingWorkspace companyId={companyId} />
    </div>
  );
}

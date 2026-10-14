import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/auth/AuthContext";
import { MarketingWorkspace } from "@/components/marketing/MarketingWorkspace";

export const Route = createFileRoute("/marketing")({ component: MarketingPage });

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
  return <MarketingWorkspace companyId={companyId} />;
}

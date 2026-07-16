import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useAuth } from "@/auth/AuthContext";
import { Sparkles } from "lucide-react";
import { MarketingDashboard } from "@/components/marketing/MarketingDashboard";
import { MarketingLibrary } from "@/components/marketing/MarketingLibrary";
import { MarketingPromotions } from "@/components/marketing/MarketingPromotions";
import { MarketingGenerator } from "@/components/marketing/MarketingGenerator";
import { MarketingApprovals } from "@/components/marketing/MarketingApprovals";
import { MarketingSchedule } from "@/components/marketing/MarketingSchedule";
import { MarketingKnowledgeBase } from "@/components/marketing/MarketingKnowledgeBase";

export const Route = createFileRoute("/marketing")({
  component: MarketingPage,
});

function MarketingPage() {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const [tab, setTab] = useState("dashboard");

  if (!companyId) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Faça login para acessar o Marketing IA.
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <header className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-xl font-semibold">Marketing IA</h1>
          <p className="text-xs text-muted-foreground">
            Organize fotos e vídeos, cadastre promoções e gere conteúdos para Instagram, Facebook e WhatsApp.
          </p>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="library">Biblioteca</TabsTrigger>
          <TabsTrigger value="promotions">Promoções</TabsTrigger>
          <TabsTrigger value="generator">Gerar com IA</TabsTrigger>
          <TabsTrigger value="approvals">Aprovação</TabsTrigger>
          <TabsTrigger value="schedule">Calendário</TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard" className="mt-4">
          <MarketingDashboard companyId={companyId} />
        </TabsContent>
        <TabsContent value="library" className="mt-4">
          <MarketingLibrary companyId={companyId} />
        </TabsContent>
        <TabsContent value="promotions" className="mt-4">
          <MarketingPromotions companyId={companyId} />
        </TabsContent>
        <TabsContent value="generator" className="mt-4">
          <MarketingGenerator companyId={companyId} onGenerated={() => setTab("approvals")} />
        </TabsContent>
        <TabsContent value="approvals" className="mt-4">
          <MarketingApprovals companyId={companyId} />
        </TabsContent>
        <TabsContent value="schedule" className="mt-4">
          <MarketingSchedule companyId={companyId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

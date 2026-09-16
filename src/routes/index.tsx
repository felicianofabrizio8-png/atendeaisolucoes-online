import { createFileRoute } from "@tanstack/react-router";
import { Activity, CalendarDays } from "lucide-react";
import { CustomerOrigins, CommercialSummary } from "@/components/dashboard/DashboardOverview";
import { AICommand } from "@/components/dashboard/AICommand";
import { AttentionPanel, CampaignsPanel, MarketingPanel } from "@/components/dashboard/GrowthPanels";
import { useDashboardData } from "@/components/dashboard/useDashboardData";
import { useAuth } from "@/auth/AuthContext";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    title: "Dashboard | Atende Aí",
    meta: [
      {
        name: "description",
        content: "Acompanhe atendimentos, campanhas, marketing e resultados comerciais no Atende Aí.",
      },
      { property: "og:title", content: "Dashboard | Atende Aí" },
      { property: "og:description", content: "Central de comando de atendimentos, campanhas e resultados comerciais." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function Index() {
  const { profile, company } = useAuth();
  const data = useDashboardData();
  const firstName = profile?.display_name?.trim().split(/\s+/)[0];
  const today = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long" }).format(new Date());

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <header className="mb-6 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-primary">
              <Activity className="h-3.5 w-3.5" /> Central de comando
            </div>
            <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">
              {firstName ? `Olá, ${firstName}` : "Visão geral"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {company?.name ? `${company.name} · ` : ""}Acompanhe o que movimenta sua operação agora.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs capitalize text-muted-foreground sm:justify-end">
            <CalendarDays className="h-4 w-4 text-primary" />{today}
          </div>
        </header>

        <div className="grid grid-cols-12 gap-4">
          <CustomerOrigins data={data} />
          <CommercialSummary data={data} />
          <AICommand data={data} />
          <AttentionPanel data={data} />
          <CampaignsPanel data={data} />
          <MarketingPanel data={data} />
        </div>
      </div>
    </main>
  );
}
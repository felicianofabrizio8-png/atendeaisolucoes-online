import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { AICommand } from "@/components/dashboard/AICommand";
import { CampaignEfficiency } from "@/components/dashboard/CampaignEfficiency";
import { KpiHero, PeriodSwitcher } from "@/components/dashboard/KpiHero";
import { MarketingPanel } from "@/components/dashboard/GrowthPanels";
import {
  ActivityPanel,
  AttentionQueue,
  ChannelMix,
  LossInsights,
} from "@/components/dashboard/OperationPanels";
import { LeadsTrend, RevenueTrend, SalesFunnel } from "@/components/dashboard/PerformancePanels";
import { useDashboardData } from "@/components/dashboard/useDashboardData";
import { useDashboardMetrics, type Periodo } from "@/components/dashboard/useDashboardMetrics";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    title: "Dashboard | Atende Aí",
    meta: [
      {
        name: "description",
        content: "Receita, funil, fila de atendimento e eficiência de campanha em um só lugar.",
      },
      { property: "og:title", content: "Dashboard | Atende Aí" },
      {
        property: "og:description",
        content: "Central de comando de atendimentos, campanhas e resultados comerciais.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const ROTULO: Record<Periodo, string> = {
  semana: "últimos 7 dias",
  mes: "últimos 30 dias",
  ano: "últimos 12 meses",
};

/**
 * Dashboard.
 *
 * A ordem dos painéis é a ordem das perguntas de quem vende, não a ordem em
 * que os dados ficaram disponíveis:
 *
 *   1. Quanto entrou?           KpiHero
 *   2. O que faço agora?        AttentionQueue — ação, não contador
 *   3. Está crescendo?          RevenueTrend / LeadsTrend
 *   4. Onde eu perco?           SalesFunnel / LossInsights
 *   5. De onde vem?             ChannelMix
 *   6. Quanto custa trazer?     CampaignEfficiency
 *   7. Quando eles falam?       ActivityPanel
 *
 * O período vale para a tela inteira. Filtro por card faria cada número
 * responder a uma pergunta diferente ao mesmo tempo — é assim que dashboard
 * vira quebra-cabeça.
 */
function Index() {
  const { profile, company } = useAuth();
  const [periodo, setPeriodo] = useState<Periodo>("mes");

  const data = useDashboardData();
  const m = useDashboardMetrics(data, periodo);

  const primeiroNome = profile?.display_name?.trim().split(/\s+/)[0];
  const hoje = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  }).format(new Date());

  const campanhasComProblema = data.campaigns.filter(
    (c) => c.meta_delivery_status === "issues_on_meta" || c.meta_sync_status === "failed",
  ).length;
  const publicacoesComFalha = data.schedule.filter((s) => s.status === "failed").length;

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {primeiroNome ? `Olá, ${primeiroNome}` : "Visão geral"}
            </h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate capitalize">
                {company?.name ? `${company.name} · ` : ""}
                {hoje}
              </span>
            </p>
          </div>
          <PeriodSwitcher value={periodo} onChange={setPeriodo} />
        </header>

        <div className="space-y-4">
          <KpiHero
            receita={m.receita}
            pipeline={m.pipeline}
            pipelineQuentes={m.pipelineQuentes}
            taxaConversao={m.taxaConversao}
            ticketMedio={m.ticketMedio}
            vendas={m.vendas}
            periodoLabel={ROTULO[periodo]}
            serieReceita={m.serieReceita.map((s) => s.value)}
          />

          <div className="grid grid-cols-12 gap-4">
            <RevenueTrend m={m} periodoLabel={ROTULO[periodo]} />
            <LeadsTrend m={m} periodoLabel={ROTULO[periodo]} />
          </div>

          <div className="grid grid-cols-12 gap-4">
            <AttentionQueue
              m={m}
              campanhasComProblema={campanhasComProblema}
              publicacoesComFalha={publicacoesComFalha}
            />
            <LossInsights m={m} />
            <ChannelMix m={m} />
          </div>

          <div className="grid grid-cols-12 gap-4">
            <SalesFunnel m={m} />
            <CampaignEfficiency data={data} ticketMedio={m.ticketMedio} />
          </div>

          <div className="grid grid-cols-12 gap-4">
            <ActivityPanel m={m} />
            <MarketingPanel data={data} />
          </div>

          <div className="grid grid-cols-12 gap-4">
            <AICommand data={data} />
          </div>
        </div>
      </div>
    </main>
  );
}

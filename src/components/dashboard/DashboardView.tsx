import { useState } from "react";
import { CalendarDays } from "lucide-react";

import { MobileSection, MobileSections, type MobileSectionTab } from "@/components/layout/MobileSections";

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
import type { DashboardData } from "./useDashboardData";
import { useDashboardMetrics, type Periodo } from "@/components/dashboard/useDashboardMetrics";
import "./dashboard.css";
import { DashboardAnalysisContext } from "./charts/ChartExplorer";
import { dashboardContexts } from "./chart-contexts";

const SECOES: MobileSectionTab[] = [
  { id: "agora", label: "Agora" },
  { id: "vendas", label: "Vendas" },
  { id: "marketing", label: "Marketing" },
  { id: "ia", label: "IA" },
];

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
 * O período controla as métricas comerciais. Painéis operacionais e acumulados
 * indicam seu próprio recorte nos respectivos rótulos.
 */
export function DashboardView({
  data,
  displayName,
  companyName,
  simulated = false,
}: {
  data: DashboardData;
  displayName?: string | null;
  companyName?: string | null;
  simulated?: boolean;
}) {
  const [periodo, setPeriodo] = useState<Periodo>("mes");

  const m = useDashboardMetrics(data, periodo);

  const primeiroNome = displayName?.trim().split(/\s+/)[0];
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
    <DashboardAnalysisContext.Provider
      value={{ charts: dashboardContexts(m, data, ROTULO[periodo]), simulated }}
    >
      <main className="lume-dashboard min-h-screen bg-background">
        <div className="mx-auto w-full max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
          <header className="mb-5 flex flex-wrap items-end justify-between gap-3 sm:mb-7 sm:gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                {primeiroNome ? `Olá, ${primeiroNome}` : "Visão geral"}
              </h1>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate capitalize">
                  {companyName ? `${companyName} · ` : ""}
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
            />

            {/* No mobile, os painéis abaixo dos KPIs viram abas: a mesma
                informação, uma pergunta por vez. No desktop as seções somem
                do layout (display: contents) e o grid é o de sempre. */}
            <MobileSections tabs={SECOES} label="Seções do dashboard">
              <div className="m-row grid grid-cols-12 gap-4">
                <MobileSection id="vendas">
                  <RevenueTrend m={m} periodoLabel={ROTULO[periodo]} />
                  <LeadsTrend m={m} periodoLabel={ROTULO[periodo]} />
                </MobileSection>
              </div>

              <div className="m-row grid grid-cols-12 gap-4">
                <MobileSection id="agora">
                  <AttentionQueue
                    m={m}
                    campanhasComProblema={campanhasComProblema}
                    publicacoesComFalha={publicacoesComFalha}
                  />
                </MobileSection>
                <MobileSection id="vendas">
                  <LossInsights m={m} />
                </MobileSection>
                <MobileSection id="marketing">
                  <ChannelMix m={m} />
                </MobileSection>
              </div>

              <div className="m-row grid grid-cols-12 gap-4">
                <MobileSection id="vendas">
                  <SalesFunnel m={m} />
                </MobileSection>
                <MobileSection id="marketing">
                  <CampaignEfficiency data={data} ticketMedio={m.ticketMedio} />
                </MobileSection>
              </div>

              <div className="m-row grid grid-cols-12 gap-4">
                <MobileSection id="agora">
                  <ActivityPanel m={m} />
                </MobileSection>
                <MobileSection id="marketing">
                  <MarketingPanel data={data} />
                </MobileSection>
              </div>

              <div className="m-row grid grid-cols-12 gap-4">
                <MobileSection id="ia">
                  <AICommand data={data} />
                </MobileSection>
              </div>
            </MobileSections>
          </div>
        </div>
      </main>
    </DashboardAnalysisContext.Provider>
  );
}

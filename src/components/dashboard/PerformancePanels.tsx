import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { AreaSpark } from "./charts/AreaSpark";
import { ChartCard, ChartEmpty } from "./charts/ChartCard";
import { ColumnChart } from "./charts/ColumnChart";
import { FunnelChart } from "./charts/FunnelChart";
import { brlCompact, num } from "./charts/primitives";
import type { DashboardMetrics } from "./useDashboardMetrics";

/**
 * Receita ao longo do tempo.
 *
 * Coluna, não linha: cada período é uma quantidade fechada e independente —
 * linha sugere continuidade entre pontos que não têm continuidade nenhuma.
 */
export function RevenueTrend({ m, periodoLabel }: { m: DashboardMetrics; periodoLabel: string }) {
  const temValor = m.serieReceita.some((s) => s.value > 0);
  return (
    <ChartCard
      title="Receita fechada"
      subtitle={`Por período · ${periodoLabel}`}
      className="col-span-12 lg:col-span-7"
      delay="60ms"
    >
      {temValor ? (
        <ColumnChart data={m.serieReceita} format={brlCompact} height={170} />
      ) : (
        <ChartEmpty text="Nenhuma venda fechada no período. Assim que um lead virar cliente, o valor aparece aqui." />
      )}
    </ChartCard>
  );
}

/**
 * Entrada de leads.
 *
 * Aqui a área faz sentido: contato chegando é fluxo contínuo, e o que
 * interessa é a forma da curva, não o valor de cada dia.
 */
export function LeadsTrend({ m, periodoLabel }: { m: DashboardMetrics; periodoLabel: string }) {
  const total = m.serieLeads.reduce((s, x) => s + x.value, 0);
  return (
    <ChartCard
      title="Entrada de leads"
      subtitle={`${num(total)} no período · ${periodoLabel}`}
      className="col-span-12 lg:col-span-5"
      delay="120ms"
    >
      {total > 0 ? (
        <AreaSpark data={m.serieLeads} format={(v) => `${num(v)} leads`} height={170} />
      ) : (
        <ChartEmpty text="Nenhum contato novo no período." />
      )}
    </ChartCard>
  );
}

/**
 * Funil comercial.
 *
 * A pergunta que ele responde não é "quantos leads eu tenho" — é "em que
 * degrau eu perco". Por isso a taxa exibida é a do passo, não a do topo.
 */
export function SalesFunnel({ m }: { m: DashboardMetrics }) {
  const topo = m.funil[0]?.value ?? 0;
  return (
    <ChartCard
      title="Funil comercial"
      subtitle="Onde o cliente para de avançar"
      className="col-span-12 lg:col-span-5"
      delay="180ms"
      action={
        <Link
          to="/relatorios"
          className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          Relatórios <ArrowRight className="h-3 w-3" />
        </Link>
      }
    >
      {topo > 0 ? (
        <FunnelChart stages={m.funil} />
      ) : (
        <ChartEmpty text="Sem leads no período para montar o funil." />
      )}
    </ChartCard>
  );
}

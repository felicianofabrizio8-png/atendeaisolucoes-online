import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { ChartCard, ChartEmpty, ChartDetails } from "./charts/ChartCard";
import { FunnelHeatmap } from "./charts/FunnelHeatmap";
import { GradientHeatmap } from "./charts/GradientHeatmap";
import { TimelineChart } from "./charts/TimelineChart";
import { LeadComparison, StageRibbons } from "./charts/SignatureCharts";
import { brl, brlCompact, num } from "./charts/primitives";
import { CANAIS, type DashboardMetrics } from "./useDashboardMetrics";

export function RevenueTrend({ m, periodoLabel }: { m: DashboardMetrics; periodoLabel: string }) {
  const [channel, setChannel] = useState("total");
  const data = m.serieReceitaCanal.map((s) => ({
    label: s.label,
    fullLabel: s.fullLabel,
    value: channel === "total" ? s.total : (s.porCanal[channel] ?? 0),
  }));
  const total = data.reduce((sum, d) => sum + d.value, 0);
  return (
    <ChartCard
      title="Sua receita, em perspectiva"
      subtitle={`Vendas fechadas · ${periodoLabel}`}
      className="dash-revenue-chart col-span-12 lg:col-span-7"
      analysis={{
        title: "Sua receita, em perspectiva",
        period: periodoLabel,
        notes: `Canal selecionado: ${channel === "total" ? "Todos" : CANAIS.find((c) => c.key === channel)?.label}. Receita de vendas fechadas.`,
        columns: ["Intervalo", "Receita"],
        rows: data.map((d) => [d.fullLabel, brl(d.value)]),
      }}
    >
      <div className="dash-revenue-heading">
        <div>
          <p className="dash-revenue-value">{brl(total)}</p>
          <p className="mt-2 text-xs text-muted-foreground">Receita fechada no período</p>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Canal da receita">
          {[{ key: "total", label: "Todos" }, ...CANAIS].map((c) => (
            <button
              key={c.key}
              className="dash-pill"
              aria-pressed={channel === c.key}
              onClick={() => setChannel(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      {total > 0 ? (
        <div className="dash-revenue-timeline">
          <TimelineChart
            key={channel + periodoLabel}
            data={data}
            format={brlCompact}
            formatValue={brl}
            label="Receita por intervalo"
          />
        </div>
      ) : (
        <ChartEmpty text="Nenhuma venda fechada neste canal e período." />
      )}
    </ChartCard>
  );
}

export function LeadsTrend({ m, periodoLabel }: { m: DashboardMetrics; periodoLabel: string }) {
  const total = m.serieLeads.reduce((s, x) => s + x.value, 0);
  const before = m.serieLeadsAnterior.reduce((s, x) => s + x.value, 0);
  return (
    <ChartCard
      title="Novas oportunidades"
      subtitle={`Entrada de leads · ${periodoLabel}`}
      className="dash-leads-chart col-span-12 lg:col-span-5"
    >
      <div className="mb-5 flex items-baseline gap-3">
        <strong className="text-3xl font-semibold tracking-tight tabular-nums">{num(total)}</strong>
        <span className="text-xs text-muted-foreground">{num(before)} no período anterior</span>
      </div>
      {total > 0 || before > 0 ? (
        <>
          <LeadComparison
            key={periodoLabel}
            current={m.serieLeads}
            previous={m.serieLeadsAnterior}
          />
          <ChartDetails title="Explorar horários de entrada">
            <GradientHeatmap
              valores={m.gradeLeads.valores}
              colunas={m.gradeLeads.colunas}
              colunasCheias={m.gradeLeads.colunasCheias}
              linhas={m.gradeLeads.linhas}
            />
          </ChartDetails>
        </>
      ) : (
        <ChartEmpty text="Nenhum contato novo no período." />
      )}
    </ChartCard>
  );
}

export function SalesFunnel({ m }: { m: DashboardMetrics }) {
  return (
    <ChartCard
      title="O caminho até a venda"
      subtitle="Volumes por etapa no período"
      className="dash-funnel-chart col-span-12 lg:col-span-6"
      action={
        <Link to="/relatorios" className="text-muted-foreground" aria-label="Abrir relatórios">
          <ArrowUpRight size={18} />
        </Link>
      }
    >
      {m.funil.some((s) => s.value > 0) ? (
        <>
          <StageRibbons stages={m.funil} />
          <ChartDetails title="Detalhar etapas por canal">
            <FunnelHeatmap
              celulas={m.matrizFunil.celulas}
              linhas={m.matrizFunil.linhas}
              colunas={m.matrizFunil.colunas}
              etapas={m.funil}
            />
          </ChartDetails>
        </>
      ) : (
        <ChartEmpty text="Sem atividade no período para exibir as etapas." />
      )}
    </ChartCard>
  );
}

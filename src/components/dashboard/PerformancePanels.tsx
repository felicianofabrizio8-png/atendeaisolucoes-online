import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { AreaSpark } from "./charts/AreaSpark";
import { ChartCard, ChartEmpty } from "./charts/ChartCard";
import { FunnelHeatmap } from "./charts/FunnelHeatmap";
import { StreamChart, type StreamBand } from "./charts/StreamChart";
import { brlCompact, num } from "./charts/primitives";
import { CANAIS, type DashboardMetrics } from "./useDashboardMetrics";

/**
 * Faixas do fluxo de receita.
 *
 * Rampa ORDINAL e não a cor de marca de cada canal: a pilha tem ordem fixa e
 * conhecida, e a luminosidade caindo do topo para a base entrega essa ordem
 * sem legenda. Usar verde do WhatsApp contra rosa do Instagram colocaria duas
 * faixas encostadas a ΔE 4,3 em deuteranopia — indistinguíveis exatamente na
 * fronteira que o gráfico existe para mostrar.
 */
const FAIXAS: StreamBand[] = CANAIS.map((c, i) => ({
  key: c.key,
  label: c.label,
  color: `var(--viz-flow-${i})`,
}));

/**
 * Receita ao longo do tempo, quebrada por canal.
 *
 * O total continua sendo a espessura da pilha — o mesmo número que a faixa de
 * KPIs mostra. O que mudou é que agora dá para ver a COMPOSIÇÃO mudar: um mês
 * que cresce porque o WhatsApp dobrou e um mês que cresce porque o Instagram
 * apareceu pedem decisões opostas, e a coluna única tratava os dois igual.
 */
export function RevenueTrend({ m, periodoLabel }: { m: DashboardMetrics; periodoLabel: string }) {
  const temValor = m.serieReceitaCanal.some((s) => s.total > 0);
  return (
    <ChartCard
      title="Receita fechada"
      subtitle={`Composição por canal · ${periodoLabel}`}
      className="col-span-12 lg:col-span-7"
      delay="60ms"
    >
      {temValor ? (
        <StreamChart data={m.serieReceitaCanal} bands={FAIXAS} format={brlCompact} height={210} />
      ) : (
        <ChartEmpty text="Nenhuma venda fechada no período. Assim que um lead virar cliente, o valor aparece aqui." />
      )}
    </ChartCard>
  );
}

/**
 * Entrada de leads, contra o período anterior.
 *
 * Aqui a área faz sentido: contato chegando é fluxo contínuo, e o que
 * interessa é a forma da curva. A tracejada é a mesma janela um período
 * atrás — é ela que transforma "38 leads" em "38 leads, e antes eram 52".
 */
export function LeadsTrend({ m, periodoLabel }: { m: DashboardMetrics; periodoLabel: string }) {
  const total = m.serieLeads.reduce((s, x) => s + x.value, 0);
  const totalAnterior = m.serieLeadsAnterior.reduce((s, x) => s + x.value, 0);
  return (
    <ChartCard
      title="Entrada de leads"
      subtitle={
        totalAnterior > 0
          ? `${num(total)} no período · antes ${num(totalAnterior)}`
          : `${num(total)} no período · ${periodoLabel}`
      }
      className="col-span-12 lg:col-span-5"
      delay="120ms"
    >
      {total > 0 ? (
        <AreaSpark
          data={m.serieLeads}
          compare={m.serieLeadsAnterior}
          color="var(--viz-2)"
          format={(v) => `${num(v)} leads`}
          height={210}
        />
      ) : (
        <ChartEmpty text="Nenhum contato novo no período." />
      )}
    </ChartCard>
  );
}

/**
 * Funil comercial como mapa de calor.
 *
 * A pergunta não é "quantos leads eu tenho" — é "em que degrau eu perco, e
 * de quem". A versão em fitas mostrava o degrau; não mostrava o dono. Um
 * funil agregado com 30% de avanço pode ser 60% num canal e 8% noutro, e
 * essas duas situações pedem decisões opostas.
 *
 * A matriz responde as duas de uma vez: a coluna diz em que etapa vaza, a
 * linha diz em qual canal, e a cor — fria onde escapa, quente onde avança —
 * leva o olho direto à pior célula. Os volumes absolutos de cada etapa e o
 * quanto escapou continuam no painel, acima e abaixo da matriz.
 */
export function SalesFunnel({ m }: { m: DashboardMetrics }) {
  const topo = m.funil[0]?.value ?? 0;
  return (
    <ChartCard
      title="Funil comercial"
      subtitle="Taxa de avanço por etapa e por canal"
      className="col-span-12 lg:col-span-6"
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
        <FunnelHeatmap
          celulas={m.matrizFunil.celulas}
          linhas={m.matrizFunil.linhas}
          colunas={m.matrizFunil.colunas}
          etapas={m.funil}
        />
      ) : (
        <ChartEmpty text="Sem leads no período para montar o funil." />
      )}
    </ChartCard>
  );
}

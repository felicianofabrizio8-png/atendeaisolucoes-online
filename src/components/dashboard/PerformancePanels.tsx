import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { ChartCard, ChartEmpty } from "./charts/ChartCard";
import { FunnelHeatmap } from "./charts/FunnelHeatmap";
import { GradientHeatmap } from "./charts/GradientHeatmap";
import { MultiArea, type SerieMulti } from "./charts/MultiArea";
import { brlCompact, num } from "./charts/primitives";
import { CANAIS, type DashboardMetrics } from "./useDashboardMetrics";

/**
 * Séries da receita, uma por canal: WhatsApp vermelho, Instagram roxo,
 * Facebook azul.
 *
 * Tons próprios e validados, não as cores de marca: aqui as três curvas se
 * cruzam, que é exatamente onde a separação não pode falhar, e o verde do
 * WhatsApp contra o rosa do Instagram fica a ΔE 4,3 em deuteranopia. Estes
 * passam em todos os pares nos dois temas — o par apertado é roxo/azul, no
 * piso de 8, sustentado pela legenda com amostra e pelo tooltip que lista os
 * três nomes com o valor de cada um.
 */
const SERIES: SerieMulti[] = CANAIS.map((c) => ({
  key: c.key,
  label: c.label,
  color: `var(--viz-canal-${c.key})`,
}));

/**
 * Receita ao longo do tempo, uma curva por canal.
 *
 * Três curvas contra o mesmo eixo, não uma pilha: a pergunta é "qual canal
 * está subindo?", e numa pilha só a faixa de baixo tem a linha de base no
 * zero — as de cima herdam o contorno das outras e param de ser legíveis
 * sozinhas. Sobrepostas, cada canal se lê direto e os cruzamentos (o momento
 * em que um passa o outro) ficam visíveis, que é o evento que interessa.
 */
export function RevenueTrend({ m, periodoLabel }: { m: DashboardMetrics; periodoLabel: string }) {
  const temValor = m.serieReceitaCanal.some((s) => s.total > 0);
  return (
    <ChartCard
      title="Receita fechada"
      subtitle={`Por canal · ${periodoLabel}`}
      className="col-span-12 lg:col-span-7"
      delay="60ms"
    >
      {temValor ? (
        <MultiArea data={m.serieReceitaCanal} series={SERIES} format={brlCompact} height={210} />
      ) : (
        <ChartEmpty text="Nenhuma venda fechada no período. Assim que um lead virar cliente, o valor aparece aqui." />
      )}
    </ChartCard>
  );
}

/**
 * Entrada de leads como campo de calor.
 *
 * A curva respondia "quantos entraram" e nada mais. O campo responde também
 * QUANDO: a linha é a hora do dia, a coluna é o tempo correndo da esquerda
 * para a direita no mesmo recorte do resto da tela. As manchas mostram de
 * uma vez a janela em que o cliente procura e se essa janela se deslocou ao
 * longo do período — duas decisões operacionais que o total diário esconde.
 *
 * A comparação com o período anterior não se perdeu: continua no subtítulo,
 * que é onde ela sempre foi lida de fato.
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
      {m.gradeLeads.total > 0 ? (
        <GradientHeatmap
          valores={m.gradeLeads.valores}
          colunas={m.gradeLeads.colunas}
          colunasCheias={m.gradeLeads.colunasCheias}
          linhas={m.gradeLeads.linhas}
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

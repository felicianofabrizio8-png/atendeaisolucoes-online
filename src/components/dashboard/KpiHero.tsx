import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { MicroArc, MicroRidge } from "./charts/Micro";
import { brl, brlCompact, num, pct, useCountUp, useInView } from "./charts/primitives";
import type { Periodo, ValorComparado } from "./useDashboardMetrics";

const PERIODOS: Array<{ value: Periodo; label: string }> = [
  { value: "semana", label: "Semana" },
  { value: "mes", label: "Mês" },
  { value: "ano", label: "Ano" },
];

/**
 * Seletor de período.
 *
 * A pastilha deslizante move-se por `transform`, não trocando a classe de
 * fundo de cada botão: é uma propriedade só, roda no compositor e o olho
 * segue o movimento em vez de ver a cor piscar de lugar.
 */
export function PeriodSwitcher({
  value,
  onChange,
}: {
  value: Periodo;
  onChange: (p: Periodo) => void;
}) {
  const index = PERIODOS.findIndex((p) => p.value === value);
  return (
    <div
      role="tablist"
      aria-label="Período"
      className="relative flex shrink-0 rounded-full bg-secondary p-1 text-xs font-semibold"
    >
      <span
        aria-hidden
        className="absolute inset-y-1 rounded-full bg-background shadow-sm transition-transform duration-300 ease-out"
        style={{
          width: `calc((100% - 0.5rem) / ${PERIODOS.length})`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {PERIODOS.map((p) => (
        <button
          key={p.value}
          role="tab"
          type="button"
          aria-selected={p.value === value}
          onClick={() => onChange(p.value)}
          className={cn(
            "relative z-10 w-[72px] rounded-full py-1.5 transition-colors",
            p.value === value ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

/** Variação vs. período anterior. Neutro quando não há base de comparação. */
function Delta({ value, inverter = false }: { value: number | null; inverter?: boolean }) {
  if (value === null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" />
        sem base
      </span>
    );
  }
  const positivo = inverter ? value < 0 : value > 0;
  const neutro = Math.abs(value) < 0.05;
  const Icon = value >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums",
        neutro ? "text-muted-foreground" : positivo ? "text-status-won" : "text-status-urgent",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {pct(Math.abs(value), 1)}
    </span>
  );
}

function Hero({
  label,
  value,
  formatted,
  delta,
  compare,
  moeda = true,
  children,
}: {
  label: string;
  value: number;
  formatted?: string;
  delta?: number | null;
  compare?: string;
  moeda?: boolean;
  /** A micro-visualização que dá forma ao número. */
  children?: React.ReactNode;
}) {
  const animated = useCountUp(value);
  const display = formatted ?? (moeda ? brl(Math.round(animated)) : num(Math.round(animated)));

  return (
    <div className="flex min-w-0 flex-col">
      {/* Caixa alta com muito espaçamento: o rótulo precisa sumir como
          textura e deixar o número ser a única coisa alta da linha. */}
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {/* tabular-nums é obrigatório em número que anima: sem ele os dígitos
            têm larguras diferentes e a linha inteira treme enquanto sobe. */}
        <span className="text-[26px] font-bold leading-none tabular-nums tracking-tight text-foreground sm:text-[32px]">
          {display}
        </span>
        {delta !== undefined && <Delta value={delta} />}
      </div>
      {compare && <p className="mt-1.5 truncate text-[11px] text-muted-foreground">{compare}</p>}
      {children && <div className="mt-auto pt-3">{children}</div>}
    </div>
  );
}

/**
 * Barra de composição do pipeline.
 *
 * O pipeline aberto é um número sem tamanho próprio: R$ 400 mil é muito ou
 * pouco? A parte que está QUENTE responde — é a fração que pode virar receita
 * nas próximas semanas. Dois segmentos, não uma pizza: comparação de duas
 * partes de um todo se lê melhor em comprimento.
 */
function PipelineSplit({ total, quentes }: { total: number; quentes: number }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const fracao = total > 0 ? Math.min(quentes / total, 1) : 0;
  return (
    <div ref={ref} aria-hidden>
      <div className="flex h-2 w-full gap-[3px] overflow-hidden rounded-full">
        <span
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{ width: inView ? `${fracao * 100}%` : "0%", background: "var(--viz-3)" }}
        />
        <span
          className="h-full min-w-0 flex-1 rounded-full"
          style={{ background: "var(--viz-track)" }}
        />
      </div>
    </div>
  );
}

/**
 * Faixa de KPIs do topo.
 *
 * Três números, não oito: um painel com dezesseis indicadores não é lido, é
 * ignorado. A ordem é a da pergunta do dono do negócio — quanto entrou,
 * quanto está em jogo, quanto do que entra vira venda.
 *
 * Cada número ganhou uma micro-visualização embaixo. Não é enfeite: um valor
 * isolado não diz se está subindo, de que é feito nem quanto falta para o
 * todo, e essas três perguntas cabem em trinta pixels de altura cada.
 */
export function KpiHero({
  receita,
  pipeline,
  pipelineQuentes,
  taxaConversao,
  ticketMedio,
  vendas,
  periodoLabel,
  serieReceita,
}: {
  receita: ValorComparado;
  pipeline: number;
  pipelineQuentes: number;
  taxaConversao: number;
  ticketMedio: number;
  vendas: ValorComparado;
  periodoLabel: string;
  /** Série de receita por balde — a crista sob o número grande. */
  serieReceita: number[];
}) {
  const conversao = useCountUp(taxaConversao);

  return (
    <section className="viz-fade-up grid gap-6 rounded-2xl border border-border bg-card/60 p-5 sm:grid-cols-3">
      <Hero
        label={`Receita · ${periodoLabel}`}
        value={receita.atual}
        delta={receita.variacao}
        compare={
          receita.anterior > 0
            ? `Antes: ${brlCompact(receita.anterior)} · ${num(vendas.atual)} venda${vendas.atual === 1 ? "" : "s"}`
            : `${num(vendas.atual)} venda${vendas.atual === 1 ? "" : "s"} fechada${vendas.atual === 1 ? "" : "s"}`
        }
      >
        {serieReceita.some((v) => v > 0) && <MicroRidge data={serieReceita} color="var(--viz-1)" />}
      </Hero>

      <div className="flex min-w-0 flex-col sm:border-l sm:border-border sm:pl-6">
        <Hero
          label="Pipeline aberto"
          value={pipeline}
          compare={
            pipelineQuentes > 0
              ? `${brlCompact(pipelineQuentes)} em leads quentes`
              : "Nenhum lead quente no momento"
          }
        >
          {pipeline > 0 && <PipelineSplit total={pipeline} quentes={pipelineQuentes} />}
        </Hero>
      </div>

      <div className="flex min-w-0 flex-col sm:border-l sm:border-border sm:pl-6">
        <div className="flex items-start justify-between gap-3">
          <Hero
            label="Conversão"
            value={taxaConversao}
            formatted={pct(conversao, 1)}
            compare={
              ticketMedio > 0
                ? `Ticket médio ${brlCompact(ticketMedio)}`
                : "Sem venda fechada no período"
            }
          />
          <MicroArc value={taxaConversao} color="var(--viz-2)" size={44} className="mt-1" />
        </div>
      </div>
    </section>
  );
}

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { brl, brlCompact, num, pct, useCountUp } from "./charts/primitives";
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
}: {
  label: string;
  value: number;
  formatted?: string;
  delta?: number | null;
  compare?: string;
  moeda?: boolean;
}) {
  const animated = useCountUp(value);
  const display = formatted ?? (moeda ? brl(Math.round(animated)) : num(Math.round(animated)));

  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {/* tabular-nums é obrigatório em número que anima: sem ele os dígitos
            têm larguras diferentes e a linha inteira treme enquanto sobe. */}
        <span className="text-2xl font-bold tabular-nums tracking-tight text-foreground sm:text-[28px]">
          {display}
        </span>
        {delta !== undefined && <Delta value={delta} />}
      </div>
      {compare && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{compare}</p>}
    </div>
  );
}

/**
 * Faixa de KPIs do topo.
 *
 * Três números, não oito. A referência que o cliente mandou acerta nisso: um
 * painel com dezesseis indicadores não é lido, é ignorado. Aqui a ordem é a
 * da pergunta do dono do negócio — quanto entrou, quanto está em jogo, quanto
 * do que entra vira venda.
 */
export function KpiHero({
  receita,
  pipeline,
  pipelineQuentes,
  taxaConversao,
  ticketMedio,
  vendas,
  periodoLabel,
}: {
  receita: ValorComparado;
  pipeline: number;
  pipelineQuentes: number;
  taxaConversao: number;
  ticketMedio: number;
  vendas: ValorComparado;
  periodoLabel: string;
}) {
  const conversao = useCountUp(taxaConversao);

  return (
    <section className="viz-fade-up grid gap-5 rounded-2xl border border-border bg-card/60 p-5 sm:grid-cols-3">
      <Hero
        label={`Receita · ${periodoLabel}`}
        value={receita.atual}
        delta={receita.variacao}
        compare={
          receita.anterior > 0
            ? `Antes: ${brlCompact(receita.anterior)} · ${num(vendas.atual)} venda${vendas.atual === 1 ? "" : "s"}`
            : `${num(vendas.atual)} venda${vendas.atual === 1 ? "" : "s"} fechada${vendas.atual === 1 ? "" : "s"}`
        }
      />

      <div className="min-w-0 sm:border-l sm:border-border sm:pl-5">
        <Hero
          label="Pipeline aberto"
          value={pipeline}
          compare={
            pipelineQuentes > 0
              ? `${brlCompact(pipelineQuentes)} em leads quentes`
              : "Nenhum lead quente no momento"
          }
        />
      </div>

      <div className="min-w-0 sm:border-l sm:border-border sm:pl-5">
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
      </div>
    </section>
  );
}

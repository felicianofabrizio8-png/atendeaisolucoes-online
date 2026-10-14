import { ArrowDownRight, ArrowUpRight, Minus, Flame } from "lucide-react";
import { cn } from "@/lib/utils";

import { brl, brlCompact, num, pct, useCountUp } from "./charts/primitives";
import type { Periodo, ValorComparado } from "./useDashboardMetrics";
import { ChartExplorer } from "./charts/ChartExplorer";

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
        <span className="dash-kpi-value text-[30px] font-bold leading-none tabular-nums tracking-tight text-foreground lg:text-[38px]">
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
 * Faixa de KPIs do topo.
 *
 * Três números, não oito: um painel com dezesseis indicadores não é lido, é
 * ignorado. A ordem é a da pergunta do dono do negócio — quanto entrou,
 * quanto está em jogo, quanto do que entra vira venda.
 *
 * Cada indicador inclui seu contexto: comparação, participação ou proporção.
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

  const revenueContent = (
    <>
      <Hero
        label={`Receita · ${periodoLabel}`}
        value={receita.atual}
        delta={receita.variacao}
        compare={
          receita.anterior > 0
            ? `Antes: ${brlCompact(receita.anterior)}`
            : "Sem receita no período anterior"
        }
      >
        <span className="dash-sales-pill">{num(vendas.atual)} vendas fechadas</span>
      </Hero>
    </>
  );
  const pipelineContent = (
    <>
      <Hero
        label="Oportunidades em aberto"
        value={pipeline}
        compare={
          pipelineQuentes > 0
            ? `${brlCompact(pipelineQuentes)} em leads quentes · agora`
            : "Nenhum lead quente no momento"
        }
      >
        <span className="dash-hot-pill">
          <Flame size={13} />
          {pipeline > 0
            ? `${pct((pipelineQuentes / pipeline) * 100, 0)} do valor em leads quentes`
            : "Sem oportunidades em aberto"}
        </span>
      </Hero>
    </>
  );
  const conversionContent = (
    <>
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
      </div>
      <div className="dash-conversion-ticks" aria-hidden>
        {Array.from({ length: 40 }, (_, i) => (
          <i
            key={i}
            style={{
              background:
                i < Math.round(Math.max(0, Math.min(100, taxaConversao)) / 2.5)
                  ? "var(--dash-lime)"
                  : "var(--dash-track)",
            }}
          />
        ))}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">Vendas ÷ novos leads no período</p>
    </>
  );
  return (
    <section className="viz-fade-up grid gap-4 sm:grid-cols-3">
      <div className="dash-kpi dash-kpi-revenue">
        <span className="dash-kpi-symbol">
          <ChartExplorer title="Receita" chartClass="dash-kpi dash-kpi-revenue">
            {revenueContent}
          </ChartExplorer>
        </span>
        {revenueContent}
      </div>
      <div className="dash-kpi dash-kpi-pipeline">
        <span className="dash-kpi-symbol">
          <ChartExplorer title="Oportunidades em aberto" chartClass="dash-kpi dash-kpi-pipeline">
            {pipelineContent}
          </ChartExplorer>
        </span>
        {pipelineContent}
      </div>
      <div className="dash-kpi dash-kpi-conversion">
        <span className="dash-kpi-symbol">
          <ChartExplorer title="Conversão" chartClass="dash-kpi dash-kpi-conversion">
            {conversionContent}
          </ChartExplorer>
        </span>
        {conversionContent}
      </div>
    </section>
  );
}

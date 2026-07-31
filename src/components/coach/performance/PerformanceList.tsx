// SPRINT 4 · FASE 5 — Lista principal do painel (mobile-first, sem scroll horizontal).
import { ChevronRight } from "lucide-react";
import { HealthBadge } from "./HealthBadge";
import { STATUS_LABEL_PT, type CoachLearningStatus } from "@/lib/coach-learnings/schema";
import {
  formatPercent,
  percentAriaLabel,
  type LearningPerformanceRow,
} from "@/lib/coach-learnings/performance/types";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
}

function Metric({ label, value, ariaValue }: { label: string; value: string; ariaValue?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-medium tabular-nums" aria-label={ariaValue}>
        {value}
      </div>
    </div>
  );
}

export interface PerformanceListProps {
  rows: LearningPerformanceRow[];
  isLoading: boolean;
  hasFilters: boolean;
  onOpen: (id: string) => void;
}

export function PerformanceList({ rows, isLoading, hasFilters, onOpen }: PerformanceListProps) {
  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true" data-testid="list-loading">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-lg border border-border bg-muted/50" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div
        className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground"
        data-testid="list-empty"
      >
        {hasFilters
          ? "Nenhum aprendizado corresponde aos filtros. Ajuste ou limpe os filtros para ver mais."
          : "Ainda não há aprendizados registrados. Use “Ensinar IA” na Caixa de Atendimento para criar o primeiro."}
      </div>
    );
  }

  return (
    <ul className="space-y-2" data-testid="performance-list">
      {rows.map((r) => (
        <li key={r.id}>
          <article className="rounded-lg border border-border bg-card p-3">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold">{r.title}</h3>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                  <span>{STATUS_LABEL_PT[r.status as CoachLearningStatus] ?? r.status}</span>
                  <span aria-hidden="true">·</span>
                  <span>prioridade {r.priority}</span>
                  <span aria-hidden="true">·</span>
                  <span>v{r.version}</span>
                  {r.product_ref && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="truncate">{r.product_ref}</span>
                    </>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <HealthBadge code={r.health} />
                <button
                  type="button"
                  onClick={() => onOpen(r.id)}
                  data-testid={`open-detail-${r.id}`}
                  aria-label={`Abrir detalhes de ${r.title}`}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              <Metric
                label="Confiança"
                value={formatPercent(r.confidence)}
                ariaValue={percentAriaLabel(r.confidence)}
              />
              <Metric
                label="Sucesso"
                value={r.feedback_sample_count > 0 ? formatPercent(r.success_rate) : "—"}
                ariaValue={
                  r.feedback_sample_count > 0 ? percentAriaLabel(r.success_rate) : "sem dados"
                }
              />
              <Metric label="Amostras" value={String(r.feedback_sample_count)} />
              <Metric label="👍 / 👎" value={`${r.positive_feedback_count} / ${r.negative_feedback_count}`} />
              <Metric label="Usado" value={String(r.usage_count)} />
              <Metric label="Recuperado" value={String(r.times_retrieved)} />
              <Metric label="Último uso" value={fmtDate(r.last_used_at)} />
            </div>

            {(r.period_retrievals > 0 || r.period_positive > 0 || r.period_negative > 0) && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                No período: {r.period_retrievals} recuperações ({r.period_contextual} contextuais /{" "}
                {r.period_fallback} fallback) · {r.period_positive} 👍 · {r.period_negative} 👎
              </p>
            )}
          </article>
        </li>
      ))}
    </ul>
  );
}

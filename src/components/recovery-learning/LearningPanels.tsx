// Painel de Aprendizado da Recuperação (Fase 6.4) — componentes de leitura.
//
// Toda a tela é SHADOW MODE: exibe o que o sistema aprendeu e o que ELE FARIA,
// sempre ao lado do que a produção realmente faz. Nenhum controle desta tela
// altera score, chance, tier ou fila.

import { cn } from "@/lib/utils";
import type {
  CalibrationReport,
  DriftAlert,
  GroupStat,
  LearningInsight,
  LearningRecommendation,
  ShadowRankingResult,
} from "@/lib/recovery-learning";
import { featureLabel } from "@/lib/recovery-learning";

const pctOf = (n: number) => `${Math.round(n * 100)}%`;

function ConfidenceBadge({ confidence, samples }: { confidence: number; samples: number }) {
  const level = confidence >= 0.7 ? "alta" : confidence >= 0.4 ? "média" : "baixa";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap",
        confidence >= 0.7
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-muted text-muted-foreground",
      )}
      title={`Confiança ${level} — baseada em ${samples} tentativas`}
    >
      Confiança {level} · {samples} amostras
    </span>
  );
}

export function LearningEmptyState({ total }: { total: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-6 text-center">
      <p className="text-sm font-medium">Ainda não há dados suficientes para aprender</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {total === 0
          ? "Nenhuma tentativa de recuperação concluída neste período."
          : `${total} tentativa(s) registrada(s). São necessárias pelo menos 8 tentativas concluídas para qualquer conclusão estatística.`}
      </p>
    </div>
  );
}

export function LearningErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center">
      <p className="text-sm">Não foi possível carregar o aprendizado agora.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 h-10 px-4 text-xs rounded-md border border-border hover:bg-accent"
      >
        Tentar novamente
      </button>
    </div>
  );
}

export function InsightsList({ insights }: { insights: LearningInsight[] }) {
  if (insights.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Nenhum padrão com amostra suficiente foi identificado nesta janela.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {insights.map((insight) => (
        <li
          key={insight.id}
          className={cn(
            "rounded-lg border p-3",
            insight.direction === "positivo"
              ? "border-primary/30 bg-primary/5"
              : "border-border bg-card",
          )}
        >
          <p className="text-sm leading-snug">{insight.text}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            <ConfidenceBadge confidence={insight.confidence} samples={insight.samples} />
            <span>Janela: {insight.windowLabel}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function GroupTable({ dimension, stats }: { dimension: string; stats: GroupStat[] }) {
  if (stats.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-3 py-2 border-b border-border">
        <h3 className="text-xs font-semibold capitalize">{dimension.replace(/_/g, " ")}</h3>
      </div>
      <ul className="divide-y divide-border">
        {stats.slice(0, 8).map((stat) => (
          <li key={stat.value} className="px-3 py-2 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium truncate">
                {featureLabel(stat.dimension, stat.value)}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {stat.samples} tentativas · resposta {pctOf(stat.replyRate)}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-semibold tabular-nums">{pctOf(stat.recoveryRate)}</p>
              <p
                className={cn(
                  "text-[10px] tabular-nums",
                  stat.liftPp > 0 ? "text-primary" : "text-muted-foreground",
                )}
              >
                {stat.liftPp > 0 ? "+" : ""}
                {stat.liftPp} pp
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DriftList({ alerts }: { alerts: DriftAlert[] }) {
  if (alerts.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Nenhuma variação relevante entre a janela anterior e a recente.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {alerts.slice(0, 6).map((alert) => (
        <li
          key={alert.id}
          className={cn(
            "rounded-lg border p-3",
            alert.severity === "critico"
              ? "border-destructive/40 bg-destructive/5"
              : "border-border bg-card",
          )}
        >
          <p className="text-sm leading-snug">{alert.text}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {alert.recentSamples} tentativas recentes · {alert.previousSamples} anteriores
          </p>
        </li>
      ))}
    </ul>
  );
}

export function CalibrationPanel({ report }: { report: CalibrationReport }) {
  if (report.samples === 0) {
    return <p className="text-xs text-muted-foreground">Sem previsões registradas para comparar.</p>;
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: "Erro médio da chance", value: pctOf(report.chanceMae) },
          { label: "Brier Score", value: report.brier.toFixed(2) },
          { label: "Precisão", value: pctOf(report.precision) },
          { label: "Cobertura", value: pctOf(report.recall) },
        ].map((m) => (
          <div key={m.label} className="rounded-lg border border-border bg-card p-3">
            <p className="text-[10px] text-muted-foreground leading-tight">{m.label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{m.value}</p>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <ul className="divide-y divide-border">
          {report.curve.map((bin) => (
            <li key={bin.band} className="px-3 py-2 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Faixa {bin.band}%</span>
              <span className="tabular-nums">
                previsto {pctOf(bin.predicted)} · real {pctOf(bin.observed)} ({bin.samples})
              </span>
            </li>
          ))}
        </ul>
      </div>
      {report.notes.length > 0 && (
        <ul className="space-y-1 text-[11px] text-muted-foreground">
          {report.notes.map((n) => (
            <li key={n}>• {n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ShadowRankingPanel({ ranking }: { ranking: ShadowRankingResult | null }) {
  if (!ranking || ranking.totalItems === 0) {
    return <p className="text-xs text-muted-foreground">Fila vazia — nada a comparar.</p>;
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Leads na fila", value: String(ranking.totalItems) },
          { label: "Mudariam de posição", value: `${Math.round(ranking.changeRatio * 100)}%` },
          { label: "Correlação", value: ranking.spearman.toFixed(2) },
        ].map((m) => (
          <div key={m.label} className="rounded-lg border border-border bg-card p-3">
            <p className="text-[10px] text-muted-foreground leading-tight">{m.label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{m.value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {[
          { title: "Subiriam na fila", moves: ranking.wouldRiseTop },
          { title: "Desceriam na fila", moves: ranking.wouldFallTop },
        ].map((col) => (
          <div key={col.title} className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="px-3 py-2 border-b border-border">
              <h3 className="text-xs font-semibold">{col.title}</h3>
            </div>
            {col.moves.length === 0 ? (
              <p className="px-3 py-3 text-[11px] text-muted-foreground">Nenhum deslocamento.</p>
            ) : (
              <ul className="divide-y divide-border">
                {col.moves.map((m) => (
                  <li
                    key={m.conversationId}
                    className="px-3 py-2 flex items-center justify-between gap-3"
                  >
                    <span className="text-xs truncate">{m.leadName}</span>
                    <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">
                      {m.currentPosition}º → {m.shadowPosition}º ({m.currentScore}→{m.learnedScore})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function RecommendationsList({ items }: { items: LearningRecommendation[] }) {
  if (items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Nenhuma sugestão de ajuste com evidência suficiente.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {items.map((rec) => (
        <li key={rec.id} className="rounded-lg border border-border bg-card p-3">
          <p className="text-sm font-medium">{rec.title}</p>
          <p className="mt-1 text-xs text-muted-foreground leading-snug">{rec.rationale}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ConfidenceBadge confidence={rec.confidence} samples={rec.samples} />
            <span className="text-[10px] text-muted-foreground">Sugestão — não aplicada</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

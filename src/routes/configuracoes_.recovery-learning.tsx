// SPRINT 6 · FASE 6.4 — Painel de Aprendizado da Recuperação (SHADOW MODE).
//
// Somente admin. Esta tela EXPLICA o que o sistema aprendeu e mostra o que ele
// FARIA com a fila — sem nunca alterar Recovery Score, chance, tier ou ordem
// em produção. Todo número vem acompanhado de amostra e janela analisada.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Loader2, RefreshCcw, ShieldCheck } from "lucide-react";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import {
  getRecoveryLearning,
  LEARNING_PERIODS,
  type LearningPeriod,
} from "@/lib/recovery-learning.functions";
import { getRecoveryEngine } from "@/lib/recovery-engine.functions";
import {
  buildShadowRanking,
  deserializeModel,
  featuresOfQueueItem,
  type RankingItem,
} from "@/lib/recovery-learning";
import {
  CalibrationPanel,
  DriftList,
  GroupTable,
  InsightsList,
  LearningEmptyState,
  LearningErrorState,
  RecommendationsList,
  ShadowRankingPanel,
} from "@/components/recovery-learning/LearningPanels";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/configuracoes_/recovery-learning")({
  component: RecoveryLearningPage,
  head: () => ({
    meta: [
      { title: "Aprendizado da Recuperação • Atende Aí" },
      {
        name: "description",
        content:
          "Veja o que realmente funciona para recuperar clientes: padrões por produto, horário, template e vendedor, com amostra e confiança de cada conclusão.",
      },
      { property: "og:title", content: "Aprendizado da Recuperação • Atende Aí" },
      {
        property: "og:description",
        content:
          "Painel de aprendizado em modo sombra: mede o que funciona sem alterar a fila de recuperação.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const PERIOD_LABEL: Record<LearningPeriod, string> = {
  "30d": "30 dias",
  "90d": "90 dias",
  "180d": "180 dias",
};

const SECTION_TITLES: Record<string, string> = {
  produto: "Por produto",
  origem: "Por origem do lead",
  horario: "Por horário do contato",
  vendedor: "Por vendedor",
  template: "Por template",
  estrategia: "Por estratégia",
  tom: "Por tom",
  insistencia: "Por número de tentativas",
};

function RecoveryLearningPage() {
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const [period, setPeriod] = useState<LearningPeriod>("90d");

  const learningFn = useServerFn(getRecoveryLearning);
  const queueFn = useServerFn(getRecoveryEngine);
  const enabled = !adminLoading && isAdmin;

  const learningQ = useQuery({
    queryKey: ["recovery-learning", period],
    queryFn: () => learningFn({ data: { period } }),
    enabled,
    staleTime: 60_000,
  });

  const queueQ = useQuery({
    queryKey: ["recovery-engine"],
    queryFn: () => queueFn(),
    enabled,
    staleTime: 60_000,
  });

  // Shadow ranking é calculado no cliente sobre uma CÓPIA da fila: a produção
  // segue exatamente com a ordem da Fase 6.1.
  const shadowRanking = useMemo(() => {
    const serialized = learningQ.data?.model;
    const queue = queueQ.data?.queue;
    if (!serialized || !queue || queue.length === 0) return null;
    const model = deserializeModel(serialized);
    if (model.weights.size === 0) return null;
    const now = Date.now();
    const items: RankingItem[] = queue.map((item) => ({
      conversationId: item.conversationId,
      leadName: item.leadName,
      score: item.score,
      position: item.position,
      features: featuresOfQueueItem(item, now),
    }));
    return buildShadowRanking(model, items);
  }, [learningQ.data?.model, queueQ.data?.queue]);

  const report = learningQ.data?.report ?? null;
  const total = learningQ.data?.total ?? 0;
  const failed = learningQ.isError || total === -1;

  if (!adminLoading && !isAdmin) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Este painel é restrito a administradores da empresa.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <header className="border-b border-border px-3 md:px-6 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Link
            to="/inbox/recovery-queue"
            aria-label="Voltar para a fila de recuperação"
            className="h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-accent shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <h1 className="text-base font-semibold leading-none truncate">
              Aprendizado da Recuperação
            </h1>
            <p className="mt-1 text-[11px] md:text-xs text-muted-foreground truncate">
              O que funciona de verdade — medido, nunca aplicado sozinho.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            void learningQ.refetch();
            void queueQ.refetch();
          }}
          className="h-9 px-3 text-xs rounded-md border border-border hover:bg-accent inline-flex items-center gap-1.5 shrink-0"
        >
          {learningQ.isFetching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCcw className="h-3.5 w-3.5" />
          )}
          <span className="hidden sm:inline">Atualizar</span>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="px-3 md:px-6 py-3 space-y-4 pb-10">
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 flex gap-2">
            <ShieldCheck className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <p className="text-xs leading-snug">
              <strong>Modo observação.</strong> Este painel apenas mede resultados reais. A
              prioridade da fila, o score e a chance exibidos no atendimento continuam sendo
              calculados pelas regras atuais — nada aqui é aplicado automaticamente.
            </p>
          </div>

          <div className="flex gap-1.5" role="tablist" aria-label="Período analisado">
            {LEARNING_PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={period === p}
                onClick={() => setPeriod(p)}
                className={cn(
                  "h-10 px-3 text-xs rounded-md border",
                  period === p
                    ? "border-primary bg-primary/10 text-primary font-semibold"
                    : "border-border hover:bg-accent",
                )}
              >
                {PERIOD_LABEL[p]}
              </button>
            ))}
          </div>

          {learningQ.isLoading || adminLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
              <Loader2 className="h-4 w-4 animate-spin" /> Analisando tentativas...
            </div>
          ) : failed ? (
            <LearningErrorState onRetry={() => void learningQ.refetch()} />
          ) : !report || report.dataset.total < 8 ? (
            <LearningEmptyState total={total < 0 ? 0 : total} />
          ) : (
            <>
              <section className="space-y-2">
                <h2 className="text-sm font-semibold">Resumo da janela</h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { label: "Tentativas analisadas", value: String(report.dataset.total) },
                    {
                      label: "Responderam",
                      value: `${Math.round(report.dataset.baseReplyRate * 100)}%`,
                    },
                    {
                      label: "Recuperados",
                      value: `${Math.round(report.dataset.baseRecoveryRate * 100)}%`,
                    },
                    { label: "Janela", value: report.windowLabel },
                  ].map((m) => (
                    <div key={m.label} className="rounded-lg border border-border bg-card p-3">
                      <p className="text-[10px] text-muted-foreground leading-tight">{m.label}</p>
                      <p className="mt-1 text-lg font-semibold tabular-nums">{m.value}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="space-y-2">
                <h2 className="text-sm font-semibold">O que estamos aprendendo</h2>
                <InsightsList insights={report.insights} />
              </section>

              <section className="space-y-2">
                <h2 className="text-sm font-semibold">Recortes por dimensão</h2>
                <div className="grid gap-3 md:grid-cols-2">
                  {Object.entries(report.groups)
                    .filter(([, stats]) => stats.length > 0)
                    .map(([dimension, stats]) => (
                      <GroupTable
                        key={dimension}
                        dimension={SECTION_TITLES[dimension] ?? dimension}
                        stats={stats}
                      />
                    ))}
                </div>
              </section>

              <section className="space-y-2">
                <h2 className="text-sm font-semibold">Mudanças de comportamento</h2>
                <DriftList alerts={report.drift} />
              </section>

              <section className="space-y-2">
                <h2 className="text-sm font-semibold">Se o aprendizado mandasse na fila</h2>
                <p className="text-[11px] text-muted-foreground">
                  Comparação entre a fila real e a ordem que o aprendizado sugeriria. A fila do
                  atendimento não muda.
                </p>
                <ShadowRankingPanel ranking={shadowRanking} />
              </section>

              <section className="space-y-2">
                <h2 className="text-sm font-semibold">Precisão das previsões</h2>
                <CalibrationPanel report={report.calibration} />
              </section>

              <section className="space-y-2">
                <h2 className="text-sm font-semibold">Sugestões de ajuste</h2>
                <RecommendationsList items={report.recommendations} />
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// SPRINT 4 · FASE 5 — Painel de desempenho e rastreabilidade dos aprendizados.
// Somente admin. Mobile First: cards em grade, lista sem scroll horizontal,
// filtros em drawer no mobile. Nenhum conteúdo de conversa é exibido.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, BarChart3, Loader2, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import {
  listLearningPerformanceFn,
  getLearningPerformanceSummaryFn,
} from "@/lib/coach-learnings/performance.functions";
import {
  PerformanceFilters,
  EMPTY_FILTERS,
  activeFilterCount,
  type PerformanceFilterState,
} from "@/components/coach/performance/PerformanceFilters";
import { PerformanceSummaryCards } from "@/components/coach/performance/PerformanceSummaryCards";
import { PerformanceList } from "@/components/coach/performance/PerformanceList";
import { LearningDetailDrawer } from "@/components/coach/performance/LearningDetailDrawer";
import {
  DEFAULT_PAGE_SIZE,
  periodToFromIso,
  type PerformanceQuery,
} from "@/lib/coach-learnings/performance/types";
import { COACH_LEARNING_STATUSES } from "@/lib/coach-learnings/schema";
import { COACH_LEARNING_HEALTH_CODES } from "@/lib/coach-learnings/performance/health";
import { PERFORMANCE_STRATEGIES } from "@/lib/coach-learnings/performance/types";

export const Route = createFileRoute("/configuracoes_/coach-desempenho")({
  component: CoachPerformancePage,
  head: () => ({
    meta: [
      { title: "Desempenho dos Aprendizados • Atende Aí" },
      {
        name: "description",
        content:
          "Acompanhe uso, confiança e feedback dos aprendizados do Coach IA e entenda por que cada regra foi aplicada.",
      },
      { property: "og:title", content: "Desempenho dos Aprendizados • Atende Aí" },
      {
        property: "og:description",
        content: "Painel de desempenho e rastreabilidade do Coach Evolutivo.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

/** Traduz o estado de filtros da UI para o contrato validado da server function. */
function toQuery(f: PerformanceFilterState, page: number): PerformanceQuery {
  const from = periodToFromIso(f.period);
  const statuses =
    f.status === "all"
      ? undefined
      : COACH_LEARNING_STATUSES.includes(f.status as (typeof COACH_LEARNING_STATUSES)[number])
        ? [f.status as (typeof COACH_LEARNING_STATUSES)[number]]
        : undefined;
  return {
    statuses,
    search: f.search.trim() ? f.search.trim().slice(0, 160) : undefined,
    health:
      f.health !== "all" &&
      (COACH_LEARNING_HEALTH_CODES as readonly string[]).includes(f.health)
        ? (f.health as (typeof COACH_LEARNING_HEALTH_CODES)[number])
        : undefined,
    strategy:
      f.strategy !== "all" && (PERFORMANCE_STRATEGIES as readonly string[]).includes(f.strategy)
        ? (f.strategy as (typeof PERFORMANCE_STRATEGIES)[number])
        : undefined,
    minSamples: f.minSamples ?? undefined,
    minUsage: f.minUsage ?? undefined,
    minConfidence: f.minConfidence ?? undefined,
    minSuccess: f.minSuccess ?? undefined,
    minPriority: f.minPriority ?? undefined,
    onlyNegative: f.onlyNegative || undefined,
    onlyUnused: f.onlyUnused || undefined,
    onlyNoFeedback: f.onlyNoFeedback || undefined,
    from,
    sort: f.sort,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
  };
}

function CoachPerformancePage() {
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const listFn = useServerFn(listLearningPerformanceFn);
  const summaryFn = useServerFn(getLearningPerformanceSummaryFn);

  const [filters, setFilters] = useState<PerformanceFilterState>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);

  const enabled = !adminLoading && isAdmin;
  const query = useMemo(() => toQuery(filters, page), [filters, page]);
  const from = useMemo(() => periodToFromIso(filters.period), [filters.period]);

  const listQ = useQuery({
    queryKey: ["coach-learning-performance", query],
    queryFn: () => listFn({ data: query }),
    enabled,
    staleTime: 20_000,
  });

  const summaryQ = useQuery({
    queryKey: ["coach-learning-performance-summary", from],
    queryFn: () => summaryFn({ data: { from } }),
    enabled,
    staleTime: 30_000,
  });

  const onFilterChange = useCallback((patch: Partial<PerformanceFilterState>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  }, []);

  const onClear = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  }, []);

  const refetchAll = useCallback(() => {
    void listQ.refetch();
    void summaryQ.refetch();
  }, [listQ, summaryQ]);

  if (adminLoading) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Carregando…</span>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-lg font-semibold">Acesso restrito</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Apenas administradores podem ver o desempenho dos aprendizados do Coach.
        </p>
        <Button asChild variant="outline" className="mt-4 min-h-11">
          <Link to="/configuracoes">Voltar às configurações</Link>
        </Button>
      </main>
    );
  }

  const rows = listQ.data?.rows ?? [];
  const pageCount = listQ.data?.pageCount ?? 1;
  const totalCount = listQ.data?.totalCount ?? 0;
  const hasFilters = activeFilterCount(filters) > 0;

  return (
    <main className="mx-auto w-full max-w-5xl px-3 py-4 sm:px-6 sm:py-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:flex-wrap sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <Button asChild variant="ghost" size="icon" className="shrink-0" aria-label="Voltar">
            <Link to="/configuracoes/coach-learnings">
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 truncate text-lg font-semibold sm:text-xl">
              <BarChart3 className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              Desempenho dos aprendizados
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              Uso, confiança e feedback do Coach — sem exibir conversas.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 shrink-0"
          onClick={refetchAll}
          disabled={listQ.isFetching || summaryQ.isFetching}
        >
          <RefreshCcw
            className={`h-4 w-4 ${listQ.isFetching ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          <span className="hidden sm:inline">Atualizar</span>
        </Button>
      </header>

      <section className="mt-4" aria-label="Resumo">
        {summaryQ.isError ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            Não foi possível carregar o resumo.{" "}
            <button className="underline" onClick={() => summaryQ.refetch()}>
              Tentar novamente
            </button>
          </div>
        ) : (
          <PerformanceSummaryCards
            summary={summaryQ.data?.summary ?? null}
            period={filters.period}
            isLoading={summaryQ.isLoading}
          />
        )}
      </section>

      <div className="mt-4">
        <PerformanceFilters value={filters} onChange={onFilterChange} onClear={onClear} />
      </div>

      <section className="mt-4" aria-label="Aprendizados">
        {listQ.isError ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            Não foi possível carregar a lista de aprendizados.{" "}
            <button className="underline" onClick={() => listQ.refetch()}>
              Tentar novamente
            </button>
          </div>
        ) : (
          <>
            <p className="mb-2 text-xs text-muted-foreground" aria-live="polite">
              {listQ.isLoading
                ? "Carregando aprendizados…"
                : `${totalCount} aprendizado(s) · página ${page} de ${pageCount}`}
            </p>
            <PerformanceList
              rows={rows}
              isLoading={listQ.isLoading}
              hasFilters={hasFilters}
              onOpen={setDetailId}
            />
            {pageCount > 1 && (
              <nav className="mt-3 flex items-center justify-between gap-2" aria-label="Paginação">
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  disabled={page <= 1 || listQ.isFetching}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Anterior
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {page} / {pageCount}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  disabled={page >= pageCount || listQ.isFetching}
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                >
                  Próxima
                </Button>
              </nav>
            )}
          </>
        )}
      </section>

      <LearningDetailDrawer
        learningId={detailId}
        onClose={() => setDetailId(null)}
        onChanged={refetchAll}
      />
    </main>
  );
}

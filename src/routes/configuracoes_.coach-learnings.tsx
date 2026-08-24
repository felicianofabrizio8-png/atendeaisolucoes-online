// Admin — Aprendizados do Coach (BLOCO 4).
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  BarChart3,
  Brain,
  Archive,
  Loader2,
  Save,
  RefreshCcw,
  History,
  Search,
  X,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import {
  listCoachLearningsFn,
  updateCoachLearningFn,
  archiveCoachLearningFn,
  getCoachLearningFn,
  restoreCoachLearningVersionFn,
  analyzeHistoricalLearningsFn,
} from "@/lib/coach-learnings/coach-learnings.functions";
import type {
  CoachLearningRow,
  CoachLearningStatus,
  CoachLearningVersionRow,
} from "@/lib/coach-learnings/schema";
import {
  COACH_LEARNING_CATEGORIES,
  COACH_LEARNING_STATUSES,
  STATUS_LABEL_PT,
} from "@/lib/coach-learnings/schema";

export const Route = createFileRoute("/configuracoes_/coach-learnings")({
  component: CoachLearningsPage,
  head: () => ({
    meta: [
      { title: "Aprendizados do Coach • Atende Aí" },
      {
        name: "description",
        content:
          "Aprendizados que sua equipe ensinou à IA de vendas. Edite, pause ou arquive regras conversacionais.",
      },
      { property: "og:title", content: "Aprendizados do Coach • Atende Aí" },
      {
        property: "og:description",
        content: "Gestão dos aprendizados conversacionais do Coach IA.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type CategoryFilter = "all" | (typeof COACH_LEARNING_CATEGORIES)[number];
type StatusFilter = "all" | CoachLearningStatus;
type SortKey = "priority" | "usage" | "retrieved" | "updated";

function CoachLearningsPage() {
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const listFn = useServerFn(listCoachLearningsFn);
  const analyzeHistoryFn = useServerFn(analyzeHistoricalLearningsFn);
  const qc = useQueryClient();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [product, setProduct] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("priority");
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [analysisSummary, setAnalysisSummary] = useState<{
    scanned: number;
    analyzed: number;
    created: number;
    duplicatesSkipped: number;
    failed: number;
    aiFailed: number;
    persistenceFailed: number;
    aiFailureBreakdown: Record<string, number>;
  } | null>(null);
  const analyzeHistoryMut = useMutation({
    mutationFn: () => analyzeHistoryFn(),
    onSuccess: (result) => {
      setAnalysisSummary(result);
      toast.success(`Análise concluída: ${result.created} candidato(s) criado(s).`);
      qc.invalidateQueries({ queryKey: ["coach-learnings"] });
    },
    onError: () => toast.error("Não foi possível analisar o histórico."),
  });

  const q = useQuery({
    queryKey: ["coach-learnings", { includeArchived }],
    queryFn: () => listFn({ data: { includeArchived } }),
    enabled: !adminLoading && isAdmin,
  });

  const rows = (q.data?.learnings ?? []) as CoachLearningRow[];

  const productOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.product_ref) set.add(r.product_ref);
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows
      .filter((r) => (category === "all" ? true : r.category === category))
      .filter((r) => (status === "all" ? true : r.status === status))
      .filter((r) => (product === "all" ? true : (r.product_ref ?? "") === product))
      .filter((r) => {
        if (!term) return true;
        return (
          r.title.toLowerCase().includes(term) ||
          r.description.toLowerCase().includes(term) ||
          r.rule_structured.toLowerCase().includes(term) ||
          (r.product_ref ?? "").toLowerCase().includes(term)
        );
      })
      .sort((a, b) => {
        if (sort === "priority") return b.priority - a.priority;
        if (sort === "usage") return b.usage_count - a.usage_count;
        if (sort === "retrieved") return b.times_retrieved - a.times_retrieved;
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      });
  }, [rows, category, status, product, search, sort]);

  const totals = useMemo(() => {
    return {
      total: rows.length,
      active: rows.filter((r) => r.status === "active").length,
      retrieved: rows.reduce((acc, r) => acc + (r.times_retrieved ?? 0), 0),
      used: rows.reduce((acc, r) => acc + (r.usage_count ?? 0), 0),
    };
  }, [rows]);

  if (adminLoading) {
    return (
      <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Acesso restrito a administradores.</div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4 lg:p-6 space-y-4">
      <header className="flex items-center gap-3 flex-wrap">
        <Link to="/configuracoes" className="p-1.5 rounded hover:bg-muted" aria-label="Voltar">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <button
          type="button"
          onClick={() => analyzeHistoryMut.mutate()}
          disabled={analyzeHistoryMut.isPending}
          className="inline-flex min-h-11 items-center gap-1 rounded border border-border px-3 text-xs hover:bg-muted disabled:opacity-50"
        >
          {analyzeHistoryMut.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          Analisar histórico
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" /> Aprendizados do Coach
          </h1>
          <p className="text-xs text-muted-foreground">
            Regras conversacionais que a equipe ensinou à IA. Cada aprendizado é injetado no
            raciocínio antes de responder.
          </p>
        </div>
        <Link
          to="/configuracoes/coach-desempenho"
          className="inline-flex min-h-11 items-center gap-1 rounded border border-border px-3 text-xs hover:bg-muted"
        >
          <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" /> Desempenho
        </Link>
        <button
          type="button"
          onClick={() => q.refetch()}
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-muted"
        >
          <RefreshCcw className="h-3 w-3" /> Atualizar
        </button>
      </header>

      {analysisSummary && (
        <div className="rounded border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Escaneadas: {analysisSummary.scanned} · Analisadas: {analysisSummary.analyzed} · Criadas:{" "}
          {analysisSummary.created} · Duplicatas ignoradas: {analysisSummary.duplicatesSkipped} ·
          Falhas: {analysisSummary.failed} (IA: {analysisSummary.aiFailed}, persistência:{" "}
          {analysisSummary.persistenceFailed})
          {analysisSummary.aiFailed > 0 && (
            <span className="ml-1">
              · Diagnóstico IA:{" "}
              {Object.entries(analysisSummary.aiFailureBreakdown)
                .filter(([, count]) => count > 0)
                .map(([kind, count]) => `${kind}: ${count}`)
                .join(", ")}
            </span>
          )}
        </div>
      )}

      <section className="grid grid-cols-2 md:grid-cols-4 gap-2" data-testid="learnings-stats">
        <Stat label="Total" value={totals.total} />
        <Stat label="Ativos" value={totals.active} />
        <Stat
          label="Recuperados"
          value={totals.retrieved}
          hint="Somatório de vezes que o Coach usou como contexto"
        />
        <Stat label="Confirmados" value={totals.used} hint="Somatório de feedback positivo" />
      </section>

      <section className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto_auto] items-center">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="search"
            placeholder="Buscar por título, regra, produto…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="learnings-search"
            className="w-full rounded border border-border bg-background pl-7 pr-2 py-1.5 text-sm"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as CategoryFilter)}
          data-testid="learnings-filter-category"
          className="rounded border border-border bg-background px-2 py-1.5 text-sm"
        >
          <option value="all">Todas categorias</option>
          {COACH_LEARNING_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          data-testid="learnings-filter-status"
          className="rounded border border-border bg-background px-2 py-1.5 text-sm"
        >
          <option value="all">Todos status</option>
          {COACH_LEARNING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL_PT[s]}
            </option>
          ))}
        </select>
        <select
          value={product}
          onChange={(e) => setProduct(e.target.value)}
          data-testid="learnings-filter-product"
          className="rounded border border-border bg-background px-2 py-1.5 text-sm"
        >
          <option value="all">Todos produtos</option>
          {productOptions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          data-testid="learnings-sort"
          className="rounded border border-border bg-background px-2 py-1.5 text-sm"
        >
          <option value="priority">Prioridade</option>
          <option value="retrieved">Mais recuperados</option>
          <option value="usage">Mais usados</option>
          <option value="updated">Atualização recente</option>
        </select>
        <label className="flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Arquivados
        </label>
      </section>

      {q.isLoading && (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando aprendizados...
        </div>
      )}

      {!q.isLoading && filtered.length === 0 && (
        <div className="rounded border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Nenhum aprendizado corresponde aos filtros atuais.
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((r) => (
          <LearningCard
            key={r.id}
            row={r}
            onChanged={() => qc.invalidateQueries({ queryKey: ["coach-learnings"] })}
            onOpenHistory={() => setHistoryId(r.id)}
          />
        ))}
      </div>

      {historyId && (
        <HistoryDialog
          learningId={historyId}
          onClose={() => setHistoryId(null)}
          onRestored={() => qc.invalidateQueries({ queryKey: ["coach-learnings"] })}
        />
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div
      className="rounded border border-border bg-card p-2"
      title={hint}
      data-testid={`stat-${label.toLowerCase()}`}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function LearningCard({
  row,
  onChanged,
  onOpenHistory,
}: {
  row: CoachLearningRow;
  onChanged: () => void;
  onOpenHistory: () => void;
}) {
  const updateFn = useServerFn(updateCoachLearningFn);
  const archiveFn = useServerFn(archiveCoachLearningFn);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState({
    title: row.title,
    description: row.description,
    rule_structured: row.rule_structured,
    category: row.category,
    product_ref: row.product_ref,
    positive_example: row.positive_example,
    negative_example: row.negative_example,
    priority: row.priority,
    status: row.status,
    confidence: row.confidence,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const saveMut = useMutation({
    mutationFn: async () => {
      setErr(null);
      setSaving(true);
      try {
        await updateFn({
          data: {
            id: row.id,
            expectedVersion: row.version,
            patch: {
              title: draft.title,
              description: draft.description,
              rule_structured: draft.rule_structured,
              category: draft.category as (typeof COACH_LEARNING_CATEGORIES)[number],
              product_ref: draft.product_ref,
              positive_example: draft.positive_example,
              negative_example: draft.negative_example,
              priority: draft.priority,
              status: draft.status as CoachLearningStatus,
              confidence: draft.confidence,
            },
            origin: "manual_edit",
          },
        });
        onChanged();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "update_failed";
        setErr(
          msg.includes("learning_version_conflict")
            ? "Este aprendizado foi alterado por outra pessoa. Atualize a página e tente novamente."
            : msg,
        );
      } finally {
        setSaving(false);
      }
    },
  });

  const archiveMut = useMutation({
    mutationFn: async () => {
      if (!confirm(`Arquivar "${row.title}"?`)) return;
      try {
        await archiveFn({ data: { id: row.id } });
        onChanged();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "archive_failed");
      }
    },
  });

  return (
    <div className="rounded border border-border bg-card p-3 space-y-2">
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 text-left min-w-0"
        >
          <div className="font-medium text-sm truncate">{row.title}</div>
          <div className="text-xs text-muted-foreground line-clamp-2">{row.rule_structured}</div>
        </button>
        <StatusBadge status={row.status} />
      </div>
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
        <span title="Categoria">{row.category}</span>
        <span>·</span>
        <span title="Prioridade">p{row.priority}</span>
        <span>·</span>
        <span title="Versão">v{row.version}</span>
        <span>·</span>
        <span title="Feedback positivo">👍 {row.usage_count}</span>
        <span>·</span>
        <span title="Vezes recuperado como contexto pelo Coach">⇢ {row.times_retrieved}</span>
        {row.product_ref && (
          <>
            <span>·</span>
            <span>{row.product_ref}</span>
          </>
        )}
        <span className="ml-auto">
          atualizado {new Date(row.updated_at).toLocaleDateString("pt-BR")}
        </span>
      </div>
      {expanded && (
        <div className="space-y-2 pt-2 border-t border-border">
          <FormRow label="Título">
            <input
              className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </FormRow>
          <div className="grid grid-cols-3 gap-2">
            <FormRow label="Categoria">
              <select
                className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              >
                {COACH_LEARNING_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow label="Prioridade">
              <input
                type="number"
                min={0}
                max={100}
                className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
                value={draft.priority}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    priority: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                  })
                }
              />
            </FormRow>
            <FormRow label="Status">
              <select
                className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
                value={draft.status}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    status: e.target.value as CoachLearningStatus,
                  })
                }
              >
                {COACH_LEARNING_STATUSES.filter((s) => s !== "archived").map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL_PT[s]}
                  </option>
                ))}
              </select>
            </FormRow>
          </div>
          <FormRow label="Descrição">
            <textarea
              rows={2}
              className="w-full rounded border border-border bg-background px-2 py-1 text-sm resize-none"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </FormRow>
          <FormRow label="Regra estruturada">
            <textarea
              rows={3}
              className="w-full rounded border border-border bg-background px-2 py-1 text-sm resize-none"
              value={draft.rule_structured}
              onChange={(e) => setDraft({ ...draft, rule_structured: e.target.value })}
            />
          </FormRow>
          {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}
          <div className="flex items-center justify-end gap-2 flex-wrap">
            <button
              type="button"
              onClick={onOpenHistory}
              data-testid={`open-history-${row.id}`}
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-muted"
            >
              <History className="h-3 w-3" /> Histórico ({row.version})
            </button>
            <button
              type="button"
              onClick={() => archiveMut.mutate()}
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-muted"
            >
              <Archive className="h-3 w-3" /> Arquivar
            </button>
            <button
              type="button"
              onClick={() => saveMut.mutate()}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded bg-primary text-primary-foreground px-2 py-1 text-xs hover:opacity-90 disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Salvar (nova versão)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryDialog({
  learningId,
  onClose,
  onRestored,
}: {
  learningId: string;
  onClose: () => void;
  onRestored: () => void;
}) {
  const getFn = useServerFn(getCoachLearningFn);
  const restoreFn = useServerFn(restoreCoachLearningVersionFn);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["coach-learning", learningId],
    queryFn: () => getFn({ data: { id: learningId } }),
  });

  const learning = q.data?.learning as CoachLearningRow | undefined;
  const versions = (q.data?.versions ?? []) as CoachLearningVersionRow[];
  const current = learning ? (versions.find((v) => v.version === learning.version) ?? null) : null;
  const selected =
    selectedVersion !== null ? (versions.find((v) => v.version === selectedVersion) ?? null) : null;

  async function handleRestore() {
    if (!learning || !selected) return;
    if (
      !confirm(
        `Restaurar versão v${selected.version}? Uma nova versão será criada preservando o histórico.`,
      )
    )
      return;
    try {
      setRestoring(true);
      setErr(null);
      await restoreFn({
        data: {
          learningId: learning.id,
          targetVersion: selected.version,
          expectedVersion: learning.version,
          changeReason: `Restaurado v${selected.version} pela interface admin`,
        },
      });
      onRestored();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "restore_failed";
      setErr(
        msg.includes("learning_version_conflict")
          ? "Aprendizado foi alterado por outra pessoa. Feche e reabra."
          : msg,
      );
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      data-testid="history-dialog"
    >
      <div className="w-full max-w-4xl max-h-[85vh] overflow-hidden rounded-lg border border-border bg-card shadow-xl flex flex-col">
        <header className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <History className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold flex-1 min-w-0 truncate">
            Histórico · {learning?.title ?? "…"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="p-1 rounded hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] flex-1 overflow-hidden">
          <aside className="border-b md:border-b-0 md:border-r border-border overflow-auto p-2 space-y-1">
            {q.isLoading && (
              <div className="text-xs text-muted-foreground flex items-center gap-1 p-2">
                <Loader2 className="h-3 w-3 animate-spin" /> Carregando…
              </div>
            )}
            {versions.map((v) => {
              const isCurrent = v.version === learning?.version;
              const isSelected = v.version === selectedVersion;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setSelectedVersion(v.version)}
                  data-testid={`history-version-${v.version}`}
                  className={`w-full text-left rounded px-2 py-1.5 text-xs border ${
                    isSelected
                      ? "border-primary bg-primary/10"
                      : "border-transparent hover:bg-muted"
                  }`}
                >
                  <div className="flex items-center gap-1">
                    <span className="font-semibold">v{v.version}</span>
                    {isCurrent && <span className="text-[9px] uppercase text-primary">atual</span>}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {v.origin} · {new Date(v.created_at).toLocaleString("pt-BR")}
                  </div>
                </button>
              );
            })}
          </aside>
          <div className="overflow-auto p-4 space-y-3">
            {!selected && (
              <div className="text-xs text-muted-foreground">
                Selecione uma versão para ver o diff com a versão atual.
              </div>
            )}
            {selected && current && (
              <>
                <div className="text-xs text-muted-foreground">
                  Comparando <strong>v{selected.version}</strong> com{" "}
                  <strong>v{current.version}</strong> (atual)
                  {selected.change_reason && <span> · motivo: {selected.change_reason}</span>}
                </div>
                <DiffField label="Título" before={selected.title} after={current.title} />
                <DiffField label="Categoria" before={selected.category} after={current.category} />
                <DiffField
                  label="Prioridade"
                  before={String(selected.priority)}
                  after={String(current.priority)}
                />
                <DiffField label="Status" before={selected.status} after={current.status} />
                <DiffField
                  label="Regra"
                  before={selected.rule_structured}
                  after={current.rule_structured}
                />
                <DiffField
                  label="Descrição"
                  before={selected.description}
                  after={current.description}
                />
                {err && (
                  <div role="alert" className="text-xs text-red-600 dark:text-red-400">
                    {err}
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="min-h-9 rounded border border-border px-3 py-1.5 text-xs hover:bg-muted"
                  >
                    Fechar
                  </button>
                  <button
                    type="button"
                    onClick={handleRestore}
                    disabled={restoring || !selected || selected.version === current.version}
                    data-testid="history-restore"
                    className="inline-flex items-center gap-1 min-h-9 rounded bg-primary text-primary-foreground px-3 py-1.5 text-xs hover:opacity-90 disabled:opacity-40"
                  >
                    {restoring ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3 w-3" />
                    )}
                    Restaurar esta versão
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DiffField({ label, before, after }: { label: string; before: string; after: string }) {
  const changed = before !== after;
  return (
    <div className="space-y-1" data-testid={`diff-${label.toLowerCase()}`} data-changed={changed}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label} {changed && <span className="text-amber-600">· alterado</span>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <pre
          className={`whitespace-pre-wrap text-xs rounded border p-2 ${
            changed ? "border-red-500/40 bg-red-500/5" : "border-border bg-muted/30"
          }`}
        >
          {before || "—"}
        </pre>
        <pre
          className={`whitespace-pre-wrap text-xs rounded border p-2 ${
            changed ? "border-emerald-500/40 bg-emerald-500/5" : "border-border bg-muted/30"
          }`}
        >
          {after || "—"}
        </pre>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const style =
    status === "active"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
      : status === "paused"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30"
        : "bg-muted text-muted-foreground border-border";
  const label =
    status === "active"
      ? STATUS_LABEL_PT.active
      : status === "paused"
        ? STATUS_LABEL_PT.paused
        : STATUS_LABEL_PT.archived;
  return (
    <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${style}`}>
      {label}
    </span>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

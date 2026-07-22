// Admin — Aprendizados do Coach (Coach Evolutivo).
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Brain, Archive, Loader2, Save, RefreshCcw } from "lucide-react";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import {
  listCoachLearningsFn,
  updateCoachLearningFn,
  archiveCoachLearningFn,
} from "@/lib/coach-learnings/coach-learnings.functions";
import type {
  CoachLearningRow,
  CoachLearningStatus,
} from "@/lib/coach-learnings/schema";
import {
  COACH_LEARNING_CATEGORIES,
  COACH_LEARNING_STATUSES,
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

function CoachLearningsPage() {
  const { isAdmin, loading: adminLoading } = useIsAdmin();
  const listFn = useServerFn(listCoachLearningsFn);
  const [includeArchived, setIncludeArchived] = useState(false);
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["coach-learnings", { includeArchived }],
    queryFn: () => listFn({ data: { includeArchived } }),
    enabled: !adminLoading,
  });

  const rows = (q.data?.learnings ?? []) as CoachLearningRow[];
  const grouped = useMemo(() => {
    const map = new Map<string, CoachLearningRow[]>();
    for (const r of rows) {
      const k = r.category;
      const arr = map.get(k) ?? [];
      arr.push(r);
      map.set(k, arr);
    }
    return map;
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
      <div className="p-6 text-sm text-muted-foreground">
        Acesso restrito a administradores.
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-4 lg:p-6 space-y-4">
      <header className="flex items-center gap-3">
        <Link
          to="/configuracoes"
          className="p-1.5 rounded hover:bg-muted"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" /> Aprendizados do Coach
          </h1>
          <p className="text-xs text-muted-foreground">
            Regras conversacionais que a equipe ensinou à IA. Cada aprendizado é injetado
            no raciocínio antes de responder.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Incluir arquivados
        </label>
        <button
          type="button"
          onClick={() => q.refetch()}
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-muted"
        >
          <RefreshCcw className="h-3 w-3" /> Atualizar
        </button>
      </header>

      {q.isLoading && (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando aprendizados...
        </div>
      )}

      {!q.isLoading && rows.length === 0 && (
        <div className="rounded border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Ainda não há aprendizados. Use o botão "Ensinar IA" no painel do Coach para começar.
        </div>
      )}

      {Array.from(grouped.entries()).map(([cat, list]) => (
        <section key={cat} className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {cat} · {list.length}
          </h2>
          <div className="space-y-2">
            {list.map((r) => (
              <LearningCard
                key={r.id}
                row={r}
                onChanged={() => qc.invalidateQueries({ queryKey: ["coach-learnings"] })}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function LearningCard({
  row,
  onChanged,
}: {
  row: CoachLearningRow;
  onChanged: () => void;
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
          },
        });
        onChanged();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "update_failed");
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
          className="flex-1 text-left"
        >
          <div className="font-medium text-sm">{row.title}</div>
          <div className="text-xs text-muted-foreground line-clamp-2">
            {row.rule_structured}
          </div>
        </button>
        <StatusBadge status={row.status} />
      </div>
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>p{row.priority}</span>
        <span>·</span>
        <span>v{row.version}</span>
        <span>·</span>
        <span>usos {row.usage_count}</span>
        {row.product_ref && (
          <>
            <span>·</span>
            <span>{row.product_ref}</span>
          </>
        )}
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
                onChange={(e) => setDraft({ ...draft, status: e.target.value })}
              >
                {COACH_LEARNING_STATUSES.filter((s) => s !== "archived").map((s) => (
                  <option key={s} value={s}>
                    {s}
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
          {err && (
            <div className="text-xs text-red-600 dark:text-red-400">{err}</div>
          )}
          <div className="flex items-center justify-end gap-2">
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
              {saving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Save className="h-3 w-3" />
              )}
              Salvar (nova versão)
            </button>
          </div>
        </div>
      )}
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
  return (
    <span
      className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${style}`}
    >
      {status}
    </span>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

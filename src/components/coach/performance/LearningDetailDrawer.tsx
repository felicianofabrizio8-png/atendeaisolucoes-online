// SPRINT 4 · FASE 5 — Drawer de detalhes do aprendizado.
// Mobile: tela cheia. Desktop: painel lateral. Carrega histórico sob demanda.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Pause, Play, Archive, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { HealthBadge } from "./HealthBadge";
import { getLearningPerformanceDetailFn } from "@/lib/coach-learnings/performance.functions";
import {
  archiveCoachLearningFn,
  restoreCoachLearningVersionFn,
  updateCoachLearningFn,
} from "@/lib/coach-learnings/coach-learnings.functions";
import { STATUS_LABEL_PT, type CoachLearningStatus } from "@/lib/coach-learnings/schema";
import { classifyLearningHealth } from "@/lib/coach-learnings/performance/health";
import { formatPercent, percentAriaLabel } from "@/lib/coach-learnings/performance/types";
import type { COACH_LEARNING_CATEGORIES } from "@/lib/coach-learnings/schema";

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium tabular-nums break-words">{value}</dd>
    </div>
  );
}

const REASON_LABEL: Record<string, string> = {
  product_match: "Produto relacionado",
  intent_match: "Intenção compatível",
  lexical_overlap: "Termos em comum",
  category_match: "Categoria compatível",
  feedback_history: "Histórico de feedback positivo",
  contextual_match: "Correspondência contextual",
};

const PENALTY_LABEL: Record<string, string> = {
  poor_feedback_history: "Histórico de feedback ruim",
  low_specificity: "Regra pouco específica",
  no_context_overlap: "Sem relação com o contexto",
  unsafe_instruction_pattern: "Padrão de instrução inseguro",
  near_duplicate: "Quase duplicado de outro aprendizado",
  context_budget_exceeded: "Limite de contexto excedido",
};

function labelOf(map: Record<string, string>, code: string): string {
  return map[code] ?? code;
}

export interface LearningDetailDrawerProps {
  learningId: string | null;
  onClose: () => void;
  onChanged: () => void;
}

export function LearningDetailDrawer({
  learningId,
  onClose,
  onChanged,
}: LearningDetailDrawerProps) {
  const detailFn = useServerFn(getLearningPerformanceDetailFn);
  const updateFn = useServerFn(updateCoachLearningFn);
  const archiveFn = useServerFn(archiveCoachLearningFn);
  const restoreFn = useServerFn(restoreCoachLearningVersionFn);
  const qc = useQueryClient();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const q = useQuery({
    queryKey: ["coach-learning-detail", learningId],
    enabled: Boolean(learningId),
    queryFn: () => detailFn({ data: { id: learningId as string, limit: 15 } }),
    staleTime: 15_000,
  });

  const learning = q.data?.learning ?? null;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["coach-learning-performance"] });
    qc.invalidateQueries({ queryKey: ["coach-learning-detail", learningId] });
    qc.invalidateQueries({ queryKey: ["coach-learnings"] });
    onChanged();
  };

  const statusMut = useMutation({
    mutationFn: async (next: CoachLearningStatus) => {
      if (!learning) return;
      await updateFn({
        data: {
          id: learning.id,
          expectedVersion: learning.version,
          patch: {
            category: learning.category as (typeof COACH_LEARNING_CATEGORIES)[number],
            product_ref: learning.product_ref,
            title: learning.title,
            description: learning.description,
            rule_structured: learning.rule_structured,
            positive_example: learning.positive_example,
            negative_example: learning.negative_example,
            priority: learning.priority,
            status: next,
          },
          origin: "manual_edit",
          changeReason: next === "paused" ? "pausado pelo painel" : "reativado pelo painel",
        },
      });
    },
    onSuccess: () => {
      toast.success("Status atualizado.");
      invalidate();
    },
    onError: () => toast.error("Não foi possível atualizar o status. Tente novamente."),
  });

  const archiveMut = useMutation({
    mutationFn: async () => {
      if (!learning) return;
      await archiveFn({ data: { id: learning.id } });
    },
    onSuccess: () => {
      toast.success("Aprendizado arquivado.");
      setConfirmArchive(false);
      invalidate();
      onClose();
    },
    onError: () => toast.error("Não foi possível arquivar. Tente novamente."),
  });

  const restoreMut = useMutation({
    mutationFn: async (targetVersion: number) => {
      if (!learning) return;
      await restoreFn({
        data: {
          learningId: learning.id,
          targetVersion,
          expectedVersion: learning.version,
          changeReason: "restaurado pelo painel de desempenho",
        },
      });
    },
    onSuccess: () => {
      toast.success("Versão restaurada.");
      invalidate();
    },
    onError: () => toast.error("Não foi possível restaurar a versão."),
  });

  const health = learning
    ? classifyLearningHealth({
        status: learning.status,
        confidence: learning.confidence,
        success_rate: learning.success_rate,
        feedback_sample_count: learning.feedback_sample_count,
        negative_feedback_count: learning.negative_feedback_count,
        usage_count: learning.usage_count,
        times_retrieved: learning.times_retrieved,
      })
    : "no_evidence";

  return (
    <Sheet open={Boolean(learningId)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl overflow-y-auto p-4"
        data-testid="learning-detail-drawer"
      >
        <SheetHeader className="p-0">
          <SheetTitle className="pr-8 text-base leading-snug">
            {learning?.title ?? "Detalhes do aprendizado"}
          </SheetTitle>
          <SheetDescription className="text-xs">
            Desempenho e rastreabilidade. Nenhum conteúdo de conversa é exibido.
          </SheetDescription>
        </SheetHeader>

        {q.isLoading && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Carregando detalhes…
          </div>
        )}

        {q.isError && (
          <div role="alert" className="my-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            Não foi possível carregar os detalhes deste aprendizado.
            <Button variant="outline" size="sm" className="mt-2" onClick={() => q.refetch()}>
              Tentar novamente
            </Button>
          </div>
        )}

        {learning && (
          <div className="mt-3 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <HealthBadge code={health} />
              <span className="rounded-full border border-border px-2 py-0.5 text-[11px]">
                {STATUS_LABEL_PT[learning.status] ?? learning.status}
              </span>
              <span className="text-[11px] text-muted-foreground">
                v{learning.version} · prioridade {learning.priority} · {learning.category}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {learning.status === "active" ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  disabled={statusMut.isPending}
                  onClick={() => statusMut.mutate("paused")}
                  data-testid="action-pause"
                >
                  <Pause className="h-4 w-4" aria-hidden="true" /> Pausar
                </Button>
              ) : (
                learning.status !== "archived" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11"
                    disabled={statusMut.isPending}
                    onClick={() => statusMut.mutate("active")}
                    data-testid="action-resume"
                  >
                    <Play className="h-4 w-4" aria-hidden="true" /> Reativar
                  </Button>
                )
              )}
              {learning.status !== "archived" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  onClick={() => setConfirmArchive(true)}
                  data-testid="action-archive"
                >
                  <Archive className="h-4 w-4" aria-hidden="true" /> Arquivar
                </Button>
              )}
            </div>

            <Tabs defaultValue="conteudo">
              <TabsList className="w-full justify-start overflow-x-auto">
                <TabsTrigger value="conteudo">Conteúdo</TabsTrigger>
                <TabsTrigger value="desempenho">Desempenho</TabsTrigger>
                <TabsTrigger value="uso">Uso</TabsTrigger>
                <TabsTrigger value="feedback">Feedback</TabsTrigger>
                <TabsTrigger value="versoes">Versões</TabsTrigger>
              </TabsList>

              <TabsContent value="conteudo" className="space-y-3 pt-3">
                <div>
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground">Regra</h4>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{learning.rule_structured}</p>
                </div>
                <div>
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground">Descrição</h4>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{learning.description}</p>
                </div>
                <dl className="grid grid-cols-2 gap-3">
                  <Field label="Produto" value={learning.product_ref ?? "—"} />
                  <Field label="Criado em" value={fmtDateTime(learning.created_at)} />
                  <Field label="Atualizado em" value={fmtDateTime(learning.updated_at)} />
                  <Field label="Origem" value={learning.source_conversation_id ? "Ensino na conversa" : "Manual"} />
                </dl>
              </TabsContent>

              <TabsContent value="desempenho" className="pt-3">
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Field label="Confiança" value={formatPercent(learning.confidence, 1)} />
                  <Field
                    label="Taxa de sucesso"
                    value={
                      learning.feedback_sample_count > 0
                        ? formatPercent(learning.success_rate, 1)
                        : "—"
                    }
                  />
                  <Field label="Amostras" value={String(learning.feedback_sample_count)} />
                  <Field label="Positivos" value={String(learning.positive_feedback_count)} />
                  <Field label="Negativos" value={String(learning.negative_feedback_count)} />
                  <Field label="Aplicações" value={String(learning.usage_count)} />
                  <Field label="Recuperações" value={String(learning.times_retrieved)} />
                  <Field label="Último uso" value={fmtDateTime(learning.last_used_at)} />
                  <Field label="Último feedback" value={fmtDateTime(learning.last_feedback_at)} />
                </dl>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Confiança e taxa de sucesso são derivadas dos contadores de feedback e não podem
                  ser editadas manualmente.
                </p>
              </TabsContent>

              <TabsContent value="uso" className="space-y-2 pt-3">
                {(q.data?.retrievals.length ?? 0) === 0 ? (
                  <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                    Este aprendizado ainda não foi recuperado em nenhuma sugestão.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {q.data?.retrievals.map((t) => (
                      <li key={t.id} className="rounded-md border border-border p-2 text-xs">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-medium">{fmtDateTime(t.created_at)}</span>
                          <span aria-hidden="true">·</span>
                          <span>rank {t.rank ?? "—"}</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            score{" "}
                            {t.final_score === null ? "—" : t.final_score.toFixed(3)}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {t.strategy === "contextual_v1"
                              ? "contextual"
                              : t.strategy
                                ? "fallback estático"
                                : (t.selection_reason ?? "—")}
                          </span>
                          {t.usage_counted && (
                            <span className="rounded bg-muted px-1">uso contabilizado</span>
                          )}
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          sugestão {t.suggestion_ref ?? "—"} · conversa {t.conversation_ref ?? "—"}
                          {t.suggestion_feedback ? ` · feedback ${t.suggestion_feedback}` : ""}
                        </div>
                        {t.matched_reasons.length > 0 && (
                          <div className="mt-1">
                            Motivos: {t.matched_reasons.map((r) => labelOf(REASON_LABEL, r)).join(", ")}
                          </div>
                        )}
                        {t.penalties.length > 0 && (
                          <div className="mt-1 text-destructive">
                            Penalizações: {t.penalties.map((p) => labelOf(PENALTY_LABEL, p)).join(", ")}
                          </div>
                        )}
                        {t.fallback_reason && (
                          <div className="mt-1">Motivo do fallback: {t.fallback_reason}</div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {(q.data?.retrievals.length ?? 0) > 0 && (
                  <details
                    className="rounded-md border border-border p-2 text-xs"
                    open={showRaw}
                    onToggle={(e) => setShowRaw((e.currentTarget as HTMLDetailsElement).open)}
                  >
                    <summary className="cursor-pointer">Ver dados técnicos do ranking</summary>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-[10px]">
                      {JSON.stringify(q.data?.retrievals.map((r) => r.raw) ?? [], null, 2)}
                    </pre>
                  </details>
                )}
              </TabsContent>

              <TabsContent value="feedback" className="space-y-2 pt-3">
                {(q.data?.feedbackEvents.length ?? 0) === 0 ? (
                  <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                    Nenhuma avaliação registrada para este aprendizado.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {q.data?.feedbackEvents.map((f) => (
                      <li key={f.id} className="rounded-md border border-border p-2 text-xs">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-medium">{fmtDateTime(f.created_at)}</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {f.new_feedback === "positive"
                              ? "👍 positivo"
                              : f.new_feedback === "negative"
                                ? "👎 negativo"
                                : "neutro"}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{f.transition ?? "—"}</span>
                          {f.source && <span className="rounded bg-muted px-1">{f.source}</span>}
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          confiança {formatPercent(f.confidence_before, 1)} →{" "}
                          <span aria-label={percentAriaLabel(f.confidence_after)}>
                            {formatPercent(f.confidence_after, 1)}
                          </span>{" "}
                          · sucesso {formatPercent(f.success_rate_before, 1)} →{" "}
                          {formatPercent(f.success_rate_after, 1)}
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          peso {f.event_weight === null ? "—" : f.event_weight.toFixed(3)} · rank{" "}
                          {f.rank ?? "—"} · autor {f.actor_ref ?? "—"}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>

              <TabsContent value="versoes" className="space-y-2 pt-3">
                {(q.data?.versions.length ?? 0) === 0 ? (
                  <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                    Sem histórico de versões.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {q.data?.versions.map((v) => (
                      <li
                        key={v.id}
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-border p-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-medium">
                            v{v.version} · {fmtDateTime(v.created_at)}
                          </div>
                          <div className="truncate text-muted-foreground">
                            {v.origin} {v.change_reason ? `· ${v.change_reason}` : ""}
                          </div>
                        </div>
                        {v.version !== learning.version && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="min-h-11"
                            disabled={restoreMut.isPending}
                            onClick={() => restoreMut.mutate(v.version)}
                            aria-label={`Restaurar versão ${v.version}`}
                          >
                            <RotateCcw className="h-4 w-4" aria-hidden="true" /> Restaurar
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>

      <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar este aprendizado?</AlertDialogTitle>
            <AlertDialogDescription>
              Ele deixa de ser usado pelo Coach e some das listas padrão. Nada é excluído: o
              histórico permanece disponível e a ação fica registrada na auditoria.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => archiveMut.mutate()}
              data-testid="confirm-archive"
            >
              Arquivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

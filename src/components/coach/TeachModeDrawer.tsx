// Teach Mode Drawer — BLOCO 3: UX do aprendizado.
//
// Escopo desta versão:
//   - Múltiplos exemplos positivos e negativos com add/remove/reordenar
//     (limite MAX_EXAMPLES, compat backend via serialização em string única).
//   - Seções visuais: Identificação / Regra / Exemplos.
//   - Resumo estruturado (Situação / O que fazer / Evitar / Categoria /
//     Prioridade) derivado das funções puras.
//   - Estados de processamento com aria-live e cópia clara.
//   - Estado de sucesso NÃO fecha automaticamente; oferece ações
//     Fechar / Ver aprendizado (quando callback existir).
//   - Estado de erro próximo da ação, com role="alert" e retry por fase.
//   - Modal de sobrescrita lista os campos em PT.
//   - Guard de "alterações não salvas" ao fechar (Esc / X / clique fora).
//   - Foco enviado para o primeiro campo inválido.
//
// Camadas puras testáveis: coach-learnings/examples.ts,
// coach-learnings/interpretation.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Brain,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  teachModeExtractFn,
  createCoachLearningFn,
} from "@/lib/coach-learnings/coach-learnings.functions";
import type { CoachLearningDraft } from "@/lib/coach-learnings/schema";
import { COACH_LEARNING_CATEGORIES } from "@/lib/coach-learnings/schema";
import {
  getSafeLearningError,
  validateLearningDraft,
  hasValidationErrors,
  type DraftValidationErrors,
  type SafeLearningError,
} from "@/lib/coach-learnings/errors";
import {
  buildLearningSummary,
  CATEGORY_LABELS_PT,
  diffDrafts,
  parseStructuredRule,
} from "@/lib/coach-learnings/interpretation";
import {
  addExample,
  buildFinalPayload,
  buildInitialExamplesUi,
  ensureAtLeastOne,
  FIELD_LABELS_PT,
  hasChanges,
  MAX_EXAMPLES,
  moveExample,
  removeExampleAt,
  updateExampleAt,
} from "@/lib/coach-learnings/examples";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

export interface TeachSourceSuggestion {
  suggestion_id: string;
  client_message: string | null;
  suggestion_text: string;
  situation: string | null;
  next_action: string | null;
  product_or_category: string | null;
  sources_used: unknown;
  grounding_score: number | null;
  domain_validation: unknown;
  conversation_id: string;
}

interface TeachModeDrawerProps {
  open: boolean;
  onClose: () => void;
  seedExplanation?: string;
  conversationId?: string | null;
  sourceSuggestion?: TeachSourceSuggestion | null;
  /** Se fornecido, o botão "Ver aprendizado" aparece após salvar. */
  onViewSavedLearning?: (learningId: string) => void;
}

type PhaseUi = "idle" | "extracting" | "editing" | "saving" | "retrying" | "saved";

function priorityLabel(p: number): string {
  if (p >= 80) return "Alta";
  if (p >= 55) return "Média";
  if (p >= 30) return "Baixa";
  return "Muito baixa";
}

export function TeachModeDrawer({
  open,
  onClose,
  seedExplanation,
  conversationId,
  sourceSuggestion,
  onViewSavedLearning,
}: TeachModeDrawerProps) {
  const extractFn = useServerFn(teachModeExtractFn);
  const createFn = useServerFn(createCoachLearningFn);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [draft, setDraft] = useState<CoachLearningDraft | null>(null);
  const [positives, setPositives] = useState<string[]>([""]);
  const [negatives, setNegatives] = useState<string[]>([""]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [safeError, setSafeError] = useState<SafeLearningError | null>(null);
  const [errorPhase, setErrorPhase] = useState<"extract" | "save" | null>(null);
  const [validation, setValidation] = useState<DraftValidationErrors>({});
  const [savedLearningId, setSavedLearningId] = useState<string | null>(null);
  const [usedFallback, setUsedFallback] = useState(false);
  const [pendingOverwrite, setPendingOverwrite] = useState<null | {
    text: string;
    turns: Turn[];
    fields: string[];
  }>(null);
  const [closeGuard, setCloseGuard] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const ruleRef = useRef<HTMLTextAreaElement>(null);
  const categoryRef = useRef<HTMLSelectElement>(null);
  const priorityRef = useRef<HTMLInputElement>(null);
  const errorBannerRef = useRef<HTMLDivElement>(null);

  const lastExtractPayloadRef = useRef<{ text: string; turns: Turn[] } | null>(null);
  const pristineDraftRef = useRef<CoachLearningDraft | null>(null);
  const pristinePositivesRef = useRef<string[]>([]);
  const pristineNegativesRef = useRef<string[]>([]);

  // ------------------------------------------------------------------
  // Reset on open — inicializa turnos, seed e refs pristine.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!open) return;
    setDraft(null);
    setPositives([""]);
    setNegatives([""]);
    setSafeError(null);
    setErrorPhase(null);
    setValidation({});
    setSavedLearningId(null);
    setUsedFallback(false);
    setPendingOverwrite(null);
    setCloseGuard(false);
    lastExtractPayloadRef.current = null;
    pristineDraftRef.current = null;
    pristinePositivesRef.current = [];
    pristineNegativesRef.current = [];
    if (sourceSuggestion) {
      const ctxLines = [
        sourceSuggestion.client_message
          ? `Mensagem do cliente: "${sourceSuggestion.client_message}"`
          : null,
        `Sugestão gerada: "${sourceSuggestion.suggestion_text}"`,
        sourceSuggestion.situation ? `Situação: ${sourceSuggestion.situation}` : null,
        sourceSuggestion.next_action
          ? `Próxima ação sugerida: ${sourceSuggestion.next_action}`
          : null,
        sourceSuggestion.product_or_category
          ? `Produto/categoria: ${sourceSuggestion.product_or_category}`
          : null,
      ]
        .filter(Boolean)
        .join("\n");
      setTurns([
        {
          role: "assistant",
          content:
            "Entendi que esta sugestão precisa melhorar. O que ficou errado e como o Coach deveria responder nesse tipo de situação?",
        },
        ...(ctxLines
          ? [{ role: "assistant" as const, content: `Contexto:\n${ctxLines}` }]
          : []),
      ]);
      setInput(seedExplanation ?? "");
    } else {
      setTurns([]);
      setInput(seedExplanation ?? "");
    }
    setTimeout(() => inputRef.current?.focus(), 60);
  }, [open, seedExplanation, sourceSuggestion]);

  // ------------------------------------------------------------------
  // Validação sempre que o draft muda.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!draft) {
      setValidation({});
      return;
    }
    setValidation(
      validateLearningDraft({
        title: draft.title,
        description: draft.description,
        rule_structured: draft.rule_structured,
        category: draft.category,
        priority: draft.priority,
        allowedCategories: COACH_LEARNING_CATEGORIES,
      }),
    );
  }, [draft]);

  const canSave = useMemo(
    () => !!draft && !saving && !hasValidationErrors(validation),
    [draft, saving, validation],
  );

  const phase: PhaseUi = savedLearningId
    ? "saved"
    : retrying
      ? "retrying"
      : saving
        ? "saving"
        : loading
          ? "extracting"
          : draft
            ? "editing"
            : "idle";

  const dirty = useMemo(() => {
    if (!draft || savedLearningId) return false;
    return hasChanges(
      {
        draft: pristineDraftRef.current,
        positives: pristinePositivesRef.current,
        negatives: pristineNegativesRef.current,
      },
      { draft, positives, negatives },
    );
  }, [draft, positives, negatives, savedLearningId]);

  // ------------------------------------------------------------------
  // Guard de fechamento — Esc / X / clique fora.
  // ------------------------------------------------------------------
  const requestClose = useCallback(() => {
    if (savedLearningId || !dirty) {
      onClose();
      return;
    }
    setCloseGuard(true);
  }, [dirty, onClose, savedLearningId]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (pendingOverwrite) {
        setPendingOverwrite(null);
        return;
      }
      if (closeGuard) {
        setCloseGuard(false);
        return;
      }
      e.stopPropagation();
      requestClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, requestClose, closeGuard, pendingOverwrite]);

  // Foco vai para o banner de erro quando um erro aparece.
  useEffect(() => {
    if (safeError && errorBannerRef.current) {
      errorBannerRef.current.focus();
    }
  }, [safeError]);

  if (!open) return null;

  // ------------------------------------------------------------------
  // Extração / commit / retry
  // ------------------------------------------------------------------
  async function runExtract(
    text: string,
    priorTurns: Turn[],
    opts: { force?: boolean; isRetry?: boolean } = {},
  ) {
    if (!opts.force && draft && pristineDraftRef.current) {
      const changed = diffDrafts(pristineDraftRef.current, draft);
      // Também sinalize mudanças em exemplos (comparando com pristine).
      const examplesChanged =
        !arraysEqualNonEmpty(pristinePositivesRef.current, positives) ||
        !arraysEqualNonEmpty(pristineNegativesRef.current, negatives);
      const fields = [
        ...changed,
        ...(examplesChanged && !changed.includes("positive_example") ? ["positive_example"] : []),
        ...(examplesChanged && !changed.includes("negative_example") ? ["negative_example"] : []),
      ];
      if (fields.length > 0) {
        setPendingOverwrite({ text, turns: priorTurns, fields });
        return;
      }
    }
    setSafeError(null);
    setErrorPhase(null);
    setPendingOverwrite(null);
    if (opts.isRetry) setRetrying(true);
    setLoading(true);
    lastExtractPayloadRef.current = { text, turns: priorTurns };
    try {
      const res = await extractFn({
        data: {
          explanation: text,
          priorTurns,
          clientMessage: sourceSuggestion?.client_message ?? null,
          suggestionText: sourceSuggestion?.suggestion_text ?? null,
        },
      });
      if (!res.ok) {
        const safe = getSafeLearningError(res.error);
        console.error("[TeachMode] extract failed", { code: safe.code, raw: res.error });
        setSafeError(safe);
        setErrorPhase("extract");
        setTurns((t) => [
          ...t,
          {
            role: "assistant",
            content:
              "Ainda não consegui estruturar. Descreva com mais detalhes: quando aplicar, o que fazer e o que evitar.",
          },
        ]);
        return;
      }
      const nextDraft = res.draft;
      setDraft(nextDraft);
      pristineDraftRef.current = nextDraft;
      const ui = buildInitialExamplesUi({
        draft: nextDraft,
        suggestionText: sourceSuggestion?.suggestion_text ?? null,
      });
      setPositives(ui.positives);
      setNegatives(ui.negatives);
      pristinePositivesRef.current = ui.positives;
      pristineNegativesRef.current = ui.negatives;
      setUsedFallback(!!res.usedFallback);
      setTurns((t) => [
        ...t,
        {
          role: "assistant",
          content: res.usedFallback
            ? "Não consegui estruturar totalmente. Preenchi um rascunho de segurança — revise ao lado antes de salvar."
            : `Entendi como "${nextDraft.title}". Revise o resumo ao lado antes de confirmar.`,
        },
      ]);
    } catch (err) {
      const safe = getSafeLearningError(err);
      console.error("[TeachMode] extract threw", { code: safe.code, err });
      setSafeError(safe);
      setErrorPhase("extract");
    } finally {
      setLoading(false);
      setRetrying(false);
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (text.length < 3 || loading) return;
    const nextTurns: Turn[] = [...turns, { role: "user", content: text }];
    setTurns(nextTurns);
    setInput("");
    await runExtract(text, nextTurns.slice(0, -1));
  }

  function focusFirstInvalid(v: DraftValidationErrors) {
    if (v.title) return titleRef.current?.focus();
    if (v.description) return descRef.current?.focus();
    if (v.rule_structured) return ruleRef.current?.focus();
    if (v.category) return categoryRef.current?.focus();
    if (v.priority) return priorityRef.current?.focus();
  }

  async function handleSave(opts: { isRetry?: boolean } = {}) {
    if (!draft || saving) return;
    const v = validateLearningDraft({
      title: draft.title,
      description: draft.description,
      rule_structured: draft.rule_structured,
      category: draft.category,
      priority: draft.priority,
      allowedCategories: COACH_LEARNING_CATEGORIES,
    });
    setValidation(v);
    if (hasValidationErrors(v)) {
      setSafeError(getSafeLearningError("input_invalid"));
      setErrorPhase("save");
      focusFirstInvalid(v);
      return;
    }
    if (opts.isRetry) setRetrying(true);
    setSaving(true);
    setSafeError(null);
    setErrorPhase(null);
    try {
      const payload = buildFinalPayload({ draft, positives, negatives });
      const res = await createFn({
        data: {
          draft: payload,
          sourceConversationId:
            conversationId ?? sourceSuggestion?.conversation_id ?? null,
          sourceSuggestionId: sourceSuggestion?.suggestion_id ?? null,
        },
      });
      setSavedLearningId(res.id);
      toast.success("Aprendizado salvo com sucesso.", {
        description: "O Coach utilizará esta regra nas próximas conversas.",
      });
      // NÃO fecha automaticamente — usuário confirma via botão.
    } catch (err) {
      const safe = getSafeLearningError(err);
      console.error("[TeachMode] save failed", { code: safe.code, err });
      setSafeError(safe);
      setErrorPhase("save");
    } finally {
      setSaving(false);
      setRetrying(false);
    }
  }

  async function handleRetry() {
    if (!safeError?.retryable) return;
    if (errorPhase === "save") {
      await handleSave({ isRetry: true });
      return;
    }
    if (errorPhase === "extract") {
      const payload = lastExtractPayloadRef.current;
      if (!payload) return;
      await runExtract(payload.text, payload.turns, { isRetry: true });
    }
  }

  function updateDraft<K extends keyof CoachLearningDraft>(
    key: K,
    value: CoachLearningDraft[K],
  ) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  const phaseCopy: Record<PhaseUi, { title: string; hint?: string }> = {
    idle: { title: "" },
    extracting: {
      title: "Interpretando o aprendizado…",
      hint: "Estamos organizando sua orientação em uma regra reutilizável.",
    },
    editing: { title: "" },
    saving: { title: "Salvando aprendizado…", hint: "Registrando na base do Coach." },
    retrying: { title: "Tentando novamente…" },
    saved: { title: "Aprendizado salvo." },
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Ensinar IA"
      onClick={requestClose}
    >
      <div
        className="relative h-full w-full max-w-4xl bg-background border-l border-border shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b border-border p-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Brain className="h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0">
              <div className="font-semibold text-sm">Ensinar IA</div>
              <div className="text-xs text-muted-foreground truncate">
                Explique com suas palavras. A IA estrutura como um aprendizado permanente da empresa.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={requestClose}
            className="shrink-0 p-2 min-h-11 min-w-11 rounded hover:bg-muted grid place-items-center"
            aria-label="Fechar Ensinar IA"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* aria-live global para estados de processamento */}
        <div
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
          data-testid="teach-phase-live"
        >
          {phaseCopy[phase].title}
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2">
          {/* -------- Coluna esquerda: chat + resumo -------- */}
          <section className="flex flex-col border-b md:border-b-0 md:border-r border-border min-h-0">
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {turns.length === 0 && (
                <div className="text-xs text-muted-foreground p-3 rounded bg-muted/50 border border-border">
                  Exemplo: "Quando o cliente pedir desconto na piscina Prainha, ofereça brinde de escada em vez de reduzir preço."
                </div>
              )}
              {turns.map((t, i) => (
                <div
                  key={i}
                  className={cn(
                    "text-sm rounded-lg px-3 py-2 max-w-[85%] whitespace-pre-wrap break-words",
                    t.role === "user"
                      ? "bg-primary text-primary-foreground self-end ml-auto"
                      : "bg-muted text-foreground",
                  )}
                >
                  {t.content}
                </div>
              ))}
              {(phase === "extracting" || phase === "retrying") && (
                <div
                  className="text-xs text-muted-foreground flex items-center gap-2"
                  data-testid="teach-loading-inline"
                >
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {phaseCopy[phase].title}
                </div>
              )}
              {draft && (
                <div className="pt-2">
                  <LearningSummaryCard draft={draft} />
                </div>
              )}
            </div>
            <div className="border-t border-border p-3 space-y-2">
              <label htmlFor="teach-input" className="sr-only">
                Explicação para ensinar a IA
              </label>
              <textarea
                id="teach-input"
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                rows={3}
                placeholder="Descreva o aprendizado que quer ensinar à IA..."
                className="w-full resize-none rounded border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
              />
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] text-muted-foreground">Ctrl/Cmd + Enter para enviar</div>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={loading || input.trim().length < 3}
                  className="inline-flex items-center gap-1 min-h-9 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs hover:opacity-90 disabled:opacity-40"
                >
                  <Sparkles className="h-3 w-3" /> Estruturar
                </button>
              </div>
            </div>
          </section>

          {/* -------- Coluna direita: formulário estruturado -------- */}
          <section className="flex flex-col min-h-0 overflow-y-auto">
            <div className="p-4 space-y-5">
              {!draft ? (
                <div className="text-sm text-muted-foreground p-4 rounded border border-dashed border-border">
                  Envie sua explicação no chat para gerar o preview.
                </div>
              ) : savedLearningId ? (
                <SavedState
                  draft={draft}
                  learningId={savedLearningId}
                  onClose={onClose}
                  onView={onViewSavedLearning}
                />
              ) : (
                <>
                  {usedFallback && (
                    <div
                      data-testid="teach-fallback-banner"
                      className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300"
                    >
                      A IA não retornou uma resposta estruturada. Um rascunho de segurança
                      foi preenchido com sua explicação — revise antes de salvar.
                    </div>
                  )}

                  {/* IDENTIFICAÇÃO */}
                  <Section title="Identificação">
                    <Field
                      label="Título"
                      htmlFor="teach-title"
                      error={validation.title}
                      testId="teach-field-title"
                    >
                      <input
                        id="teach-title"
                        ref={titleRef}
                        type="text"
                        value={draft.title}
                        onChange={(e) => updateDraft("title", e.target.value)}
                        maxLength={120}
                        aria-invalid={!!validation.title}
                        className={cn(
                          "w-full rounded border bg-background px-2 py-1.5 text-sm",
                          validation.title ? "border-destructive" : "border-border",
                        )}
                      />
                    </Field>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Field
                        label="Categoria"
                        htmlFor="teach-category"
                        error={validation.category}
                        testId="teach-field-category"
                      >
                        <select
                          id="teach-category"
                          ref={categoryRef}
                          value={draft.category}
                          onChange={(e) =>
                            updateDraft(
                              "category",
                              e.target.value as CoachLearningDraft["category"],
                            )
                          }
                          aria-invalid={!!validation.category}
                          className={cn(
                            "w-full rounded border bg-background px-2 py-1.5 text-sm",
                            validation.category ? "border-destructive" : "border-border",
                          )}
                        >
                          {COACH_LEARNING_CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {CATEGORY_LABELS_PT[c]}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field
                        label="Prioridade (0-100)"
                        htmlFor="teach-priority"
                        error={validation.priority}
                        testId="teach-field-priority"
                      >
                        <input
                          id="teach-priority"
                          ref={priorityRef}
                          type="number"
                          min={0}
                          max={100}
                          value={draft.priority}
                          onChange={(e) =>
                            updateDraft(
                              "priority",
                              Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                            )
                          }
                          aria-invalid={!!validation.priority}
                          className={cn(
                            "w-full rounded border bg-background px-2 py-1.5 text-sm",
                            validation.priority ? "border-destructive" : "border-border",
                          )}
                        />
                      </Field>
                    </div>
                    <Field label="Produto ou contexto (opcional)" htmlFor="teach-product">
                      <input
                        id="teach-product"
                        type="text"
                        value={draft.product_ref ?? ""}
                        onChange={(e) =>
                          updateDraft("product_ref", e.target.value || null)
                        }
                        className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
                      />
                    </Field>
                  </Section>

                  {/* REGRA */}
                  <Section title="Regra">
                    <Field
                      label="Descrição"
                      htmlFor="teach-description"
                      error={validation.description}
                      testId="teach-field-description"
                    >
                      <textarea
                        id="teach-description"
                        ref={descRef}
                        rows={2}
                        value={draft.description}
                        onChange={(e) => updateDraft("description", e.target.value)}
                        aria-invalid={!!validation.description}
                        className={cn(
                          "w-full rounded border bg-background px-2 py-1.5 text-sm resize-none",
                          validation.description ? "border-destructive" : "border-border",
                        )}
                      />
                    </Field>
                    <Field
                      label="Regra estruturada (o que a IA deve seguir)"
                      htmlFor="teach-rule"
                      error={validation.rule_structured}
                      testId="teach-field-rule"
                    >
                      <textarea
                        id="teach-rule"
                        ref={ruleRef}
                        rows={4}
                        value={draft.rule_structured}
                        onChange={(e) => updateDraft("rule_structured", e.target.value)}
                        aria-invalid={!!validation.rule_structured}
                        className={cn(
                          "w-full rounded border bg-background px-2 py-1.5 text-sm resize-none font-mono",
                          validation.rule_structured ? "border-destructive" : "border-border",
                        )}
                      />
                    </Field>
                  </Section>

                  {/* EXEMPLOS */}
                  <Section title="Exemplos">
                    <ExampleList
                      label="Exemplos positivos"
                      testIdPrefix="teach-positive"
                      items={positives}
                      onChange={setPositives}
                    />
                    <ExampleList
                      label="Exemplos negativos (o que evitar)"
                      testIdPrefix="teach-negative"
                      items={negatives}
                      onChange={setNegatives}
                    />
                  </Section>
                </>
              )}

              {safeError && !savedLearningId && (
                <div
                  ref={errorBannerRef}
                  tabIndex={-1}
                  role="alert"
                  aria-live="assertive"
                  data-testid="teach-error-banner"
                  data-error-phase={errorPhase ?? "unknown"}
                  className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs outline-none focus:ring-2 focus:ring-destructive/40"
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-destructive">
                        {errorPhase === "save"
                          ? "Não foi possível salvar o aprendizado."
                          : "Não foi possível interpretar o aprendizado."}
                      </div>
                      <div className="text-foreground mt-0.5 break-words">
                        {safeError.message}
                      </div>
                      {safeError.hint && (
                        <div className="text-muted-foreground mt-0.5 break-words">
                          {safeError.hint}
                        </div>
                      )}
                    </div>
                    {safeError.retryable && (
                      <button
                        type="button"
                        onClick={handleRetry}
                        disabled={loading || saving}
                        data-testid="teach-retry"
                        className="inline-flex items-center gap-1 min-h-9 rounded border border-destructive/40 text-destructive px-2 py-1 text-[11px] hover:bg-destructive/10 shrink-0 disabled:opacity-40"
                      >
                        <RefreshCw className="h-3 w-3" /> Tentar novamente
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
            {!savedLearningId && (
              <div className="border-t border-border p-3 flex items-center justify-end gap-2 mt-auto">
                <button
                  type="button"
                  onClick={requestClose}
                  className="min-h-9 rounded border border-border px-3 py-1.5 text-xs hover:bg-muted"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => handleSave()}
                  disabled={!canSave}
                  data-testid="teach-save"
                  className="inline-flex items-center gap-1 min-h-9 rounded bg-primary text-primary-foreground px-3 py-1.5 text-xs hover:opacity-90 disabled:opacity-40"
                >
                  {saving ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Save className="h-3 w-3" />
                  )}
                  {saving ? "Salvando…" : "Salvar aprendizado"}
                </button>
              </div>
            )}
          </section>
        </div>

        {/* ---------------- Modais ---------------- */}
        {pendingOverwrite && (
          <OverlayModal
            testId="teach-overwrite-confirm"
            title="Nova interpretação vai substituir seus ajustes"
          >
            <div className="text-xs text-muted-foreground">
              A nova interpretação irá substituir:
            </div>
            <ul className="text-xs list-disc pl-5 space-y-0.5">
              {pendingOverwrite.fields.map((f) => (
                <li key={f} className="font-medium text-foreground">
                  {FIELD_LABELS_PT[f] ?? f}
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2 pt-1 flex-wrap">
              <button
                type="button"
                onClick={() => setPendingOverwrite(null)}
                className="min-h-9 rounded border border-border px-3 py-1.5 text-xs hover:bg-muted"
              >
                Manter minhas alterações
              </button>
              <button
                type="button"
                data-testid="teach-overwrite-confirm-yes"
                onClick={() => {
                  const p = pendingOverwrite;
                  setPendingOverwrite(null);
                  if (p) runExtract(p.text, p.turns, { force: true });
                }}
                className="min-h-9 rounded bg-primary text-primary-foreground px-3 py-1.5 text-xs hover:opacity-90"
              >
                Usar nova interpretação
              </button>
            </div>
          </OverlayModal>
        )}

        {closeGuard && (
          <OverlayModal testId="teach-close-guard" title="Descartar alterações?">
            <div className="text-xs text-muted-foreground">
              Você possui alterações que ainda não foram salvas.
            </div>
            <div className="flex justify-end gap-2 pt-1 flex-wrap">
              <button
                type="button"
                onClick={() => setCloseGuard(false)}
                className="min-h-9 rounded border border-border px-3 py-1.5 text-xs hover:bg-muted"
              >
                Continuar editando
              </button>
              <button
                type="button"
                data-testid="teach-close-guard-confirm"
                onClick={() => {
                  setCloseGuard(false);
                  onClose();
                }}
                className="min-h-9 rounded bg-destructive text-destructive-foreground px-3 py-1.5 text-xs hover:opacity-90"
              >
                Descartar alterações
              </button>
            </div>
          </OverlayModal>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponentes
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
  error,
  testId,
  htmlFor,
}: {
  label: string;
  children: React.ReactNode;
  error?: string;
  testId?: string;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1" data-testid={testId}>
      <label
        htmlFor={htmlFor}
        className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wide"
      >
        {label}
      </label>
      {children}
      {error && (
        <span
          role="alert"
          data-testid={testId ? `${testId}-error` : undefined}
          className="block text-[11px] text-destructive"
        >
          {error}
        </span>
      )}
    </div>
  );
}

function ExampleList({
  label,
  items,
  onChange,
  testIdPrefix,
}: {
  label: string;
  items: string[];
  onChange: (next: string[]) => void;
  testIdPrefix: string;
}) {
  const normalized = ensureAtLeastOne(items);
  const canAdd = normalized.length < MAX_EXAMPLES;
  return (
    <div className="space-y-2" data-testid={`${testIdPrefix}-list`}>
      <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </div>
      <ul className="space-y-2">
        {normalized.map((value, idx) => {
          const id = `${testIdPrefix}-item-${idx}`;
          return (
            <li key={idx} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-start">
              <label htmlFor={id} className="sr-only">
                {label} {idx + 1}
              </label>
              <textarea
                id={id}
                data-testid={id}
                rows={2}
                value={value}
                onChange={(e) => onChange(updateExampleAt(normalized, idx, e.target.value))}
                placeholder={`${label.replace(/s\b/i, "")} ${idx + 1}`}
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm resize-none"
              />
              <div className="flex flex-col gap-1 shrink-0">
                <button
                  type="button"
                  data-testid={`${testIdPrefix}-move-up-${idx}`}
                  aria-label={`Mover ${label} ${idx + 1} para cima`}
                  disabled={idx === 0}
                  onClick={() => onChange(moveExample(normalized, idx, idx - 1))}
                  className="min-h-8 min-w-8 grid place-items-center rounded border border-border hover:bg-muted disabled:opacity-30"
                >
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  data-testid={`${testIdPrefix}-move-down-${idx}`}
                  aria-label={`Mover ${label} ${idx + 1} para baixo`}
                  disabled={idx === normalized.length - 1}
                  onClick={() => onChange(moveExample(normalized, idx, idx + 1))}
                  className="min-h-8 min-w-8 grid place-items-center rounded border border-border hover:bg-muted disabled:opacity-30"
                >
                  <ArrowDown className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  data-testid={`${testIdPrefix}-remove-${idx}`}
                  aria-label={`Remover ${label} ${idx + 1}`}
                  onClick={() => onChange(removeExampleAt(normalized, idx))}
                  className="min-h-8 min-w-8 grid place-items-center rounded border border-border text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        data-testid={`${testIdPrefix}-add`}
        onClick={() => onChange(addExample(normalized))}
        disabled={!canAdd}
        className="inline-flex items-center gap-1 min-h-9 rounded border border-dashed border-border px-3 py-1.5 text-[11px] hover:bg-muted disabled:opacity-40"
      >
        <Plus className="h-3 w-3" /> Adicionar {label.toLowerCase()}
      </button>
      {!canAdd && (
        <div className="text-[10px] text-muted-foreground">
          Máximo de {MAX_EXAMPLES} exemplos por lista.
        </div>
      )}
    </div>
  );
}

function LearningSummaryCard({ draft }: { draft: CoachLearningDraft }) {
  const summary = buildLearningSummary(draft);
  const rule = parseStructuredRule(draft.rule_structured);
  const doList = summary.bullets
    .filter((b) => !b.startsWith("não "))
    .slice(0, 6);
  const avoidList = summary.bullets
    .filter((b) => b.startsWith("não "))
    .map((b) => b.replace(/^não\s+/, ""))
    .slice(0, 6);
  return (
    <div
      data-testid="teach-summary"
      className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2 text-xs"
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">
        {summary.intro.replace(/:$/, "")}
      </div>

      {rule.trigger && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Situação
          </div>
          <div className="text-foreground">{rule.trigger}</div>
        </div>
      )}

      {doList.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            O que fazer
          </div>
          <ul className="list-disc pl-4 space-y-0.5">
            {doList.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      {avoidList.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Evitar
          </div>
          <ul className="list-disc pl-4 space-y-0.5" data-testid="teach-summary-avoid">
            {avoidList.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 pt-1">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Categoria
          </div>
          <div className="text-foreground" data-testid="teach-summary-category">
            {CATEGORY_LABELS_PT[draft.category]}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Prioridade
          </div>
          <div className="text-foreground" data-testid="teach-summary-priority">
            {priorityLabel(draft.priority)} · {draft.priority}
          </div>
        </div>
      </div>
    </div>
  );
}

function SavedState({
  draft,
  learningId,
  onClose,
  onView,
}: {
  draft: CoachLearningDraft;
  learningId: string;
  onClose: () => void;
  onView?: (id: string) => void;
}) {
  return (
    <div
      data-testid="teach-saved-state"
      role="status"
      aria-live="polite"
      className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3"
    >
      <div className="flex items-start gap-2">
        <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
        <div className="min-w-0">
          <div className="font-semibold text-sm text-emerald-700 dark:text-emerald-300">
            Aprendizado salvo com sucesso.
          </div>
          <div className="text-xs text-emerald-800/80 dark:text-emerald-200/80">
            O Coach poderá usar esta regra nas próximas conversas.
          </div>
        </div>
      </div>
      <div className="rounded border border-emerald-500/20 bg-background/60 p-3 text-xs space-y-1">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Aprendizado
        </div>
        <div className="font-medium text-foreground">{draft.title}</div>
        <div className="text-muted-foreground">
          {CATEGORY_LABELS_PT[draft.category]} · Prioridade {draft.priority}
        </div>
      </div>
      <div className="flex justify-end gap-2 flex-wrap">
        {onView && (
          <button
            type="button"
            data-testid="teach-saved-view"
            onClick={() => onView(learningId)}
            className="inline-flex items-center gap-1 min-h-9 rounded border border-border px-3 py-1.5 text-xs hover:bg-muted"
          >
            <ExternalLink className="h-3 w-3" /> Ver aprendizado
          </button>
        )}
        <button
          type="button"
          data-testid="teach-saved-close"
          onClick={onClose}
          className="min-h-9 rounded bg-primary text-primary-foreground px-3 py-1.5 text-xs hover:opacity-90"
        >
          Fechar
        </button>
      </div>
    </div>
  );
}

function OverlayModal({
  title,
  children,
  testId,
}: {
  title: string;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      data-testid={testId}
    >
      <div className="w-full max-w-md rounded-lg bg-background border border-border shadow-xl p-4 space-y-3">
        <div className="font-semibold text-sm">{title}</div>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function arraysEqualNonEmpty(a: readonly string[], b: readonly string[]): boolean {
  const ax = a.map((s) => (s ?? "").trim()).filter(Boolean);
  const bx = b.map((s) => (s ?? "").trim()).filter(Boolean);
  if (ax.length !== bx.length) return false;
  return ax.every((v, i) => v === bx[i]);
}

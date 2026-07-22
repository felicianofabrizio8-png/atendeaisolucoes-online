// Teach Mode Drawer — conversa curta para ensinar a IA.
// Extração via teachModeExtractFn; commit via createCoachLearningFn.
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Brain, Loader2, Save, X, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  teachModeExtractFn,
  createCoachLearningFn,
} from "@/lib/coach-learnings/coach-learnings.functions";
import type { CoachLearningDraft } from "@/lib/coach-learnings/schema";
import { COACH_LEARNING_CATEGORIES } from "@/lib/coach-learnings/schema";

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
}


export function TeachModeDrawer({
  open,
  onClose,
  seedExplanation,
  conversationId,
  sourceSuggestion,
}: TeachModeDrawerProps) {
  const extractFn = useServerFn(teachModeExtractFn);
  const createFn = useServerFn(createCoachLearningFn);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [draft, setDraft] = useState<CoachLearningDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(null);
    setError(null);
    setSaved(false);
    // Se abriu via 👎, semeia o chat com a pergunta guiada + contexto.
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

  if (!open) return null;

  async function handleSend() {
    const text = input.trim();
    if (text.length < 3 || loading) return;
    setError(null);
    setLoading(true);
    const nextTurns: Turn[] = [...turns, { role: "user", content: text }];
    setTurns(nextTurns);
    setInput("");
    try {
      // Enriquece a explicação com o contexto da sugestão reprovada,
      // para o extrator escolher categoria / product_ref / negative_example.
      const enrichedExplanation = sourceSuggestion
        ? `${text}\n\n---\nContexto da sugestão reprovada:\n- Mensagem do cliente: ${sourceSuggestion.client_message ?? "(não informada)"}\n- Sugestão original que precisa melhorar (use como negative_example): "${sourceSuggestion.suggestion_text}"\n- Produto/categoria: ${sourceSuggestion.product_or_category ?? "(não informada)"}`
        : text;
      const res = await extractFn({
        data: {
          explanation: enrichedExplanation,
          priorTurns: nextTurns.slice(0, -1),
        },
      });
      if (!res.ok) {
        setError(labelError(res.error));
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
      // Se veio de 👎, garante que o negative_example seja a sugestão reprovada.
      const draftFromLlm =
        sourceSuggestion && !res.draft.negative_example
          ? { ...res.draft, negative_example: sourceSuggestion.suggestion_text }
          : res.draft;
      setDraft(draftFromLlm);
      setTurns((t) => [
        ...t,
        {
          role: "assistant",
          content: `Entendi assim: "${draftFromLlm.title}". Revise ao lado e confirme antes de salvar.`,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "extract_failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!draft || saving) return;
    setSaving(true);
    setError(null);
    try {
      await createFn({
        data: {
          draft,
          sourceConversationId:
            conversationId ?? sourceSuggestion?.conversation_id ?? null,
          sourceSuggestionId: sourceSuggestion?.suggestion_id ?? null,
        },
      });
      setSaved(true);
      setTimeout(() => onClose(), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save_failed");
    } finally {
      setSaving(false);

    }
  }

  function updateDraft<K extends keyof CoachLearningDraft>(
    key: K,
    value: CoachLearningDraft[K],
  ) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Ensinar IA"
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-3xl bg-background border-l border-border shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b border-border p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            <div>
              <div className="font-semibold text-sm">Ensinar IA</div>
              <div className="text-xs text-muted-foreground">
                Explique com suas palavras. A IA estrutura como um aprendizado permanente da empresa.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-muted"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2">
          {/* Chat */}
          <section className="flex flex-col border-r border-border min-h-0">
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
                    "text-sm rounded-lg px-3 py-2 max-w-[85%]",
                    t.role === "user"
                      ? "bg-primary text-primary-foreground self-end ml-auto"
                      : "bg-muted text-foreground",
                  )}
                >
                  {t.content}
                </div>
              ))}
              {loading && (
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" /> Estruturando aprendizado...
                </div>
              )}
            </div>
            <div className="border-t border-border p-3 space-y-2">
              <textarea
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
              <div className="flex items-center justify-between">
                <div className="text-[10px] text-muted-foreground">Ctrl/Cmd + Enter para enviar</div>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={loading || input.trim().length < 3}
                  className="inline-flex items-center gap-1 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs hover:opacity-90 disabled:opacity-40"
                >
                  <Sparkles className="h-3 w-3" /> Estruturar
                </button>
              </div>
            </div>
          </section>

          {/* Preview do aprendizado */}
          <section className="flex flex-col min-h-0 overflow-y-auto">
            <div className="p-4 space-y-3">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Aprendizado estruturado
              </div>
              {!draft ? (
                <div className="text-sm text-muted-foreground p-4 rounded border border-dashed border-border">
                  Envie sua explicação no chat para gerar o preview.
                </div>
              ) : (
                <div className="space-y-3">
                  <Field label="Título">
                    <input
                      type="text"
                      value={draft.title}
                      onChange={(e) => updateDraft("title", e.target.value)}
                      maxLength={120}
                      className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Categoria">
                      <select
                        value={draft.category}
                        onChange={(e) =>
                          updateDraft(
                            "category",
                            e.target.value as CoachLearningDraft["category"],
                          )
                        }
                        className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
                      >
                        {COACH_LEARNING_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Prioridade (0-100)">
                      <input
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
                        className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
                      />
                    </Field>
                  </div>
                  <Field label="Produto / contexto (opcional)">
                    <input
                      type="text"
                      value={draft.product_ref ?? ""}
                      onChange={(e) => updateDraft("product_ref", e.target.value || null)}
                      className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
                    />
                  </Field>
                  <Field label="Descrição">
                    <textarea
                      rows={2}
                      value={draft.description}
                      onChange={(e) => updateDraft("description", e.target.value)}
                      className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm resize-none"
                    />
                  </Field>
                  <Field label="Regra estruturada (o que a IA deve seguir)">
                    <textarea
                      rows={3}
                      value={draft.rule_structured}
                      onChange={(e) => updateDraft("rule_structured", e.target.value)}
                      className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm resize-none"
                    />
                  </Field>
                  <Field label="Exemplo positivo (opcional)">
                    <textarea
                      rows={2}
                      value={draft.positive_example ?? ""}
                      onChange={(e) => updateDraft("positive_example", e.target.value || null)}
                      className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm resize-none"
                    />
                  </Field>
                  <Field label="Exemplo negativo (opcional)">
                    <textarea
                      rows={2}
                      value={draft.negative_example ?? ""}
                      onChange={(e) => updateDraft("negative_example", e.target.value || null)}
                      className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm resize-none"
                    />
                  </Field>
                </div>
              )}
              {error && (
                <div className="text-xs text-red-600 dark:text-red-400 border border-red-500/30 bg-red-500/10 rounded p-2">
                  {error}
                </div>
              )}
              {saved && (
                <div className="text-xs text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 rounded p-2">
                  Aprendizado salvo. A IA passa a usá-lo imediatamente.
                </div>
              )}
            </div>
            <div className="border-t border-border p-3 flex items-center justify-end gap-2 mt-auto">
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-border px-3 py-1.5 text-xs hover:bg-muted"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!draft || saving}
                className="inline-flex items-center gap-1 rounded bg-primary text-primary-foreground px-3 py-1.5 text-xs hover:opacity-90 disabled:opacity-40"
              >
                {saving ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Save className="h-3 w-3" />
                )}
                Salvar aprendizado
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      {children}
    </label>
  );
}

function labelError(code: string): string {
  if (code === "no_company") return "Sua conta não está vinculada a uma empresa.";
  if (code === "teach_mode_schema_invalid")
    return "A IA não conseguiu estruturar. Explique com mais detalhe.";
  return "Falha ao estruturar o aprendizado. Tente reformular.";
}

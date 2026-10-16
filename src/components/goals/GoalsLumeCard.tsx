// src/components/goals/GoalsLumeCard.tsx
import { useState } from "react";
import { ArrowUp, Check, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { OrbBloop } from "@/components/ui/orb-bloop";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Goal } from "@/lib/goals/model";
import type { GoalInsight } from "@/lib/goals/api";

export function GoalsLumeCard({
  insights,
  tips,
  goals,
  canManage,
  onApply,
  onDismiss,
}: {
  insights: GoalInsight[];
  tips: GoalInsight[];
  goals: Pick<Goal, "id" | "name">[];
  canManage: boolean;
  onApply: (insight: GoalInsight) => void;
  onDismiss: (insight: GoalInsight) => void;
}) {
  const isMobile = useIsMobile();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const summary = insights.find((i) => i.kind === "resumo");
  const attention = insights.filter((i) => i.kind === "atencao").slice(0, 3);
  const suggestions = insights
    .filter((i) => i.kind === "sugestao" && i.state === "pendente")
    .slice(0, 2);
  const nameOf = (id: string | null) => goals.find((g) => g.id === id)?.name;

  const ask = async () => {
    const text = question.trim();
    if (!text || asking) return;
    setAsking(true);
    try {
      const { data } = await supabase.auth.getSession();
      const response = await fetch("/api/goals/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ question: text }),
      });
      const body = (await response.json()) as { answer?: string; error?: string };
      setAnswer(body.answer ?? body.error ?? "A Lume não respondeu.");
      setQuestion("");
    } catch {
      setAnswer("A Lume não respondeu agora.");
    } finally {
      setAsking(false);
    }
  };

  return (
    <section aria-label="Lume" className="gl-panel gl-lume">
      <div className="flex items-center gap-3">
        <OrbBloop size={isMobile ? 44 : 56} />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-200/70">
            Lume · análise do dia
          </p>
          <p className="text-[15px] font-semibold leading-snug">
            {canManage
              ? (summary?.body ?? "A análise aparece aqui depois da primeira rodada diária.")
              : (tips[0]?.body ?? "Suas dicas aparecem aqui todo dia.")}
          </p>
        </div>
      </div>

      {canManage && attention.length > 0 && (
        <ul className="mt-4 space-y-2">
          {attention.map((a) => (
            <li key={a.id} className="gl-lume-item">
              <strong>{nameOf(a.goalId)}:</strong> {a.body}
            </li>
          ))}
        </ul>
      )}

      {canManage && suggestions.length > 0 && (
        <ul className="mt-3 space-y-2">
          {suggestions.map((s) => (
            <li key={s.id} className="gl-lume-suggestion">
              <span className="min-w-0 flex-1">{s.body}</span>
              {s.action && (
                <button
                  type="button"
                  className="gl-lume-apply"
                  aria-label={`Aplicar: ${s.body}`}
                  onClick={() => onApply(s)}
                >
                  <Check className="h-3.5 w-3.5" aria-hidden /> Aplicar
                </button>
              )}
              <button
                type="button"
                className="gl-lume-dismiss"
                aria-label={`Dispensar: ${s.body}`}
                onClick={() => onDismiss(s)}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="gl-lume-ask"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <input
          aria-label="Pergunte à Lume sobre as metas"
          placeholder="Pergunte à Lume sobre as metas…"
          value={question}
          maxLength={1000}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button type="submit" aria-label="Enviar pergunta" disabled={asking || !question.trim()}>
          {asking ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <ArrowUp className="h-4 w-4" aria-hidden />
          )}
        </button>
      </form>
      {answer && <p className="mt-3 text-sm leading-relaxed text-foreground/90">{answer}</p>}
    </section>
  );
}

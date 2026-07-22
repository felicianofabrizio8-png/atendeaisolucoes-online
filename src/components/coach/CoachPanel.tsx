import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/auth/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  AlertTriangle,
  Copy,
  Check,
  X,
  RefreshCcw,
  Loader2,
  Flame,
  Settings2,
  Brain,
} from "lucide-react";
import { TeachModeDrawer } from "@/components/coach/TeachModeDrawer";


interface CoachAlert {
  id: string;
  alert_type: string;
  severity: "low" | "medium" | "high" | "critical";
  urgency_minutes: number | null;
  risk_score: number;
  payload: Record<string, unknown> | null;
  status: string;
  created_at: string;
}

interface CoachSuggestion {
  id: string;
  situation: string | null;
  next_action: string | null;
  suggestion_text: string;
  reasoning: string | null;
  objection_type: string | null;
  urgency: string | null;
  risk_score: number | null;
  status: string;
  created_at: string;
}

const ALERT_LABEL: Record<string, string> = {
  no_response: "Cliente sem resposta",
  followup_overdue: "Follow-up vencido",
  quote_no_reply: "Orçamento sem retorno",
  window_closing: "Janela 24h fechando",
  hot_lead_unattended: "Lead quente sem atendimento",
  awaiting_quote: "Aguardando orçamento",
  discount_requested: "Pediu desconto",
  will_research: "Disse que vai pesquisar",
  spouse_decision: "Decisão com cônjuge",
};

const SEVERITY_STYLE: Record<string, string> = {
  low: "bg-muted text-muted-foreground border-border",
  medium: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  high: "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30",
  critical: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30",
};

export function CoachPanel({
  conversationId,
  onInsertSuggestion,
}: {
  conversationId: string;
  onInsertSuggestion?: (text: string) => void;
}) {
  const { profile } = useAuth();
  const companyId = profile?.company_id ?? null;
  // Fase 3.2 — reutiliza o guard já existente. Não altera permissões,
  // apenas condiciona a exibição do atalho para o Admin Console.
  const { isAdmin } = useIsAdmin();

  const [alerts, setAlerts] = useState<CoachAlert[]>([]);
  const [suggestion, setSuggestion] = useState<CoachSuggestion | null>(null);
  const [loadingScan, setLoadingScan] = useState(false);
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [teachOpen, setTeachOpen] = useState(false);
  const [teachSeed, setTeachSeed] = useState<string>("");

  const loadData = useMemo(
    () => async () => {
      if (!companyId) return;
      const [{ data: a }, { data: s }] = await Promise.all([
        supabase
          .from("coach_alerts")
          .select("*")
          .eq("conversation_id", conversationId)
          .eq("status", "open")
          .order("severity", { ascending: false })
          .order("created_at", { ascending: false }),
        supabase
          .from("coach_suggestions")
          .select("*")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(1),
      ]);
      setAlerts((a ?? []) as CoachAlert[]);
      setSuggestion(((s ?? [])[0] as CoachSuggestion) ?? null);
    },
    [conversationId, companyId],
  );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function runAnalyze() {
    setLoadingScan(true);
    setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sessão expirada");
      const res = await fetch("/api/coach/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ scope: "conversation", conversation_id: conversationId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha na análise");
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingScan(false);
    }
  }

  async function runSuggest() {
    setLoadingSuggest(true);
    setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sessão expirada");
      const res = await fetch("/api/coach/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao gerar sugestão");
      setSuggestion(json.suggestion as CoachSuggestion);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingSuggest(false);
    }
  }

  async function dismissAlert(id: string) {
    await supabase
      .from("coach_alerts")
      .update({ status: "dismissed", resolved_at: new Date().toISOString() })
      .eq("id", id);
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }

  async function copySuggestion() {
    if (!suggestion) return;
    await navigator.clipboard.writeText(suggestion.suggestion_text);
    setCopied(true);
    await supabase
      .from("coach_suggestions")
      .update({ status: "copied", used_at: new Date().toISOString() })
      .eq("id", suggestion.id);
    setTimeout(() => setCopied(false), 1500);
  }

  function applySuggestion() {
    if (suggestion && onInsertSuggestion) onInsertSuggestion(suggestion.suggestion_text);
  }

  async function dismissSuggestion() {
    if (!suggestion) return;
    await supabase
      .from("coach_suggestions")
      .update({ status: "dismissed" })
      .eq("id", suggestion.id);
    setSuggestion(null);
  }

  return (
    <div className="border-b border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <div className="text-sm font-semibold">Coach IA</div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setTeachOpen(true)}
            data-testid="coach-panel-open-teach"
            className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 text-primary px-2 py-1 text-xs hover:bg-primary/20"
            title="Ensinar a IA com um aprendizado novo"
            aria-label="Ensinar IA"
          >
            <Brain className="h-3 w-3" />
            Ensinar IA
          </button>
          {isAdmin && (
            <>
              <Link
                to="/configuracoes_/coach-learnings"
                className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs hover:bg-muted"
                title="Ver aprendizados desta empresa"
                aria-label="Aprendizados"
              >
                <Brain className="h-3 w-3" />
                Aprendizados
              </Link>
              <Link
                to="/configuracoes_/coach-interpreter"
                data-testid="coach-panel-open-interpreter"
                className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs hover:bg-muted"
                title="Abrir Console do Coach Interpreter"
                aria-label="Abrir Console do Coach Interpreter"
              >
                <Settings2 className="h-3 w-3" />
                Console
              </Link>
            </>
          )}
          <button
            type="button"
            onClick={runAnalyze}
            disabled={loadingScan}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
            title="Analisar esta conversa"
          >
            {loadingScan ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCcw className="h-3 w-3" />
            )}
            Analisar
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {alerts.length === 0 && !suggestion && !loadingScan && (
        <div className="text-xs text-muted-foreground">
          Clique em "Analisar" para verificar a situação e gerar sugestão.
        </div>
      )}

      {alerts.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Alertas ({alerts.length})
          </div>
          {alerts.map((a) => (
            <div
              key={a.id}
              className={cn(
                "flex items-start justify-between gap-2 rounded-md border px-2 py-1.5 text-xs",
                SEVERITY_STYLE[a.severity] ?? SEVERITY_STYLE.medium,
              )}
            >
              <div className="flex items-start gap-1.5 min-w-0">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium">{ALERT_LABEL[a.alert_type] ?? a.alert_type}</div>
                  {a.urgency_minutes != null && (
                    <div className="text-[10px] opacity-80">
                      {a.urgency_minutes < 60
                        ? `há ${a.urgency_minutes} min`
                        : `há ${Math.floor(a.urgency_minutes / 60)}h`}
                      {a.risk_score > 0 && ` · risco ${a.risk_score}`}
                    </div>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => dismissAlert(a.id)}
                className="shrink-0 rounded p-0.5 hover:bg-background/50"
                aria-label="Dispensar"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={runSuggest}
        disabled={loadingSuggest}
        className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground px-2 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50"
      >
        {loadingSuggest ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
        {suggestion ? "Gerar nova sugestão" : "Gerar sugestão de resposta"}
      </button>

      {suggestion && (
        <div className="rounded-md border border-border bg-card p-2.5 space-y-2">
          {suggestion.situation && (
            <div className="text-[11px]">
              <span className="uppercase tracking-wide text-muted-foreground">Situação: </span>
              <span className="text-foreground">{suggestion.situation}</span>
            </div>
          )}
          {suggestion.next_action && (
            <div className="text-[11px]">
              <span className="uppercase tracking-wide text-muted-foreground">Próxima ação: </span>
              <span className="text-foreground">{suggestion.next_action}</span>
            </div>
          )}
          <div className="rounded bg-muted/50 p-2 text-xs whitespace-pre-wrap">
            {suggestion.suggestion_text}
          </div>
          {(suggestion.urgency || suggestion.risk_score != null || suggestion.objection_type) && (
            <div className="flex flex-wrap gap-1 text-[10px]">
              {suggestion.urgency && (
                <span className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5">
                  <Flame className="h-2.5 w-2.5" />
                  {suggestion.urgency}
                </span>
              )}
              {suggestion.risk_score != null && (
                <span className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5">
                  risco {suggestion.risk_score}
                </span>
              )}
              {suggestion.objection_type && (
                <span className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5">
                  {suggestion.objection_type}
                </span>
              )}
            </div>
          )}
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={copySuggestion}
              className="flex-1 inline-flex items-center justify-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px] hover:bg-muted"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copiado" : "Copiar"}
            </button>
            {onInsertSuggestion && (
              <button
                type="button"
                onClick={applySuggestion}
                className="flex-1 inline-flex items-center justify-center gap-1 rounded bg-primary text-primary-foreground px-2 py-1 text-[11px] hover:opacity-90"
              >
                Usar no campo
              </button>
            )}
            <button
              type="button"
              onClick={dismissSuggestion}
              className="inline-flex items-center justify-center rounded border border-border bg-background px-2 py-1 text-[11px] hover:bg-muted"
              aria-label="Descartar"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          {suggestion.reasoning && (
            <div className="text-[10px] text-muted-foreground italic">{suggestion.reasoning}</div>
          )}
        </div>
      )}
      <TeachModeDrawer
        open={teachOpen}
        onClose={() => setTeachOpen(false)}
        seedExplanation={teachSeed}
        conversationId={null}
      />
    </div>
  );
}


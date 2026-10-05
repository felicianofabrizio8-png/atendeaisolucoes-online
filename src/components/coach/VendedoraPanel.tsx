import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Bot, Brain, Loader2, RefreshCcw, Sparkles, UserRound, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/auth/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useTakeOver } from "@/hooks/useTakeOver";
import { cn } from "@/lib/utils";
import { ALERT_LABEL, SEVERITY_STYLE, type CoachAlert } from "@/components/coach/coach-alerts";
import type { CoachPanelMessage } from "@/components/coach/CoachPanel";
import { SalesAgentAssistedCard, type AssistedSuggestion } from "@/components/coach/SalesAgentAssistedCard";
import { ConversationAutoReplyToggle } from "@/components/coach/ConversationAutoReplyToggle";
import { TeachModeDrawer, type TeachSourceSuggestion } from "@/components/coach/TeachModeDrawer";

/**
 * Painel de IA das empresas que usam a Vendedora 2.0.
 *
 * Uma IA só: a sugestão atual da Vendedora, aprovar ou rejeitar e ensinar, os alertas da
 * conversa e o estado (IA ativa x atendimento humano). Este painel não gera resposta pelo
 * Coach: não existe chamada a /api/coach/suggest aqui, nem automática nem manual.
 * "Analisar" só atualiza os alertas, a pedido do atendente.
 */
export function VendedoraPanel({
  conversationId,
  onInsertSuggestion,
  messages,
  composerHasDraft = false,
  aiStatus,
  humanTakeoverAt,
}: {
  conversationId: string;
  onInsertSuggestion?: (text: string) => void;
  messages?: CoachPanelMessage[];
  composerHasDraft?: boolean;
  aiStatus?: string | null;
  humanTakeoverAt?: string | null;
}) {
  const { profile } = useAuth();
  const companyId = profile?.company_id ?? null;
  const { isAdmin } = useIsAdmin();
  const { release, releasing } = useTakeOver(conversationId);

  const [alerts, setAlerts] = useState<CoachAlert[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSuggestion, setHasSuggestion] = useState(false);
  const [autoReply, setAutoReply] = useState(false);
  const [teachOpen, setTeachOpen] = useState(false);
  const [teachSource, setTeachSource] = useState<TeachSourceSuggestion | null>(null);
  const activeConversationRef = useRef(conversationId);

  const loadAlerts = useCallback(async () => {
    if (!companyId) return;
    const requested = conversationId;
    const { data } = await supabase
      .from("coach_alerts")
      .select("*")
      .eq("conversation_id", conversationId)
      .eq("status", "open")
      .order("severity", { ascending: false })
      .order("created_at", { ascending: false });
    if (activeConversationRef.current !== requested) return;
    setAlerts((data ?? []) as CoachAlert[]);
  }, [conversationId, companyId]);

  useEffect(() => {
    activeConversationRef.current = conversationId;
    setAlerts([]);
    setError(null);
    setTeachOpen(false);
    setTeachSource(null);
    void loadAlerts();
  }, [conversationId, loadAlerts]);

  async function analyze() {
    setScanning(true);
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
      await loadAlerts();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }

  async function dismissAlert(id: string) {
    await supabase
      .from("coach_alerts")
      .update({ status: "dismissed", resolved_at: new Date().toISOString() })
      .eq("id", id);
    setAlerts((prev) => prev.filter((alert) => alert.id !== id));
  }

  // Rejeitar e ensinar: abre o Ensinar IA com a mensagem do cliente e a resposta recusada.
  // O aprendizado segue o fluxo de aprovação que já existe; nada vale antes de aprovado.
  function teachFromRejected(rejected: AssistedSuggestion) {
    const lastLead = [...(messages ?? [])].reverse().find((message) => message.role === "lead");
    setTeachSource({
      suggestion_id: null,
      client_message: lastLead?.text ?? null,
      suggestion_text: rejected.generated_text,
      situation: null,
      next_action: null,
      product_or_category: null,
      sources_used: null,
      grounding_score: null,
      domain_validation: null,
      conversation_id: conversationId,
    });
    setTeachOpen(true);
  }

  const stateKnown = aiStatus !== undefined || humanTakeoverAt !== undefined;
  const humanRequested = aiStatus === "aguardando_humano";
  const humanActive = humanRequested || aiStatus === "assumido_humano" || Boolean(humanTakeoverAt);

  return (
    <div data-testid="vendedora-panel" className="border-b border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <div className="text-sm font-semibold">Vendedora IA</div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setTeachSource(null);
              setTeachOpen(true);
            }}
            data-testid="vendedora-panel-open-teach"
            className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 text-primary px-2 py-1 text-xs hover:bg-primary/20"
            title="Ensinar a IA com um aprendizado novo"
            aria-label="Ensinar IA"
          >
            <Brain className="h-3 w-3" />
            Ensinar IA
          </button>
          {isAdmin && (
            <Link
              to="/configuracoes/coach-learnings"
              className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs hover:bg-muted"
              title="Ver aprendizados desta empresa"
              aria-label="Aprendizados"
            >
              Aprendizados
            </Link>
          )}
        </div>
      </div>

      {stateKnown && (
        <div
          data-testid="vendedora-panel-state"
          className={cn(
            "flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs",
            humanActive ? "border-amber-500/30 bg-amber-500/10" : "border-border bg-muted/40",
          )}
        >
          {humanActive ? <UserRound className="h-3.5 w-3.5 shrink-0" /> : <Bot className="h-3.5 w-3.5 shrink-0" />}
          <span className="min-w-0 flex-1">
            {humanRequested
              ? "A IA pediu atendimento humano nesta conversa."
              : humanActive
                ? "Atendimento humano: a IA está pausada nesta conversa."
                : "IA ativa nesta conversa."}
          </span>
          {humanActive && (
            <button
              type="button"
              onClick={() => void release()}
              disabled={releasing}
              data-testid="vendedora-panel-release"
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-semibold hover:bg-muted disabled:opacity-60"
            >
              {releasing && <Loader2 className="h-3 w-3 animate-spin" />}
              Devolver para a IA
            </button>
          )}
        </div>
      )}

      <ConversationAutoReplyToggle conversationId={conversationId} onChange={setAutoReply} />

      <SalesAgentAssistedCard
        conversationId={conversationId}
        onInsertSuggestion={onInsertSuggestion}
        composerHasDraft={composerHasDraft}
        onPendingChange={setHasSuggestion}
        onRejected={teachFromRejected}
      />

      {!hasSuggestion && !humanActive && (
        <div data-testid="vendedora-panel-empty" className="text-xs text-muted-foreground italic">
          {autoReply
            ? "A Vendedora responde sozinha quando o cliente mandar a próxima mensagem."
            : "Sem sugestão pendente. A Vendedora sugere quando o cliente mandar a próxima mensagem."}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Alertas{alerts.length > 0 ? ` (${alerts.length})` : ""}
          </div>
          <button
            type="button"
            onClick={() => void analyze()}
            disabled={scanning}
            data-testid="vendedora-panel-analyze"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
            title="Atualizar os alertas desta conversa"
          >
            {scanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />}
            Analisar
          </button>
        </div>
        {alerts.length === 0 ? (
          <div className="text-xs text-muted-foreground">Nenhum alerta nesta conversa.</div>
        ) : (
          alerts.map((alert) => (
            <div
              key={alert.id}
              className={cn(
                "flex items-start justify-between gap-2 rounded-md border px-2 py-1.5 text-xs",
                SEVERITY_STYLE[alert.severity] ?? SEVERITY_STYLE.medium,
              )}
            >
              <div className="flex items-start gap-1.5 min-w-0">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium">{ALERT_LABEL[alert.alert_type] ?? alert.alert_type}</div>
                  {alert.urgency_minutes != null && (
                    <div className="text-[10px] opacity-80">
                      {alert.urgency_minutes < 60
                        ? `há ${alert.urgency_minutes} min`
                        : `há ${Math.floor(alert.urgency_minutes / 60)}h`}
                    </div>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void dismissAlert(alert.id)}
                className="shrink-0 rounded p-0.5 hover:bg-background/50"
                aria-label="Dispensar"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))
        )}
      </div>

      <TeachModeDrawer
        open={teachOpen}
        onClose={() => {
          setTeachOpen(false);
          setTeachSource(null);
        }}
        seedExplanation=""
        conversationId={conversationId}
        sourceSuggestion={teachSource}
      />
    </div>
  );
}

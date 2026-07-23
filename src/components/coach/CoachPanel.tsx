import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
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
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import {
  TeachModeDrawer,
  type TeachSourceSuggestion,
} from "@/components/coach/TeachModeDrawer";
import { submitSuggestionFeedbackFn } from "@/lib/coach-learnings/coach-learnings.functions";

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
  message_id: string | null;
  learning_ids_used?: string[] | null;
  grounding_score?: number | null;
  sources_used?: Record<string, boolean> | null;
  domain_validation?: unknown;
  feedback_status?: "positive" | "negative" | null;
}

/**
 * Mensagem mínima que o CoachPanel precisa para decidir auto-geração.
 * O painel não depende do tipo `Message` completo do repo — apenas dos
 * campos abaixo, mantendo o acoplamento com o inbox mínimo.
 */
export interface CoachPanelMessage {
  id: string;
  role: "lead" | "agent" | "system";
  text: string;
  at: string;
  sourceSubtype?: string;
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

// Janela de agrupamento — se várias mensagens do cliente chegarem em sequência,
// consolidamos em uma única sugestão.
const DEBOUNCE_MS = 1500;
// Tempo máximo esperando mídia (transcrição/OCR) antes de gerar mesmo assim
// com o contexto disponível — a IA registra internamente a limitação.
const MEDIA_WAIT_MS = 15_000;

const MEDIA_SUBTYPES = new Set([
  "image",
  "audio",
  "voice",
  "video",
  "document",
  "sticker",
]);

function isMediaSubtype(sub?: string): boolean {
  if (!sub) return false;
  return MEDIA_SUBTYPES.has(sub.toLowerCase());
}

/** Uma mensagem de mídia é considerada "pronta" quando já tem texto
 *  (legenda, transcrição, OCR ou fallback) OU quando estourou a janela
 *  máxima de espera. Textos puros são sempre prontos. */
function isMessageReady(msg: CoachPanelMessage, nowMs: number): boolean {
  if (msg.text && msg.text.trim().length > 0) return true;
  if (!isMediaSubtype(msg.sourceSubtype)) return true;
  const ageMs = nowMs - new Date(msg.at).getTime();
  return ageMs >= MEDIA_WAIT_MS;
}

type AutoState =
  | "idle"
  | "waiting_media"
  | "debouncing"
  | "generating"
  | "ready"
  | "error";

export function CoachPanel({
  conversationId,
  onInsertSuggestion,
  messages,
  composerHasDraft = false,
}: {
  conversationId: string;
  onInsertSuggestion?: (text: string) => void;
  /** Mensagens visíveis da conversa (ordem cronológica). Necessário para
   *  auto-geração da sugestão quando uma nova mensagem inbound é confirmada. */
  messages?: CoachPanelMessage[];
  /** Se `true`, o compositor tem texto digitado pelo atendente. Usado só para
   *  telemetria de UX — o painel nunca sobrescreve o compositor sozinho. */
  composerHasDraft?: boolean;
}) {
  const { profile } = useAuth();
  const companyId = profile?.company_id ?? null;
  const { isAdmin } = useIsAdmin();

  const [alerts, setAlerts] = useState<CoachAlert[]>([]);
  const [suggestion, setSuggestion] = useState<CoachSuggestion | null>(null);
  const [loadingScan, setLoadingScan] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [teachOpen, setTeachOpen] = useState(false);
  const [teachSeed, setTeachSeed] = useState<string>("");
  const [teachSource, setTeachSource] = useState<TeachSourceSuggestion | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState<"positive" | "negative" | null>(null);
  const submitFeedback = useServerFn(submitSuggestionFeedbackFn);

  // Máquina de auto-geração —————————————————————————————————————
  const [autoState, setAutoState] = useState<AutoState>("idle");
  // Último messageId inbound que já disparou (ou está disparando) uma sugestão.
  // Idempotência: mesmo id nunca gera duas vezes.
  const processedIdRef = useRef<string | null>(null);
  // Conversa "ativa" para invalidar respostas antigas quando o usuário troca.
  const activeConversationRef = useRef(conversationId);
  // Sequência da requisição em andamento — resultados de seq antigo são descartados.
  const requestSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mediaWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guarda o momento em que a sugestão foi carregada inicialmente, evitando
  // auto-gerar ao abrir uma conversa antiga cujo último inbound já foi processado.
  const initialLoadDoneRef = useRef(false);
  // Sinaliza que o atendente está "avaliando" (feedback em andamento ou drawer aberto)
  // — nesse caso a próxima sugestão fica pendente para não substituir sem aviso.
  const evaluatingRef = useRef(false);
  const [pendingRefresh, setPendingRefresh] = useState<string | null>(null);
  evaluatingRef.current = teachOpen || feedbackBusy !== null;

  // ————————————— carrega alertas + última sugestão salva —————————————
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
      // Descarta se o usuário já trocou de conversa durante o await.
      if (activeConversationRef.current !== conversationId) return;
      setAlerts((a ?? []) as CoachAlert[]);
      const last = ((s ?? [])[0] as CoachSuggestion) ?? null;
      setSuggestion(last);
      if (last?.message_id) processedIdRef.current = last.message_id;
      initialLoadDoneRef.current = true;
    },
    [conversationId, companyId],
  );

  // Reset completo ao trocar de conversa — cancela requisições, timers e estados.
  useEffect(() => {
    activeConversationRef.current = conversationId;
    initialLoadDoneRef.current = false;
    processedIdRef.current = null;
    setSuggestion(null);
    setAlerts([]);
    setError(null);
    setAutoState("idle");
    setPendingRefresh(null);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (mediaWaitTimerRef.current) clearTimeout(mediaWaitTimerRef.current);
    abortRef.current?.abort();
    abortRef.current = null;
    void loadData();
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (mediaWaitTimerRef.current) clearTimeout(mediaWaitTimerRef.current);
      abortRef.current?.abort();
    };
  }, [conversationId, loadData]);

  // ————————————— geração da sugestão (auto ou manual) —————————————
  const runSuggest = useCallback(
    async (opts?: { auto?: boolean; targetMessageId?: string | null }) => {
      const auto = opts?.auto === true;
      // Cancela requisição anterior — resultado antigo vira obsoleto.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const seq = ++requestSeqRef.current;
      const capturedConversation = conversationId;
      // Marca imediatamente o id como "em processamento" (idempotência dura).
      if (opts?.targetMessageId) processedIdRef.current = opts.targetMessageId;
      setAutoState("generating");
      setError(null);
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        if (!token) throw new Error("Sessão expirada");
        const res = await fetch("/api/coach/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ conversation_id: capturedConversation }),
          signal: controller.signal,
        });
        const json = await res.json();
        // Descarta se: usuário trocou de conversa OU chegou nova mensagem
        // (seq mais novo) OU controller foi abortado.
        if (
          controller.signal.aborted ||
          activeConversationRef.current !== capturedConversation ||
          requestSeqRef.current !== seq
        ) {
          return;
        }
        if (!res.ok) throw new Error(json.error ?? "Falha ao gerar sugestão");
        const nextSuggestion = json.suggestion as CoachSuggestion;
        // Se o atendente está avaliando/ensinando, não substitui em silêncio:
        // mostra um "toast" leve pedindo confirmação.
        if (!auto || !evaluatingRef.current) {
          setSuggestion(nextSuggestion);
          setPendingRefresh(null);
        } else {
          setPendingRefresh(nextSuggestion.id);
          // Guarda a nova sugestão em ref via state secundário — reaproveitamos
          // `suggestion` mas empurramos após o usuário aceitar. Aqui simplificamos
          // fazendo overwrite quando o drawer/feedback fecha (efeito abaixo).
          setSuggestion((prev) => prev ?? nextSuggestion);
          pendingSuggestionRef.current = nextSuggestion;
        }
        setAutoState("ready");
      } catch (e) {
        if (controller.signal.aborted) return;
        if (activeConversationRef.current !== capturedConversation) return;
        if (requestSeqRef.current !== seq) return;
        setError(e instanceof Error ? e.message : String(e));
        setAutoState("error");
      }
    },
    [conversationId],
  );

  const pendingSuggestionRef = useRef<CoachSuggestion | null>(null);

  // Quando o atendente termina de avaliar/ensinar, aplica a sugestão pendente.
  useEffect(() => {
    if (evaluatingRef.current) return;
    const pending = pendingSuggestionRef.current;
    if (pending && pendingRefresh) {
      setSuggestion(pending);
      pendingSuggestionRef.current = null;
      setPendingRefresh(null);
    }
  }, [teachOpen, feedbackBusy, pendingRefresh]);

  // ————————————— gatilho automático por nova mensagem inbound —————————————
  useEffect(() => {
    if (!messages || messages.length === 0) return;
    if (!initialLoadDoneRef.current) return;
    // Última mensagem do cliente (role === "lead"). Ignora system/agent.
    let lastInbound: CoachPanelMessage | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "lead") {
        lastInbound = m;
        break;
      }
    }
    if (!lastInbound) return;
    if (lastInbound.id === processedIdRef.current) return;

    const now = Date.now();
    const ready = isMessageReady(lastInbound, now);

    // Limpa timers pendentes — sempre reprograma com o estado atual.
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (mediaWaitTimerRef.current) clearTimeout(mediaWaitTimerRef.current);

    if (!ready) {
      setAutoState("waiting_media");
      const ageMs = now - new Date(lastInbound.at).getTime();
      const remaining = Math.max(500, MEDIA_WAIT_MS - ageMs);
      mediaWaitTimerRef.current = setTimeout(() => {
        // Reavalia — o effect vai reentrar pois messages continua o mesmo,
        // então forçamos via bump: agenda debouncing direto.
        setAutoState("debouncing");
        debounceTimerRef.current = setTimeout(() => {
          void runSuggest({ auto: true, targetMessageId: lastInbound.id });
        }, DEBOUNCE_MS);
      }, remaining);
      return;
    }

    setAutoState("debouncing");
    const targetId = lastInbound.id;
    debounceTimerRef.current = setTimeout(() => {
      void runSuggest({ auto: true, targetMessageId: targetId });
    }, DEBOUNCE_MS);
  }, [messages, runSuggest]);

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

  async function fetchClientMessage(messageId: string | null): Promise<string | null> {
    if (!messageId) return null;
    const { data } = await supabase
      .from("messages")
      .select("text")
      .eq("id", messageId)
      .maybeSingle();
    return (data?.text as string | undefined) ?? null;
  }

  async function handleThumbsUp() {
    if (!suggestion || feedbackBusy) return;
    setFeedbackBusy("positive");
    try {
      await submitFeedback({
        data: { suggestionId: suggestion.id, status: "positive" },
      });
      setSuggestion({ ...suggestion, feedback_status: "positive" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFeedbackBusy(null);
    }
  }

  async function handleThumbsDown() {
    if (!suggestion || feedbackBusy) return;
    setFeedbackBusy("negative");
    try {
      const clientMessage = await fetchClientMessage(suggestion.message_id);
      const product =
        (suggestion.domain_validation as { product?: string } | null)?.product ??
        suggestion.objection_type ??
        null;
      setTeachSource({
        suggestion_id: suggestion.id,
        client_message: clientMessage,
        suggestion_text: suggestion.suggestion_text,
        situation: suggestion.situation,
        next_action: suggestion.next_action,
        product_or_category: product,
        sources_used: suggestion.sources_used ?? null,
        grounding_score: suggestion.grounding_score ?? null,
        domain_validation: suggestion.domain_validation ?? null,
        conversation_id: conversationId,
      });
      setTeachSeed("");
      setTeachOpen(true);
    } finally {
      setFeedbackBusy(null);
    }
  }

  const isGenerating = autoState === "generating";
  const isAnalyzingMedia = autoState === "waiting_media" || autoState === "debouncing";
  const showAnalyzingState = isGenerating || isAnalyzingMedia;

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

      {composerHasDraft && showAnalyzingState && (
        <div className="text-[10px] text-muted-foreground italic">
          Seu texto no compositor está preservado.
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-700 dark:text-red-300">
          {error}
          <button
            type="button"
            onClick={() => void runSuggest({ auto: false })}
            className="ml-2 underline"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {alerts.length === 0 && !suggestion && !loadingScan && !showAnalyzingState && (
        <div className="text-xs text-muted-foreground">
          Aguardando nova mensagem do cliente para gerar sugestão automaticamente.
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
        onClick={() => void runSuggest({ auto: false })}
        disabled={isGenerating || isAnalyzingMedia}
        data-testid="coach-generate-alternative"
        className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground px-2 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50"
      >
        {isGenerating ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
        {suggestion ? "Gerar nova sugestão" : "Gerar sugestão de resposta"}
      </button>

      {showAnalyzingState && (
        <div
          data-testid="coach-analyzing-state"
          className="rounded-md border border-border bg-card/60 p-3 flex items-center gap-2 text-xs text-muted-foreground"
        >
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span>
            {autoState === "waiting_media"
              ? "Aguardando processamento da mídia…"
              : "Analisando a nova mensagem…"}
          </span>
        </div>
      )}

      {pendingRefresh && !showAnalyzingState && (
        <div className="rounded-md border border-primary/40 bg-primary/10 px-2 py-1.5 text-[11px] text-primary flex items-center justify-between gap-2">
          <span>Nova sugestão pronta enquanto você avaliava.</span>
          <button
            type="button"
            className="underline"
            onClick={() => {
              const p = pendingSuggestionRef.current;
              if (p) setSuggestion(p);
              pendingSuggestionRef.current = null;
              setPendingRefresh(null);
            }}
          >
            Atualizar
          </button>
        </div>
      )}

      {suggestion && !showAnalyzingState && (
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
          <div className="flex items-center gap-1.5 pt-1 border-t border-border/50">
            <span className="text-[10px] text-muted-foreground mr-auto">
              A sugestão te ajudou?
            </span>
            <button
              type="button"
              onClick={handleThumbsUp}
              disabled={!!feedbackBusy || suggestion.feedback_status === "positive"}
              data-testid="coach-suggestion-thumbs-up"
              aria-label="Boa sugestão"
              className={cn(
                "inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-60",
                suggestion.feedback_status === "positive"
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-border bg-background",
              )}
            >
              {feedbackBusy === "positive" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ThumbsUp className="h-3 w-3" />
              )}
              Boa
            </button>
            <button
              type="button"
              onClick={handleThumbsDown}
              disabled={!!feedbackBusy}
              data-testid="coach-suggestion-thumbs-down"
              aria-label="Precisa melhorar — abrir Ensinar IA"
              className={cn(
                "inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] hover:bg-muted",
                suggestion.feedback_status === "negative"
                  ? "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  : "border-border bg-background",
              )}
            >
              {feedbackBusy === "negative" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ThumbsDown className="h-3 w-3" />
              )}
              Precisa melhorar
            </button>
          </div>
          {suggestion.reasoning && (
            <div className="text-[10px] text-muted-foreground italic">{suggestion.reasoning}</div>
          )}
          {suggestion.learning_ids_used && suggestion.learning_ids_used.length > 0 && (
            <div className="text-[10px] text-emerald-700 dark:text-emerald-400">
              Aprendizados usados: {suggestion.learning_ids_used.length}
              {suggestion.grounding_score != null &&
                ` · grounding ${suggestion.grounding_score.toFixed(2)}`}
            </div>
          )}
        </div>
      )}
      <TeachModeDrawer
        open={teachOpen}
        onClose={() => {
          setTeachOpen(false);
          setTeachSource(null);
        }}
        seedExplanation={teachSeed}
        conversationId={conversationId}
        sourceSuggestion={teachSource}
      />
    </div>
  );
}

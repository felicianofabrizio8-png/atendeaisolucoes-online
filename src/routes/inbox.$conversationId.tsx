import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { timeAgo, formatBRL, type Message } from "@/data/mock";
import {
  getConversationById,
  getLeadById,
  getMessagesFor,
  appendMessage,
  markLeadLost,
  markLeadWon,
  refetchConversationMessages,
  subscribeRepo,
} from "@/data/leadRepo";
import { useAuth } from "@/auth/AuthContext";
import { ChannelBadge, StatusBadge } from "@/components/Badges";
import { OriginBadge, getConversationOrigin } from "./inbox.index";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Sparkles,
  FileText,
  Calendar,
  Target,
  CheckCircle2,
  XCircle,
  Send,
  Loader2,
  Tag,
  Clock,
  Flame,
  X,
  DollarSign,
  MessageSquare,
} from "lucide-react";
import { getQuote, markQuoteSent, type Quote } from "@/data/quotes";
import { getSettings, subscribeSettings } from "@/data/settings";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { QualificationPanel } from "@/components/QualificationBadges";
import { AITimeline } from "@/components/AITimeline";

export const Route = createFileRoute("/inbox/$conversationId")({
  component: ConversationPage,
  validateSearch: (search: Record<string, unknown>): { quote?: string } => {
    if (typeof search.quote === "string") return { quote: search.quote };
    return {};
  },
});

interface AISuggestion {
  classification: "frio" | "morno" | "quente";
  intent: string;
  objection?: string | null;
  nextAction: string;
  suggestedReply: string;
  lowConfidence?: boolean;
  logId?: string;
  fallbackMessage?: string;
}

type MetaSendPayload = {
  ok?: boolean;
  error?: string;
  metaError?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  } | null;
  status?: number;
  dbError?: unknown;
};

async function readFunctionError(
  error: unknown,
  data: unknown,
): Promise<{ message: string; full: unknown }> {
  const payload = data as MetaSendPayload | null;
  if (payload?.metaError || payload?.error) {
    const meta = payload.metaError;
    const parts = [
      meta?.message ?? payload.error,
      meta?.code ? `code ${meta.code}` : null,
      meta?.error_subcode ? `subcode ${meta.error_subcode}` : null,
      meta?.fbtrace_id ? `fbtrace ${meta.fbtrace_id}` : null,
    ].filter(Boolean);
    return { message: parts.join(" • "), full: payload };
  }

  const context = error as { message?: string; context?: { response?: Response } } | null;
  const response = context?.context?.response;
  if (response) {
    const raw = await response
      .clone()
      .text()
      .catch(() => "");
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as MetaSendPayload;
        const meta = parsed.metaError;
        const parts = [
          meta?.message ?? parsed.error ?? raw,
          meta?.code ? `code ${meta.code}` : null,
          meta?.error_subcode ? `subcode ${meta.error_subcode}` : null,
          meta?.fbtrace_id ? `fbtrace ${meta.fbtrace_id}` : null,
        ].filter(Boolean);
        return { message: parts.join(" • "), full: parsed };
      } catch {
        return { message: raw, full: raw };
      }
    }
  }

  const fallback = context?.message ?? "Falha ao enviar mensagem";
  return { message: fallback, full: error };
}

// Considera "cliente quente parado" quando o lead é quente e há mensagem do cliente
// aguardando resposta há pelo menos o tempo de SLA configurado em /configuracoes.

const IMAGE_URL_RE = /(https?:\/\/[^\s]+?\.(?:jpg|jpeg|png|webp|gif)(?:\?[^\s]*)?)/gi;

function ImagePreview({ url }: { url: string }) {
  const [error, setError] = useState(false);
  if (error) {
    return <span className="text-xs italic opacity-70">Imagem indisponível</span>;
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="block">
      <img
        src={url}
        alt="Imagem"
        onError={() => setError(true)}
        className="rounded-md max-w-full md:max-w-[240px] w-auto h-auto max-h-[50vh] md:max-h-none object-contain cursor-zoom-in"
        loading="lazy"
      />
    </a>
  );
}

function MessageContent({ message }: { message: Message }) {
  const meta = message.sourceMetadata as Record<string, unknown> | undefined;
  const mediaUrl =
    (meta?.media_url as string | undefined) ??
    (meta?.mediaUrl as string | undefined) ??
    (meta?.image_url as string | undefined);
  const isImageType =
    message.sourceSubtype === "image" ||
    (meta?.type as string | undefined) === "image";

  if (mediaUrl && (isImageType || IMAGE_URL_RE.test(mediaUrl))) {
    IMAGE_URL_RE.lastIndex = 0;
    return (
      <div className="space-y-1">
        <ImagePreview url={mediaUrl} />
        {message.text && !/^https?:\/\//.test(message.text.trim()) && (
          <div>{message.text}</div>
        )}
      </div>
    );
  }

  const text = message.text ?? "";
  IMAGE_URL_RE.lastIndex = 0;
  if (!IMAGE_URL_RE.test(text)) {
    return <>{text}</>;
  }
  IMAGE_URL_RE.lastIndex = 0;
  const parts: Array<{ type: "text" | "image"; value: string }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IMAGE_URL_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: "image", value: match[1] });
    lastIndex = match.index + match[1].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", value: text.slice(lastIndex) });
  }
  return (
    <div className="space-y-1">
      {parts.map((p, i) =>
        p.type === "image" ? (
          <ImagePreview key={i} url={p.value} />
        ) : (
          p.value.trim() ? <div key={i}>{p.value}</div> : null
        ),
      )}
    </div>
  );
}

function ConversationPage() {

  const { conversationId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { profile } = useAuth();
  // Re-renderiza quando o repo mudar (mensagens novas, status atualizado, etc.).
  useSyncExternalStore(
    subscribeRepo,
    () => 0,
    () => 0,
  );
  const conversation = getConversationById(conversationId);
  const lead = conversation ? getLeadById(conversation.leadId) : undefined;
  const repoMessages = conversation ? getMessagesFor(conversationId) : [];

  // `localMessages` guarda apenas adições otimistas (envios ainda não confirmados
  // pelo backend) e mensagens de sistema locais (ex.: "Venda fechada"). O Realtime
  // do leadRepo atualiza `repoMessages` automaticamente — não usamos useState para
  // a lista principal, senão mensagens novas só apareceriam ao reabrir a conversa.
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const messages = useMemo<Message[]>(() => {
    const ids = new Set(repoMessages.map((m) => m.id));
    const extras = localMessages.filter((m) => !ids.has(m.id));
    return [...repoMessages, ...extras].sort(
      (a, b) => +new Date(a.at) - +new Date(b.at),
    );
  }, [repoMessages, localMessages]);

  // Limpa otimistas que já foram absorvidos pelo repo (evita memória crescendo).
  useEffect(() => {
    if (localMessages.length === 0) return;
    const ids = new Set(repoMessages.map((m) => m.id));
    if (localMessages.some((m) => ids.has(m.id))) {
      setLocalMessages((prev) => prev.filter((m) => !ids.has(m.id)));
    }
  }, [repoMessages, localMessages]);
  const [input, setInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [ai, setAi] = useState<AISuggestion | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [closedInfo, setClosedInfo] = useState<{ value: number; at: string } | null>(null);
  const [pendingQuote, setPendingQuote] = useState<Quote | null>(null);
  const [quoteSuggesting, setQuoteSuggesting] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [aiState, setAiState] = useState<{ ai_status: string | null; ai_handling: boolean } | null>(null);
  const [aiHandoffReason, setAiHandoffReason] = useState<string | null>(null);
  const [takingOver, setTakingOver] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Carrega ai_status da conversa + realtime + último motivo de handoff
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    const loadStatus = async () => {
      const { data } = await supabase
        .from("conversations")
        .select("ai_status, ai_handling")
        .eq("id", conversationId)
        .maybeSingle();
      if (!cancelled && data) setAiState({ ai_status: data.ai_status, ai_handling: data.ai_handling });
    };
    const loadReason = async () => {
      const { data } = await supabase
        .from("ai_flow_events")
        .select("payload, event_type, created_at")
        .eq("conversation_id", conversationId)
        .in("event_type", ["handoff_requested", "handoff_safety_block"])
        .order("created_at", { ascending: false })
        .limit(1);
      if (!cancelled && data && data[0]) {
        const p = (data[0].payload ?? {}) as { reason?: string };
        setAiHandoffReason(p.reason ?? data[0].event_type);
      }
    };
    void loadStatus();
    void loadReason();

    const ch = supabase
      .channel(`conv-ai-${conversationId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversations", filter: `id=eq.${conversationId}` },
        (payload) => {
          const row = payload.new as { ai_status: string | null; ai_handling: boolean };
          setAiState({ ai_status: row.ai_status, ai_handling: row.ai_handling });
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(ch);
    };
  }, [conversationId]);

  const handleTakeover = async () => {
    if (takingOver) return;
    setTakingOver(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const res = await fetch("/api/ai/agent-takeover", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Falha ao assumir");
      setAiState({ ai_status: "assumido_humano", ai_handling: false });
      toast.success("Você assumiu o atendimento. IA pausada para esta conversa.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao assumir atendimento");
    } finally {
      setTakingOver(false);
    }
  };

  // Quando voltamos da tela de orçamentos com ?quote=<id>, carrega o orçamento
  // pronto para envio acima do campo de mensagem.
  useEffect(() => {
    if (search.quote) {
      const q = getQuote(search.quote);
      if (q) setPendingQuote(q);
      navigate({
        to: "/inbox/$conversationId",
        params: { conversationId },
        search: {},
        replace: true,
      });
    }
  }, [search.quote, conversationId, navigate]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, ai, pendingQuote]);


  const settings = useSyncExternalStore(subscribeSettings, getSettings, getSettings);

  const isHotStale = useMemo(() => {
    if (!lead || !conversation) return false;
    if (closedInfo) return false;
    if (lead.status !== "quente") return false;
    if (!conversation.awaitingReply) return false;
    const lastLead = [...messages].reverse().find((m) => m.role === "lead");
    const ref = lastLead?.at ?? conversation.lastMessageAt;
    const minutes = (Date.now() - new Date(ref).getTime()) / 60_000;
    return minutes >= settings.slaMinutes;
  }, [lead, conversation, messages, closedInfo, settings.slaMinutes]);

  if (!conversation || !lead) {
    return (
      <div className="flex-1 p-8">
        <p>Conversa não encontrada.</p>
        <Link to="/inbox" className="text-primary hover:underline">
          Voltar
        </Link>
      </div>
    );
  }

  const lastIncoming = [...messages].reverse().find((m) => m.role === "lead");
  const origin = getConversationOrigin(
    lead,
    lastIncoming ?? messages[messages.length - 1],
    conversation,
  );
  const isComment =
    conversation.interactionType === "comment" ||
    origin === "instagram_comment" ||
    origin === "facebook_comment" ||
    origin === "comment";
  const commentMeta = (lastIncoming?.sourceMetadata ?? {}) as {
    comment_id?: string;
    post_id?: string;
    media_id?: string;
  };

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const msg: Message = {
      id: `local-${Date.now()}`,
      conversationId,
      role: "agent",
      text: trimmed,
      at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, msg]);
    setInput("");
    setSendError(null);

    const isWhatsApp = lead?.channel === "whatsapp";
    if (profile?.company_id) {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        if (token) {
          if (isWhatsApp) {
            // WhatsApp Cloud API — mesma rota usada pelo "Enviar teste"
            const res = await fetch("/api/whatsapp/send", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ conversationId, text: trimmed }),
            });
            if (res.ok) return;
            // Falhou: remove a bolha otimista e mostra o erro real da Meta
            let errMsg = `HTTP ${res.status}`;
            try {
              const j = (await res.json()) as { error?: string; metaError?: unknown };
              if (j.error) errMsg = j.error;
              console.error("[chat send] WhatsApp falhou", j);
            } catch {
              /* ignore */
            }
            setMessages((prev) => prev.filter((m) => m.id !== msg.id));
            setSendError(errMsg);
            toast.error("Falha ao enviar WhatsApp", { description: errMsg });
            return;
          } else {
            // Meta (Instagram / Facebook / Messenger / Comentário) → meta-send edge function
            const providerType =
              origin === "instagram_comment"
                ? "instagram_comment"
                : origin === "instagram_direct"
                  ? "instagram_direct"
                  : origin;
            const subtype =
              origin === "instagram_comment" ||
              origin === "facebook_comment" ||
              origin === "comment"
                ? "comment"
                : "dm";
            const { data, error } = await supabase.functions.invoke("meta-send", {
              body: {
                conversationId,
                leadId: lead.id,
                text: trimmed,
                subtype,
                origin,
                provider_type: providerType,
              },
            });
            const ok = !error && (data as { ok?: boolean } | null)?.ok === true;
            if (ok) return;
            const details = await readFunctionError(error, data);
            console.error("[chat send] Meta falhou", {
              origin,
              providerType,
              subtype,
              error,
              data,
              full: details.full,
            });
            setMessages((prev) => prev.filter((m) => m.id !== msg.id));
            setSendError(details.message);
            const label =
              origin === "instagram_direct" || origin === "instagram_comment"
                ? "Instagram"
                : origin === "messenger"
                  ? "Messenger"
                  : "Meta";
            toast.error(`Falha ao enviar ${label}`, { description: details.message });
            return;
          }
        }
      } catch (e) {
        console.error("[chat send] erro", e);
        setMessages((prev) => prev.filter((m) => m.id !== msg.id));
        setSendError(e instanceof Error ? e.message : "Erro de rede");
        toast.error("Falha ao enviar mensagem", {
          description: e instanceof Error ? e.message : "Erro de rede",
        });
        return;
      }
    }

    void appendMessage(msg, profile?.company_id);
  };

  const markAiSent = async (logId: string, sentText: string, originalText: string) => {
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) return;
      await fetch("/api/ai/mark-sent", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          logId,
          sentText,
          wasEdited: sentText.trim() !== originalText.trim(),
        }),
      });
    } catch (e) {
      console.warn("[AI_MARK_SENT_CLIENT]", e);
    }
  };

  const sendSuggestion = () => {
    if (!ai?.suggestedReply) return;
    const text = ai.suggestedReply;
    const logId = ai.logId;
    sendMessage(text);
    if (logId) void markAiSent(logId, text, text);
    setAi(null);
  };

  const generateAI = async () => {
    setAiLoading(true);
    setAiError(null);
    setAi(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sessão expirada. Faça login novamente.");
      const res = await fetch("/api/ai/suggest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          leadName: lead.name,
          channel: lead.channel,
          product: lead.product,
          tags: lead.tags,
          conversationId,
          leadId: lead.id,
          messages: messages.map((m) => ({ role: m.role, text: m.text })),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Erro ${res.status}`);
      }
      const data = (await res.json()) as AISuggestion;
      setAi(data);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Falha ao gerar sugestão");
    } finally {
      setAiLoading(false);
    }
  };

  const handleConfirmClose = (value: number) => {
    setClosedInfo({ value, at: new Date().toISOString() });
    setCloseOpen(false);
    if (lead) void markLeadWon(lead.id, value);
    setMessages((prev) => [
      ...prev,
      {
        id: `sys-${Date.now()}`,
        conversationId,
        role: "system",
        text: `✅ Venda fechada — ${formatBRL(value)}`,
        at: new Date().toISOString(),
      },
    ]);
  };

  const confirmLost = (reason: string) => {
    if (!lead) return;
    void markLeadLost(lead.id, reason);
    setLostOpen(false);
    setClosedInfo({ value: 0, at: new Date().toISOString() });
    setMessages((prev) => [
      ...prev,
      {
        id: `sys-${Date.now()}`,
        conversationId,
        role: "system",
        text: `❌ Lead marcado como perdido — ${reason}`,
        at: new Date().toISOString(),
      },
    ]);
  };

  const sendPendingQuote = () => {
    if (!pendingQuote) return;
    sendMessage(pendingQuote.message);
    markQuoteSent(pendingQuote.id);
    setMessages((prev) => [
      ...prev,
      {
        id: `sys-${Date.now()}`,
        conversationId,
        role: "system",
        text: `📄 Orçamento enviado — ${pendingQuote.productName} • ${formatBRL(pendingQuote.finalValue)}`,
        at: new Date().toISOString(),
      },
    ]);
    setPendingQuote(null);
  };

  const openNewQuote = async () => {
    if (!lead) return;
    setQuoteSuggesting(true);
    let suggestedProductId: string | undefined;
    let suggestionReason: string | undefined;
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sessão expirada");
      const res = await fetch("/api/ai/suggest-product", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          leadName: lead.name,
          product: lead.product,
          messages: messages.map((m) => ({ role: m.role, text: m.text })),
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { productId: string; reason: string };
        suggestedProductId = data.productId;
        suggestionReason = data.reason;
      }
    } catch {
      // segue sem sugestão — usuário escolhe manualmente
    } finally {
      setQuoteSuggesting(false);
    }
    navigate({
      to: "/orcamentos",
      search: {
        new: "1",
        leadId: lead.id,
        conversationId,
        ...(suggestedProductId ? { suggestedProductId } : {}),
        ...(suggestionReason ? { suggestionReason } : {}),
      },
    });
  };

  const lastMessageAge = timeAgo(messages[messages.length - 1]?.at ?? conversation.lastMessageAt);

  return (
    <div className="flex-1 flex min-w-0 min-h-0 h-full max-w-full overflow-hidden">
      {/* Conversation column */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 max-w-full border-r border-border overflow-hidden">
        <header className="h-12 md:h-14 px-3 md:px-4 border-b border-border flex items-center gap-2 md:gap-3 shrink-0">

          <button
            onClick={() => navigate({ to: "/inbox" })}
            className="md:hidden p-1.5 rounded-md hover:bg-accent shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 md:gap-2 flex-wrap">
              <span className="font-semibold truncate text-sm md:text-base">{lead.name}</span>
              <OriginBadge origin={origin} />
              {origin !== "whatsapp" && <ChannelBadge channel={lead.channel} />}
              {closedInfo ? (
                <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-[var(--status-won)]/15 text-[var(--status-won)]">
                  <CheckCircle2 className="h-3 w-3" /> Fechado
                </span>
              ) : (
                <StatusBadge status={lead.status} />
              )}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5 truncate">
              <Clock className="h-3 w-3 shrink-0" />
              <span className="truncate">Há {lastMessageAge}</span>
              {conversation.slaBreached && conversation.awaitingReply && !closedInfo && (
                <span className="text-[var(--status-urgent)] font-semibold ml-1 shrink-0">
                  • SLA
                </span>
              )}
            </div>
          </div>
          {!closedInfo && (
            <button
              onClick={() => setCloseOpen(true)}
              className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-[var(--status-won)] text-white hover:opacity-90 text-xs font-semibold shrink-0"
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Fechar venda
            </button>
          )}
        </header>

        {/* AI status banners */}
        {aiState?.ai_status === "aguardando_humano" && (
          <div className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2.5 flex items-center gap-2">
            <span className="text-sm font-bold text-amber-700 dark:text-amber-400">
              ⚠️ Atendimento humano necessário
            </span>
            {aiHandoffReason && (
              <span className="text-xs text-muted-foreground">Motivo: {aiHandoffReason}</span>
            )}
            <button
              onClick={handleTakeover}
              disabled={takingOver}
              className="ml-auto inline-flex items-center gap-1.5 h-7 px-3 rounded-md bg-amber-600 text-white hover:bg-amber-700 text-xs font-semibold disabled:opacity-50"
            >
              {takingOver ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Assumir atendimento
            </button>
          </div>
        )}
        {aiState?.ai_status === "pre_atendido_ia" && (
          <div className="border-b border-sky-500/40 bg-sky-500/10 px-4 py-2 flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-sky-600" />
            <span className="text-xs font-semibold text-sky-700 dark:text-sky-400">
              🤖 Pré-atendido pela IA
            </span>
            <button
              onClick={handleTakeover}
              disabled={takingOver}
              className="ml-auto inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-sky-500/40 text-sky-700 hover:bg-sky-500/10 text-[11px] font-semibold disabled:opacity-50"
            >
              Assumir
            </button>
          </div>
        )}


        {/* Hot-stale alert banner */}
        {isHotStale && (
          <div className="border-b border-[var(--status-urgent)]/40 bg-[var(--status-urgent)]/10 px-4 py-2.5 flex items-center gap-2 animate-pulse">
            <Flame className="h-4 w-4 text-[var(--status-urgent)]" />
            <span className="text-sm font-bold text-[var(--status-urgent)] tracking-wide">
              🔥 CLIENTE QUENTE PARADO
            </span>
            <span className="text-xs text-muted-foreground">
              Aguardando resposta há {lastMessageAge}. Responda agora para não perder a venda.
            </span>
          </div>
        )}

        {/* Comment-origin context banner */}
        {isComment && (
          <div className="border-b border-[var(--channel-instagram)]/40 bg-[var(--channel-instagram)]/10 px-4 py-2.5 flex items-start gap-2">
            <MessageSquare className="h-4 w-4 text-[var(--channel-instagram)] mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0 text-xs">
              <div className="font-semibold text-[var(--channel-instagram)] uppercase tracking-wide">
                Comentário em{" "}
                {origin === "instagram_comment" ? "post do Instagram" : "publicação do Facebook"}
              </div>
              {lastIncoming?.text && (
                <div className="mt-1 text-foreground/80 italic line-clamp-2">
                  "{lastIncoming.text}"
                </div>
              )}
              {(commentMeta.post_id || commentMeta.media_id) && (
                <div className="mt-1 text-muted-foreground">
                  Post:{" "}
                  <span className="font-mono">{commentMeta.post_id ?? commentMeta.media_id}</span>
                  {commentMeta.media_id && origin === "instagram_comment" && (
                    <>
                      {" · "}
                      <a
                        href={`https://www.instagram.com/p/${commentMeta.media_id}/`}
                        target="_blank"
                        rel="noreferrer"
                        className="underline hover:text-foreground"
                      >
                        abrir
                      </a>
                    </>
                  )}
                </div>
              )}
              <div className="mt-1 text-muted-foreground">
                Você está respondendo ao <strong>comentário</strong> publicamente — não é uma
                mensagem privada.
              </div>
            </div>
          </div>
        )}

        {closedInfo && (
          <div className="border-b border-[var(--status-won)]/40 bg-[var(--status-won)]/10 px-4 py-2.5 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-[var(--status-won)]" />
            <span className="text-sm font-semibold text-[var(--status-won)]">
              Venda fechada — {formatBRL(closedInfo.value)}
            </span>
          </div>
        )}

        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scroll-smooth p-3 md:p-4 pb-4 md:pb-6 space-y-3 overscroll-contain">
          {messages.map((m) => {
            if (m.role === "system") {
              return (
                <div key={m.id} className="flex justify-center">
                  <span className="text-[11px] text-muted-foreground bg-secondary rounded-full px-3 py-1">
                    {m.text}
                  </span>
                </div>
              );
            }
            const tplMeta = m.sourceMetadata as { template_name?: string; category?: string } | undefined;
            const isTemplate = m.role === "agent" && !!tplMeta?.template_name;
            return (
              <div
                key={m.id}
                className={cn(
                  "flex flex-col max-w-[90%] md:max-w-[75%]",
                  m.role === "agent" ? "ml-auto items-end" : "items-start",
                )}
              >
                <div
                  className={cn(
                    "rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words",
                    m.role === "agent"
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-card border border-border rounded-bl-sm",
                  )}
                >
                  <MessageContent message={m} />
                </div>
                {isTemplate && (
                  <span className="text-[10px] mt-1 px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary">
                    Enviado via template Utility{tplMeta?.template_name ? ` · ${tplMeta.template_name}` : ""}
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground mt-1 px-1">{timeAgo(m.at)}</span>
              </div>
            );

          })}
        </div>

        {/* Pending quote panel — appears above the composer when a quote was just created */}
        {pendingQuote && !closedInfo && (
          <div className="border-t border-[var(--status-won)]/40 bg-[var(--status-won)]/10 p-3 shrink-0 max-h-[40vh] overflow-y-auto">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="h-4 w-4 text-[var(--status-won)]" />
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--status-won)]">
                Orçamento pronto para envio
              </span>
              <span className="ml-auto text-xs font-bold">
                {formatBRL(pendingQuote.finalValue)}
                {pendingQuote.installments > 1 && (
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    • {pendingQuote.installments}x
                  </span>
                )}
              </span>
              <button
                onClick={() => setPendingQuote(null)}
                className="p-1 rounded hover:bg-accent"
                title="Descartar"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="rounded-md bg-card border border-border p-3 text-sm whitespace-pre-wrap leading-relaxed mb-2">
              {pendingQuote.message}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={sendPendingQuote}
                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--status-won)] text-white px-3 py-1.5 text-xs font-semibold hover:opacity-90"
              >
                <Send className="h-3.5 w-3.5" /> Enviar na conversa
              </button>
              <button
                onClick={() => {
                  setInput(pendingQuote.message);
                  setPendingQuote(null);
                }}
                className="text-xs rounded-md bg-secondary px-3 py-1.5 hover:bg-accent"
              >
                Editar antes
              </button>
            </div>
          </div>
        )}

        {sendError && (
          <div className="border-t border-[var(--status-urgent)]/40 bg-[var(--status-urgent)]/10 px-3 py-2 text-xs text-[var(--status-urgent)]">
            <div className="flex items-start gap-2">
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="min-w-0">
                <div className="font-semibold">Falha ao enviar pela Meta</div>
                <div className="mt-0.5 break-words font-mono text-[11px]">{sendError}</div>
              </div>
              <button
                type="button"
                onClick={() => setSendError(null)}
                className="ml-auto rounded p-1 hover:bg-accent"
                title="Fechar erro"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* AI suggestion panel — appears right above the composer */}
        {(ai || aiLoading || aiError) && (
          <div className="border-t border-primary/30 bg-primary/5 p-3 shrink-0 max-h-[40vh] overflow-y-auto">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold uppercase tracking-wide text-primary">
                Sugestão da IA
              </span>
              {(ai || aiError) && (
                <button
                  onClick={() => {
                    setAi(null);
                    setAiError(null);
                  }}
                  className="ml-auto p-1 rounded hover:bg-accent"
                  title="Descartar"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {aiLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Analisando conversa e gerando resposta…
              </div>
            )}
            {aiError && <p className="text-sm text-[var(--status-urgent)]">{aiError}</p>}
            {ai && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded bg-secondary px-1.5 py-0.5">
                    Classificação: <strong className="capitalize">{ai.classification}</strong>
                  </span>
                  <span className="rounded bg-secondary px-1.5 py-0.5">Intenção: {ai.intent}</span>
                  {ai.objection && (
                    <span className="rounded bg-[var(--status-warm)]/20 text-[var(--status-warm)] px-1.5 py-0.5">
                      Objeção: {ai.objection}
                    </span>
                  )}
                  <span className="rounded bg-secondary px-1.5 py-0.5">
                    Próxima ação: {ai.nextAction}
                  </span>
                </div>
                {ai.lowConfidence && (
                  <div className="rounded-md border border-[var(--status-urgent)]/40 bg-[var(--status-urgent)]/10 px-2 py-1.5 text-xs text-[var(--status-urgent)]">
                    {ai.fallbackMessage ?? "✋ Atendimento humano recomendado: a IA não tem dados suficientes."}
                  </div>
                )}
                <div className="rounded-md bg-card border border-border p-3 text-sm whitespace-pre-wrap">
                  {ai.suggestedReply}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={sendSuggestion}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-semibold hover:opacity-90"
                  >
                    <Send className="h-3.5 w-3.5" /> Enviar
                  </button>
                  <button
                    onClick={() => {
                      setInput(ai.suggestedReply);
                      setAi(null);
                    }}
                    className="text-xs rounded-md bg-secondary px-3 py-1.5 hover:bg-accent"
                  >
                    Editar antes
                  </button>
                  <button
                    onClick={generateAI}
                    className="text-xs rounded-md bg-secondary px-3 py-1.5 hover:bg-accent inline-flex items-center gap-1"
                  >
                    <Sparkles className="h-3 w-3" /> Gerar outra
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Composer */}
        <div
          className="border-t border-border p-2 md:p-3 shrink-0 bg-background"
          style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        >

          <div className="flex items-end gap-1.5 md:gap-2">
            <button
              onClick={generateAI}
              disabled={aiLoading || !!closedInfo}
              className="h-9 px-2 md:px-3 inline-flex items-center gap-1.5 rounded-md bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 text-xs font-semibold disabled:opacity-50 shrink-0"
              title="Responder com IA"
              aria-label="Responder com IA"
            >
              {aiLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              <span className="hidden md:inline">Responder com IA</span>
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={!!closedInfo}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
              placeholder={
                closedInfo
                  ? "Venda fechada."
                  : isComment
                    ? "Resposta ao comentário…"
                    : "Mensagem…"
              }
              rows={1}
              className="flex-1 min-w-0 resize-none rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 max-h-32 md:min-h-[3.5rem]"
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || !!closedInfo}
              className="h-9 px-2.5 md:px-3 inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 text-sm font-medium shrink-0"
              aria-label={isComment ? "Responder comentário" : "Enviar"}
            >
              <Send className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{isComment ? "Responder" : "Enviar"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Side panel */}
      <aside className="hidden lg:flex w-80 shrink-0 flex-col bg-card/40 overflow-y-auto min-h-0">

        <div className="p-4 border-b border-border">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Lead</div>
          <div className="text-base font-semibold">{lead.name}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{lead.phone ?? lead.handle}</div>
        </div>

        <div className="p-4 border-b border-border space-y-3 text-sm">
          <Row label="Produto" value={lead.product ?? "—"} />
          <Row
            label={closedInfo ? "Valor da venda" : "Valor estimado"}
            value={
              closedInfo
                ? formatBRL(closedInfo.value)
                : lead.estimatedValue
                  ? formatBRL(lead.estimatedValue)
                  : "—"
            }
          />
          <Row label="Atribuído a" value={lead.assignedTo ?? "Ninguém"} />
          <Row label="Origem" value={<ChannelBadge channel={lead.channel} />} />
        </div>

        <QualificationPanel conv={conversation} />
        <AITimeline conversationId={conversationId} />



        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground mb-2">
            <Target className="h-3 w-3" /> Próxima ação
          </div>
          {lead.nextAction ? (
            <div>
              <div className="text-sm font-medium">{lead.nextAction.label}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {new Date(lead.nextAction.dueAt).toLocaleString("pt-BR")}
              </div>
            </div>
          ) : (
            <div className="rounded-md bg-[var(--status-warm)]/10 text-[var(--status-warm)] text-xs px-2 py-1.5">
              ⚠ Sem próxima ação definida
            </div>
          )}
        </div>

        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground mb-2">
            <Tag className="h-3 w-3" /> Tags
          </div>
          <div className="flex flex-wrap gap-1">
            {lead.tags.length === 0 && (
              <span className="text-xs text-muted-foreground">Nenhuma</span>
            )}
            {lead.tags.map((t: string) => (
              <span key={t} className="rounded bg-secondary px-1.5 py-0.5 text-[11px]">
                #{t}
              </span>
            ))}
          </div>
        </div>

        <div className="p-4 space-y-1.5">
          <ActionButton
            icon={quoteSuggesting ? Loader2 : FileText}
            onClick={openNewQuote}
            disabled={!!closedInfo || quoteSuggesting}
          >
            {quoteSuggesting ? "Sugerindo produto…" : "Criar orçamento"}
          </ActionButton>
          <ActionButton icon={Calendar}>Agendar visita</ActionButton>
          <ActionButton icon={Target}>Definir próxima ação</ActionButton>
          <ActionButton
            icon={CheckCircle2}
            variant="won"
            onClick={() => setCloseOpen(true)}
            disabled={!!closedInfo}
          >
            Fechar venda
          </ActionButton>
          <ActionButton
            icon={XCircle}
            variant="lost"
            onClick={() => setLostOpen(true)}
            disabled={!!closedInfo}
          >
            Marcar como perdido
          </ActionButton>
        </div>
      </aside>

      {closeOpen && (
        <CloseSaleModal
          defaultValue={lead.estimatedValue}
          leadName={lead.name}
          onCancel={() => setCloseOpen(false)}
          onConfirm={handleConfirmClose}
        />
      )}

      {lostOpen && (
        <MarkLostModal
          leadName={lead.name}
          onCancel={() => setLostOpen(false)}
          onConfirm={confirmLost}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm text-right">{value}</span>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  children,
  variant = "default",
  onClick,
  disabled,
}: {
  icon: typeof FileText;
  children: React.ReactNode;
  variant?: "default" | "won" | "lost";
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full inline-flex items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
        variant === "won" && "text-[var(--status-won)]",
        variant === "lost" && "text-[var(--status-lost)]",
      )}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}

function CloseSaleModal({
  defaultValue,
  leadName,
  onCancel,
  onConfirm,
}: {
  defaultValue?: number;
  leadName: string;
  onCancel: () => void;
  onConfirm: (value: number) => void;
}) {
  const [raw, setRaw] = useState<string>(defaultValue ? String(defaultValue) : "");
  const value = Number(raw.replace(/[^\d]/g, ""));
  const valid = value > 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-[var(--status-won)]" />
          <h2 className="text-sm font-semibold">Fechar venda — {leadName}</h2>
          <button onClick={onCancel} className="ml-auto p-1 rounded hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <label className="block">
            <span className="text-xs text-muted-foreground">Valor da venda (R$)</span>
            <div className="mt-1 flex items-center gap-2 rounded-md bg-input px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <input
                autoFocus
                inputMode="numeric"
                value={raw}
                onChange={(e) => setRaw(e.target.value.replace(/[^\d]/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && valid) onConfirm(value);
                }}
                placeholder="Ex: 28500"
                className="flex-1 bg-transparent outline-none text-sm"
              />
            </div>
            {valid && (
              <span className="text-[11px] text-muted-foreground mt-1 block">
                {formatBRL(value)}
              </span>
            )}
          </label>
        </div>
        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="text-xs rounded-md bg-secondary px-3 py-2 hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            disabled={!valid}
            onClick={() => onConfirm(value)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-[var(--status-won)] text-white px-3 py-2 hover:opacity-90 disabled:opacity-40"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Confirmar venda
          </button>
        </div>
      </div>
    </div>
  );
}

function MarkLostModal({
  leadName,
  onCancel,
  onConfirm,
}: {
  leadName: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const settings = useSyncExternalStore(subscribeSettings, getSettings, getSettings);
  const reasons = settings.lossReasons;
  // Não pré-seleciona — força a vendedora a escolher um motivo conscientemente.
  const [selected, setSelected] = useState<string>("");
  const [custom, setCustom] = useState("");
  const useCustom = selected === "__custom__";
  const finalReason = useCustom ? custom.trim() : selected;
  const valid = !!finalReason;

  return (
    <div
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border flex items-center gap-2">
          <XCircle className="h-4 w-4 text-[var(--status-lost)]" />
          <h2 className="text-sm font-semibold">Marcar como perdido — {leadName}</h2>
          <button onClick={onCancel} className="ml-auto p-1 rounded hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Selecione um motivo <span className="font-semibold text-foreground">(obrigatório)</span>{" "}
            para entrar nos relatórios automaticamente.
          </p>
          <div className="space-y-1.5">
            {reasons.map((r) => (
              <label
                key={r}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors",
                  selected === r
                    ? "border-[var(--status-lost)] bg-[var(--status-lost)]/10"
                    : "border-border hover:bg-accent",
                )}
              >
                <input
                  type="radio"
                  name="loss-reason"
                  value={r}
                  checked={selected === r}
                  onChange={() => setSelected(r)}
                  className="accent-[var(--status-lost)]"
                />
                <span className="flex-1">{r}</span>
              </label>
            ))}
            <label
              className={cn(
                "flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors",
                useCustom
                  ? "border-[var(--status-lost)] bg-[var(--status-lost)]/10"
                  : "border-border hover:bg-accent",
              )}
            >
              <input
                type="radio"
                name="loss-reason"
                value="__custom__"
                checked={useCustom}
                onChange={() => setSelected("__custom__")}
                className="accent-[var(--status-lost)]"
              />
              <span className="flex-1">Outro…</span>
            </label>
            {useCustom && (
              <input
                autoFocus
                type="text"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && valid) onConfirm(finalReason);
                }}
                placeholder="Descreva o motivo"
                className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Você pode gerenciar a lista em{" "}
            <span className="font-semibold">Configurações → Motivos de perda</span>.
          </p>
        </div>
        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="text-xs rounded-md bg-secondary px-3 py-2 hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            disabled={!valid}
            onClick={() => onConfirm(finalReason)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-[var(--status-lost)] text-white px-3 py-2 hover:opacity-90 disabled:opacity-40"
          >
            <XCircle className="h-3.5 w-3.5" /> Confirmar perda
          </button>
        </div>
      </div>
    </div>
  );
}

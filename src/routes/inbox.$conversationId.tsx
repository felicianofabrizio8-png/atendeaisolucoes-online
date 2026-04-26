import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  getConversation,
  getLead,
  getMessages,
  timeAgo,
  formatBRL,
  type Message,
} from "@/data/mock";
import { ChannelBadge, StatusBadge } from "@/components/Badges";
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
} from "lucide-react";
import { getQuote, markQuoteSent, type Quote } from "@/data/quotes";
import { appendMessage, markLeadLost, markLeadWon } from "@/data/leadStore";
import { getSettings, subscribeSettings } from "@/data/settings";

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
  objection?: string;
  nextAction: string;
  suggestedReply: string;
}

// Considera "cliente quente parado" quando o lead é quente e há mensagem do cliente
// aguardando resposta há pelo menos o tempo de SLA configurado em /configuracoes.

function ConversationPage() {
  const { conversationId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const conversation = getConversation(conversationId);
  const lead = conversation ? getLead(conversation.leadId) : undefined;
  const initialMessages = conversation ? getMessages(conversationId) : [];

  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [ai, setAi] = useState<AISuggestion | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [closedInfo, setClosedInfo] = useState<{ value: number; at: string } | null>(null);
  const [pendingQuote, setPendingQuote] = useState<Quote | null>(null);
  const [quoteSuggesting, setQuoteSuggesting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
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
        <Link to="/inbox" className="text-primary hover:underline">Voltar</Link>
      </div>
    );
  }

  const sendMessage = (text: string) => {
    if (!text.trim()) return;
    const msg: Message = {
      id: `local-${Date.now()}`,
      conversationId,
      role: "agent",
      text: text.trim(),
      at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, msg]);
    appendMessage(msg);
    setInput("");
  };

  const sendSuggestion = () => {
    if (!ai?.suggestedReply) return;
    sendMessage(ai.suggestedReply);
    setAi(null);
  };

  const generateAI = async () => {
    setAiLoading(true);
    setAiError(null);
    setAi(null);
    try {
      const res = await fetch("/api/ai/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadName: lead.name,
          channel: lead.channel,
          product: lead.product,
          tags: lead.tags,
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
    if (lead) markLeadWon(lead.id, value);
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
    markLeadLost(lead.id, reason);
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
      const res = await fetch("/api/ai/suggest-product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    <div className="flex-1 flex min-w-0">
      {/* Conversation column */}
      <div className="flex-1 flex flex-col min-w-0 border-r border-border">
        <header className="h-14 px-4 border-b border-border flex items-center gap-3">
          <button
            onClick={() => navigate({ to: "/inbox" })}
            className="md:hidden p-1.5 rounded-md hover:bg-accent"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold truncate">{lead.name}</span>
              <ChannelBadge channel={lead.channel} />
              {closedInfo ? (
                <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-[var(--status-won)]/15 text-[var(--status-won)]">
                  <CheckCircle2 className="h-3 w-3" /> Fechado
                </span>
              ) : (
                <StatusBadge status={lead.status} />
              )}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
              <Clock className="h-3 w-3" />
              Última mensagem há {lastMessageAge}
              {conversation.slaBreached && conversation.awaitingReply && !closedInfo && (
                <span className="text-[var(--status-urgent)] font-semibold ml-1">• SLA estourado</span>
              )}
            </div>
          </div>
          {!closedInfo && (
            <button
              onClick={() => setCloseOpen(true)}
              className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-[var(--status-won)] text-white hover:opacity-90 text-xs font-semibold"
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Fechar venda
            </button>
          )}
        </header>

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

        {closedInfo && (
          <div className="border-b border-[var(--status-won)]/40 bg-[var(--status-won)]/10 px-4 py-2.5 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-[var(--status-won)]" />
            <span className="text-sm font-semibold text-[var(--status-won)]">
              Venda fechada — {formatBRL(closedInfo.value)}
            </span>
          </div>
        )}

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
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
            return (
              <div
                key={m.id}
                className={cn(
                  "flex flex-col max-w-[75%]",
                  m.role === "agent" ? "ml-auto items-end" : "items-start",
                )}
              >
                <div
                  className={cn(
                    "rounded-lg px-3 py-2 text-sm leading-relaxed",
                    m.role === "agent"
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-card border border-border rounded-bl-sm",
                  )}
                >
                  {m.text}
                </div>
                <span className="text-[10px] text-muted-foreground mt-1 px-1">{timeAgo(m.at)}</span>
              </div>
            );
          })}
        </div>

        {/* Pending quote panel — appears above the composer when a quote was just created */}
        {pendingQuote && !closedInfo && (
          <div className="border-t border-[var(--status-won)]/40 bg-[var(--status-won)]/10 p-3">
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

        {/* AI suggestion panel — appears right above the composer */}
        {(ai || aiLoading || aiError) && (
          <div className="border-t border-primary/30 bg-primary/5 p-3">
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
        <div className="border-t border-border p-3">
          <div className="flex items-end gap-2">
            <button
              onClick={generateAI}
              disabled={aiLoading || !!closedInfo}
              className="h-9 px-3 inline-flex items-center gap-1.5 rounded-md bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 text-xs font-semibold disabled:opacity-50"
              title="Analisar conversa e sugerir resposta"
            >
              {aiLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Responder com IA
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
                closedInfo ? "Venda fechada." : "Escreva uma mensagem… (Enter para enviar)"
              }
              rows={2}
              className="flex-1 resize-none rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || !!closedInfo}
              className="h-9 px-3 inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 text-sm font-medium"
            >
              <Send className="h-3.5 w-3.5" /> Enviar
            </button>
          </div>
        </div>
      </div>

      {/* Side panel */}
      <aside className="hidden lg:flex w-80 shrink-0 flex-col bg-card/40">
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
            {lead.tags.length === 0 && <span className="text-xs text-muted-foreground">Nenhuma</span>}
            {lead.tags.map((t) => (
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
  const [selected, setSelected] = useState<string>(reasons[0] ?? "");
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
            Selecione o motivo para entrar nos relatórios automaticamente.
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

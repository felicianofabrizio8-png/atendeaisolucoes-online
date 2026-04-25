import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
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
} from "lucide-react";

export const Route = createFileRoute("/inbox/$conversationId")({
  component: ConversationPage,
});

interface AISuggestion {
  classification: "frio" | "morno" | "quente";
  intent: string;
  objection?: string;
  nextAction: string;
  suggestedReply: string;
}

function ConversationPage() {
  const { conversationId } = Route.useParams();
  const navigate = useNavigate();
  const conversation = getConversation(conversationId);
  const lead = conversation ? getLead(conversation.leadId) : undefined;
  const initialMessages = conversation ? getMessages(conversationId) : [];

  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [ai, setAi] = useState<AISuggestion | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length]);

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
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        conversationId,
        role: "agent",
        text: text.trim(),
        at: new Date().toISOString(),
      },
    ]);
    setInput("");
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
              <StatusBadge status={lead.status} />
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
              <Clock className="h-3 w-3" />
              Última mensagem há {lastMessageAge}
              {conversation.slaBreached && conversation.awaitingReply && (
                <span className="text-[var(--status-urgent)] font-semibold ml-1">• SLA estourado</span>
              )}
            </div>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((m) => (
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
          ))}
        </div>

        {/* AI suggestion panel */}
        {(ai || aiLoading || aiError) && (
          <div className="border-t border-border bg-accent/40 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold uppercase tracking-wide">Sugestão da IA</span>
            </div>
            {aiLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Analisando conversa…
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
                </div>
                <div className="text-xs text-muted-foreground">
                  Próxima ação sugerida: <span className="text-foreground">{ai.nextAction}</span>
                </div>
                <div className="rounded-md bg-card border border-border p-2.5 text-sm whitespace-pre-wrap">
                  {ai.suggestedReply}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setInput(ai.suggestedReply)}
                    className="text-xs rounded-md bg-primary text-primary-foreground px-3 py-1.5 hover:opacity-90"
                  >
                    Usar resposta
                  </button>
                  <button
                    onClick={() => setAi(null)}
                    className="text-xs rounded-md bg-secondary px-3 py-1.5 hover:bg-accent"
                  >
                    Descartar
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
              disabled={aiLoading}
              className="h-9 px-3 inline-flex items-center gap-1.5 rounded-md bg-secondary hover:bg-accent text-xs font-medium disabled:opacity-50"
              title="Gerar resposta com IA"
            >
              <Sparkles className="h-3.5 w-3.5" /> IA
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
              placeholder="Escreva uma mensagem… (Enter para enviar)"
              rows={2}
              className="flex-1 resize-none rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim()}
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
            label="Valor estimado"
            value={lead.estimatedValue ? formatBRL(lead.estimatedValue) : "—"}
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
          <ActionButton icon={FileText}>Criar orçamento</ActionButton>
          <ActionButton icon={Calendar}>Agendar visita</ActionButton>
          <ActionButton icon={Target}>Definir próxima ação</ActionButton>
          <ActionButton icon={CheckCircle2} variant="won">Marcar como fechado</ActionButton>
          <ActionButton icon={XCircle} variant="lost">Marcar como perdido</ActionButton>
        </div>
      </aside>
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
}: {
  icon: typeof FileText;
  children: React.ReactNode;
  variant?: "default" | "won" | "lost";
}) {
  return (
    <button
      className={cn(
        "w-full inline-flex items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-accent transition-colors",
        variant === "won" && "text-[var(--status-won)]",
        variant === "lost" && "text-[var(--status-lost)]",
      )}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}

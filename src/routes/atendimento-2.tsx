import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Clock3, MessageCircle, Sparkles } from "lucide-react";
import { useAtendimentoData, type AtendimentoContact } from "@/hooks/useAtendimentoData";


export const Route = createFileRoute("/atendimento-2")({
  component: Atendimento2Page,
});

function channelLabel(channel: string) {
  return channel === "whatsapp" ? "WhatsApp" : channel.charAt(0).toUpperCase() + channel.slice(1);
}
function relativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "—";

  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "agora";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function statusLabel(status: string) {
  return {
    novo: "Novo",
    aguardando: "Aguardando",
    quente: "Quente",
    morno: "Morno",
    frio: "Frio",
    fechado: "Ganha",
    perdido: "Perdida",
  }[status] ?? status;
}

function contactTitle(contact: AtendimentoContact) {
  return contact.lead.name || contact.lead.phone || "Contato sem nome";
}

function ConversationList({
  contacts,
  selectedId,
  onSelect,
}: {
  contacts: AtendimentoContact[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="flex min-h-0 w-full flex-col border-r border-border bg-card lg:w-[340px]">
      <div className="border-b border-border px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Atendimento 2.0</p>
            <h1 className="mt-1 text-lg font-semibold text-foreground">Conversas</h1>
          </div>
          <span className="rounded-full border border-border px-2 py-1 text-[10px] font-semibold text-muted-foreground">
            Somente leitura
          </span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Visualização baseada nos dados reais do Inbox.</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {contacts.map((contact) => {
          const active = selectedId === contact.conversation.id;
          const lastMessage = contact.messages.at(-1);
          return (
            <button
              key={contact.conversation.id}
              type="button"
              onClick={() => onSelect(contact.conversation.id)}
              className={`flex w-full gap-3 border-b border-border px-5 py-4 text-left transition-colors ${
                active ? "bg-accent" : "hover:bg-accent/50"
              }`}
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                {contactTitle(contact).slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-foreground">{contactTitle(contact)}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {lastMessage ? relativeTime(lastMessage.at) : "—"}
                  </span>
                </span>
                <span className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>{channelLabel(contact.lead.channel)}</span>
                  <span>•</span>
                  <span>{statusLabel(contact.lead.status)}</span>
                </span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">
                  {lastMessage?.text || "Nenhuma mensagem"}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function ConversationView({ contact }: { contact: AtendimentoContact }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-primary" />
            <h2 className="truncate text-base font-semibold text-foreground">{contactTitle(contact)}</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {channelLabel(contact.lead.channel)} · {statusLabel(contact.lead.status)}
          </p>
        </div>
        <div className="hidden items-center gap-2 rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold text-muted-foreground sm:flex">
          <Clock3 className="h-3 w-3" /> Histórico
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-6">
        {contact.messages.map((message) => {
          const mine = message.role === "agent";
          return (
            <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[min(680px,85%)] rounded-2xl px-4 py-3 text-sm ${
                  mine
                    ? "rounded-br-md bg-primary text-primary-foreground"
                    : "rounded-bl-md border border-border bg-card text-foreground"
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{message.text}</p>
                <p className={`mt-2 text-[10px] ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                  {relativeTime(message.at)}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-border px-5 pb-[env(safe-area-inset-bottom)] py-3 text-xs text-muted-foreground">
        Atendimento 2.0 está em prévia somente leitura. Envio, anexos, IA e automações estarão disponíveis em etapas futuras.
      </div>
    </section>
  );
}

function Atendimento2Page() {
  const { contacts, status, error } = useAtendimentoData();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedId && contacts.some((contact) => contact.conversation.id === selectedId)) return;
    setSelectedId(contacts[0]?.conversation.id ?? null);
  }, [contacts, selectedId]);

  const selected = useMemo(
    () => contacts.find((contact) => contact.conversation.id === selectedId) ?? null,
    [contacts, selectedId],
  );

  if (status === "loading") {
    return <PreviewState title="Carregando conversas" detail="Buscando os dados atuais do Inbox." />;
  }

  if (status === "error") {
    return <PreviewState title="Não foi possível carregar o Atendimento 2.0" detail={error ?? "Erro ao carregar as conversas."} error />;
  }

  if (status === "empty") {
    return <PreviewState title="Nenhuma conversa disponível" detail="Quando houver conversas reais, elas aparecerão nesta prévia." />;
  }

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground lg:h-screen lg:min-h-0">
      <div className="flex items-center gap-3 border-b border-border px-5 py-3">
        <a href="/" className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar
        </a>
        <span className="text-xs text-muted-foreground">Prévia independente do Inbox atual</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <ConversationList contacts={contacts} selectedId={selectedId} onSelect={setSelectedId} />
        {selected ? (
          <ConversationView contact={selected} />
        ) : (
          <PreviewState title="Selecione uma conversa" detail="Escolha um contato para ler o histórico." />
        )}
        <aside className="hidden w-[280px] border-l border-border bg-card xl:block">
          <div className="flex border-b border-border text-xs font-semibold">
            <div className="flex-1 border-b-2 border-primary px-4 py-3 text-center text-foreground" aria-selected="true">
              Info
            </div>
            <div className="flex-1 px-4 py-3 text-center text-muted-foreground opacity-60" aria-disabled="true">
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" /> Assistente IA
              </span>
            </div>
          </div>
          <div className="p-5">
            <div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
              Em breve
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function PreviewState({ title, detail, error = false }: { title: string; detail: string; error?: boolean }) {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 text-center text-foreground">
      <div className="max-w-md">
        <MessageCircle className={`mx-auto h-8 w-8 ${error ? "text-destructive" : "text-primary"}`} />
        <h1 className="mt-4 text-base font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
        <a href="/" className="mt-5 inline-flex text-xs font-semibold text-primary hover:underline">
          Voltar ao início
        </a>
      </div>
    </main>
  );
}

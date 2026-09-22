import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Camera, FileUp, Images, Paperclip, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { timeAgo, type Message } from "@/data/mock";
import { refetchConversationMessages } from "@/data/leadRepo";
import { sendManualText } from "@/lib/inbox/manual-send";
import { suggestAiReply } from "@/lib/atendimento/ai-suggest";
import { getConversationOrigin } from "@/routes/inbox.index";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ContactAvatar } from "./ContactAvatar";
import { CustomerTierBadge } from "./CustomerTierBadge";
import { RichText } from "./RichText";
import type { AtendimentoContact } from "@/hooks/useAtendimentoData";

/**
 * Menu do clipe. Abre o seletor nativo com o filtro certo — arquivo livre,
 * galeria, ou câmera.
 *
 * O envio de TEXTO já é real (ver `sendManualText`); o de anexo ainda não, e o
 * aviso depois da escolha diz isso em vez de fingir que mandou. Mantido aqui
 * porque a escolha de arquivo já funciona e é onde o upload vai entrar.
 */
function AttachmentMenu() {
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [picker, setPicker] = useState<{ accept: string; capture?: "environment" }>({
    accept: "*/*",
  });

  const options = [
    {
      key: "arquivo",
      icon: FileUp,
      label: "Enviar arquivo",
      hint: "PDF, planilha, contrato",
      accept: "*/*",
    },
    {
      key: "midia",
      icon: Images,
      label: "Fotos e vídeos",
      hint: "Da galeria do aparelho",
      accept: "image/*,video/*",
    },
    {
      key: "camera",
      icon: Camera,
      label: "Tirar foto",
      hint: "Abre a câmera",
      accept: "image/*",
      capture: "environment" as const,
    },
  ];

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        accept={picker.accept}
        {...(picker.capture ? { capture: picker.capture } : {})}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            toast.info(`“${file.name}” selecionado`, {
              description: "O envio de anexo ainda não está ligado nesta tela.",
            });
          }
          e.target.value = "";
        }}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Anexar"
            className={cn(
              "shrink-0 rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
              open && "bg-secondary text-foreground",
            )}
          >
            <Paperclip className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" sideOffset={12} className="w-60 p-1.5">
          {options.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => {
                  setPicker({ accept: opt.accept, capture: opt.capture });
                  setOpen(false);
                  // Deixa o estado do input aplicar antes de abrir o seletor.
                  window.setTimeout(() => fileRef.current?.click(), 0);
                }}
                className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium leading-tight">{opt.label}</span>
                  <span className="block text-[11px] text-muted-foreground">{opt.hint}</span>
                </span>
              </button>
            );
          })}
        </PopoverContent>
      </Popover>
    </>
  );
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(date, today)) return "Hoje";
  if (sameDay(date, yesterday)) return "Ontem";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function ChatThread({
  contact,
  onBack,
  actions,
  draft,
  onDraftChange,
}: {
  contact: AtendimentoContact;
  onBack?: () => void;
  actions?: React.ReactNode;
  /**
   * Torna o campo controlado. Existe para o painel de IA conseguir carregar
   * uma sugestão no composer ("Usar no chat"); sem isso o texto ficaria preso
   * dentro deste componente e o painel não teria como escrever nele.
   * Omitido, o componente gerencia o próprio estado.
   */
  draft?: string;
  onDraftChange?: (value: string) => void;
}) {
  const bottom = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);
  const sendAttemptRef = useRef(0);
  const suggestAttemptRef = useRef(0);
  const activeConversationIdRef = useRef(contact.conversation.id);
  const [internalText, setInternalText] = useState("");
  const controlled = draft !== undefined && onDraftChange !== undefined;
  const text = controlled ? draft : internalText;
  const setText = controlled ? onDraftChange : setInternalText;
  const [sending, setSending] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  activeConversationIdRef.current = contact.conversation.id;

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [contact.conversation.id, contact.messages.length]);

  useEffect(() => {
    sendAttemptRef.current += 1;
    suggestAttemptRef.current += 1;
    setText("");
    setSendError(null);
    setSuggestError(null);
    sendingRef.current = false;
    setSending(false);
    setSuggesting(false);
    // `setText` fica fora das deps de propósito: quando o campo é controlado
    // ele é o `onDraftChange` do pai, cuja identidade muda a cada render.
    // Incluí-lo faria este reset disparar a cada render do pai e apagar o que
    // o atendente está digitando. O efeito existe só para a troca de conversa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.conversation.id]);

  const handleSuggest = async () => {
    if (sending || suggesting || contact.lead.channel !== "whatsapp") return;

    const conversationId = contact.conversation.id;
    const attemptId = ++suggestAttemptRef.current;
    const isCurrentAttempt = () =>
      activeConversationIdRef.current === conversationId && suggestAttemptRef.current === attemptId;

    setSuggesting(true);
    setSuggestError(null);

    try {
      const result = await suggestAiReply(conversationId);

      if (!isCurrentAttempt()) return;

      if (!result.ok) {
        setSuggestError(result.error);
        return;
      }

      if (result.kind === "reply") {
        setText(result.message);
        return;
      }

      if (result.kind === "handoff") {
        setSuggestError("A IA indicou atendimento humano para esta conversa.");
        return;
      }

      setSuggestError("A IA não gerou uma sugestão para esta mensagem.");
    } catch (error) {
      if (!isCurrentAttempt()) return;
      setSuggestError(error instanceof Error ? error.message : "Falha ao gerar sugestão");
    } finally {
      if (isCurrentAttempt()) setSuggesting(false);
    }
  };
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sendingRef.current || suggesting) return;

    const conversationId = contact.conversation.id;
    const attemptId = ++sendAttemptRef.current;
    const isCurrentAttempt = () =>
      activeConversationIdRef.current === conversationId && sendAttemptRef.current === attemptId;

    sendingRef.current = true;
    setSending(true);
    setSendError(null);

    const lastMessage = contact.messages[contact.messages.length - 1];
    const origin = getConversationOrigin(contact.lead, lastMessage, contact.conversation);

    try {
      const result = await sendManualText({
        conversationId,
        leadId: contact.lead.id,
        channel: contact.lead.channel,
        origin,
        text: trimmed,
      });

      if (!result.ok) {
        if (isCurrentAttempt()) setSendError(result.error);
        return;
      }

      if (result.delivery === "sent") {
        await refetchConversationMessages(conversationId);
      }

      if (isCurrentAttempt()) setText("");
    } catch (error) {
      if (isCurrentAttempt()) {
        setSendError(error instanceof Error ? error.message : "Falha ao enviar mensagem");
      }
    } finally {
      if (isCurrentAttempt()) {
        sendingRef.current = false;
        setSending(false);
      }
    }
  };

  const { lead, conversation, messages, history, hue } = contact;
  let lastDay = "";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 px-5 py-4">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Voltar para a lista"
            className="-ml-1 shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground lg:hidden"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        <ContactAvatar name={lead.name} hue={hue} size={52} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[17px] font-bold leading-tight">{lead.name}</h2>
            <CustomerTierBadge history={history} size="sm" />
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {lead.channel === "whatsapp"
              ? "WhatsApp"
              : lead.channel === "instagram"
                ? "Instagram"
                : "Facebook"}
            {conversation.detectedCity
              ? ` · ${conversation.detectedCity}/${conversation.detectedState ?? ""}`
              : ""}
            {` · ativo ${timeAgo(conversation.lastMessageAt)} atrás`}
          </p>
        </div>
        {actions}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
        <div className="mx-auto flex max-w-[680px] flex-col gap-2">
          {messages.map((message: Message) => {
            const day = dayLabel(message.at);
            const showDay = day !== lastDay;
            lastDay = day;

            if (message.role === "system") {
              return (
                <div
                  key={message.id}
                  className="my-2 self-center rounded-full bg-secondary/70 px-3 py-1 text-[11px] text-muted-foreground"
                >
                  <RichText text={message.text} />
                </div>
              );
            }

            const mine = message.role === "agent";
            return (
              <div key={message.id} className="contents">
                {showDay && (
                  <div className="my-3 self-center rounded-full bg-secondary/50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {day}
                  </div>
                )}
                <div
                  className={cn(
                    "max-w-[78%] rounded-3xl px-4 py-2.5 text-sm leading-relaxed",
                    // Balão enviado sólido em `primary`, que agora é neutro:
                    // cinza no tema escuro, quase preto no claro. Preenchimento
                    // cheio (em vez de 20% de opacidade) é o que mantém a
                    // distinção de quem falou depois que a cor de destaque saiu
                    // do produto.
                    mine
                      ? "self-end rounded-br-lg bg-primary text-primary-foreground"
                      : "self-start rounded-bl-lg border border-border bg-secondary/50 text-foreground",
                  )}
                >
                  <RichText text={message.text} />
                  {/* Sobre o balão sólido, `muted-foreground` some: ele é
                      calibrado para o fundo da página, não para o do balão. */}
                  <span
                    className={cn(
                      "mt-1 block text-right text-[10px]",
                      mine ? "text-primary-foreground/70" : "text-muted-foreground",
                    )}
                  >
                    {hhmm(message.at)}
                    {mine && message.deliveryStatus === "read" ? " · lida" : ""}
                  </span>
                </div>
              </div>
            );
          })}
          <div ref={bottom} />
        </div>
      </div>

      <form onSubmit={handleSubmit} className="px-5 pb-5">
        {suggestError ? (
          <p role="alert" className="mx-auto mb-2 max-w-[680px] text-xs text-destructive">
            {suggestError}
          </p>
        ) : null}
        <div className="mx-auto flex max-w-[680px] items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5">
          <AttachmentMenu />
          <button
            type="button"
            onClick={handleSuggest}
            disabled={sending || suggesting || contact.lead.channel !== "whatsapp"}
            aria-label={suggesting ? "Gerando sugestão..." : "Sugerir com IA"}
            title={
              contact.lead.channel === "whatsapp"
                ? "Sugerir resposta com IA"
                : "Sugestão com IA disponível no WhatsApp"
            }
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-primary transition hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />
            <span className="hidden sm:inline">{suggesting ? "Gerando..." : "Sugerir com IA"}</span>
          </button>
          <input
            aria-label="Mensagem"
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={sending}
            placeholder="Mandar mensagem"
            // min-w-0 é obrigatório: um item flex tem `min-width: auto`, então
            // o campo se recusava a encolher abaixo da largura do próprio
            // placeholder e empurrava os botões para FORA do form — o "Enviar"
            // chegava a aparecer por cima do painel lateral em telas estreitas.
            className="h-10 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:font-semibold placeholder:text-muted-foreground disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={sending || suggesting || !text.trim()}
            aria-label={sending ? "Enviando..." : "Enviar"}
            className="rounded-full bg-primary p-2.5 text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        {sending && (
          <p className="mx-auto mt-2 max-w-[680px] text-xs text-muted-foreground">Enviando...</p>
        )}
        {sendError && (
          <p role="alert" className="mx-auto mt-2 max-w-[680px] text-xs text-destructive">
            {sendError}
          </p>
        )}
      </form>
    </div>
  );
}

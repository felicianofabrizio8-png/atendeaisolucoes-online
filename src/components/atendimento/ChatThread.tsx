import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, FileUp, Images, Paperclip, Send, Smile } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { timeAgo, type Message } from "@/data/mock";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ContactAvatar } from "./ContactAvatar";
import { CustomerTierBadge } from "./CustomerTierBadge";
import type { AtendimentoContact } from "@/hooks/useAtendimentoData";

/**
 * Menu do clipe. Cada opção abre o seletor nativo do sistema com o filtro
 * certo — arquivo livre, galeria de fotos e vídeos, ou câmera. São ações
 * reais, não itens decorativos: o que esta tela ainda não faz é enviar, e o
 * aviso depois da escolha diz isso em vez de fingir que mandou.
 */
function AttachmentMenu() {
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [picker, setPicker] = useState<{ accept: string; capture?: "environment" }>({
    accept: "*/*",
  });

  const options = [
    { key: "arquivo", icon: FileUp, label: "Enviar arquivo", hint: "PDF, planilha, contrato", accept: "*/*" },
    { key: "midia", icon: Images, label: "Fotos e vídeos", hint: "Da galeria do aparelho", accept: "image/*,video/*" },
    { key: "camera", icon: Camera, label: "Tirar foto", hint: "Abre a câmera", accept: "image/*", capture: "environment" as const },
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
              description: "Prévia da interface: o anexo não é enviado ao cliente nesta tela.",
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
              "rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
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
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return "Hoje";
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === yesterday.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function ChatThread({
  contact,
  draft,
  onDraftChange,
  onSend,
  onBack,
  actions,
}: {
  contact: AtendimentoContact;
  draft: string;
  onDraftChange: (v: string) => void;
  onSend: () => void;
  /** Volta para a lista no layout compacto, onde a conversa ocupa a tela. */
  onBack?: () => void;
  /** Controles do canto direito do cabeçalho (acesso ao painel Info/IA). */
  actions?: React.ReactNode;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const { lead, conversation, messages, history, hue } = contact;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [conversation.id, messages.length]);

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
            {lead.channel === "whatsapp" ? "WhatsApp" : lead.channel === "instagram" ? "Instagram" : "Facebook"}
            {conversation.detectedCity ? ` · ${conversation.detectedCity}/${conversation.detectedState ?? ""}` : ""}
            {` · ativo ${timeAgo(conversation.lastMessageAt)} atrás`}
          </p>
        </div>
        {actions}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
        <div className="mx-auto flex max-w-[680px] flex-col gap-2">
          {messages.map((m: Message) => {
            const day = dayLabel(m.at);
            const showDay = day !== lastDay;
            lastDay = day;
            const mine = m.role === "agent";

            if (m.role === "system") {
              return (
                <div key={m.id} className="my-2 self-center rounded-full bg-secondary/70 px-3 py-1 text-[11px] text-muted-foreground">
                  {m.text}
                </div>
              );
            }

            return (
              <div key={m.id} className="contents">
                {showDay && (
                  <div className="my-3 self-center rounded-full bg-secondary/50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {day}
                  </div>
                )}
                <div
                  className={cn(
                    "max-w-[78%] rounded-3xl px-4 py-2.5 text-sm leading-relaxed",
                    // Minhas mensagens usam a cor de destaque do app: sobre o
                    // fundo preto, um cinza um pouco mais claro que o outro
                    // balão não era diferença suficiente para bater o olho e
                    // saber quem falou.
                    mine
                      ? "self-end rounded-br-lg border border-primary/30 bg-primary/20 text-foreground"
                      : "self-start rounded-bl-lg border border-border bg-secondary/50 text-foreground",
                  )}
                >
                  <p className="whitespace-pre-wrap break-words">{m.text}</p>
                  <span className="mt-1 block text-right text-[10px] text-muted-foreground">
                    {hhmm(m.at)}
                    {mine && m.deliveryStatus === "read" ? " · lida" : ""}
                  </span>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="px-5 pb-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSend();
          }}
          // Sem anel de foco colorido: ao clicar, o único sinal é o cursor
          // piscando no campo, como pedido.
          className="mx-auto flex max-w-[680px] items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5"
        >
          <AttachmentMenu />

          <input
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder="Mandar mensagem"
            className="h-10 flex-1 bg-transparent text-[15px] outline-none placeholder:font-semibold placeholder:text-muted-foreground"
          />
          <button
            type="button"
            aria-label="Emojis"
            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Smile className="h-4 w-4" />
          </button>
          <button
            type="submit"
            disabled={!draft.trim()}
            aria-label="Enviar"
            className="rounded-full bg-primary p-2.5 text-primary-foreground transition-opacity disabled:opacity-30"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

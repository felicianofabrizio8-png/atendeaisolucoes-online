import { useEffect, type FormEvent, type RefObject } from "react";
import { Mic, Send, Smile, Sparkles, X } from "lucide-react";
import EmojiPicker, { EmojiStyle, Theme as EmojiTheme } from "emoji-picker-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MediaSendPanel, QuickRepliesButton } from "@/components/inbox/composer/ComposerWidgets";
import { useVoiceNote } from "@/hooks/useVoiceNote";
import { quotedPreview } from "@/lib/inbox/conversation-actions";
import type { Message } from "@/data/mock";
import { cn } from "@/lib/utils";
import { VoiceNoteBar } from "./VoiceNoteBar";

/** Ícone solto dentro da pílula — mesmo peso visual do clipe original. */
const ICON_BUTTON =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Composer do Atendimento 2.0.
 *
 * Os recursos são os da Caixa de atendimento — mídia, biblioteca de produtos,
 * localização, respostas rápidas, emoji, áudio e IA — reaproveitando os mesmos
 * componentes; só a moldura é a pílula do design novo. O envio em si fica no
 * `ChatThread`, que é quem sabe o estado da conversa.
 *
 * Áudio: com o campo vazio o botão da direita é o microfone (com texto, é o
 * enviar). Tocar nele transforma a pílula no gravador até enviar ou
 * descartar. Monte com `key={conversationId}`: trocar de conversa descarta a
 * gravação em curso em vez de mandá-la para o cliente errado.
 */
export function ThreadComposer({
  conversationId,
  channel,
  leadId,
  companyId,
  text,
  onTextChange,
  onSubmit,
  onSendText,
  locked,
  placeholder,
  sending,
  suggesting,
  canSuggest,
  onSuggest,
  replyingTo,
  replyAuthor,
  onCancelReply,
  textareaRef,
}: {
  conversationId: string;
  channel: string;
  leadId: string;
  companyId: string | null;
  text: string;
  onTextChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** Envio direto de texto (respostas rápidas com "enviar agora"). */
  onSendText: (text: string) => void;
  /** Conversa encerrada ou clientes de exemplo: nada sai daqui. */
  locked: boolean;
  placeholder: string;
  sending: boolean;
  suggesting: boolean;
  canSuggest: boolean;
  onSuggest: () => void;
  replyingTo: Message | null;
  replyAuthor: string;
  onCancelReply: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const voice = useVoiceNote({ conversationId });
  const recordingVoice = voice.state !== "idle";
  const busy = locked || sending;
  const showMic = channel === "whatsapp" && !text.trim();

  // Altura acompanha o conteúdo, com teto; reseta antes de medir para encolher.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text, textareaRef]);

  const appendText = (addition: string) => {
    onTextChange(text.trim() ? `${text}\n${addition}` : addition);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    onTextChange(text.slice(0, start) + emoji + text.slice(end));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = start + emoji.length;
      try {
        el.setSelectionRange(pos, pos);
      } catch {
        /* noop */
      }
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      className="w-full min-w-0 shrink-0 px-3 sm:px-5"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1rem)" }}
    >
      {replyingTo && (
        <div className="mb-2 flex w-full min-w-0 items-start gap-2 rounded-2xl border border-border bg-secondary/40 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Respondendo a {replyAuthor}
            </p>
            <p className="mt-0.5 truncate text-xs">{quotedPreview(replyingTo, 120)}</p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Cancelar resposta"
            className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex w-full min-w-0 items-end gap-1 rounded-3xl border border-border bg-background px-2 py-1.5">
        {recordingVoice ? (
          <VoiceNoteBar
            state={voice.state}
            seconds={voice.seconds}
            levels={voice.levels}
            onDiscard={voice.discard}
            onPause={voice.pause}
            onResume={voice.resume}
            onSend={() => void voice.send()}
          />
        ) : (
          <>
            <MediaSendPanel
              conversationId={conversationId}
              channel={channel}
              disabled={busy}
              companyId={companyId}
              leadId={leadId}
              onSent={() => {
                /* o realtime entrega a mídia enviada */
              }}
              onSendText={onSendText}
              onInsertText={appendText}
              triggerClassName={ICON_BUTTON}
            />
            <QuickRepliesButton
              companyId={companyId}
              disabled={busy}
              onPick={appendText}
              triggerClassName={ICON_BUTTON}
            />
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={busy}
                  aria-label="Inserir emoji"
                  title="Inserir emoji"
                  className={cn(ICON_BUTTON, "hidden sm:inline-flex")}
                >
                  <Smile className="h-4 w-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                side="top"
                className="w-auto border-0 bg-transparent p-0 shadow-none"
                onOpenAutoFocus={(e) => e.preventDefault()}
              >
                <EmojiPicker
                  theme={EmojiTheme.AUTO}
                  emojiStyle={EmojiStyle.NATIVE}
                  lazyLoadEmojis
                  width={320}
                  height={380}
                  searchPlaceHolder="Buscar emoji…"
                  onEmojiClick={(data) => insertEmoji(data.emoji)}
                />
              </PopoverContent>
            </Popover>

            <textarea
              ref={textareaRef}
              aria-label="Mensagem"
              value={text}
              onChange={(event) => onTextChange(event.target.value)}
              onKeyDown={(event) => {
                // Enter envia, Shift+Enter quebra linha. Durante composição de
                // IME (acento, emoji) o Enter confirma o caractere.
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              disabled={busy}
              rows={1}
              spellCheck
              autoCapitalize="sentences"
              enterKeyHint="send"
              placeholder={placeholder}
              // text-base (16px) impede o zoom do Safari ao focar; min-w-0 deixa
              // o campo encolher em vez de empurrar os botões para fora.
              className="block max-h-40 min-h-[36px] min-w-0 flex-1 resize-none self-center bg-transparent px-1 py-2 text-base leading-snug outline-none placeholder:font-semibold placeholder:text-muted-foreground disabled:opacity-60 sm:text-sm"
            />

            <button
              type="button"
              onClick={onSuggest}
              disabled={busy || suggesting || !canSuggest}
              aria-label={suggesting ? "Gerando sugestão..." : "Sugerir com IA"}
              title={
                canSuggest ? "Sugerir resposta com IA" : "Sugestão com IA disponível no WhatsApp"
              }
              className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-primary transition hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Sparkles className="h-4 w-4" />
              <span className="hidden md:inline">
                {suggesting ? "Gerando..." : "Sugerir com IA"}
              </span>
            </button>

            {showMic ? (
              <button
                type="button"
                onClick={() => void voice.start()}
                disabled={busy}
                aria-label="Gravar áudio"
                title="Gravar áudio"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-30"
              >
                <Mic className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={busy || suggesting || !text.trim()}
                aria-label={sending ? "Enviando..." : "Enviar"}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-30"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </>
        )}
      </div>

      {voice.error && (
        <p role="alert" className="mt-2 w-full text-xs text-destructive">
          {voice.error}
          {voice.state === "failed" ? " A gravação foi mantida — toque para tentar de novo." : ""}
        </p>
      )}
    </form>
  );
}

import { useEffect, useRef, useState } from "react";
import {
  Copy,
  Check,
  CornerDownLeft,
  FileText,
  Lightbulb,
  MessageSquare,
  Paperclip,
  Square,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/auth/AuthContext";
import { OrbBloop } from "@/components/ui/orb-bloop";
import { AiComposer, type Attachment } from "./AiComposer";
import { RichText } from "./RichText";
import type { AtendimentoContact } from "@/hooks/useAtendimentoData";
import { answerQuestion } from "@/lib/atendimento/copilot";
import {
  COPILOT_ACTIONS,
  CHAT_LIMITS,
  greeting,
  type CopilotTurn,
} from "@/lib/atendimento/copilot-chat";
import { askConversationCopilot } from "@/lib/atendimento/copilot-chat-api";

interface Entry extends CopilotTurn {
  id: string;
  attachmentNames?: string[];
}
interface Props {
  contact: AtendimentoContact;
  onUseSuggestion: (text: string) => void;
  simulated?: boolean;
}

/** Remount on tenant/user/conversation changes; pending requests never cross clients. */
export function ConversationAiChat(props: Props) {
  const { profile, user } = useAuth();
  return (
    <ChatSession
      key={`${profile?.company_id}:${user?.id}:${props.contact.conversation.id}`}
      {...props}
      displayName={profile?.display_name}
    />
  );
}

function ChatSession({
  contact,
  onUseSuggestion,
  simulated = false,
  displayName,
}: Props & { displayName?: string | null }) {
  const [chat, setChat] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<Entry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  useEffect(() => {
    if (!started) return;
    const timeout = setTimeout(
      () => setShowIntro(false),
      matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 320,
    );
    return () => clearTimeout(timeout);
  }, [started]);
  const active = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!chat.length && !pending) return;
    endRef.current?.scrollIntoView({
      block: "end",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  }, [chat.length, pending]);
  async function ask(question: string, attachments: Attachment[] = [], clearInput = true) {
    if (active.current || (!question.trim() && !attachments.length)) return false;
    setStarted(true);
    const controller = new AbortController();
    active.current = controller;
    const turn: Entry = {
      id: crypto.randomUUID(),
      role: "user",
      text: question,
      attachmentNames: attachments.map((a) => a.file.name),
    };
    setPending(turn);
    setError(null);
    try {
      let answer: string;
      if (simulated) {
        if (attachments.length)
          throw new Error(
            "Abra um atendimento real para a IA analisar anexos. Este cliente é um exemplo.",
          );
        answer = answerQuestion(question, {
          lead: contact.lead,
          conversation: contact.conversation,
          messages: contact.messages,
          history: contact.history,
          summary: contact.summary,
        }).text;
      } else {
        answer = await askConversationCopilot({
          conversationId: contact.conversation.id,
          question,
          history: chat.slice(-CHAT_LIMITS.history).map(({ role, text }) => ({ role, text })),
          files: attachments.map((a) => a.file),
          signal: controller.signal,
        });
      }
      if (controller.signal.aborted || active.current !== controller) return false;
      setChat((previous) => [
        ...previous,
        turn,
        { id: crypto.randomUUID(), role: "assistant", text: answer },
      ]);
      if (clearInput) setInput("");
      return true;
    } catch (failure) {
      if (!controller.signal.aborted && active.current === controller)
        setError(
          failure instanceof Error
            ? failure.message
            : "Não foi possível consultar a IA. Tente novamente.",
        );
      return false;
    } finally {
      if (active.current === controller) {
        active.current = null;
        setPending(null);
      }
    }
  }
  async function copy(entry: Entry) {
    try {
      await navigator.clipboard.writeText(entry.text);
      setCopied(entry.id);
    } catch {
      toast.error("Não foi possível copiar a resposta.");
    }
  }
  const idle = !chat.length && !pending;
  const entries = pending ? [...chat, pending] : chat;
  return (
    <section aria-label="Chat com a IA Lume" className="at-ai-chat flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-1",
          idle && "py-2",
        )}
      >
        {showIntro && (
          <header
            aria-hidden={started}
            className="flex shrink-0 flex-col items-center pb-8 pt-4 text-center transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none"
            style={{ opacity: started ? 0 : 1, transform: started ? "translateY(-8px)" : "none" }}
          >
            <OrbBloop size={192} />
            <h3 className="mt-2 text-[23px] font-semibold leading-tight tracking-tight">
              {greeting(displayName)}
            </h3>
          </header>
        )}
        <div
          role="log"
          aria-label="Mensagens com a IA"
          aria-live="polite"
          aria-relevant="additions"
          className="space-y-5 pb-3"
        >
          {entries.map((entry) => (
            <article key={entry.id} className="min-w-0">
              <div
                className={cn(
                  "break-words text-[13px] leading-relaxed [overflow-wrap:anywhere]",
                  entry.role === "user"
                    ? "ml-7 rounded-2xl rounded-tr-sm bg-secondary px-3.5 py-3"
                    : "px-1",
                )}
              >
                <RichText text={entry.text} />
                {!!entry.attachmentNames?.length && (
                  <ul className="mt-2 space-y-1">
                    {entry.attachmentNames.map((name, index) => (
                      <li
                        key={index}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground"
                      >
                        <Paperclip className="h-3 w-3 shrink-0" />
                        <span className="truncate">{name}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {entry.role === "assistant" && (
                <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => void copy(entry)}
                    aria-label="Copiar resposta"
                    className="rounded-lg p-1.5 hover:bg-accent hover:text-foreground"
                  >
                    {copied === entry.id ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onUseSuggestion(entry.text)}
                    className="flex items-center gap-1.5 rounded-lg p-1.5 hover:bg-accent hover:text-foreground"
                  >
                    <CornerDownLeft className="h-3.5 w-3.5" />
                    Usar no chat
                  </button>
                </div>
              )}
            </article>
          ))}
          {pending && (
            <div
              role="status"
              className="flex items-center justify-between text-xs text-muted-foreground"
            >
              <span className="motion-safe:animate-pulse">Analisando o atendimento…</span>
              <button
                type="button"
                onClick={() => {
                  active.current?.abort();
                  active.current = null;
                  setPending(null);
                }}
                className="flex items-center gap-1 rounded-full border border-border px-2 py-1"
              >
                <Square className="h-2.5 w-2.5" />
                Parar
              </button>
            </div>
          )}
        </div>
        <div ref={endRef} />
      </div>
      <div className="shrink-0 pt-3">
        {error && (
          <p
            role="alert"
            className="mb-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive"
          >
            {error}
          </p>
        )}
        <AiComposer value={input} onChange={setInput} onSubmit={ask} disabled={!!pending} />
        <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
          {COPILOT_ACTIONS.map((action, index) => {
            const Icon = [MessageSquare, FileText, Lightbulb][index];
            return (
              <button
                key={action.label}
                type="button"
                disabled={!!pending}
                onClick={() => void ask(action.prompt, [], false)}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-2 text-[11px] font-medium text-muted-foreground transition-colors hover:border-violet-400/50 hover:bg-violet-500/5 hover:text-foreground disabled:opacity-40"
              >
                <Icon className="h-3 w-3" />
                {action.label}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

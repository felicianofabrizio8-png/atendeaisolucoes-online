import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, KeyRound, Loader2, Mic, Square, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { OrbBloop } from "@/components/ui/orb-bloop";
import { RichText } from "@/components/atendimento/RichText";
import {
  askLume,
  decideLumeAction,
  lumeStatus,
  type LumeAction,
  type LumeStatus,
} from "./lume-api";
import { useLumeVoice } from "./useLumeVoice";
import "./lume.css";

interface Entry {
  id: string;
  role: "user" | "assistant";
  text: string;
  voice?: boolean;
  actions?: LumeAction[];
}

/**
 * Lume Dock — a assistente da equipe, em qualquer tela. Texto ou voz; ações aparecem
 * como cartões: criar já vem feito (com Desfazer), alterar/excluir/avisar esperam o
 * Confirmar. `page` diz à Lume onde a pessoa está; `onChanged` avisa a tela para
 * recarregar e destacar o que mudou.
 */
export function LumeDock({
  page,
  greeting,
  suggestions,
  onChanged,
  openSignal = 0,
}: {
  page: string;
  greeting: string;
  suggestions: string[];
  onChanged?: (touched: string[]) => void;
  /** Mude o número para abrir o painel de fora (ex.: botão "Pedir à Lume"). */
  openSignal?: number;
}) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [status, setStatus] = useState<LumeStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  const voice = useLumeVoice((audio) => void send("", audio));

  useEffect(() => {
    if (openSignal) setOpen(true);
  }, [openSignal]);
  useEffect(() => {
    if (!open || status) return;
    lumeStatus()
      .then(setStatus)
      .catch((error: Error) => setStatusError(error.message));
  }, [open, status]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [entries.length, thinking]);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  async function send(text: string, audio?: Blob) {
    const message = text.trim();
    if ((!message && !audio) || thinking) return;
    const history = entries.map(({ role, text: body }) => ({ role, text: body }));
    const userEntry: Entry = {
      id: crypto.randomUUID(),
      role: "user",
      text: message || "🎙️ Áudio",
      voice: !!audio,
    };
    setEntries((list) => [...list, userEntry]);
    setInput("");
    setThinking(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const result = await askLume({ message, audio, history, page, signal: controller.signal });
      setEntries((list) => [
        ...list.map((entry) =>
          entry.id === userEntry.id && result.transcript
            ? { ...entry, text: result.transcript }
            : entry,
        ),
        { id: crypto.randomUUID(), role: "assistant", text: result.reply, actions: result.actions },
      ]);
      const touched = result.actions
        .filter((a) => a.status === "executada")
        .flatMap((a) => a.touched);
      if (touched.length) onChanged?.(touched);
    } catch (error) {
      if (controller.signal.aborted) return;
      setEntries((list) => [
        ...list,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: error instanceof Error ? error.message : "A Lume não respondeu.",
        },
      ]);
    } finally {
      if (abort.current === controller) abort.current = null;
      setThinking(false);
    }
  }

  function patchAction(id: string, changes: Partial<LumeAction>) {
    setEntries((list) =>
      list.map((entry) =>
        entry.actions?.some((action) => action.id === id)
          ? {
              ...entry,
              actions: entry.actions.map((a) => (a.id === id ? { ...a, ...changes } : a)),
            }
          : entry,
      ),
    );
  }

  async function decide(action: LumeAction, decision: "confirm" | "cancel" | "undo") {
    patchAction(action.id, { error: undefined });
    try {
      const result = await decideLumeAction(action, decision);
      patchAction(action.id, {
        status: result.status,
        undo: result.undo ?? action.undo,
        touched: result.touched ?? action.touched,
      });
      if (decision !== "cancel") onChanged?.(result.touched ?? action.touched);
      if (decision === "undo") toast.success("Desfeito");
    } catch (error) {
      patchAction(action.id, { error: error instanceof Error ? error.message : "Falhou." });
    }
  }

  const notConfigured = status && !status.chat;

  return (
    <>
      <button
        type="button"
        className="lume-capsule"
        data-open={open}
        aria-expanded={open}
        aria-controls="lume-dock-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="lume-capsule-orb" aria-hidden>
          <OrbBloop size={34} state={thinking ? "think" : voice.recording ? "listen" : "idle"} />
        </span>
        <span className="lume-capsule-label">{open ? "Fechar Lume" : "Pergunte à Lume"}</span>
      </button>

      {open && (
        <section id="lume-dock-panel" className="lume-panel" aria-label="Assistente Lume">
          <header className="lume-panel-head">
            <OrbBloop size={64} state={thinking ? "think" : voice.recording ? "listen" : "idle"} />
            <div className="min-w-0">
              <p className="lume-kicker">Lume · {page}</p>
              <h2 className="lume-title">{greeting}</h2>
            </div>
            <button
              type="button"
              className="lume-icon"
              aria-label="Fechar"
              onClick={() => setOpen(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          {(notConfigured || statusError) && (
            <div className="lume-setup" role="status">
              <KeyRound className="h-4 w-4 shrink-0" />
              <p>
                {statusError ??
                  "A Lume está pronta, só falta a chave do modelo. Configure LUME_AI_ENDPOINT, LUME_AI_MODEL e LUME_AI_API_KEY no servidor (ou use a mesma da Vendedora)."}
              </p>
            </div>
          )}

          <div className="lume-log" role="log" aria-live="polite">
            {!entries.length && (
              <div className="lume-suggestions">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="lume-suggestion"
                    disabled={thinking || !!notConfigured}
                    onClick={() => void send(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            {entries.map((entry) => (
              <article key={entry.id} className="lume-entry" data-role={entry.role}>
                <div className="lume-bubble">
                  {entry.voice && <Mic className="mr-1 inline h-3 w-3 opacity-70" />}
                  <RichText text={entry.text} />
                </div>
                {entry.actions?.map((action) => (
                  <ActionCard
                    key={action.id}
                    action={action}
                    onDecide={(d) => void decide(action, d)}
                  />
                ))}
              </article>
            ))}
            {thinking && (
              <p className="lume-thinking">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Lume pensando…
              </p>
            )}
            <div ref={endRef} />
          </div>

          <form
            className="lume-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send(input);
            }}
          >
            {voice.recording ? (
              <div className="lume-recording">
                <span
                  className="lume-rec-dot"
                  style={{ transform: `scale(${1 + voice.level * 1.6})` }}
                />
                Ouvindo… {String(Math.floor(voice.seconds / 60)).padStart(1, "0")}:
                {String(voice.seconds % 60).padStart(2, "0")}
                <button type="button" className="lume-link" onClick={voice.cancel}>
                  Cancelar
                </button>
              </div>
            ) : (
              <textarea
                rows={1}
                value={input}
                maxLength={4000}
                placeholder={
                  notConfigured
                    ? "Aguardando a chave da IA…"
                    : "Peça algo: “marque reunião amanhã às 10h”"
                }
                aria-label="Mensagem para a Lume"
                disabled={thinking}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void send(input);
                  }
                }}
              />
            )}
            {status?.voice !== false && (
              <button
                type="button"
                className="lume-icon"
                data-active={voice.recording}
                aria-label={voice.recording ? "Enviar áudio" : "Falar com a Lume"}
                disabled={thinking}
                onClick={() => void (voice.recording ? voice.stop() : voice.start())}
              >
                {voice.recording ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-4 w-4" />}
              </button>
            )}
            {!voice.recording && (
              <button
                type="submit"
                className="lume-send"
                aria-label="Enviar"
                disabled={thinking || !input.trim()}
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
          </form>
          {voice.error && <p className="lume-error">{voice.error}</p>}
        </section>
      )}
    </>
  );
}

function ActionCard({
  action,
  onDecide,
}: {
  action: LumeAction;
  onDecide: (decision: "confirm" | "cancel" | "undo") => void;
}) {
  const [busy, setBusy] = useState(false);
  const run = async (decision: "confirm" | "cancel" | "undo") => {
    setBusy(true);
    await onDecide(decision);
    setBusy(false);
  };
  const label: Record<LumeAction["status"], string> = {
    pendente: "Aguardando você",
    executada: "Feito",
    confirmada: "Feito",
    cancelada: "Cancelado",
    desfeita: "Desfeito",
    falhou: "Não deu certo",
  };
  return (
    <div className="lume-action" data-status={action.status}>
      <div className="min-w-0 flex-1">
        <p className="lume-action-status">{label[action.status]}</p>
        <p className="lume-action-summary">{action.summary}</p>
        {action.error && <p className="lume-error !mt-1">{action.error}</p>}
      </div>
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : action.status === "pendente" ? (
        <div className="flex gap-1.5">
          <button type="button" className="lume-chip" onClick={() => void run("cancel")}>
            Cancelar
          </button>
          <button
            type="button"
            className="lume-chip lume-chip-primary"
            onClick={() => void run("confirm")}
          >
            <Check className="h-3.5 w-3.5" /> Confirmar
          </button>
        </div>
      ) : (action.status === "executada" || action.status === "confirmada") && action.undo ? (
        <button type="button" className="lume-chip" onClick={() => void run("undo")}>
          <Undo2 className="h-3.5 w-3.5" /> Desfazer
        </button>
      ) : null}
    </div>
  );
}

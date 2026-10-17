import { useEffect, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { ArrowUp, Check, KeyRound, Loader2, Mic, Sparkles, Square, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  mobileLauncher = true,
}: {
  page: string;
  greeting: string;
  suggestions: string[];
  onChanged?: (touched: string[]) => void;
  /** Mude o número para abrir o painel de fora (ex.: botão "Pedir à Lume"). */
  openSignal?: number;
  /** false: no celular a tela tem o próprio botão (estrela no topo) e o
      flutuante some — ele cobria o fim da página e a barra inferior. */
  mobileLauncher?: boolean;
}) {
  const isMobile = useIsMobile();
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

  const orbState = thinking ? "think" : voice.recording ? "listen" : "idle";

  return (
    <>
      <button
        type="button"
        className="lume-launcher"
        data-mobile={mobileLauncher ? undefined : "off"}
        aria-expanded={open}
        aria-controls="lume-dock-panel"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
        <span className="lume-launcher-label">{open ? "Fechar Lume" : "Pergunte à Lume"}</span>
      </button>

      {open && (
        // No celular a janela é uma folha que sobe de baixo; o fundo escurece
        // e tocar fora fecha.
        <div className="lume-backdrop md:hidden" aria-hidden onClick={() => setOpen(false)} />
      )}
      {open && (
        <section id="lume-dock-panel" className="lume-window" aria-label="Assistente Lume">
          <header className="lume-window-head">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">Lume · {page}</h3>
              <p className="mt-1 text-[11px] text-muted-foreground max-md:hidden">
                Peça por texto ou voz. Alterações pedem sua confirmação.
              </p>
            </div>
            <button
              type="button"
              className="lume-icon"
              aria-label="Fechar Lume"
              onClick={() => setOpen(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="lume-log" role="log" aria-live="polite" aria-label="Conversa com a Lume">
            {!entries.length && (
              <div className="lume-welcome">
                <OrbBloop size={isMobile ? 64 : 130} state={orbState} />
                <h4 className="text-lg font-semibold">{greeting}</h4>
                {/* Celular: as sugestões ficam aqui em cima, numa faixa que
                    desliza — embaixo do campo elas empilhavam quatro linhas. */}
                {isMobile && (
                  <div className="lume-suggest-row">
                    {suggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        className="lume-chip"
                        disabled={thinking || !!notConfigured}
                        onClick={() => void send(suggestion)}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {(notConfigured || statusError) && (
              <div className="lume-setup" role="status">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  {statusError ??
                    "A Lume está pronta, só falta a chave do modelo. Configure LUME_AI_ENDPOINT, LUME_AI_MODEL e LUME_AI_API_KEY no servidor (ou use a mesma da Vendedora)."}
                </p>
              </div>
            )}
            {entries.map((entry) => (
              <article
                key={entry.id}
                className={entry.role === "user" ? "lume-user" : "lume-answer"}
              >
                {entry.voice && <Mic className="mr-1 inline h-3 w-3 opacity-70" />}
                <RichText text={entry.text} />
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
              <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Lume organizando…
              </p>
            )}
            <div ref={endRef} />
          </div>

          <div className="space-y-3 pt-3">
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
                  Ouvindo… {Math.floor(voice.seconds / 60)}:
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
                  placeholder={notConfigured ? "Aguardando a chave da IA…" : "Pergunte à Lume…"}
                  aria-label="Mensagem para a Lume"
                  disabled={thinking}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
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
                  {voice.recording ? (
                    <Square className="h-3.5 w-3.5" />
                  ) : (
                    <Mic className="h-4 w-4" />
                  )}
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
            {voice.error && (
              <p role="alert" className="text-xs text-destructive">
                {voice.error}
              </p>
            )}
            {!isMobile && (
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((suggestion) => (
                  <Button
                    key={suggestion}
                    size="sm"
                    disabled={thinking || !!notConfigured}
                    onClick={() => void send(suggestion)}
                  >
                    {suggestion}
                  </Button>
                ))}
              </div>
            )}
            <p className="text-[10px] text-muted-foreground max-md:hidden">
              A Lume age com a sua permissão. Criar dá para desfazer; alterar e excluir pedem
              confirmação.
            </p>
          </div>
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

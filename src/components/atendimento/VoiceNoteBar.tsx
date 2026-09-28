import { Loader2, Pause, Play, RotateCw, Send, Trash2 } from "lucide-react";
import type { VoiceNoteState } from "@/hooks/useVoiceNote";
import { cn } from "@/lib/utils";

function fmtTime(total: number): string {
  const s = Math.max(0, Math.floor(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const ROUND_BUTTON =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Gravador que toma o lugar do composer enquanto há uma nota de voz em curso.
 *
 * Referência de interação é o WhatsApp (lixeira · tempo e onda · pausar ·
 * enviar), mas nas cores neutras do Atendimento 2.0: o único ponto de cor é
 * o indicador de gravação.
 */
export function VoiceNoteBar({
  state,
  seconds,
  levels,
  onDiscard,
  onPause,
  onResume,
  onSend,
}: {
  state: VoiceNoteState;
  seconds: number;
  levels: number[];
  onDiscard: () => void;
  onPause: () => void;
  onResume: () => void;
  onSend: () => void;
}) {
  const recording = state === "recording";
  const sending = state === "sending";
  const starting = state === "starting";
  const failed = state === "failed";

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1" aria-live="polite">
      <button
        type="button"
        onClick={onDiscard}
        disabled={sending || starting}
        aria-label="Descartar áudio"
        title="Descartar áudio"
        className={cn(
          ROUND_BUTTON,
          "text-muted-foreground hover:bg-secondary hover:text-destructive",
        )}
      >
        <Trash2 className="h-4 w-4" />
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
        <span
          aria-hidden
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            recording ? "animate-pulse bg-destructive" : "bg-muted-foreground/50",
          )}
        />
        <span
          className="w-10 shrink-0 font-mono text-sm tabular-nums"
          aria-label={`Duração ${fmtTime(seconds)}`}
        >
          {fmtTime(seconds)}
        </span>
        {starting ? (
          <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Abrindo microfone…
          </span>
        ) : (
          <div
            aria-hidden
            className={cn(
              "flex h-7 min-w-0 flex-1 items-center justify-end gap-[2px] overflow-hidden transition-opacity",
              !recording && "opacity-50",
            )}
          >
            {levels.map((level, i) => (
              <span
                key={i}
                className="w-[3px] shrink-0 rounded-full bg-foreground/70"
                style={{ height: `${Math.max(12, level * 100)}%` }}
              />
            ))}
          </div>
        )}
      </div>

      {!failed && (
        <button
          type="button"
          onClick={recording ? onPause : onResume}
          disabled={sending || starting}
          aria-label={recording ? "Pausar gravação" : "Continuar gravação"}
          title={recording ? "Pausar" : "Continuar"}
          className={cn(ROUND_BUTTON, "text-foreground hover:bg-secondary")}
        >
          {recording ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
      )}

      <button
        type="button"
        onClick={onSend}
        disabled={sending || starting}
        aria-label={
          failed ? "Tentar enviar o áudio de novo" : sending ? "Enviando áudio..." : "Enviar áudio"
        }
        title={failed ? "Tentar de novo" : "Enviar áudio"}
        className={cn(ROUND_BUTTON, "bg-primary text-primary-foreground hover:opacity-90")}
      >
        {sending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : failed ? (
          <RotateCw className="h-4 w-4" />
        ) : (
          <Send className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}

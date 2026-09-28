import { useCallback, useEffect, useRef, useState } from "react";
import {
  microphoneErrorMessage,
  openMicrophone,
  prepareVoiceNote,
  startVoiceCapture,
  uploadVoiceNote,
  VoiceNoteError,
  watchInputLevel,
  type VoiceCapture,
} from "@/lib/audio/voice-note";

export type VoiceNoteState = "idle" | "starting" | "recording" | "paused" | "sending" | "failed";

/** Quantas amostras de nível a forma de onda mostra. */
export const VOICE_LEVEL_SAMPLES = 40;

const EMPTY_LEVELS = () => new Array(VOICE_LEVEL_SAMPLES).fill(0.04) as number[];

/** Cronômetro que pausa: soma só o tempo em que a gravação estava rodando. */
function createStopwatch(onTick: (seconds: number) => void) {
  let accumulated = 0;
  let runningSince: number | null = null;
  let tick: number | null = null;
  const elapsedMs = () => accumulated + (runningSince ? Date.now() - runningSince : 0);
  const clearTick = () => {
    if (tick) window.clearInterval(tick);
    tick = null;
  };
  return {
    elapsedMs,
    start() {
      clearTick();
      runningSince = Date.now();
      tick = window.setInterval(() => onTick(Math.floor(elapsedMs() / 1000)), 200);
    },
    freeze() {
      accumulated = elapsedMs();
      runningSince = null;
      clearTick();
      onTick(Math.floor(accumulated / 1000));
    },
    reset() {
      clearTick();
      accumulated = 0;
      runningSince = null;
    },
  };
}

/**
 * Nota de voz de toque único: tocar grava, pausar/continuar, enviar ou
 * descartar. Mesmo pipeline da Caixa de atendimento (`@/lib/audio/voice-note`).
 *
 * Se o envio falhar, a gravação fica guardada em `failed` — `send()` tenta de
 * novo com o mesmo áudio e `discard()` joga fora. Nada se perde por um erro
 * de rede.
 */
export function useVoiceNote({
  conversationId,
  onSent,
}: {
  conversationId: string;
  onSent?: () => void;
}) {
  const [state, setState] = useState<VoiceNoteState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>(EMPTY_LEVELS);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const captureRef = useRef<VoiceCapture | null>(null);
  const stopLevelsRef = useRef<(() => void) | null>(null);
  // Criado uma vez: identidade estável para os callbacks abaixo.
  const [stopwatch] = useState(() => createStopwatch(setSeconds));
  // Guardados para reenviar sem regravar.
  const rawRef = useRef<Blob | null>(null);
  const preparedRef = useRef<Blob | null>(null);
  // A nota pertence à conversa em que foi gravada.
  const conversationRef = useRef(conversationId);
  const busyRef = useRef(false);

  const releaseInput = () => {
    stopLevelsRef.current?.();
    stopLevelsRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const reset = useCallback(() => {
    stopwatch.reset();
    releaseInput();
    captureRef.current = null;
    rawRef.current = null;
    preparedRef.current = null;
    busyRef.current = false;
    setSeconds(0);
    setLevels(EMPTY_LEVELS());
    setError(null);
    setState("idle");
  }, [stopwatch]);

  // Microfone e timers nunca ficam presos ao sair da tela.
  useEffect(
    () => () => {
      stopwatch.reset();
      captureRef.current?.abort();
      releaseInput();
    },
    [stopwatch],
  );

  const start = useCallback(async () => {
    if (state !== "idle" || busyRef.current) return;
    busyRef.current = true;
    setError(null);
    conversationRef.current = conversationId;
    setState("starting");

    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      busyRef.current = false;
      setState("idle");
      setError(
        window.isSecureContext
          ? "Seu navegador não suporta gravação de áudio."
          : "Gravação exige HTTPS.",
      );
      return;
    }

    try {
      streamRef.current = await openMicrophone();
    } catch (e) {
      busyRef.current = false;
      setState("idle");
      setError(microphoneErrorMessage(e));
      return;
    }

    try {
      captureRef.current = await startVoiceCapture(streamRef.current);
    } catch (e) {
      console.error("[audio] start error", e);
      releaseInput();
      busyRef.current = false;
      setState("idle");
      setError("Seu navegador não suporta gravação compatível com WhatsApp.");
      return;
    }

    stopLevelsRef.current = watchInputLevel(streamRef.current, (level) =>
      setLevels((prev) => [...prev.slice(1), level]),
    );
    stopwatch.reset();
    setSeconds(0);
    stopwatch.start();
    busyRef.current = false;
    setState("recording");
  }, [conversationId, state, stopwatch]);

  const pause = useCallback(() => {
    if (state !== "recording") return;
    captureRef.current?.pause();
    stopwatch.freeze();
    setState("paused");
  }, [state, stopwatch]);

  const resume = useCallback(() => {
    if (state !== "paused") return;
    captureRef.current?.resume();
    stopwatch.start();
    setState("recording");
  }, [state, stopwatch]);

  const discard = useCallback(() => {
    captureRef.current?.abort();
    reset();
  }, [reset]);

  const send = useCallback(async () => {
    if (busyRef.current) return;
    if (state !== "recording" && state !== "paused" && state !== "failed") return;
    busyRef.current = true;
    setError(null);
    setState("sending");

    const capture = captureRef.current;
    try {
      if (!rawRef.current && capture) {
        stopwatch.freeze();
        rawRef.current = await capture.stop();
        releaseInput();
      }
      if (!preparedRef.current) {
        if (!rawRef.current || !capture) throw new VoiceNoteError("Nada gravado para enviar.");
        const prepared = await prepareVoiceNote(rawRef.current, capture.source);
        preparedRef.current = prepared.blob;
      }
      await uploadVoiceNote({
        blob: preparedRef.current,
        conversationId: conversationRef.current,
        durationSeconds: Math.round(stopwatch.elapsedMs() / 1000),
        recorderKind: capture?.kind ?? "",
        recorderMime: capture?.mime ?? "",
        metrics: { platform: capture?.platform, bitrate_bps: capture?.bitrate },
      });
      onSent?.();
      reset();
    } catch (e) {
      console.error("[audio] send error", e);
      const detail = e instanceof Error ? e.message : "erro desconhecido";
      busyRef.current = false;
      setError(
        e instanceof VoiceNoteError ? detail : `Áudio não enviado pelo WhatsApp · ${detail}`,
      );
      // A gravação continua guardada: tentar de novo não pede para regravar.
      setState("failed");
    }
  }, [onSent, reset, state, stopwatch]);

  return { state, seconds, levels, error, start, pause, resume, discard, send };
}

// AudioRecorder — botão de microfone estilo WhatsApp.
//
// UX:
// - press-and-hold no microfone para gravar
// - soltar envia automaticamente
// - arrastar para a esquerda cancela
// - arrastar para cima trava a gravação (modo "mãos livres")
// - waveform em tempo real
// - ao parar: UI muda na hora ("Processando…" → "Enviando…"), conversão roda em background
//
// Gravação, conversão para OGG/Opus e envio vivem em `@/lib/audio/voice-note`,
// compartilhados com o gravador do Atendimento 2.0.

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Send, Trash2, Lock, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
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

interface Props {
  conversationId: string;
  disabled?: boolean;
  onSent?: () => void;
  onStateChange?: (state: "idle" | "recording" | "locked" | "processing" | "sending") => void;
}

function fmtTime(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

const CANCEL_THRESHOLD = 90; // px arrastado para esquerda
const LOCK_THRESHOLD = 70;   // px arrastado para cima
const WAVEFORM_BARS = 28;

type UIState = "idle" | "recording" | "locked" | "processing" | "sending";

export function AudioRecorder({ conversationId, disabled, onSent, onStateChange }: Props) {
  const [state, setState] = useState<UIState>("idle");
  useEffect(() => { onStateChange?.(state); }, [state, onStateChange]);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragX, setDragX] = useState(0);
  const [dragY, setDragY] = useState(0);
  const [willCancel, setWillCancel] = useState(false);
  const [bars, setBars] = useState<number[]>(() => new Array(WAVEFORM_BARS).fill(0.05));
  const [micPermission, setMicPermission] = useState<"unknown" | "granted" | "denied">("unknown");

  const captureRef = useRef<VoiceCapture | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);
  const stopLevelRef = useRef<(() => void) | null>(null);

  const cancelledRef = useRef(false);
  const lockedRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  // Consulta o estado da permissão do microfone no mount.
  // Se já estiver concedida, pula a etapa de "primeiro toque = liberar mic"
  // e permite gravar direto no primeiro press-and-hold.
  useEffect(() => {
    let cancelled = false;
    const nav = navigator as Navigator & {
      permissions?: { query: (q: { name: PermissionName }) => Promise<PermissionStatus> };
    };
    if (nav.permissions?.query) {
      nav.permissions
        .query({ name: "microphone" as PermissionName })
        .then((status) => {
          if (cancelled) return;
          if (status.state === "granted") setMicPermission("granted");
          else if (status.state === "denied") setMicPermission("denied");
          status.onchange = () => {
            if (status.state === "granted") setMicPermission("granted");
            else if (status.state === "denied") setMicPermission("denied");
          };
        })
        .catch(() => { /* */ });
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
      stopLevelRef.current?.();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);


  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const stopAnalyser = () => {
    stopLevelRef.current?.();
    stopLevelRef.current = null;
  };

  const resetAll = useCallback(() => {
    if (tickRef.current) window.clearInterval(tickRef.current);
    tickRef.current = null;
    stopLevelRef.current?.();
    stopLevelRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setSeconds(0);
    setDragX(0);
    setDragY(0);
    setWillCancel(false);
    setBars(new Array(WAVEFORM_BARS).fill(0.05));
    captureRef.current = null;
    cancelledRef.current = false;
    lockedRef.current = false;
    pointerIdRef.current = null;
    pointerStartRef.current = null;
    setState("idle");
  }, []);

  // ===== Auto-send após finalizar =====
  const sendBlob = async (blob: Blob, capture: VoiceCapture, metrics: Record<string, unknown>) => {
    setState("sending");
    try {
      await uploadVoiceNote({
        blob,
        conversationId,
        durationSeconds: seconds,
        recorderKind: capture.kind,
        recorderMime: capture.mime,
        metrics,
      });
      onSent?.();
      resetAll();
    } catch (e) {
      const detail = e instanceof Error ? e.message : "erro desconhecido";
      const msg = `Áudio não enviado pelo WhatsApp · ${detail}`;
      console.error("[audio] send error", e);
      toast.error(msg, { duration: 10000 });
      setError(msg);
      resetAll();
    }
  };

  const finalize = async (raw: Blob, capture: VoiceCapture) => {
    if (cancelledRef.current) {
      resetAll();
      return;
    }
    try {
      const prepared = await prepareVoiceNote(raw, capture.source);
      stopStream();
      if (tickRef.current) window.clearInterval(tickRef.current);
      tickRef.current = null;
      stopAnalyser();
      // Envia direto, sem etapa de preview/confirmação.
      void sendBlob(prepared.blob, capture, {
        platform: capture.platform,
        bitrate_bps: prepared.bitrate ?? capture.bitrate,
        transcode_ms: prepared.transcodeMs,
      });
    } catch (err) {
      const msg =
        err instanceof VoiceNoteError
          ? err.message
          : "Não foi possível gerar um áudio válido. Tente novamente.";
      toast.error(msg, { duration: 8000 });
      setError(msg);
      resetAll();
    }
  };

  // ===== Start =====
  const startRecording = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Seu navegador não suporta gravação de áudio.");
      return false;
    }
    if (!window.isSecureContext) {
      setError("Gravação exige HTTPS.");
      return false;
    }

    let stream: MediaStream;
    try {
      stream = await openMicrophone();
    } catch (e) {
      setError(microphoneErrorMessage(e));
      return false;
    }
    streamRef.current = stream;
    cancelledRef.current = false;
    lockedRef.current = false;

    try {
      const capture = await startVoiceCapture(stream);
      captureRef.current = capture;
      console.log("[AUDIO PLATFORM]", {
        user_agent: navigator.userAgent,
        platform: capture.platform,
        record_mode: capture.source,
        final_format: "audio/ogg;codecs=opus",
        final_bitrate: capture.bitrate,
      });
    } catch (e) {
      console.error("[audio] start error", e);
      stopStream();
      setError("Seu navegador não suporta gravação compatível com WhatsApp.");
      return false;
    }

    stopLevelRef.current = watchInputLevel(stream, (level) =>
      setBars((prev) => [...prev.slice(1), level]),
    );
    startedAtRef.current = Date.now();
    setSeconds(0);
    setState("recording");
    tickRef.current = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 200);
    return true;
  };

  // ===== Stop / cancel =====
  const stopAndSend = () => {
    // Para cronômetro/waveform na hora e mostra "Processando…" imediatamente.
    if (tickRef.current) window.clearInterval(tickRef.current);
    tickRef.current = null;
    stopAnalyser();
    setState("processing");
    const capture = captureRef.current;
    if (!capture) return;
    void capture
      .stop()
      .then((raw) => finalize(raw, capture))
      .catch((e) => {
        console.error("[audio] stop error", e);
        resetAll();
      });
  };

  const cancelRecording = () => {
    cancelledRef.current = true;
    if (tickRef.current) window.clearInterval(tickRef.current);
    tickRef.current = null;
    stopAnalyser();
    captureRef.current?.abort();
    resetAll();
  };

  // ===== Pointer handlers =====
  // Usamos pointer capture no PRÓPRIO botão do microfone. Nenhum listener global em
  // window/document. O botão permanece montado durante toda a gravação para manter
  // a captura ativa e não atrapalhar toques fora dele.
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const willCancelRef = useRef(false);
  useEffect(() => { willCancelRef.current = willCancel; }, [willCancel]);

  const releaseCapture = (pointerId: number | null) => {
    if (pointerId == null) return;
    try { btnRef.current?.releasePointerCapture(pointerId); } catch { /* */ }
  };

  // Primeira interação: apenas pedir permissão do microfone, SEM iniciar gravação.
  // Abre o prompt do navegador, libera o stream imediatamente e mostra um toast
  // instruindo o usuário a pressionar de novo para gravar.
  const requestMicPermission = async (): Promise<boolean> => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Seu navegador não suporta gravação de áudio.");
      return false;
    }
    if (!window.isSecureContext) {
      setError("Gravação exige HTTPS.");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Libera imediatamente — só queríamos disparar o prompt de permissão.
      stream.getTracks().forEach((t) => t.stop());
      setMicPermission("granted");
      toast.success("Microfone liberado. Toque e segure para gravar.");
      return true;
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name === "NotAllowedError" || name === "SecurityError") {
        setMicPermission("denied");
        setError("Permissão de microfone negada.");
        toast.error("Permissão de microfone negada.");
      } else if (name === "NotFoundError") {
        setError("Nenhum microfone encontrado.");
      } else {
        setError("Não foi possível acessar o microfone.");
      }
      return false;
    }
  };

  const onPointerDown = async (e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled || state !== "idle") return;
    e.preventDefault();
    e.stopPropagation();
    const pid = e.pointerId;

    // Etapa 1: se ainda não temos permissão, apenas solicitar — NÃO gravar.
    if (micPermission !== "granted") {
      await requestMicPermission();
      return;
    }

    // Etapa 2: permissão já concedida — iniciar gravação real.
    pointerIdRef.current = pid;
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
    try { btnRef.current?.setPointerCapture(pid); } catch { /* */ }
    const ok = await startRecording();
    if (!ok) {
      releaseCapture(pid);
      pointerIdRef.current = null;
      pointerStartRef.current = null;
    }
  };


  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (state !== "recording") return;
    if (pointerIdRef.current !== e.pointerId || !pointerStartRef.current) return;
    const dx = e.clientX - pointerStartRef.current.x;
    const dy = e.clientY - pointerStartRef.current.y;
    setDragX(Math.min(0, dx));
    setDragY(Math.min(0, dy));
    setWillCancel(dx <= -CANCEL_THRESHOLD);
    if (dy <= -LOCK_THRESHOLD && !lockedRef.current) {
      lockedRef.current = true;
      releaseCapture(pointerIdRef.current);
      pointerIdRef.current = null;
      pointerStartRef.current = null;
      setDragX(0);
      setDragY(0);
      setState("locked");
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (state !== "recording") return;
    if (pointerIdRef.current !== e.pointerId) return;
    releaseCapture(pointerIdRef.current);
    pointerIdRef.current = null;
    pointerStartRef.current = null;
    if (willCancelRef.current) { cancelRecording(); return; }
    const dur = Date.now() - startedAtRef.current;
    if (dur < 700) { cancelRecording(); return; }
    stopAndSend();
  };

  // ===== UI =====
  // Estratégia: o botão do microfone fica SEMPRE montado (mesmo durante recording),
  // para manter o pointer capture. Os indicadores de gravação (timer, waveform,
  // hint "deslize p/ cancelar") aparecem como overlay ACIMA do composer com
  // pointer-events-none, sem bloquear input/+/enviar/navegação.

  const showRecordingOverlay = state === "recording";
  const showLockedBar = state === "locked";
  const showProcessing = state === "processing" || state === "sending";

  return (
    <div className={`relative min-w-0 ${(showLockedBar || showProcessing) ? "flex-1" : "shrink-0"}`}>
      {/* Botão do microfone — único alvo de toque para iniciar a gravação.
          Permanece montado durante recording para manter o pointer capture. */}
      {(state === "idle" || state === "recording") && (
        <button
          ref={btnRef}
          type="button"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={(e) => e.preventDefault()}
          disabled={disabled}
          aria-label={micPermission === "granted" ? "Pressione e segure para gravar áudio" : "Liberar microfone"}
          title={micPermission === "granted" ? "Pressione e segure para gravar" : "Toque para liberar o microfone"}

          style={{ touchAction: "none" }}
          className={`h-11 w-11 md:h-9 md:w-9 inline-flex items-center justify-center rounded-full md:rounded-md select-none transition-colors ${
            showRecordingOverlay
              ? "bg-destructive text-destructive-foreground scale-110"
              : "bg-muted hover:bg-muted/80 text-foreground"
          } disabled:opacity-40`}
        >
          <Mic className="h-5 w-5 md:h-4 md:w-4" />
        </button>
      )}

      {/* Estado "locked" — substitui o mic por uma barra compacta com cancelar/enviar.
          Não é um overlay full-screen; ocupa apenas o espaço do composer. */}
      {showLockedBar && (
        <div className="flex items-center gap-1.5 md:gap-2 bg-destructive/10 border border-destructive/40 rounded-full md:rounded-md px-2 md:px-3 h-11 md:h-9 w-full min-w-0 max-w-full overflow-hidden">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75 animate-ping" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-destructive" />
          </span>
          <span className="text-xs md:text-sm font-mono tabular-nums text-destructive shrink-0">{fmtTime(seconds)}</span>
          <div className="flex-1 min-w-0 flex items-center gap-[2px] h-5 overflow-hidden">
            {bars.map((v, i) => (
              <span key={i} className="w-[2px] rounded-full bg-destructive/70 shrink-0" style={{ height: `${Math.max(6, v * 100)}%` }} />
            ))}
          </div>
          <button
            type="button"
            onClick={cancelRecording}
            aria-label="Cancelar"
            className="h-8 w-8 inline-flex items-center justify-center rounded-full hover:bg-destructive/20 shrink-0"
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </button>
          <button
            type="button"
            onClick={stopAndSend}
            aria-label="Parar e enviar"
            className="h-8 w-8 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground shrink-0"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Processing / sending — pill compacto no lugar do mic */}
      {showProcessing && (
        <div className="flex items-center gap-2 bg-muted rounded-full md:rounded-md px-3 h-11 md:h-9 w-full min-w-0 max-w-full overflow-hidden">
          <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
          <span className="text-xs md:text-sm text-muted-foreground truncate">
            {state === "processing" ? "Processando…" : "Enviando…"}
          </span>
          <span className="ml-auto text-xs font-mono tabular-nums text-muted-foreground shrink-0">{fmtTime(seconds)}</span>
        </div>
      )}

      {/* Overlay flutuante de gravação — fica ACIMA do composer e NÃO captura toques.
          Mostra timer, waveform, hint "deslize p/ cancelar" e indicador de lock.
          Só aparece depois que a gravação realmente começou. */}
      {showRecordingOverlay && (
        <div
          className="pointer-events-none absolute bottom-full right-0 mb-2 flex items-center gap-1.5 md:gap-2 bg-card border border-destructive/40 shadow-lg rounded-full px-2.5 md:px-3 h-10 w-[min(92vw,360px)] max-w-[92vw] overflow-hidden"
          aria-live="polite"
        >
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75 animate-ping" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-destructive" />
          </span>
          <span className="text-xs md:text-sm font-mono tabular-nums text-destructive shrink-0">{fmtTime(seconds)}</span>
          <div className="flex-1 min-w-0 flex items-center gap-[2px] h-5 overflow-hidden">
            {bars.map((v, i) => (
              <span key={i} className="w-[2px] rounded-full bg-destructive/70 shrink-0" style={{ height: `${Math.max(6, v * 100)}%` }} />
            ))}
          </div>
          <span
            className={`text-[11px] shrink-0 transition-colors ${willCancel ? "text-destructive font-semibold" : "text-muted-foreground"}`}
            style={{ transform: `translateX(${Math.max(dragX, -50)}px)` }}
          >
            {willCancel ? (
              <span className="inline-flex items-center gap-1"><X className="h-3 w-3" /> <span className="hidden sm:inline">solte p/ cancelar</span><span className="sm:hidden">solte</span></span>
            ) : (
              <><span className="hidden sm:inline">‹ deslize p/ cancelar</span><span className="sm:hidden">‹ deslize</span></>
            )}
          </span>
          {/* Botão X sempre clicável — escape caso a gravação fique "presa".
              pointer-events-auto sobrescreve o pointer-events-none do overlay. */}
          <button
            type="button"
            onPointerDown={(ev) => { ev.stopPropagation(); ev.preventDefault(); }}
            onClick={(ev) => { ev.stopPropagation(); cancelRecording(); }}
            aria-label="Cancelar gravação"
            className="pointer-events-auto ml-1 h-7 w-7 inline-flex items-center justify-center rounded-full bg-destructive/15 hover:bg-destructive/25 text-destructive shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
          <div
            className="absolute -top-8 right-3 flex flex-col items-center text-destructive/80"
            style={{ transform: `translateY(${Math.max(dragY, -40)}px)`, opacity: Math.min(1, Math.abs(dragY) / LOCK_THRESHOLD + 0.4) }}
          >
            <Lock className="h-3.5 w-3.5" />
          </div>
        </div>
      )}


      {error && (
        <div role="alert" className="absolute bottom-full right-0 mb-2 rounded-md bg-destructive/10 border border-destructive/40 text-destructive text-xs px-3 py-2 whitespace-nowrap">
          {error}
        </div>
      )}
    </div>
  );
}


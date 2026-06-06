// AudioRecorder — botão de microfone do composer (somente WhatsApp).
//
// Estratégia de formato: WhatsApp Cloud API só aceita áudio (voice note) nos
// containers AAC, AMR, MPEG, MP4 e OGG/Opus. Chrome/Android/Desktop devem sair
// sempre como OGG/Opus real via opus-recorder. Só Safari/iOS pode usar MP4
// nativo, e mesmo assim validamos os bytes antes de enviar.

import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, Square, Play, Pause, Trash2, Send, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
// URL do worker do encoder Opus, processada pelo Vite para um asset estático.
import encoderWorkerUrl from "opus-recorder/dist/encoderWorker.min.js?url";

interface Props {
  conversationId: string;
  disabled?: boolean;
  onSent?: () => void;
}

type RecorderLike = {
  start: () => Promise<void> | void;
  stop: () => Promise<void> | void;
  close?: () => void;
  ondataavailable?: (data: ArrayBuffer | Uint8Array | Blob) => void;
  onstop?: () => void;
};

type NativeMime = "audio/mp4";

function isSafariLike(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const vendor = navigator.vendor;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/.test(ua) && /Apple/.test(vendor) && !/CriOS|FxiOS|EdgiOS|Chrome|Chromium|Android/.test(ua);
  return isIOS || isSafari;
}

function pickSafariNativeMime(): NativeMime | null {
  if (typeof MediaRecorder === "undefined") return null;
  if (!isSafariLike()) return null;
  try {
    if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  } catch {
    /* */
  }
  return null;
}

function fmtTime(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

const MAX_BYTES = 16 * 1024 * 1024;

function bytesIncludeAscii(bytes: Uint8Array, needle: string, scanLimit = bytes.length): boolean {
  const max = Math.min(bytes.length, scanLimit);
  outer: for (let i = 0; i <= max - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (bytes[i + j] !== needle.charCodeAt(j)) continue outer;
    }
    return true;
  }
  return false;
}

function hasOggOpusBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 36 && bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53 && bytesIncludeAscii(bytes, "OpusHead", 256);
}

function hasMp4Bytes(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && bytesIncludeAscii(bytes, "ftyp", 64);
}

export function AudioRecorder({ conversationId, disabled, onSent }: Props) {
  const [state, setState] = useState<"idle" | "recording" | "preview" | "sending">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // Recorder pode ser nativo (MediaRecorder) ou opus-recorder.
  const recorderRef = useRef<RecorderLike | MediaRecorder | null>(null);
  const recorderKindRef = useRef<"native" | "opus" | null>(null);
  const recorderMimeRef = useRef<string>("audio/ogg");
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const nativeMime = useMemo(() => pickSafariNativeMime(), []);

  useEffect(() => {
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const reset = () => {
    if (tickRef.current) window.clearInterval(tickRef.current);
    tickRef.current = null;
    stopStream();
    try {
      const r = recorderRef.current as RecorderLike | null;
      r?.close?.();
    } catch {
      /* */
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setSeconds(0);
    setIsPlaying(false);
    blobRef.current = null;
    chunksRef.current = [];
    recorderRef.current = null;
    recorderKindRef.current = null;
    setState("idle");
  };

  const finalize = (blob: Blob) => {
    blobRef.current = blob;
    const url = URL.createObjectURL(blob);
    setPreviewUrl(url);
    setState("preview");
    stopStream();
    if (tickRef.current) window.clearInterval(tickRef.current);
    tickRef.current = null;
  };

  const startRecording = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Seu navegador não suporta gravação de áudio.");
      return;
    }
    if (!window.isSecureContext) {
      setError("Gravação exige HTTPS. Acesse pelo domínio publicado.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name === "NotAllowedError" || name === "SecurityError") {
        setError("Permissão de microfone negada. Habilite nas configurações do navegador.");
      } else if (name === "NotFoundError") {
        setError("Nenhum microfone encontrado.");
      } else {
        setError("Não foi possível acessar o microfone.");
      }
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];

    try {
      if (nativeMime) {
        // Caminho nativo restrito a Safari/iOS: só aceitamos MP4 se os bytes forem MP4 real.
        const rec = new MediaRecorder(stream, { mimeType: nativeMime });
        recorderRef.current = rec;
        recorderKindRef.current = "native";
        recorderMimeRef.current = nativeMime;
        rec.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
        };
        rec.onstop = () => {
          const blob = new Blob(chunksRef.current as Blob[], {
            type: rec.mimeType || nativeMime,
          });
          finalize(blob);
        };
        rec.start();
      } else {
        // Caminho opus-recorder: produz OGG/Opus real em Chrome/Android/Desktop.
        // Import dinâmico evita custo do WASM até o primeiro uso.
        const mod = await import("opus-recorder");
        const RecorderCtor = mod.default;
        const rec = new RecorderCtor({
          encoderPath: encoderWorkerUrl,
          encoderApplication: 2048, // voice
          encoderSampleRate: 16000,
          encoderFrameSize: 20,
          numberOfChannels: 1,
          streamPages: false,
          monitorGain: 0,
          recordingGain: 1,
        });
        recorderRef.current = rec;
        recorderKindRef.current = "opus";
        recorderMimeRef.current = "audio/ogg";
        rec.ondataavailable = (data) => {
          if (data instanceof Blob) {
            if (data.size > 0) chunksRef.current.push(data);
          } else if (data instanceof ArrayBuffer) {
            chunksRef.current.push(data);
          } else {
            // Uint8Array — copia para um ArrayBuffer puro para satisfazer BlobPart.
            const copy = new Uint8Array(data.byteLength);
            copy.set(data);
            chunksRef.current.push(copy.buffer);
          }
        };
        rec.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: "audio/ogg" });
          finalize(blob);
        };
        await rec.start();
      }
    } catch (e) {
      console.error("[audio] start error", e);
      stopStream();
      setError("Não foi possível iniciar a gravação.");
      return;
    }

    startedAtRef.current = Date.now();
    setSeconds(0);
    setState("recording");
    tickRef.current = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 250);
  };

  const stopRecording = async () => {
    const r = recorderRef.current;
    const kind = recorderKindRef.current;
    if (!r) return;
    try {
      if (kind === "native") {
        const mr = r as MediaRecorder;
        if (mr.state !== "inactive") mr.stop();
      } else {
        await (r as RecorderLike).stop();
      }
    } catch (e) {
      console.error("[audio] stop error", e);
    }
  };

  const togglePlay = () => {
    const el = audioElRef.current;
    if (!el) return;
    if (isPlaying) el.pause();
    else el.play().catch(() => null);
  };

  const sendAudio = async () => {
    const blob = blobRef.current;
    if (!blob) return;
    if (blob.size > MAX_BYTES) {
      setError("Áudio acima de 16MB. Grave um trecho menor.");
      return;
    }
    setState("sending");
    setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? "";
      if (!token) throw new Error("Sessão expirada. Entre novamente.");

      const base = blob.type.split(";")[0] || "audio/ogg";
      const extMap: Record<string, string> = {
        "audio/ogg": "ogg",
        "audio/mp4": "m4a",
        "audio/aac": "aac",
        "audio/mpeg": "mp3",
      };
      const ext = extMap[base] ?? "ogg";
      const fd = new FormData();
      fd.append("file", blob, `audio-${Date.now()}.${ext}`);
      fd.append("conversationId", conversationId);
      fd.append("duration", String(seconds));

      const res = await fetch("/api/whatsapp/send-audio", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        stage?: string;
        detail?: string;
        http_status?: number | string;
        status?: number;
        meta_error?: unknown;
        meta_error_message?: string | null;
        meta_error_code?: number | null;
        meta_error_subcode?: number | null;
        meta_error_type?: string | null;
        fbtrace_id?: string | null;
        meta_body?: string;
        signed_url_status?: number | string;
        signed_url_content_type?: string | null;
        signed_url_content_length?: string | null;
      };
      if (!res.ok) {
        console.error("[AUDIO SEND ERROR]", { http_status: res.status, ...json });
        const parts = [
          `HTTP ${res.status}`,
          json.stage ? `stage=${json.stage}` : null,
          json.meta_error_message ? `meta=${json.meta_error_message}` : null,
          json.meta_error_code != null ? `code=${json.meta_error_code}` : null,
          json.meta_error_subcode != null ? `subcode=${json.meta_error_subcode}` : null,
          json.fbtrace_id ? `fbtrace=${json.fbtrace_id}` : null,
          json.detail && !json.meta_error_message ? json.detail : null,
        ].filter(Boolean);
        throw new Error(parts.join(" · ") || (json.error ?? `Falha (HTTP ${res.status})`));
      }
      onSent?.();
      reset();
    } catch (e) {
      const detail = e instanceof Error ? e.message : "erro desconhecido";
      const msg = `Áudio não enviado pelo WhatsApp · ${detail}`;
      console.error("[audio] send error", e);
      setError(msg);
      toast.error(msg, { duration: 10000 });
      // Mantém o blob localmente para o atendente tentar de novo.
      setState("preview");
    }
  };

  // --- UI ---

  if (state === "idle") {
    return (
      <>
        <button
          type="button"
          onClick={startRecording}
          disabled={disabled}
          aria-label="Gravar áudio"
          title="Gravar áudio"
          className="h-11 w-11 md:h-9 md:w-9 inline-flex items-center justify-center rounded-full md:rounded-md bg-muted hover:bg-muted/80 text-foreground disabled:opacity-40 shrink-0"
        >
          <Mic className="h-5 w-5 md:h-4 md:w-4" />
        </button>
        {error && (
          <div
            role="alert"
            className="absolute bottom-full left-2 right-2 mb-2 rounded-md bg-destructive/10 border border-destructive/40 text-destructive text-xs px-3 py-2"
          >
            {error}
          </div>
        )}
      </>
    );
  }

  if (state === "recording") {
    return (
      <div className="flex items-center gap-2 bg-destructive/10 border border-destructive/40 rounded-full md:rounded-md px-3 h-11 md:h-9 shrink-0">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75 animate-ping" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-destructive" />
        </span>
        <span className="text-sm font-mono tabular-nums text-destructive min-w-[3rem]">
          {fmtTime(seconds)}
        </span>
        <button
          type="button"
          onClick={reset}
          aria-label="Cancelar gravação"
          title="Cancelar"
          className="h-8 w-8 inline-flex items-center justify-center rounded-full hover:bg-destructive/20"
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </button>
        <button
          type="button"
          onClick={stopRecording}
          aria-label="Parar gravação"
          title="Parar"
          className="h-8 w-8 inline-flex items-center justify-center rounded-full bg-destructive text-destructive-foreground"
        >
          <Square className="h-4 w-4" />
        </button>
      </div>
    );
  }

  // preview ou sending
  return (
    <div className="flex items-center gap-1.5 bg-muted rounded-full md:rounded-md px-2 h-11 md:h-9 shrink-0 max-w-full">
      {previewUrl && (
        <audio
          ref={audioElRef}
          src={previewUrl}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          preload="metadata"
          className="hidden"
        />
      )}
      <button
        type="button"
        onClick={togglePlay}
        aria-label={isPlaying ? "Pausar" : "Ouvir"}
        disabled={state === "sending"}
        className="h-8 w-8 inline-flex items-center justify-center rounded-full bg-background hover:bg-background/80"
      >
        {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      <span className="text-xs font-mono tabular-nums text-muted-foreground min-w-[2.5rem]">
        {fmtTime(seconds)}
      </span>
      <button
        type="button"
        onClick={reset}
        aria-label="Descartar áudio"
        disabled={state === "sending"}
        className="h-8 w-8 inline-flex items-center justify-center rounded-full hover:bg-background"
      >
        <Trash2 className="h-4 w-4 text-muted-foreground" />
      </button>
      <button
        type="button"
        onClick={sendAudio}
        aria-label="Enviar áudio"
        disabled={state === "sending"}
        className="h-8 w-8 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        {state === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      </button>
      {error && (
        <div
          role="alert"
          className="absolute bottom-full left-2 right-2 mb-2 rounded-md bg-destructive/10 border border-destructive/40 text-destructive text-xs px-3 py-2"
        >
          {error}
        </div>
      )}
    </div>
  );
}

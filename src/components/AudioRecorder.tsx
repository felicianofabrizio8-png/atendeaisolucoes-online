// AudioRecorder — botão de microfone do composer.
// Fluxo mobile-first: 1) tocar mic, 2) gravar com timer + indicador,
// 3) parar → preview (play + enviar/cancelar). Envia via /api/whatsapp/send-audio.
//
// Detecta o melhor mimeType suportado pelo navegador, na ordem que o WhatsApp
// Cloud API aceita: audio/ogg;codecs=opus → audio/mp4 → audio/aac → audio/webm.
// Não bloqueia o fluxo de texto; falhas de microfone mostram erro amigável.

import { useEffect, useRef, useState } from "react";
import { Mic, Square, Play, Pause, Trash2, Send, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  conversationId: string;
  disabled?: boolean;
  onSent?: () => void;
}

const PREFERRED_MIMES = [
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
  "audio/aac",
  "audio/webm;codecs=opus",
  "audio/webm",
];

function pickMimeType(): string | "" {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of PREFERRED_MIMES) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* */
    }
  }
  return "";
}

function fmtTime(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function AudioRecorder({ conversationId, disabled, onSent }: Props) {
  const [state, setState] = useState<"idle" | "recording" | "preview" | "sending">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      // Cleanup ao desmontar
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
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setSeconds(0);
    setIsPlaying(false);
    blobRef.current = null;
    chunksRef.current = [];
    mediaRecorderRef.current = null;
    setState("idle");
  };

  const startRecording = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Seu navegador não suporta gravação de áudio.");
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
    const mime = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch {
      recorder = new MediaRecorder(stream);
    }
    mediaRecorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
    };
    recorder.onstop = () => {
      const type = recorder.mimeType || mime || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      blobRef.current = blob;
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setState("preview");
      stopStream();
      if (tickRef.current) window.clearInterval(tickRef.current);
      tickRef.current = null;
    };

    startedAtRef.current = Date.now();
    setSeconds(0);
    setState("recording");
    tickRef.current = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 250);
    recorder.start();
  };

  const stopRecording = () => {
    const r = mediaRecorderRef.current;
    if (r && r.state !== "inactive") {
      try {
        r.stop();
      } catch {
        /* */
      }
    }
  };

  const togglePlay = () => {
    const el = audioElRef.current;
    if (!el) return;
    if (isPlaying) {
      el.pause();
    } else {
      el.play().catch(() => null);
    }
  };

  const sendAudio = async () => {
    const blob = blobRef.current;
    if (!blob) return;
    setState("sending");
    setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? "";
      if (!token) throw new Error("Sessão expirada. Entre novamente.");

      const ext = (blob.type.split(";")[0].split("/")[1] ?? "webm").replace("mpeg", "mp3");
      const fd = new FormData();
      fd.append("file", blob, `audio-${Date.now()}.${ext}`);
      fd.append("conversationId", conversationId);
      fd.append("duration", String(seconds));

      const res = await fetch("/api/whatsapp/send-audio", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(json.error ?? `Falha (HTTP ${res.status})`);
      }
      onSent?.();
      reset();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao enviar áudio";
      setError(msg);
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

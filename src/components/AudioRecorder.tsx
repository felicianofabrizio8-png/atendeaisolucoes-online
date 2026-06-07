// AudioRecorder — botão de microfone do composer (somente WhatsApp).
//
// Estratégia de formato: WhatsApp Cloud API só aceita áudio (voice note) nos
// containers AAC, AMR, MPEG, MP4 e OGG/Opus. Chrome/Android/Desktop devem sair
// sempre como OGG/Opus real via opus-recorder. Só Safari/iOS pode usar MP4
// nativo, e mesmo assim validamos os bytes antes de enviar.

import { useEffect, useRef, useState } from "react";
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
  try {
    if (MediaRecorder.isTypeSupported("audio/mp4;codecs=mp4a.40.2")) return "audio/mp4";
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
  const bitrateRef = useRef<number>(0);
  const transcodeMsRef = useRef<number>(0);
  const platformRef = useRef<"ios_safari" | "android_or_desktop">("android_or_desktop");

  

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

  // Transcoda MP4/AAC (gravado no Safari/iOS) para OGG/Opus real no cliente.
  // iOS preset: bitrate 64 kbps para baixar rápido no WhatsApp do cliente.
  const transcodeMp4ToOgg = async (mp4Blob: Blob): Promise<{ blob: Blob; elapsedMs: number; bitrate: number }> => {
    const t0 = Date.now();
    const arr = await mp4Blob.arrayBuffer();
    const AC: typeof AudioContext =
      (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) throw new Error("AudioContext indisponível");
    const decodeCtx = new AC();
    let decoded: AudioBuffer;
    try {
      decoded = await new Promise<AudioBuffer>((resolve, reject) => {
        try {
          const p = decodeCtx.decodeAudioData(arr.slice(0), resolve, reject);
          if (p && typeof (p as Promise<AudioBuffer>).then === "function") {
            (p as Promise<AudioBuffer>).then(resolve, reject);
          }
        } catch (err) {
          reject(err);
        }
      });
    } finally {
      try { await decodeCtx.close(); } catch { /* */ }
    }

    const targetRate = 48000;
    const iosBitrate = 64000;
    const offline = new (
      (window as unknown as { OfflineAudioContext: typeof OfflineAudioContext }).OfflineAudioContext
    )(1, Math.ceil(decoded.duration * targetRate), targetRate);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start(0);
    const monoBuffer = await offline.startRendering();

    const mod = await import("opus-recorder");
    const RecorderCtor = mod.default;
    const playCtx = new AC({ sampleRate: targetRate });
    const playSrc = playCtx.createBufferSource();
    playSrc.buffer = monoBuffer;

    const rec = new RecorderCtor({
      encoderPath: encoderWorkerUrl,
      encoderApplication: 2048, // voice
      encoderSampleRate: targetRate,
      encoderFrameSize: 20,
      encoderBitRate: iosBitrate,
      numberOfChannels: 1,
      streamPages: false,
      sourceNode: playSrc,
      monitorGain: 0,
      recordingGain: 1,
    });
    const chunks: BlobPart[] = [];
    rec.ondataavailable = (data: ArrayBuffer | Uint8Array | Blob) => {
      if (data instanceof Blob) {
        if (data.size > 0) chunks.push(data);
      } else if (data instanceof ArrayBuffer) {
        chunks.push(data);
      } else {
        const copy = new Uint8Array(data.byteLength);
        copy.set(data);
        chunks.push(copy.buffer);
      }
    };

    const oggBlob = await new Promise<Blob>((resolve, reject) => {
      rec.onstop = () => resolve(new Blob(chunks, { type: "audio/ogg" }));
      playSrc.onended = () => {
        try { void rec.stop(); } catch (e) { reject(e); }
      };
      rec.start().then(() => {
        try {
          playSrc.start(0);
        } catch (e) {
          reject(e);
        }
      }).catch(reject);
    });

    try { await playCtx.close(); } catch { /* */ }

    const bytes = new Uint8Array(await oggBlob.arrayBuffer());
    const valid = hasOggOpusBytes(bytes);
    const elapsedMs = Date.now() - t0;
    console.log("[AUDIO IOS TRANSCODE]", {
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      input_mime: mp4Blob.type,
      input_size: mp4Blob.size,
      decoded_duration_sec: decoded.duration,
      decoded_sample_rate: decoded.sampleRate,
      decoded_channels: decoded.numberOfChannels,
      output_mime: "audio/ogg",
      output_size: oggBlob.size,
      output_bitrate: iosBitrate,
      output_valid_ogg_opus: valid,
      elapsed_ms: elapsedMs,
    });
    if (!valid) throw new Error("Transcodificação não produziu OGG/Opus válido");
    return { blob: oggBlob, elapsedMs, bitrate: iosBitrate };
  };

  const finalize = async (blob: Blob, expectedMime: "audio/ogg" | "audio/mp4") => {
    // iOS/Safari grava MP4 nativo; precisamos transcodar para OGG antes do envio.
    let workBlob = blob;
    let workExpected: "audio/ogg" = "audio/ogg";
    if (expectedMime === "audio/mp4") {
      try {
        const out = await transcodeMp4ToOgg(blob);
        workBlob = out.blob;
        transcodeMsRef.current = out.elapsedMs;
        bitrateRef.current = out.bitrate;
      } catch (err) {
        console.error("[AUDIO IOS TRANSCODE] failed", err);
        stopStream();
        if (tickRef.current) window.clearInterval(tickRef.current);
        tickRef.current = null;
        setState("idle");
        setError("Não foi possível preparar o áudio neste iPhone. Tente atualizar o Safari ou envie uma mensagem de texto.");
        return;
      }
    }
    const bytes = new Uint8Array(await workBlob.arrayBuffer());
    const valid = hasOggOpusBytes(bytes);
    const firstBytesHex = Array.from(bytes.slice(0, 16))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ");
    console.log("[AUDIO MOBILE DEBUG]", {
      stage: "recorder_finalize",
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      recorder_kind: recorderKindRef.current,
      recorder_mime: recorderMimeRef.current,
      mediaRecorder_mimeType:
        recorderKindRef.current === "native"
          ? (recorderRef.current as MediaRecorder | null)?.mimeType ?? null
          : null,
      original_blob_type: blob.type,
      original_size: blob.size,
      final_blob_type: workBlob.type,
      final_size: workBlob.size,
      expected_mime: workExpected,
      duration_seconds: seconds,
      valid_bytes: valid,
      first_bytes_hex: firstBytesHex,
      transcoded_from_mp4: expectedMime === "audio/mp4",
    });
    if (!valid) {
      stopStream();
      if (tickRef.current) window.clearInterval(tickRef.current);
      tickRef.current = null;
      setState("idle");
      setError("Não foi possível gerar um áudio OGG/Opus válido. Grave novamente.");
      return;
    }
    const normalized = new Blob([bytes], { type: "audio/ogg" });
    blobRef.current = normalized;
    const url = URL.createObjectURL(normalized);
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

    const uaEarly = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const safariEarly = isSafariLike();
    // Constraints recomendadas para voice notes — EC/NS/AGC ligados melhoram a clareza
    // em ambientes reais (eco do alto-falante do celular, ruído de fundo, microfone fraco).
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 48000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
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

    // Log das constraints reais aplicadas pelo browser (útil pra debugar Android).
    const trackSettings = (() => {
      try {
        return stream.getAudioTracks()[0]?.getSettings?.() ?? null;
      } catch {
        return null;
      }
    })();

    const ua = uaEarly;
    const safari = safariEarly;
    const safariMime = safari ? pickSafariNativeMime() : null;
    const useNative = Boolean(safariMime);
    const targetSampleRate = 48000;
    // Presets por plataforma:
    // - iOS: 64 kbps no OGG final (após transcode) para baixar rápido no WhatsApp.
    // - Android/Desktop: 128 kbps direto no opus-recorder para voz clara.
    const targetBitrate = useNative ? 64000 : 128000;
    platformRef.current = safari ? "ios_safari" : "android_or_desktop";
    bitrateRef.current = targetBitrate;

    console.log("[AUDIO PLATFORM]", {
      user_agent: ua,
      platform: platformRef.current,
      encoder: useNative ? "MediaRecorder(native)" : "opus-recorder",
      chosen_format: useNative ? safariMime : "audio/ogg;codecs=opus",
      sample_rate: targetSampleRate,
      bitrate: targetBitrate,
      preset: useNative ? "ios_64kbps_fast_download" : "android_128kbps_clear_voice",
      mic_constraints: trackSettings,
      reason: useNative
        ? "iOS/Safari grava MP4/AAC nativo e transcoda para OGG/Opus 64 kbps antes do envio (carrega rápido no WhatsApp)."
        : "Android/Desktop usa opus-recorder em 48kHz mono / 128kbps / voice para máxima clareza.",
      native_mp4_supported:
        typeof MediaRecorder !== "undefined" &&
        (() => {
          try {
            return MediaRecorder.isTypeSupported("audio/mp4");
          } catch {
            return false;
          }
        })(),
    });

    console.log("[AUDIO FORMAT SELECTED]", {
      user_agent: ua,
      final_upload_format: "audio/ogg;codecs=opus",
      encoder: useNative ? "ios_native_mp4_then_transcode" : "opus_recorder_direct",
      reason: useNative
        ? "iOS/Safari grava MP4 e cliente converte para OGG/Opus antes de enviar à Meta."
        : "Android/Desktop grava diretamente em OGG/Opus.",
    });

    try {
      if (useNative && safariMime) {
        // Safari/iOS: MediaRecorder nativo → MP4/AAC.
        const mr = new MediaRecorder(stream, {
          mimeType: safariMime,
          audioBitsPerSecond: targetBitrate,
        });
        recorderRef.current = mr;
        recorderKindRef.current = "native";
        recorderMimeRef.current = safariMime;
        mr.ondataavailable = (ev: BlobEvent) => {
          if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
        };
        mr.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: safariMime });
          void finalize(blob, "audio/mp4");
        };
        mr.start();
      } else {
        // Android/Desktop: opus-recorder → OGG/Opus real (48kHz, 64kbps, voice).
        const mod = await import("opus-recorder");
        const RecorderCtor = mod.default;
        const rec = new RecorderCtor({
          encoderPath: encoderWorkerUrl,
          encoderApplication: 2048, // voice
          encoderSampleRate: targetSampleRate,
          encoderFrameSize: 20,
          encoderBitRate: targetBitrate,
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
            const copy = new Uint8Array(data.byteLength);
            copy.set(data);
            chunksRef.current.push(copy.buffer);
          }
        };
        rec.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: "audio/ogg" });
          void finalize(blob, "audio/ogg");
        };
        await rec.start();
      }
    } catch (e) {
      console.error("[audio] start error", e);
      stopStream();
      setError("Seu navegador não suporta gravação de áudio compatível com WhatsApp.");
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
      };
      const ext = extMap[base] ?? "ogg";
      const filename = `audio-${Date.now()}.${ext}`;

      // Re-amostra primeiros bytes p/ diagnóstico no envio.
      const sendBytes = new Uint8Array(await blob.arrayBuffer());
      const firstBytesHex = Array.from(sendBytes.slice(0, 16))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ");
      const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
      console.log("[AUDIO MOBILE DEBUG]", {
        stage: "send",
        user_agent: ua,
        recorder_kind: recorderKindRef.current,
        recorder_mime: recorderMimeRef.current,
        blob_type: blob.type,
        filename,
        extension: ext,
        size: blob.size,
        duration_seconds: seconds,
        first_bytes_hex: firstBytesHex,
      });

      const fd = new FormData();
      fd.append("file", blob, filename);
      fd.append("conversationId", conversationId);
      fd.append("duration", String(seconds));
      fd.append("client_user_agent", ua);
      fd.append("client_recorder_kind", recorderKindRef.current ?? "");
      fd.append("client_recorder_mime", recorderMimeRef.current ?? "");
      fd.append("client_blob_type", blob.type);
      fd.append("client_first_bytes_hex", firstBytesHex);

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
        detected_audio?: string | null;
        declared_mime?: string | null;
      };
      console.log("[AUDIO MOBILE DEBUG]", {
        stage: "send_response",
        http_status: res.status,
        detected_audio: json.detected_audio ?? null,
        declared_mime: json.declared_mime ?? null,
        signed_url_content_type: json.signed_url_content_type ?? null,
        signed_url_content_length: json.signed_url_content_length ?? null,
      });
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

// Pipeline de nota de voz do WhatsApp — gravação, conversão e envio.
//
// Extraído do AudioRecorder da Caixa de atendimento para o Atendimento 2.0
// usar exatamente o mesmo fluxo que já funciona lá. Só a interface muda entre
// as telas; formato, conversão e upload moram aqui.
//
// Estratégia de encoder: a WhatsApp Cloud API só aceita áudio em AAC, AMR,
// MPEG, MP4 ou OGG/Opus. Chrome/Android/Desktop gravam nativo (WebM/Opus) e
// são transcodados para OGG/Opus offline para não picotar; Safari/iOS grava
// MP4 nativo e também é transcodado. Sem MediaRecorder compatível, o
// opus-recorder grava OGG/Opus direto.

import { supabase } from "@/integrations/supabase/client";
import encoderWorkerUrl from "opus-recorder/dist/encoderWorker.min.js?url";

export const VOICE_NOTE_MAX_BYTES = 16 * 1024 * 1024;

type NativeMime = "audio/mp4" | "audio/webm" | "audio/webm;codecs=opus" | "audio/ogg;codecs=opus";
export type VoiceSource = "ogg_direct" | "ios_mp4" | "android_native";

type OpusRecorderLike = {
  start: () => Promise<void> | void;
  stop: () => Promise<void> | void;
  pause?: () => Promise<void> | void;
  resume?: () => void;
  close?: () => void;
  ondataavailable?: (data: ArrayBuffer | Uint8Array | Blob) => void;
  onstop?: () => void;
};

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | undefined {
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext;
}

export function isSafariLike(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const vendor = navigator.vendor;
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafari =
    /Safari/.test(ua) &&
    /Apple/.test(vendor) &&
    !/CriOS|FxiOS|EdgiOS|Chrome|Chromium|Android/.test(ua);
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

function pickAndroidNativeMime(): NativeMime | null {
  if (typeof MediaRecorder === "undefined") return null;
  try {
    if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
    if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) return "audio/ogg;codecs=opus";
    if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  } catch {
    /* */
  }
  return null;
}

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

export function hasOggOpusBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 36 &&
    bytes[0] === 0x4f &&
    bytes[1] === 0x67 &&
    bytes[2] === 0x67 &&
    bytes[3] === 0x53 &&
    bytesIncludeAscii(bytes, "OpusHead", 256)
  );
}

function pushChunk(chunks: BlobPart[], data: ArrayBuffer | Uint8Array | Blob) {
  if (data instanceof Blob) {
    if (data.size > 0) chunks.push(data);
  } else if (data instanceof ArrayBuffer) {
    chunks.push(data);
  } else {
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    chunks.push(copy.buffer);
  }
}

/** Microfone com os mesmos parâmetros da Caixa de atendimento. */
export function openMicrophone(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      sampleRate: 48000,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
}

/** Mensagem amigável para falhas ao abrir o microfone. */
export function microphoneErrorMessage(error: unknown): string {
  const name = (error as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Permissão de microfone negada.";
  if (name === "NotFoundError") return "Nenhum microfone encontrado.";
  return "Não foi possível acessar o microfone.";
}

export interface VoiceCapture {
  kind: "native" | "opus";
  mime: string;
  source: VoiceSource;
  bitrate: number;
  platform: "ios_safari" | "android_or_desktop";
  pause: () => void;
  resume: () => void;
  /** Para a gravação e entrega o áudio bruto (antes da conversão). */
  stop: () => Promise<Blob>;
  /** Descarta sem produzir áudio. */
  abort: () => void;
}

/**
 * Começa a gravar no stream dado, escolhendo o recorder pela plataforma.
 * Lança se o navegador não tiver recorder compatível.
 */
export async function startVoiceCapture(stream: MediaStream): Promise<VoiceCapture> {
  const safari = isSafariLike();
  const safariMime = safari ? pickSafariNativeMime() : null;
  const androidMime = !safari ? pickAndroidNativeMime() : null;
  const platform = safari ? "ios_safari" : "android_or_desktop";
  const chunks: BlobPart[] = [];

  const nativeMime = safariMime ?? androidMime;
  if (nativeMime) {
    const source: VoiceSource = safariMime ? "ios_mp4" : "android_native";
    const mr = new MediaRecorder(stream, { mimeType: nativeMime, audioBitsPerSecond: 128000 });
    mr.ondataavailable = (ev: BlobEvent) => {
      if (ev.data?.size) chunks.push(ev.data);
    };
    const stopped = new Promise<Blob>((resolve) => {
      mr.onstop = () => resolve(new Blob(chunks, { type: nativeMime }));
    });
    mr.start();
    return {
      kind: "native",
      mime: nativeMime,
      source,
      bitrate: source === "ios_mp4" ? 64000 : 96000,
      platform,
      pause: () => {
        if (mr.state === "recording") mr.pause();
      },
      resume: () => {
        if (mr.state === "paused") mr.resume();
      },
      stop: async () => {
        if (mr.state !== "inactive") mr.stop();
        return stopped;
      },
      abort: () => {
        if (mr.state !== "inactive") mr.stop();
      },
    };
  }

  const mod = await import("opus-recorder");
  const RecorderCtor = mod.default;
  const rec = new RecorderCtor({
    encoderPath: encoderWorkerUrl,
    encoderApplication: 2048,
    encoderSampleRate: 48000,
    encoderFrameSize: 20,
    encoderBitRate: 96000,
    numberOfChannels: 1,
    streamPages: false,
    monitorGain: 0,
    recordingGain: 1,
  }) as unknown as OpusRecorderLike;
  rec.ondataavailable = (data) => pushChunk(chunks, data);
  const stopped = new Promise<Blob>((resolve) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: "audio/ogg" }));
  });
  await rec.start();
  return {
    kind: "opus",
    mime: "audio/ogg",
    source: "ogg_direct",
    bitrate: 96000,
    platform,
    pause: () => void rec.pause?.(),
    resume: () => rec.resume?.(),
    stop: async () => {
      await rec.stop();
      return stopped;
    },
    abort: () => {
      void rec.stop();
      try {
        rec.close?.();
      } catch {
        /* */
      }
    },
  };
}

/** Converte áudio nativo (MP4/WebM) em OGG/Opus, único formato aceito aqui. */
export async function transcodeToOgg(
  sourceBlob: Blob,
  bitrate: number,
  logTag: "[AUDIO IOS TRANSCODE]" | "[AUDIO ANDROID TRANSCODE]",
): Promise<{ blob: Blob; elapsedMs: number; bitrate: number }> {
  const t0 = Date.now();
  const arr = await sourceBlob.arrayBuffer();
  const AC = audioContextCtor();
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
    try {
      await decodeCtx.close();
    } catch {
      /* */
    }
  }

  const targetRate = 48000;
  const offline = new (
    window as unknown as { OfflineAudioContext: typeof OfflineAudioContext }
  ).OfflineAudioContext(1, Math.ceil(decoded.duration * targetRate), targetRate);
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
    encoderApplication: 2048,
    encoderSampleRate: targetRate,
    encoderFrameSize: 20,
    encoderBitRate: bitrate,
    numberOfChannels: 1,
    streamPages: false,
    sourceNode: playSrc,
    monitorGain: 0,
    recordingGain: 1,
  });
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (data: ArrayBuffer | Uint8Array | Blob) => pushChunk(chunks, data);

  const oggBlob = await new Promise<Blob>((resolve, reject) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: "audio/ogg" }));
    playSrc.onended = () => {
      try {
        void rec.stop();
      } catch (e) {
        reject(e);
      }
    };
    rec
      .start()
      .then(() => {
        try {
          playSrc.start(0);
        } catch (e) {
          reject(e);
        }
      })
      .catch(reject);
  });

  try {
    await playCtx.close();
  } catch {
    /* */
  }

  const bytes = new Uint8Array(await oggBlob.arrayBuffer());
  const valid = hasOggOpusBytes(bytes);
  const elapsedMs = Date.now() - t0;
  console.log(logTag, {
    input_mime: sourceBlob.type,
    input_size: sourceBlob.size,
    output_size: oggBlob.size,
    output_bitrate: bitrate,
    valid,
    elapsed_ms: elapsedMs,
  });
  if (!valid) throw new Error("Transcodificação não produziu OGG/Opus válido");
  return { blob: oggBlob, elapsedMs, bitrate };
}

export class VoiceNoteError extends Error {}

/**
 * Deixa o áudio bruto pronto para envio: converte quando preciso e valida o
 * OGG/Opus. Lança `VoiceNoteError` com mensagem para o usuário.
 */
export async function prepareVoiceNote(
  raw: Blob,
  source: VoiceSource,
): Promise<{ blob: Blob; transcodeMs: number; bitrate: number | null }> {
  let work = raw;
  let transcodeMs = 0;
  let bitrate: number | null = null;
  if (source === "ios_mp4" || source === "android_native") {
    const rate = source === "ios_mp4" ? 64000 : 96000;
    const tag = source === "ios_mp4" ? "[AUDIO IOS TRANSCODE]" : "[AUDIO ANDROID TRANSCODE]";
    try {
      const out = await transcodeToOgg(raw, rate, tag);
      work = out.blob;
      transcodeMs = out.elapsedMs;
      bitrate = out.bitrate;
    } catch (err) {
      console.error(tag, "failed", err);
      throw new VoiceNoteError(
        source === "ios_mp4"
          ? "Não foi possível preparar o áudio neste iPhone. Tente atualizar o Safari ou envie uma mensagem de texto."
          : "Não foi possível preparar o áudio neste Android. Tente novamente.",
      );
    }
  }
  const bytes = new Uint8Array(await work.arrayBuffer());
  if (!hasOggOpusBytes(bytes)) {
    throw new VoiceNoteError("Não foi possível gerar um áudio válido. Tente novamente.");
  }
  const blob = new Blob([bytes], { type: "audio/ogg" });
  if (blob.size > VOICE_NOTE_MAX_BYTES) {
    throw new VoiceNoteError("Áudio acima de 16MB. Grave um trecho menor.");
  }
  return { blob, transcodeMs, bitrate };
}

/** Envia a nota de voz pronta. Lança `VoiceNoteError` com o detalhe do servidor. */
export async function uploadVoiceNote(args: {
  blob: Blob;
  conversationId: string;
  durationSeconds: number;
  recorderKind: string;
  recorderMime: string;
  metrics?: Record<string, unknown>;
}): Promise<void> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token ?? "";
  if (!token) throw new VoiceNoteError("Sessão expirada. Entre novamente.");

  const fd = new FormData();
  fd.append("file", args.blob, `audio-${Date.now()}.ogg`);
  fd.append("conversationId", args.conversationId);
  fd.append("duration", String(args.durationSeconds));
  fd.append("client_user_agent", typeof navigator !== "undefined" ? navigator.userAgent : "");
  fd.append("client_recorder_kind", args.recorderKind);
  fd.append("client_recorder_mime", args.recorderMime);
  fd.append("client_blob_type", args.blob.type);

  const uploadStart = Date.now();
  const res = await fetch("/api/whatsapp/send-audio", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    stage?: string;
    meta_error_message?: string | null;
    meta_error_code?: number | null;
    meta_error_subcode?: number | null;
    fbtrace_id?: string | null;
    detected_audio?: string | null;
  };
  console.log("[AUDIO QUALITY METRICS]", {
    ...args.metrics,
    duration_seconds: args.durationSeconds,
    final_size_bytes: args.blob.size,
    upload_ms: Date.now() - uploadStart,
    http_status: res.status,
    meta_detected_audio: json.detected_audio ?? null,
    ok: res.ok,
  });
  if (!res.ok) {
    const parts = [
      `HTTP ${res.status}`,
      json.stage ? `stage=${json.stage}` : null,
      json.meta_error_message ? `meta=${json.meta_error_message}` : null,
      json.meta_error_code != null ? `code=${json.meta_error_code}` : null,
      json.meta_error_subcode != null ? `subcode=${json.meta_error_subcode}` : null,
      json.fbtrace_id ? `fbtrace=${json.fbtrace_id}` : null,
    ].filter(Boolean);
    throw new VoiceNoteError(parts.join(" · ") || (json.error ?? `Falha (HTTP ${res.status})`));
  }
}

/** Níveis 0–1 do microfone para a forma de onda; devolve a função de parada. */
export function watchInputLevel(stream: MediaStream, onLevel: (level: number) => void): () => void {
  const AC = audioContextCtor();
  if (!AC) return () => undefined;
  let raf: number | null = null;
  let ctx: AudioContext | null = null;
  try {
    ctx = new AC();
    void ctx.resume?.();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let last = 0;
    const loop = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const now = performance.now();
      if (now - last > 60) {
        last = now;
        onLevel(Math.min(1, Math.max(0.04, Math.sqrt(sum / data.length) * 2.2)));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  } catch (e) {
    console.warn("[audio] analyser failed", e);
  }
  return () => {
    if (raf !== null) cancelAnimationFrame(raf);
    try {
      void ctx?.close();
    } catch {
      /* */
    }
  };
}

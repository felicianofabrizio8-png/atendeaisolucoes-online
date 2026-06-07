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
// Estratégia de encoder (inalterada): WhatsApp Cloud API só aceita áudio em AAC,
// AMR, MPEG, MP4 ou OGG/Opus. Chrome/Android/Desktop saem sempre como OGG/Opus
// real via opus-recorder (gravado nativo + transcodado offline para não picotar).
// Safari/iOS grava MP4 nativo e o cliente transcoda para OGG/Opus antes do envio.

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Send, Trash2, Lock, X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import encoderWorkerUrl from "opus-recorder/dist/encoderWorker.min.js?url";

interface Props {
  conversationId: string;
  disabled?: boolean;
  onSent?: () => void;
  onStateChange?: (state: "idle" | "recording" | "locked" | "processing" | "sending") => void;
}

type RecorderLike = {
  start: () => Promise<void> | void;
  stop: () => Promise<void> | void;
  close?: () => void;
  ondataavailable?: (data: ArrayBuffer | Uint8Array | Blob) => void;
  onstop?: () => void;
};

type NativeMime = "audio/mp4" | "audio/webm" | "audio/webm;codecs=opus" | "audio/ogg;codecs=opus";

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
  } catch { /* */ }
  return null;
}

function pickAndroidNativeMime(): NativeMime | null {
  if (typeof MediaRecorder === "undefined") return null;
  try {
    if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
    if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) return "audio/ogg;codecs=opus";
    if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  } catch { /* */ }
  return null;
}

function fmtTime(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

const MAX_BYTES = 16 * 1024 * 1024;
const CANCEL_THRESHOLD = 90; // px arrastado para esquerda
const LOCK_THRESHOLD = 70;   // px arrastado para cima
const WAVEFORM_BARS = 28;

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

  const recorderRef = useRef<RecorderLike | MediaRecorder | null>(null);
  const recorderKindRef = useRef<"native" | "opus" | null>(null);
  const recorderMimeRef = useRef<string>("audio/ogg");
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const bitrateRef = useRef<number>(0);
  const transcodeMsRef = useRef<number>(0);
  const platformRef = useRef<"ios_safari" | "android_or_desktop">("android_or_desktop");

  const cancelledRef = useRef(false);
  const lockedRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);

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
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      try { audioCtxRef.current?.close(); } catch { /* */ }
    };
  }, []);


  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const stopAnalyser = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    try { audioCtxRef.current?.close(); } catch { /* */ }
    audioCtxRef.current = null;
    analyserRef.current = null;
  };

  const resetAll = useCallback(() => {
    if (tickRef.current) window.clearInterval(tickRef.current);
    tickRef.current = null;
    stopAnalyser();
    stopStream();
    try {
      const r = recorderRef.current as RecorderLike | null;
      r?.close?.();
    } catch { /* */ }
    setSeconds(0);
    setDragX(0);
    setDragY(0);
    setWillCancel(false);
    setBars(new Array(WAVEFORM_BARS).fill(0.05));
    blobRef.current = null;
    chunksRef.current = [];
    recorderRef.current = null;
    recorderKindRef.current = null;
    cancelledRef.current = false;
    lockedRef.current = false;
    pointerIdRef.current = null;
    pointerStartRef.current = null;
    setState("idle");
  }, []);

  // Loop de waveform: lê amostras do AnalyserNode e empurra um novo nível por frame.
  const startAnalyser = (stream: MediaStream) => {
    try {
      const AC: typeof AudioContext =
        (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.fftSize);
      let last = 0;
      const loop = () => {
        if (!analyserRef.current) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        const level = Math.min(1, Math.max(0.04, rms * 2.2));
        const now = performance.now();
        if (now - last > 60) {
          last = now;
          setBars((prev) => {
            const next = prev.slice(1);
            next.push(level);
            return next;
          });
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (e) {
      console.warn("[audio] analyser failed", e);
    }
  };

  // ===== Encoding pipeline (mantido) =====
  const transcodeToOgg = async (
    sourceBlob: Blob,
    bitrate: number,
    logTag: "[AUDIO IOS TRANSCODE]" | "[AUDIO ANDROID TRANSCODE]"
  ): Promise<{ blob: Blob; elapsedMs: number; bitrate: number }> => {
    const t0 = Date.now();
    const arr = await sourceBlob.arrayBuffer();
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
        } catch (err) { reject(err); }
      });
    } finally {
      try { await decodeCtx.close(); } catch { /* */ }
    }

    const targetRate = 48000;
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
      playSrc.onended = () => { try { void rec.stop(); } catch (e) { reject(e); } };
      rec.start().then(() => {
        try { playSrc.start(0); } catch (e) { reject(e); }
      }).catch(reject);
    });

    try { await playCtx.close(); } catch { /* */ }

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
  };

  // ===== Auto-send após finalizar =====
  const sendBlob = async (blob: Blob) => {
    if (blob.size > MAX_BYTES) {
      setError("Áudio acima de 16MB. Grave um trecho menor.");
      resetAll();
      return;
    }
    setState("sending");
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? "";
      if (!token) throw new Error("Sessão expirada. Entre novamente.");

      const filename = `audio-${Date.now()}.ogg`;
      const fd = new FormData();
      fd.append("file", blob, filename);
      fd.append("conversationId", conversationId);
      fd.append("duration", String(seconds));
      fd.append("client_user_agent", typeof navigator !== "undefined" ? navigator.userAgent : "");
      fd.append("client_recorder_kind", recorderKindRef.current ?? "");
      fd.append("client_recorder_mime", recorderMimeRef.current ?? "");
      fd.append("client_blob_type", blob.type);

      const uploadStart = Date.now();
      const res = await fetch("/api/whatsapp/send-audio", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const uploadMs = Date.now() - uploadStart;
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
        platform: platformRef.current,
        duration_seconds: seconds,
        final_size_bytes: blob.size,
        bitrate_bps: bitrateRef.current,
        transcode_ms: transcodeMsRef.current,
        upload_ms: uploadMs,
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
        throw new Error(parts.join(" · ") || (json.error ?? `Falha (HTTP ${res.status})`));
      }
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

  const finalize = async (
    blob: Blob,
    source: "ogg_direct" | "ios_mp4" | "android_native"
  ) => {
    if (cancelledRef.current) {
      resetAll();
      return;
    }
    let workBlob = blob;
    if (source === "ios_mp4" || source === "android_native") {
      const bitrate = source === "ios_mp4" ? 64000 : 96000;
      const tag = source === "ios_mp4" ? "[AUDIO IOS TRANSCODE]" : "[AUDIO ANDROID TRANSCODE]";
      try {
        const out = await transcodeToOgg(blob, bitrate, tag);
        workBlob = out.blob;
        transcodeMsRef.current = out.elapsedMs;
        bitrateRef.current = out.bitrate;
      } catch (err) {
        console.error(tag, "failed", err);
        const msg = source === "ios_mp4"
          ? "Não foi possível preparar o áudio neste iPhone. Tente atualizar o Safari ou envie uma mensagem de texto."
          : "Não foi possível preparar o áudio neste Android. Tente novamente.";
        toast.error(msg, { duration: 8000 });
        setError(msg);
        resetAll();
        return;
      }
    }
    const bytes = new Uint8Array(await workBlob.arrayBuffer());
    if (!hasOggOpusBytes(bytes)) {
      toast.error("Não foi possível gerar um áudio válido. Tente novamente.");
      resetAll();
      return;
    }
    const normalized = new Blob([bytes], { type: "audio/ogg" });
    blobRef.current = normalized;
    stopStream();
    if (tickRef.current) window.clearInterval(tickRef.current);
    tickRef.current = null;
    stopAnalyser();
    // Envia direto, sem etapa de preview/confirmação.
    void sendBlob(normalized);
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

    const safari = isSafariLike();
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
        setError("Permissão de microfone negada.");
      } else if (name === "NotFoundError") {
        setError("Nenhum microfone encontrado.");
      } else {
        setError("Não foi possível acessar o microfone.");
      }
      return false;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    cancelledRef.current = false;
    lockedRef.current = false;

    const safariMime = safari ? pickSafariNativeMime() : null;
    const androidMime = !safari ? pickAndroidNativeMime() : null;
    const recordMode: "ios_native" | "android_native" | "opus_streaming" = safariMime
      ? "ios_native"
      : androidMime ? "android_native" : "opus_streaming";
    const targetBitrate = recordMode === "ios_native" ? 64000 : 96000;
    platformRef.current = safari ? "ios_safari" : "android_or_desktop";
    bitrateRef.current = targetBitrate;

    console.log("[AUDIO PLATFORM]", {
      user_agent: navigator.userAgent,
      platform: platformRef.current,
      record_mode: recordMode,
      final_format: "audio/ogg;codecs=opus",
      final_bitrate: targetBitrate,
    });

    try {
      if (recordMode === "ios_native" && safariMime) {
        const mr = new MediaRecorder(stream, { mimeType: safariMime, audioBitsPerSecond: 128000 });
        recorderRef.current = mr;
        recorderKindRef.current = "native";
        recorderMimeRef.current = safariMime;
        mr.ondataavailable = (ev: BlobEvent) => { if (ev.data?.size) chunksRef.current.push(ev.data); };
        mr.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: safariMime });
          void finalize(blob, "ios_mp4");
        };
        mr.start();
      } else if (recordMode === "android_native" && androidMime) {
        const mr = new MediaRecorder(stream, { mimeType: androidMime, audioBitsPerSecond: 128000 });
        recorderRef.current = mr;
        recorderKindRef.current = "native";
        recorderMimeRef.current = androidMime;
        mr.ondataavailable = (ev: BlobEvent) => { if (ev.data?.size) chunksRef.current.push(ev.data); };
        mr.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: androidMime });
          void finalize(blob, "android_native");
        };
        mr.start();
      } else {
        const mod = await import("opus-recorder");
        const RecorderCtor = mod.default;
        const rec = new RecorderCtor({
          encoderPath: encoderWorkerUrl,
          encoderApplication: 2048,
          encoderSampleRate: 48000,
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
          void finalize(blob, "ogg_direct");
        };
        await rec.start();
      }
    } catch (e) {
      console.error("[audio] start error", e);
      stopStream();
      setError("Seu navegador não suporta gravação compatível com WhatsApp.");
      return false;
    }

    startAnalyser(stream);
    startedAtRef.current = Date.now();
    setSeconds(0);
    setState("recording");
    tickRef.current = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 200);
    return true;
  };

  // ===== Stop / cancel =====
  const stopRecorder = async () => {
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

  const stopAndSend = () => {
    // Para cronômetro/waveform na hora e mostra "Processando…" imediatamente.
    if (tickRef.current) window.clearInterval(tickRef.current);
    tickRef.current = null;
    stopAnalyser();
    setState("processing");
    void stopRecorder();
  };

  const cancelRecording = () => {
    cancelledRef.current = true;
    if (tickRef.current) window.clearInterval(tickRef.current);
    tickRef.current = null;
    stopAnalyser();
    // Para o recorder mas o onstop vê cancelledRef e descarta.
    void stopRecorder();
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
    <div className="relative shrink-0">
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
        <div className="flex items-center gap-2 bg-destructive/10 border border-destructive/40 rounded-full md:rounded-md px-3 h-11 md:h-9 min-w-[200px]">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75 animate-ping" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-destructive" />
          </span>
          <span className="text-sm font-mono tabular-nums text-destructive min-w-[3rem]">{fmtTime(seconds)}</span>
          <div className="flex-1 flex items-center gap-[2px] h-5 overflow-hidden">
            {bars.map((v, i) => (
              <span key={i} className="w-[2px] rounded-full bg-destructive/70" style={{ height: `${Math.max(6, v * 100)}%` }} />
            ))}
          </div>
          <button
            type="button"
            onClick={cancelRecording}
            aria-label="Cancelar"
            className="h-8 w-8 inline-flex items-center justify-center rounded-full hover:bg-destructive/20"
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </button>
          <button
            type="button"
            onClick={stopAndSend}
            aria-label="Parar e enviar"
            className="h-8 w-8 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Processing / sending — pill compacto no lugar do mic */}
      {showProcessing && (
        <div className="flex items-center gap-2 bg-muted rounded-full md:rounded-md px-3 h-11 md:h-9 min-w-[160px]">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">
            {state === "processing" ? "Processando…" : "Enviando…"}
          </span>
          <span className="ml-auto text-xs font-mono tabular-nums text-muted-foreground">{fmtTime(seconds)}</span>
        </div>
      )}

      {/* Overlay flutuante de gravação — fica ACIMA do composer e NÃO captura toques.
          Mostra timer, waveform, hint "deslize p/ cancelar" e indicador de lock.
          Só aparece depois que a gravação realmente começou. */}
      {showRecordingOverlay && (
        <div
          className="pointer-events-none absolute bottom-full right-0 mb-2 flex items-center gap-2 bg-card border border-destructive/40 shadow-lg rounded-full px-3 h-10 min-w-[240px] max-w-[80vw]"
          aria-live="polite"
        >
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75 animate-ping" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-destructive" />
          </span>
          <span className="text-sm font-mono tabular-nums text-destructive min-w-[3rem]">{fmtTime(seconds)}</span>
          <div className="flex-1 flex items-center gap-[2px] h-5 overflow-hidden">
            {bars.map((v, i) => (
              <span key={i} className="w-[2px] rounded-full bg-destructive/70" style={{ height: `${Math.max(6, v * 100)}%` }} />
            ))}
          </div>
          <span
            className={`text-[11px] shrink-0 transition-colors ${willCancel ? "text-destructive font-semibold" : "text-muted-foreground"}`}
            style={{ transform: `translateX(${Math.max(dragX, -50)}px)` }}
          >
            {willCancel ? (
              <span className="inline-flex items-center gap-1"><X className="h-3 w-3" /> solte p/ cancelar</span>
            ) : (
              "‹ deslize p/ cancelar"
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


import { useCallback, useEffect, useRef, useState } from "react";
import {
  microphoneErrorMessage,
  openMicrophone,
  startVoiceCapture,
  watchInputLevel,
  type VoiceCapture,
} from "@/lib/audio/voice-note";

const MAX_SECONDS = 180;

/**
 * Pedido por voz para a Lume: tocar grava, tocar de novo envia, cancelar descarta.
 * Usa o mesmo gravador do Atendimento (formato certo para cada navegador).
 */
export function useLumeVoice(onAudio: (audio: Blob) => void) {
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const capture = useRef<VoiceCapture | null>(null);
  const stopLevel = useRef<(() => void) | null>(null);
  const timer = useRef<number | null>(null);
  const deliver = useRef(onAudio);
  deliver.current = onAudio;

  const release = useCallback(() => {
    stopLevel.current?.();
    stopLevel.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    setRecording(false);
    setLevel(0);
  }, []);

  useEffect(
    () => () => {
      capture.current?.abort();
      release();
    },
    [release],
  );

  const stop = useCallback(async () => {
    const current = capture.current;
    capture.current = null;
    if (!current) return;
    const audio = await current.stop();
    release();
    if (audio.size > 0) deliver.current(audio);
  }, [release]);

  const start = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      setError("Este navegador não permite gravar áudio aqui.");
      return;
    }
    try {
      stream.current = await openMicrophone();
      capture.current = await startVoiceCapture(stream.current);
      stopLevel.current = watchInputLevel(stream.current, setLevel);
      setSeconds(0);
      setRecording(true);
      const started = Date.now();
      timer.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - started) / 1000);
        setSeconds(elapsed);
        if (elapsed >= MAX_SECONDS) void stop();
      }, 250);
    } catch (failure) {
      release();
      setError(microphoneErrorMessage(failure));
    }
  }, [release, stop]);

  const cancel = useCallback(() => {
    capture.current?.abort();
    capture.current = null;
    release();
  }, [release]);

  return { recording, level, seconds, error, start, stop, cancel };
}

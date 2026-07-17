// Hook do player de áudio da biblioteca.
// Responsabilidades:
// - Manter um único <audio> ativo (troca de faixa pausa a anterior).
// - Buscar signed URL sob demanda e agendar renovação automática antes
//   da expiração (TTL = 10 min; renova 60s antes).
// - Recuperar-se de erros de rede via re-fetch da URL.
// - Emitir eventos observáveis sanitizados.

import { useCallback, useEffect, useRef, useState } from "react";
import { getSignedAudioUrlRich } from "@/lib/audio-library/audio-library-service";
import { logAudioEvent } from "./audio-observability";

const RENEW_GUARD_MS = 60 * 1000; // renova 60s antes de expirar
const MIN_RENEW_MS = 5 * 1000; // nunca agendar menos que 5s

interface Session {
  audioId: string;
  audio: HTMLAudioElement;
  renewTimer: number | null;
}

export interface AudioPlayerApi {
  /** id da faixa tocando OU pausada (permanece até troca ou stop). */
  activeId: string | null;
  /** true enquanto o <audio> está de fato reproduzindo. */
  isPlaying: boolean;
  /** true enquanto o hook está buscando/renovando URL. */
  isLoading: boolean;
  toggle: (audioId: string) => Promise<void>;
  stop: () => void;
}

export function useAudioPlayer(): AudioPlayerApi {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const sessionRef = useRef<Session | null>(null);

  const clearRenewTimer = useCallback(() => {
    if (sessionRef.current?.renewTimer != null) {
      window.clearTimeout(sessionRef.current.renewTimer);
      sessionRef.current.renewTimer = null;
    }
  }, []);

  const tearDown = useCallback(() => {
    clearRenewTimer();
    const s = sessionRef.current;
    if (s) {
      try {
        s.audio.pause();
      } catch {
        /* ignore */
      }
      s.audio.src = "";
      s.audio.removeAttribute("src");
      s.audio.load();
    }
    sessionRef.current = null;
    setActiveId(null);
    setIsPlaying(false);
    setIsLoading(false);
  }, [clearRenewTimer]);

  useEffect(() => tearDown, [tearDown]);

  /** Renova a signed URL preservando currentTime e estado de reprodução. */
  const renewUrl = useCallback(async (audioId: string): Promise<void> => {
    const s = sessionRef.current;
    if (!s || s.audioId !== audioId) return;
    try {
      setIsLoading(true);
      const fresh = await getSignedAudioUrlRich(audioId);
      if (!sessionRef.current || sessionRef.current.audioId !== audioId) return;
      const currentTime = s.audio.currentTime;
      const wasPlaying = !s.audio.paused;
      s.audio.src = fresh.url;
      // Restaura posição depois que os metadados carregarem.
      const onLoaded = () => {
        try {
          s.audio.currentTime = currentTime;
          if (wasPlaying) void s.audio.play();
        } catch {
          /* ignore */
        }
        s.audio.removeEventListener("loadedmetadata", onLoaded);
      };
      s.audio.addEventListener("loadedmetadata", onLoaded);
      scheduleRenew(audioId, fresh.expiresAt);
      logAudioEvent("signed_url_renewed", {
        audio_id: audioId,
        expires_at: fresh.expiresAt.toISOString(),
      });
    } catch (e) {
      logAudioEvent("signed_url_renew_failed", {
        audio_id: audioId,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduleRenew = useCallback(
    (audioId: string, expiresAt: Date) => {
      clearRenewTimer();
      const s = sessionRef.current;
      if (!s || s.audioId !== audioId) return;
      const ms = Math.max(
        MIN_RENEW_MS,
        expiresAt.getTime() - Date.now() - RENEW_GUARD_MS,
      );
      s.renewTimer = window.setTimeout(() => {
        void renewUrl(audioId);
      }, ms);
    },
    [clearRenewTimer, renewUrl],
  );

  const toggle = useCallback(
    async (audioId: string) => {
      const s = sessionRef.current;
      // Toggle pause/play na mesma faixa.
      if (s && s.audioId === audioId) {
        if (s.audio.paused) {
          try {
            await s.audio.play();
          } catch (e) {
            logAudioEvent("player_error", {
              audio_id: audioId,
              phase: "resume",
              error: e instanceof Error ? e.message : String(e),
            });
          }
        } else {
          s.audio.pause();
          logAudioEvent("player_paused", { audio_id: audioId });
        }
        return;
      }

      // Troca de faixa: tear down anterior.
      tearDown();
      setActiveId(audioId);
      setIsLoading(true);
      try {
        const signed = await getSignedAudioUrlRich(audioId);
        const audio = new Audio(signed.url);
        audio.preload = "none";
        audio.addEventListener("play", () => setIsPlaying(true));
        audio.addEventListener("pause", () => {
          if (audio.ended) return;
          setIsPlaying(false);
        });
        audio.addEventListener("ended", () => {
          setIsPlaying(false);
          logAudioEvent("player_ended", { audio_id: audioId });
        });
        audio.addEventListener("error", () => {
          logAudioEvent("player_error", {
            audio_id: audioId,
            phase: "playback",
            code: audio.error?.code,
          });
          // Tenta renovar em caso de erro de rede (URL possivelmente expirada).
          void renewUrl(audioId);
        });
        sessionRef.current = { audioId, audio, renewTimer: null };
        scheduleRenew(audioId, signed.expiresAt);
        await audio.play();
        logAudioEvent("player_started", { audio_id: audioId });
      } catch (e) {
        logAudioEvent("player_error", {
          audio_id: audioId,
          phase: "start",
          error: e instanceof Error ? e.message : String(e),
        });
        tearDown();
        throw e;
      } finally {
        setIsLoading(false);
      }
    },
    [renewUrl, scheduleRenew, tearDown],
  );

  return { activeId, isPlaying, isLoading, toggle, stop: tearDown };
}

// Observabilidade sanitizada da Biblioteca de Áudio (cliente).
// Nunca inclui signed URL completa, token ou payload sensível.

export type AudioObservabilityEvent =
  | "upload_started"
  | "upload_completed"
  | "upload_failed"
  | "upload_duplicate"
  | "player_started"
  | "player_ended"
  | "player_paused"
  | "player_error"
  | "signed_url_renewed"
  | "signed_url_renew_failed";

export function logAudioEvent(
  event: AudioObservabilityEvent,
  payload: Record<string, unknown> = {},
): void {
  try {
    // eslint-disable-next-line no-console
    console.info(`[audio-library:client] ${event}`, JSON.stringify(payload));
  } catch {
    // ignore — logging must never break UX
  }
}

// ============================================================================
// Áudio do cliente no turno da Vendedora.
//
// O webhook da Edge Function grava a mensagem de áudio como "[áudio]" e só
// depois (download + transcrição, alguns segundos) atualiza o texto com a
// transcrição. O trigger do agente dispara no INSERT, então o turno via o
// placeholder e acabava pedindo humano ("áudio sem transcrição"). O webhook
// TanStack transcreve antes do insert e usa "🎤 Áudio" quando falha.
// ============================================================================

export type LeadAudioState = "none" | "transcribed" | "pending" | "failed";

export interface LeadMessageForAudio {
  text: string | null;
  source_subtype?: string | null;
  source_metadata?: unknown;
}

const AUDIO_PLACEHOLDERS = new Set(["[áudio]", "[audio]", "🎤 áudio", "🎤 audio"]);

/** Resposta neutra quando não há transcrição (nenhuma promessa, nenhum fato). */
export const AUDIO_UNAVAILABLE_REPLY =
  "Não consegui ouvir seu áudio por aqui. Pode me escrever sua mensagem em texto?";

function metadataOf(message: LeadMessageForAudio): Record<string, unknown> {
  const value = message.source_metadata;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function isAudioPlaceholder(text: string | null | undefined): boolean {
  return AUDIO_PLACEHOLDERS.has((text ?? "").trim().toLowerCase());
}

export function classifyLeadAudio(message: LeadMessageForAudio): LeadAudioState {
  const metadata = metadataOf(message);
  const isAudio =
    message.source_subtype === "audio" ||
    metadata.media_kind === "audio" ||
    isAudioPlaceholder(message.text);
  if (!isAudio) return "none";
  const transcription =
    typeof metadata.transcription_text === "string" ? metadata.transcription_text.trim() : "";
  const stillPlaceholder = !(message.text ?? "").trim() || isAudioPlaceholder(message.text);
  if (transcription || !stillPlaceholder) return "transcribed";
  if (metadata.ai_media_error) return "failed";
  return "pending";
}

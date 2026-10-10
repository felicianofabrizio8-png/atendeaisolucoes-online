// Compatibilidade entre o FORMATO do conteúdo e o CANAL de publicação.
// Regra única (pura, sem IO) usada pela tela (quais destinos oferecer), pelo
// servidor (recusar antes de gravar o agendamento) e pela fila (dizer o
// motivo quando descarta um agendamento).
//
// A fila só publica no Instagram e no Facebook, e só os formatos abaixo.
// Conteúdo de WhatsApp (`whatsapp_cta`) é texto para conversa: não vira post.

export type PublishChannel = "instagram" | "facebook";

/** Formatos que a fila sabe publicar no Instagram e no Facebook. */
export const PUBLISHABLE_FORMATS = ["feed", "reel", "story", "carousel"] as const;

const FORMAT_NAME: Record<string, string> = { feed: "Feed", reel: "Reel", story: "Story", carousel: "Carrossel", whatsapp_cta: "WhatsApp" };
const CHANNEL_NAME: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", whatsapp: "WhatsApp" };

export function isPublishableFormat(format: unknown): boolean {
  return typeof format === "string" && (PUBLISHABLE_FORMATS as readonly string[]).includes(format);
}

/** Destinos de publicação automática que fazem sentido para o formato. */
export function publishChannelsFor(format: unknown): PublishChannel[] {
  return isPublishableFormat(format) ? ["instagram", "facebook"] : [];
}

/**
 * Motivo (texto para o usuário) pelo qual este formato não pode ir para este
 * canal, ou null. O canal WhatsApp não é restringido aqui: ele é só um
 * registro na agenda (a fila não envia WhatsApp) e segue como sempre foi.
 */
export function formatChannelProblem(format: unknown, channel: string): string | null {
  if (channel !== "instagram" && channel !== "facebook") return null;
  if (isPublishableFormat(format)) return null;
  const canal = CHANNEL_NAME[channel];
  if (format === "whatsapp_cta") {
    return `Este conteúdo é uma mensagem para WhatsApp e não pode ser publicado no ${canal}. Para publicar no ${canal}, crie um conteúdo de Feed, Story, Reel ou Carrossel.`;
  }
  const nome = typeof format === "string" && format ? (FORMAT_NAME[format] ?? format) : "desconhecido";
  return `O formato deste conteúdo (${nome}) não pode ser publicado no ${canal}. Formatos aceitos: Feed, Story, Reel e Carrossel.`;
}

/** Texto curto para o card de um conteúdo que não tem destino de publicação automática. */
export function noPublishTargetHint(format: unknown): string {
  return format === "whatsapp_cta"
    ? "Mensagem para WhatsApp: não é publicada no Instagram nem no Facebook. Copie o texto para usar na conversa."
    : "Este formato não é publicado automaticamente no Instagram nem no Facebook.";
}

export type ScheduleRejection = "format_not_publishable" | "carousel_publish_disabled";

/** Por que a fila descarta um agendamento aprovado, de canal válido, sem formato publicável. */
export function scheduleRejectionReason(format: unknown): ScheduleRejection {
  return format === "carousel" ? "carousel_publish_disabled" : "format_not_publishable";
}

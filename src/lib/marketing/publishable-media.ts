// ============================================================================
// Mídia publicável de um conteúdo — a MESMA ordem que o publicador usa para
// escolher o que enviar à Meta (`MetaPublisher.resolvePrimaryMedia`):
//
//   0. vídeo renderizado da campanha para o formato (Feed → feed_video_id;
//      Story/Reel → story_video_id), guardado em `video_library`;
//   1. mídias do acervo de marketing (`media_ids`);
//   2. fotos de produto (`ai_prompt.product_media_refs`);
//   3. primeira foto do produto vinculado (`product_id`).
//
// A validação de agendar/publicar (tela e servidor) usa este helper para não
// recusar um conteúdo que o publicador conseguiria publicar — e para dizer o
// motivo certo quando realmente falta mídia.
// ============================================================================

export interface PublishableContent {
  campaign_id?: string | null;
  format?: string | null;
  media_ids?: string[] | null;
  ai_prompt?: unknown;
  product_id?: string | null;
  feed_video_id?: string | null;
  story_video_id?: string | null;
}

export type PublishableMediaSource = "rendered_video" | "marketing_media" | "product_media_refs" | "product";

/** Vídeo renderizado que vale para o formato do conteúdo (mesma regra do publicador). */
export function renderedVideoIdFor(content: PublishableContent): string | null {
  const id = content.format === "feed" ? content.feed_video_id : content.story_video_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** Primeira fonte de mídia que o publicador encontraria; null = nada a publicar. */
export function publishableMediaSource(content: PublishableContent): PublishableMediaSource | null {
  if (renderedVideoIdFor(content)) return "rendered_video";
  if (Array.isArray(content.media_ids) && content.media_ids.length > 0) return "marketing_media";
  const prompt = content.ai_prompt && typeof content.ai_prompt === "object" ? (content.ai_prompt as { product_media_refs?: unknown }) : null;
  if (Array.isArray(prompt?.product_media_refs) && prompt.product_media_refs.length > 0) return "product_media_refs";
  if (typeof content.product_id === "string" && content.product_id.length > 0) return "product";
  return null;
}

/**
 * Mensagem para quando não há mídia publicável. Conteúdo de campanha de vídeo
 * sem vídeo pronto não deve pedir para "selecionar uma imagem": o que falta é
 * gerar o vídeo.
 */
export function missingMediaMessage(content: PublishableContent, canal: string): string {
  const isCampaignVideo = !!content.campaign_id && content.format !== "whatsapp_cta";
  return isCampaignVideo
    ? `O vídeo desta publicação ainda não foi gerado. Gere o vídeo antes de agendar para o ${canal}.`
    : `Selecione ao menos uma imagem ou vídeo (biblioteca ou produto) antes de agendar para o ${canal}.`;
}

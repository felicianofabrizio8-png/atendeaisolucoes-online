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
  /** Documento do Estúdio Criativo (carrossel ou arte), quando o conteúdo veio de lá. */
  design?: unknown;
}

/** Conteúdo do Estúdio Criativo cuja imagem final é gerada no botão Concluir. */
export function isStudioImageContent(content: PublishableContent): boolean {
  const kind = content.design && typeof content.design === "object" ? (content.design as { kind?: unknown }).kind : null;
  return kind === "art" || kind === "carousel";
}

export const STUDIO_EXPORT_NEEDED_MESSAGE =
  "Esta peça ainda não tem a imagem final (ela foi criada ou alterada depois da última exportação). Abra o conteúdo em Editar no estúdio e clique em Concluir para gerar a imagem antes de publicar.";

export type PublishableMediaSource = "rendered_video" | "marketing_media" | "product_media_refs" | "product";

/**
 * Vídeo renderizado que vale para o formato do conteúdo. ÚNICA definição,
 * usada pela tela, pelo agendamento e pelo publicador:
 *   Feed          → `feed_video_id`  (1080x1350);
 *   Story e Reel  → `story_video_id` (vertical, 1080x1920).
 */
export function renderedVideoIdFor(content: PublishableContent): string | null {
  const id = content.format === "feed" ? content.feed_video_id : content.story_video_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** Formatos que só existem como vídeo. Um Reel nunca é publicado com imagem. */
export function requiresVideo(format: unknown): boolean {
  return format === "reel";
}

/**
 * Situação do vídeo de um conteúdo que exige vídeo:
 * - "not_required": o formato aceita imagem;
 * - "ready": há um vídeo renderizado ou um vídeo do acervo;
 * - "missing": não há vídeo — o conteúdo é só o roteiro;
 * - "unknown": há mídias do acervo, mas quem chama não sabe o tipo delas
 *   (a tela). O servidor, que consulta o acervo, sempre resolve.
 *
 * `mediaTypes` = tipos (`image`/`video`) das mídias ATIVAS de `media_ids`.
 * Foto de produto não conta: não é vídeo.
 */
export type VideoRequirement = "not_required" | "ready" | "missing" | "unknown";
export function videoRequirementStatus(content: PublishableContent, mediaTypes?: readonly string[]): VideoRequirement {
  if (!requiresVideo(content.format)) return "not_required";
  if (renderedVideoIdFor(content)) return "ready";
  if (mediaTypes) return mediaTypes.includes("video") ? "ready" : "missing";
  return Array.isArray(content.media_ids) && content.media_ids.length > 0 ? "unknown" : "missing";
}

export const REEL_NEEDS_VIDEO_MESSAGE =
  "Este Reel ainda é só o roteiro: falta produzir o vídeo. Um Reel só pode ser publicado ou agendado com um vídeo pronto.";
export const REEL_SCRIPT_HINT =
  "Roteiro de Reel — ainda falta produzir o vídeo. Use o texto para gravar; ele só pode ser publicado quando tiver um vídeo.";

/** Primeira fonte de mídia que o publicador encontraria; null = nada a publicar. */
export function publishableMediaSource(content: PublishableContent): PublishableMediaSource | null {
  if (renderedVideoIdFor(content)) return "rendered_video";
  if (Array.isArray(content.media_ids) && content.media_ids.length > 0) return "marketing_media";
  // Reel: foto de produto não serve de mídia (o publicador não troca vídeo por imagem).
  if (requiresVideo(content.format)) return null;
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
  if (requiresVideo(content.format)) return REEL_NEEDS_VIDEO_MESSAGE;
  if (isStudioImageContent(content)) return STUDIO_EXPORT_NEEDED_MESSAGE;
  const isCampaignVideo = !!content.campaign_id && content.format !== "whatsapp_cta";
  return isCampaignVideo
    ? `O vídeo desta publicação ainda não foi gerado. Gere o vídeo antes de agendar para o ${canal}.`
    : `Selecione ao menos uma imagem ou vídeo (biblioteca ou produto) antes de agendar para o ${canal}.`;
}

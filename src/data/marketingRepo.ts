// Client-side helpers for the Marketing AI module.
// - Chama server functions para toda mutação.
// - Uploads passam pelo bucket privado `marketing-media` com prefixo por empresa.

import { getStudioContent, listStudioSources, proposeStudioCarousel, saveStudioContent } from "@/lib/marketing/studio/studio.functions";
import type { StudioDocument } from "@/lib/marketing/studio/document";
import { supabase } from "@/integrations/supabase/client";
import { getSignedImageUrl, getSignedMediaUrl } from "@/lib/storage";
import type { MediaResolverDeps } from "@/lib/marketing/campaign-media";
import { getVideoSignedUrl } from "@/lib/render-engine/render-job.functions";
import {
  registerMarketingMedia,
  listMarketingMedia,
  getMarketingMediaPaths,
  updateMarketingMedia,
  softDeleteMarketingMedia,
  upsertMarketingPromotion,
  listMarketingPromotions,
  deleteMarketingPromotion,
  listMarketingContents,
  listMarketingPublishContents,
  previewMarketingCleanup,
  archiveMarketingCleanup,
  updateMarketingContent,
  setMarketingContentStatus,
  scheduleMarketingContent,
  listMarketingSchedule,
  listMarketingPublishSchedule,
  cancelMarketingSchedule,
  getFacebookPublishReadiness,
} from "@/lib/marketing/marketing.functions";
import { generateMarketingContent, generateSimpleMarketingPost } from "@/lib/marketing/marketing-ai.functions";
import {
  generateMarketingCampaign,
  generateManualCampaign,
  getCampaignRenderStatus,
  retryCampaignRender,
  regenerateCampaignTexts,
  approveCampaignAndRender,
} from "@/lib/marketing/marketing-campaign.functions";
import type {
  ManualCampaignFields,
  ManualCampaignFormats,
} from "@/lib/marketing/manual-campaign";
import type {
  MarketingMediaRow,
  MarketingPromotionRow,
  MarketingContentRow,
  MarketingScheduleRow,
} from "@/lib/marketing/marketing.types";

const BUCKET = "marketing-media";

function extForMime(mime: string, fallback = "bin"): string {
  const m = mime.toLowerCase();
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  if (m.includes("mp4")) return "mp4";
  if (m.includes("quicktime") || m.includes("mov")) return "mov";
  if (m.includes("webm")) return "webm";
  return fallback;
}

/** Upload de arquivo para o bucket marketing-media. Devolve o path final. */
export async function uploadMarketingFile(
  companyId: string,
  file: File,
): Promise<string> {
  const ext = extForMime(file.type, file.name.split(".").pop() ?? "bin");
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `${companyId}/marketing/${id}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return path;
}

export async function urlForMarketingPath(path: string, options: { fresh?: boolean } = {}): Promise<string | null> {
  return getSignedMediaUrl(BUCKET, path, options);
}

/** Link temporário do vídeo renderizado (video_library), validado no servidor por empresa. */
export async function apiGetRenderedVideoUrl(videoId: string): Promise<{ url: string; expires_in: number }> {
  return getVideoSignedUrl({ data: { id: videoId } });
}

/** Dependências reais do resolvedor de imagens de campanha (ver campaign-media.ts). */
export const campaignMediaDeps: MediaResolverDeps = {
  mediaPaths: async (ids) => (await getMarketingMediaPaths({ data: { ids } })).paths,
  signMarketing: (storagePath, fresh) => urlForMarketingPath(storagePath, { fresh }),
  signProduct: async (imagePath, fresh) => (await getSignedImageUrl(imagePath, { fresh })) || null,
};

// ------- Media -------
export async function apiListMedia(query: { limit?: number; offset?: number } = {}): Promise<MarketingMediaRow[]> {
  const res = await listMarketingMedia({ data: query });
  return (res.media ?? []) as unknown as MarketingMediaRow[];
}
export async function apiRegisterMedia(args: {
  storage_path: string;
  media_type: "image" | "video";
  mime_type?: string | null;
  size_bytes?: number | null;
  width?: number | null;
  height?: number | null;
  duration_seconds?: number | null;
  title?: string | null;
  description?: string | null;
  tags?: string[];
}): Promise<MarketingMediaRow> {
  return (await registerMarketingMedia({ data: args })) as unknown as MarketingMediaRow;
}
export async function apiUpdateMedia(args: {
  id: string;
  title?: string | null;
  description?: string | null;
  tags?: string[];
  active?: boolean;
}) {
  return updateMarketingMedia({ data: args });
}
export async function apiDeleteMedia(id: string) {
  return softDeleteMarketingMedia({ data: { id } });
}

// ------- Promotions -------
export async function apiListPromotions(): Promise<MarketingPromotionRow[]> {
  const res = await listMarketingPromotions();
  return (res.promotions ?? []) as unknown as MarketingPromotionRow[];
}
export async function apiUpsertPromotion(
  input: {
    id?: string;
    title: string;
    description?: string | null;
    price_original?: number | null;
    price_promo?: number | null;
    discount_percent?: number | null;
    starts_at?: string | null;
    ends_at?: string | null;
    whatsapp_cta_text?: string | null;
    whatsapp_destination?: string | null;
    product_id?: string | null;
    cover_media_id?: string | null;
    status?: "draft" | "active" | "paused" | "ended";
  },
): Promise<MarketingPromotionRow> {
  return (await upsertMarketingPromotion({ data: input })) as unknown as MarketingPromotionRow;
}
export async function apiDeletePromotion(id: string) {
  return deleteMarketingPromotion({ data: { id } });
}

// ------- Contents -------
export async function apiListContents(): Promise<MarketingContentRow[]> {
  const res = await listMarketingContents();
  return (res.contents ?? []) as unknown as MarketingContentRow[];
}
export async function apiListPublishContents(): Promise<MarketingContentRow[]> {
  const res = await listMarketingPublishContents();
  return (res.contents ?? []) as unknown as MarketingContentRow[];
}

export type MarketingCleanupStatus = "draft" | "pending" | "approved" | "rejected" | "archived";

export async function apiPreviewMarketingCleanup(input: { statuses: MarketingCleanupStatus[]; before: string }) {
  return previewMarketingCleanup({ data: input });
}

export async function apiArchiveMarketingCleanup(input: { statuses: MarketingCleanupStatus[]; before: string; ids: string[] }) {
  return archiveMarketingCleanup({ data: input });
}
export async function apiUpdateContent(input: {
  id: string;
  title?: string | null;
  body?: string;
  hashtags?: string[];
  cta_text?: string | null;
  cta_destination?: string | null;
}) {
  return updateMarketingContent({ data: input });
}
export async function apiSetContentStatus(input: {
  id: string;
  status: "draft" | "pending" | "approved" | "rejected" | "archived";
  rejection_reason?: string | null;
}) {
  return setMarketingContentStatus({ data: input });
}

// ------- AI -------
export async function apiGenerateContent(input: {
  promotion_id?: string | null;
  product_id?: string | null;
  media_ids?: string[];
  product_media_refs?: Array<{ product_id: string; image_path: string }>;
  tone?: "amigável" | "profissional" | "descontraído" | "urgente";
  audience?: string | null;
  extra_instructions?: string | null;
}): Promise<MarketingContentRow[]> {
  const res = await generateMarketingContent({ data: input });
  return (res.contents ?? []) as unknown as MarketingContentRow[];
}

export async function apiGenerateSimpleMarketingPost(input: {
  media_mode: "photo" | "uploaded_video";
  media_ids: [string];
  campaign_formats?: "feed" | "story" | "feed_story";
  promotion_id?: string | null;
  tone?: "amigável" | "profissional" | "descontraído" | "urgente";
  audience?: string | null;
  extra_instructions?: string | null;
}): Promise<{ contents: MarketingContentRow[] }> {
  const res = await generateSimpleMarketingPost({ data: input });
  return { contents: (res.contents ?? []) as unknown as MarketingContentRow[] };
}
// ------- Schedule -------
export async function apiListSchedule(): Promise<MarketingScheduleRow[]> {
  const res = await listMarketingSchedule();
  return (res.schedule ?? []) as unknown as MarketingScheduleRow[];
}
export async function apiListPublishSchedule(): Promise<MarketingScheduleRow[]> {
  const res = await listMarketingPublishSchedule();
  return (res.schedule ?? []) as unknown as MarketingScheduleRow[];
}
export async function apiScheduleContent(input: {
  content_id: string;
  channel: "instagram" | "facebook" | "whatsapp";
  /** Horário escolhido ao agendar. Em `publish_now` o servidor define o horário. */
  scheduled_at?: string;
  publish_now?: boolean;
  notes?: string | null;
}) {
  return scheduleMarketingContent({ data: input });
}
export async function apiCancelSchedule(id: string) {
  return cancelMarketingSchedule({ data: { id } });
}

// ------- Facebook publish readiness -------
export async function apiFacebookPublishReadiness() {
  return getFacebookPublishReadiness();
}

// ------- Campaign (Fase C.1 / C.2) -------
export type CampaignPrimaryImage =
  | { origin: "marketing"; media_id: string }
  | { origin: "product"; product_id: string; image_path: string };

export interface FocalPointInput {
  x: number;
  y: number;
  zoom: number;
  /** "contain" = imagem inteira na área do modelo; ausente = "cover" (formato antigo). */
  fit?: "contain" | "cover";
  /** Preenchimento do que a imagem não cobre. */
  fill?: "blur" | "color";
}

/** Item da lista de imagens da campanha (fase C.2). */
export type CampaignImageInput =
  | { origin: "marketing"; media_id: string; focal_point?: FocalPointInput | null }
  | {
      origin: "product";
      product_id: string;
      image_path: string;
      focal_point?: FocalPointInput | null;
    };

export async function apiGenerateCampaign(input: {
  promotion_id?: string | null;
  /** Legado — se ausente, use `images`. */
  primary_image?: CampaignPrimaryImage;
  /** Novo — lista ordenada; primeira é a principal. */
  images?: CampaignImageInput[];
  primary_audio_id: string;
  audio_start_second?: number;
  duration_seconds?: 8 | 10 | 15 | 30 | 60;
  tone?: "amigável" | "profissional" | "descontraído" | "urgente";
  audience?: string | null;
  extra_instructions?: string | null;
  /** Seleção de formatos (mesmo contrato do modo manual). */
  formats?: "feed" | "story" | "feed_story";
}) {
  return generateMarketingCampaign({ data: input });
}

export async function apiGetCampaignRenderStatus(campaign_id: string) {
  return getCampaignRenderStatus({ data: { campaign_id } });
}

/**
 * Modo Manual — cria a campanha sem chamar a IA (não consome créditos).
 * Devolve o mesmo formato do modo IA para reuso do editor de aprovação.
 */
export async function apiGenerateManualCampaign(input: {
  promotion_id?: string | null;
  images: CampaignImageInput[];
  primary_audio_id: string;
  audio_start_second?: number;
  duration_seconds?: 8 | 10 | 15 | 30 | 60;
  fields: ManualCampaignFields;
  formats?: ManualCampaignFormats;
  theme?: string | null;
  template?: string | null;
}) {
  return generateManualCampaign({ data: input });
}


export async function apiRetryCampaignRender(input: {
  campaign_id: string;
  role: "feed" | "story";
}) {
  return retryCampaignRender({ data: input });
}



// ------- Campaign approval-gate (revisar antes de renderizar) -------
export async function apiRegenerateCampaignTexts(input: { campaign_id: string }) {
  return regenerateCampaignTexts({ data: input });
}

export async function apiApproveCampaignAndRender(input: {
  campaign_id: string;
  headline: string;
  subheadline?: string | null;
  cta?: string | null;
  layout?: Record<string, unknown> | null;
  template?: string | null;
  images?: CampaignImageInput[];
  duration_seconds?: number;
}) {
  return approveCampaignAndRender({ data: input });
}

// ------- Estúdio Criativo (carrossel e arte) -------
export async function apiSaveStudioContent(input: {
  id?: string;
  title?: string | null;
  caption?: string;
  document: StudioDocument;
  exported_media_ids?: string[];
}): Promise<MarketingContentRow> {
  const res = await saveStudioContent({ data: input });
  return res.content as unknown as MarketingContentRow;
}

export async function apiListStudioSources(): Promise<{ products: Array<{ id: string; name: string }>; promotions: Array<{ id: string; title: string }> }> {
  return listStudioSources();
}

/** Proposta montada só com dados do cadastro (sem IA, sem gravar nada). */
export async function apiProposeStudioCarousel(input: {
  product_id?: string | null;
  promotion_id?: string | null;
  recipe?: string;
  format?: "portrait" | "square";
}): Promise<{ document: unknown; used: { has_price: boolean; has_discount: boolean; images: number } }> {
  return proposeStudioCarousel({ data: input });
}

export async function apiGetStudioContent(id: string): Promise<MarketingContentRow> {
  const res = await getStudioContent({ data: { id } });
  return res.content as unknown as MarketingContentRow;
}

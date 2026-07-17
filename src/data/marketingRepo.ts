// Client-side helpers for the Marketing AI module.
// - Chama server functions para toda mutação.
// - Uploads passam pelo bucket privado `marketing-media` com prefixo por empresa.

import { supabase } from "@/integrations/supabase/client";
import { getSignedMediaUrl } from "@/lib/storage";
import {
  registerMarketingMedia,
  listMarketingMedia,
  updateMarketingMedia,
  softDeleteMarketingMedia,
  upsertMarketingPromotion,
  listMarketingPromotions,
  deleteMarketingPromotion,
  listMarketingContents,
  updateMarketingContent,
  setMarketingContentStatus,
  scheduleMarketingContent,
  listMarketingSchedule,
  cancelMarketingSchedule,
  getFacebookPublishReadiness,
} from "@/lib/marketing/marketing.functions";
import { generateMarketingContent } from "@/lib/marketing/marketing-ai.functions";
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

export async function urlForMarketingPath(path: string): Promise<string | null> {
  return getSignedMediaUrl(BUCKET, path);
}

// ------- Media -------
export async function apiListMedia(): Promise<MarketingMediaRow[]> {
  const res = await listMarketingMedia();
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

// ------- Schedule -------
export async function apiListSchedule(): Promise<MarketingScheduleRow[]> {
  const res = await listMarketingSchedule();
  return (res.schedule ?? []) as unknown as MarketingScheduleRow[];
}
export async function apiScheduleContent(input: {
  content_id: string;
  channel: "instagram" | "facebook" | "whatsapp";
  scheduled_at: string;
  notes?: string | null;
}) {
  return scheduleMarketingContent({ data: input });
}
export async function apiCancelSchedule(id: string) {
  return cancelMarketingSchedule({ data: { id } });
}

// Shared types for the Marketing AI module (Phase 1).
// Server functions and client repos both import from here.

export type MarketingMediaType = "image" | "video";
export type MarketingPromotionStatus = "draft" | "active" | "paused" | "ended";
export type MarketingContentStatus =
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "archived";
export type MarketingContentChannel = "instagram" | "facebook" | "whatsapp";
export type MarketingContentFormat = "story" | "feed" | "reel" | "whatsapp_cta";
export type MarketingScheduleStatus = "planned" | "published" | "cancelled";

export interface MarketingMediaRow {
  id: string;
  company_id: string;
  storage_path: string;
  media_type: MarketingMediaType;
  mime_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  title: string | null;
  description: string | null;
  tags: string[];
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface MarketingPromotionRow {
  id: string;
  company_id: string;
  title: string;
  description: string | null;
  price_original: number | null;
  price_promo: number | null;
  discount_percent: number | null;
  starts_at: string | null;
  ends_at: string | null;
  whatsapp_cta_text: string | null;
  whatsapp_destination: string | null;
  product_id: string | null;
  cover_media_id: string | null;
  status: MarketingPromotionStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MarketingContentRow {
  id: string;
  company_id: string;
  promotion_id: string | null;
  product_id: string | null;
  media_ids: string[];
  channel: MarketingContentChannel;
  format: MarketingContentFormat;
  title: string | null;
  body: string;
  hashtags: string[];
  cta_text: string | null;
  cta_destination: string | null;
  ai_model: string | null;
  ai_prompt: unknown;
  ai_raw_output: unknown;
  status: MarketingContentStatus;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MarketingScheduleRow {
  id: string;
  company_id: string;
  content_id: string;
  channel: MarketingContentChannel;
  scheduled_at: string;
  status: MarketingScheduleStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Shape returned by the AI generator (single structured call, 4 formats).
export interface GeneratedContentBundle {
  story: { title: string; body: string; hashtags: string[] };
  feed: { title: string; body: string; hashtags: string[] };
  reel: { title: string; body: string; hashtags: string[] };
  whatsapp: { title: string; body: string; cta_text: string };
}

export interface MarketingKnowledgeBaseRow {
  id: string;
  company_id: string;
  brand_identity: string;
  tone_of_voice: string;
  differentiators: string;
  products_services: string;
  guarantees: string;
  cities_served: string;
  gifts: string;
  commercial_terms: string;
  preferred_words: string;
  forbidden_words: string;
  copy_best_practices: string;
  extra_notes: string;
  updated_at: string;
  updated_by: string | null;
}


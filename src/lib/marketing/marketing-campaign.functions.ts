// ============================================================================
// Marketing Campaign — server functions (Fase C.2)
//
// Uma "campanha" reune sob um mesmo campaign_id os textos e vídeos dos
// formatos 'feed' (4:5, 1080x1350) e 'story' (9:16, 1080x1920).
//
// Fase C.2 adiciona:
//  - Múltiplas imagens ordenadas por campanha (1..MAX_CAMPAIGN_IMAGES).
//    Payload legado `primary_image` (1 imagem) continua aceito.
//  - Focal point real por imagem (aplicado no ffmpeg do worker).
//
// Retrocompatibilidade:
//  * As colunas antigas de video_render_jobs (image_source/image_id/product_id/
//    product_image_path) continuam preenchidas com a imagem PRIMÁRIA
//    (primary=true), garantindo comportamento idêntico ao atual quando N=1.
//  * image_sequence só é gravada quando há mais de 1 imagem OU quando há
//    focal_point definido em algum item (para preservar o crop escolhido).
//  * focal_point (coluna direta) espelha o da imagem primária, para leitura
//    rápida pelo worker.
// ============================================================================

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { generateMarketingContent } from "./marketing-ai.functions";
import type {
  MarketingContentRow,
  MarketingContentFormat,
} from "./marketing.types";
import type {
  VideoFormat,
  RenderJobRow,
  FocalPoint,
  RenderImageSequenceItem,
} from "@/lib/render-engine/render.types";
import { MAX_CAMPAIGN_IMAGES } from "@/lib/render-engine/render.types";
import {
  buildVideoBrandSnapshot,
  type VideoBrandSnapshot,
} from "@/lib/render-engine/video-brand-snapshot";
import {
  resolveOverlayContentFromRow,
  type MarketingRowOverlaySource,
} from "./overlay-content-resolver";

type SB = SupabaseClient<Database>;

const RENDER_DURATIONS = [8, 10, 15, 30, 60] as const;
type RenderDuration = (typeof RENDER_DURATIONS)[number];

// ---------------------------------------------------------------- schemas

const FocalPointSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    zoom: z.number().min(1).max(3).default(1),
  })
  .strict();

const PrimaryImageSchema = z.union([
  z.object({ origin: z.literal("marketing"), media_id: z.string().uuid() }),
  z.object({
    origin: z.literal("product"),
    product_id: z.string().uuid(),
    image_path: z.string().min(1).max(500),
  }),
]);

const CampaignImageSchema = z
  .object({
    origin: z.enum(["marketing", "product"]),
    media_id: z.string().uuid().optional(),
    product_id: z.string().uuid().optional(),
    image_path: z.string().min(1).max(500).optional(),
    focal_point: FocalPointSchema.optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.origin === "marketing" && !v.media_id) {
      ctx.addIssue({ code: "custom", message: "media_id_required" });
    }
    if (v.origin === "product" && (!v.product_id || !v.image_path)) {
      ctx.addIssue({ code: "custom", message: "product_ref_required" });
    }
  });

export const GenerateCampaignInput = z
  .object({
    promotion_id: z.string().uuid().nullable().optional(),
    // Legado (mantido):
    primary_image: PrimaryImageSchema.optional(),
    // Novo (fase C.2):
    images: z.array(CampaignImageSchema).min(1).max(MAX_CAMPAIGN_IMAGES).optional(),
    primary_audio_id: z.string().uuid(),
    audio_start_second: z.number().int().min(0).max(3600).default(0),
    duration_seconds: z
      .number()
      .int()
      .refine((v): v is RenderDuration => (RENDER_DURATIONS as readonly number[]).includes(v), {
        message: "duration_seconds_not_allowed",
      })
      .default(15),
    tone: z
      .enum(["amigável", "profissional", "descontraído", "urgente"])
      .default("amigável"),
    audience: z.string().trim().max(300).nullable().optional(),
    extra_instructions: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((v) => !!v.primary_image || (v.images && v.images.length > 0), {
    message: "primary_image_or_images_required",
  });

export type CampaignRoleFeedStory = "feed" | "story";

const CAMPAIGN_ROLE_TO_VIDEO_FORMAT: Record<CampaignRoleFeedStory, VideoFormat> = {
  feed: "feed_4_5",
  story: "story",
};

// ---------------------------------------------------------------- helpers

async function resolveCompanyId(supabase: SB, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data?.company_id) throw new Error("company_not_found");
  return data.company_id;
}

type ImageOwnershipRef =
  | { source: "marketing_media"; image_id: string }
  | { source: "product_image"; product_id: string; product_image_path: string };

interface ValidatedImage {
  ref: ImageOwnershipRef;
  focalPoint: FocalPoint | null;
  /** Snapshot para gravar em image_sequence. */
  sequenceItem: RenderImageSequenceItem;
}

/** Valida uma imagem individual — ownership + tipo + ativo. */
async function validateOneImage(
  supabase: SB,
  companyId: string,
  it: z.infer<typeof CampaignImageSchema>,
  position: number,
  primary: boolean,
): Promise<ValidatedImage> {
  if (it.origin === "marketing") {
    const { data, error } = await supabase
      .from("marketing_media")
      .select("id, company_id, active, media_type")
      .eq("id", it.media_id!)
      .maybeSingle();
    if (error || !data) throw new Error("image_not_found");
    if (data.company_id !== companyId) throw new Error("image_cross_tenant");
    if (!data.active) throw new Error("image_inactive");
    if (data.media_type !== "image") throw new Error("image_wrong_type");
    const ref: ImageOwnershipRef = { source: "marketing_media", image_id: data.id };
    const focal = it.focal_point ?? null;
    return {
      ref,
      focalPoint: focal,
      sequenceItem: {
        position,
        primary,
        source: "marketing_media",
        image_id: data.id,
        focal_point: focal,
      },
    };
  }
  const { data: prod, error } = await supabase
    .from("products")
    .select("id, company_id, images")
    .eq("id", it.product_id!)
    .maybeSingle();
  if (error || !prod) throw new Error("product_not_found");
  if (prod.company_id !== companyId) throw new Error("product_cross_tenant");
  const images = Array.isArray(prod.images)
    ? (prod.images.filter((x) => typeof x === "string") as string[])
    : [];
  if (!images.includes(it.image_path!)) throw new Error("product_image_not_owned");
  const focal = it.focal_point ?? null;
  return {
    ref: {
      source: "product_image",
      product_id: prod.id,
      product_image_path: it.image_path!,
    },
    focalPoint: focal,
    sequenceItem: {
      position,
      primary,
      source: "product_image",
      product_id: prod.id,
      product_image_path: it.image_path!,
      focal_point: focal,
    },
  };
}

/** Normaliza payload em lista de imagens (converte legado → novo internamente). */
function normalizeImages(
  data: z.infer<typeof GenerateCampaignInput>,
): Array<z.infer<typeof CampaignImageSchema>> {
  if (data.images && data.images.length > 0) return data.images;
  const p = data.primary_image!;
  if (p.origin === "marketing") return [{ origin: "marketing", media_id: p.media_id }];
  return [
    { origin: "product", product_id: p.product_id, image_path: p.image_path },
  ];
}

async function assertPrimaryAudio(
  supabase: SB,
  companyId: string,
  audioId: string,
  startSecond: number,
  durationSeconds: number,
): Promise<void> {
  const { data, error } = await supabase
    .from("audio_library")
    .select("id, company_id, is_active, duration_seconds")
    .eq("id", audioId)
    .maybeSingle();
  if (error || !data) throw new Error("audio_not_found");
  if (data.company_id !== companyId) throw new Error("audio_cross_tenant");
  if (!data.is_active) throw new Error("audio_inactive");
  const total = Number(data.duration_seconds ?? 0);
  if (!Number.isFinite(total) || total <= 0) throw new Error("audio_duration_invalid");
  if (startSecond + durationSeconds > total + 0.001) {
    throw new Error("audio_slice_exceeds_duration");
  }
}

interface EnsureJobArgs {
  companyId: string;
  userId: string;
  role: CampaignRoleFeedStory;
  primaryImage: ImageOwnershipRef;
  primaryFocalPoint: FocalPoint | null;
  imageSequence: RenderImageSequenceItem[] | null;
  audioId: string;
  audioStart: number;
  duration: number;
  existingJobId: string | null;
  /**
   * Fase 5.B1 — textos determinísticos para o Brand Composer do worker.
   * Todos opcionais; ausente = renderiza sem painel/tela final (só watermark).
   */
  content?: {
    headline?: string | null;
    supportingText?: string | null;
    ctaText?: string | null;
    companyName?: string | null;
  } | null;
}


/**
 * Constrói as colunas de marca (brand_version_id + video_brand) para o
 * INSERT em video_render_jobs. Reutiliza os helpers oficiais do Brand Center
 * (loadBrandContextForCompany + buildVideoBrandSnapshot) — ponto único de
 * verdade, o mesmo já usado por createRenderJob (Fase 5.A).
 *
 * Regras:
 *  - Empresa sem marca publicada → retorna {} (job segue sem watermark).
 *  - Falha ao carregar Brand Center → retorna {} e loga (não bloqueia o job).
 *  - Nunca loga signed URL, sourceUrl, storage_path ou payload completo.
 */
async function prepareMarketingVideoBrandColumns(params: {
  supabase: SB;
  companyId: string;
  videoFormat: VideoFormat;
  correlationId: string;
  /** Fase 5.B1 — textos determinísticos que alimentam o Brand Composer. */
  content?: {
    headline?: string | null;
    supportingText?: string | null;
    ctaText?: string | null;
    companyName?: string | null;
  } | null;
}): Promise<
  | { brand_version_id: string; video_brand: VideoBrandSnapshot }
  | Record<string, never>
> {
  const { supabase, companyId, videoFormat, correlationId, content } = params;
  // eslint-disable-next-line no-console
  console.info(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      event: "marketing_render_brand_snapshot_start",
      company_id: companyId,
      correlation_id: correlationId,
      video_format: videoFormat,
      has_content: !!(content?.headline || content?.ctaText || content?.companyName),
    }),
  );
  try {
    const { loadBrandContextForCompany } = await import(
      "@/lib/brand-center/brand-consumer.server"
    );
    const brandCtx = await loadBrandContextForCompany(supabase, companyId);
    // eslint-disable-next-line no-console
    console.info(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        event: "marketing_render_brand_context_loaded",
        company_id: companyId,
        correlation_id: correlationId,
        is_fallback: brandCtx.isFallback,
        brand_profile_id: brandCtx.profileId ?? null,
        brand_version_id: brandCtx.versionId ?? null,
        status: brandCtx.status,
        has_logo: Boolean(brandCtx.assets.byType.logo_primary),
      }),
    );
    const snapshot = buildVideoBrandSnapshot({
      brandContext: brandCtx,
      videoFormat,
      content: content ?? null,
    });

    // eslint-disable-next-line no-console
    console.info(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        event: "marketing_render_brand_snapshot_built",
        company_id: companyId,
        correlation_id: correlationId,
        has_snapshot: Boolean(snapshot),
        brand_version_id: snapshot?.brandVersionId ?? null,
        watermark_enabled: snapshot?.watermark?.enabled ?? false,
        null_reason: snapshot
          ? null
          : brandCtx.isFallback
            ? "brand_context_is_fallback"
            : !brandCtx.versionId
              ? "brand_context_missing_version_id"
              : "unknown",
      }),
    );
    if (!snapshot) return {};
    return { brand_version_id: snapshot.brandVersionId, video_brand: snapshot };
  } catch (err) {
    const errorName = err instanceof Error ? err.name : "UnknownError";
    const rawMessage = err instanceof Error ? err.message : String(err);
    const sanitizedMessage = rawMessage
      .replace(/https?:\/\/\S+/gi, "[url]")
      .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[jwt]")
      .slice(0, 240);
    const errorCode = rawMessage.split(":")[0]?.slice(0, 80) ?? "unknown";
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        event: "marketing_render_brand_snapshot_failed",
        company_id: companyId,
        correlation_id: correlationId,
        error_name: errorName,
        error_message: sanitizedMessage,
        error_code: errorCode,
      }),
    );
    return {};
  }
}

async function ensureCampaignJob(
  supabase: SB,
  args: EnsureJobArgs,
): Promise<{ jobId: string; created: boolean }> {
  if (args.existingJobId) {
    const { data } = await supabase
      .from("video_render_jobs")
      .select("id, status")
      .eq("id", args.existingJobId)
      .maybeSingle();
    if (data && data.status !== "failed" && data.status !== "cancelled") {
      return { jobId: data.id, created: false };
    }
  }

  const videoFormat = CAMPAIGN_ROLE_TO_VIDEO_FORMAT[args.role];
  const correlationId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `cid-${Date.now()}`;

  // Snapshot de marca (Fase 5.A) — construído UMA vez por INSERT.
  // Retry cria um novo job com a versão publicada no momento (regra 5.A).
  const brandColumns = await prepareMarketingVideoBrandColumns({
    supabase,
    companyId: args.companyId,
    videoFormat,
    correlationId,
    content: args.content ?? null,
  });


  const basePayload = {
    company_id: args.companyId,
    created_by: args.userId,
    audio_id: args.audioId,
    video_format: videoFormat,
    audio_start_second: args.audioStart,
    duration_seconds: args.duration,
    // Campos novos (opcionais)
    image_sequence: args.imageSequence as unknown as
      | Database["public"]["Tables"]["video_render_jobs"]["Insert"]["image_sequence"]
      | null,
    focal_point: args.primaryFocalPoint as unknown as
      | Database["public"]["Tables"]["video_render_jobs"]["Insert"]["focal_point"]
      | null,
    ...brandColumns,
  };
  const insertPayload =
    args.primaryImage.source === "marketing_media"
      ? {
          ...basePayload,
          image_source: "marketing_media" as const,
          image_id: args.primaryImage.image_id,
        }
      : {
          ...basePayload,
          image_source: "product_image" as const,
          product_id: args.primaryImage.product_id,
          product_image_path: args.primaryImage.product_image_path,
        };

  const { data: inserted, error } = await supabase
    .from("video_render_jobs")
    .insert(insertPayload as never)
    .select("id")
    .single();
  if (error || !inserted) throw new Error(error?.message ?? "job_insert_failed");
  return { jobId: inserted.id, created: true };
}

// ------------------------------------------------- generateMarketingCampaign
//
// Fase "Approval Gate":
//  - Cria as linhas de marketing_contents (feed+story) com overlays sugeridos
//    pela IA e persiste também a coluna overlay_original_* (snapshot p/ botão
//    "Restaurar original").
//  - NÃO enfileira job de render aqui. O job só é criado após a aprovação
//    explícita do usuário via `approveCampaignAndRender`.

export const generateMarketingCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => GenerateCampaignInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);

    // 1) Ownership de cada imagem.
    const rawImages = normalizeImages(data);
    const validated: ValidatedImage[] = [];
    for (let i = 0; i < rawImages.length; i++) {
      const v = await validateOneImage(supabase, companyId, rawImages[i], i, i === 0);
      validated.push(v);
    }
    await assertPrimaryAudio(
      supabase,
      companyId,
      data.primary_audio_id,
      data.audio_start_second,
      data.duration_seconds,
    );

    const primary = validated[0];

    // 2) Geração dos textos pela IA.
    const media_ids = validated
      .filter((v) => v.ref.source === "marketing_media")
      .map((v) => (v.ref as { source: "marketing_media"; image_id: string }).image_id);
    const product_media_refs = validated
      .filter((v) => v.ref.source === "product_image")
      .map((v) => {
        const r = v.ref as {
          source: "product_image";
          product_id: string;
          product_image_path: string;
        };
        return { product_id: r.product_id, image_path: r.product_image_path };
      });

    const { contents } = await generateMarketingContent({
      data: {
        promotion_id: data.promotion_id ?? null,
        media_ids,
        product_media_refs,
        tone: data.tone,
        audience: data.audience ?? null,
        extra_instructions: data.extra_instructions ?? null,
      },
    });

    // 3) Vincula story/feed ao campaign_id e grava referências de mídia/áudio.
    const campaignId = crypto.randomUUID();
    const feedRow = contents.find((c) => (c.format as MarketingContentFormat) === "feed");
    const storyRow = contents.find((c) => (c.format as MarketingContentFormat) === "story");
    if (!feedRow || !storyRow) throw new Error("ai_missing_feed_or_story");

    const primaryRef =
      primary.ref.source === "marketing_media"
        ? { primary_image_media_id: primary.ref.image_id, primary_image_product_ref: null }
        : {
            primary_image_media_id: null,
            primary_image_product_ref: {
              product_id: primary.ref.product_id,
              image_path: primary.ref.product_image_path,
            } as unknown as Database["public"]["Tables"]["marketing_contents"]["Update"]["primary_image_product_ref"],
          };
    const commonPatch = {
      campaign_id: campaignId,
      ...primaryRef,
      primary_audio_id: data.primary_audio_id,
      audio_start_second: data.audio_start_second,
      duration_seconds: data.duration_seconds,
    };
    await supabase
      .from("marketing_contents")
      .update({ ...commonPatch, campaign_role: "feed" })
      .eq("id", feedRow.id);
    await supabase
      .from("marketing_contents")
      .update({ ...commonPatch, campaign_role: "story" })
      .eq("id", storyRow.id);

    // eslint-disable-next-line no-console
    console.info(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        event: "campaign_awaiting_text_approval",
        campaign_id: campaignId,
        company_id: companyId,
      }),
    );

    const { data: refreshed } = await supabase
      .from("marketing_contents")
      .select("*")
      .in("id", contents.map((c) => c.id));

    return {
      campaign_id: campaignId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      contents: (refreshed ?? contents) as any,
      needs_approval: true as const,
      // Mantido por compat com clientes antigos; render só é enfileirado
      // após approveCampaignAndRender.
      feed_job_id: null,
      story_job_id: null,
      needs_marketing_media_for_render: false,
    };
  });

// ------------------------------------------------- regenerateCampaignTexts
//
// Reinvoca a IA para gerar NOVOS overlays (título/subtítulo/CTA) na mesma
// campanha, mantendo imagens, áudio, música, duração e overlay_original_*
// intactos. Apenas overlay_headline / overlay_subheadline / overlay_cta são
// substituídos em ambas as linhas (feed+story).

const RegenerateTextsInput = z.object({ campaign_id: z.string().uuid() });

export const regenerateCampaignTexts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RegenerateTextsInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);

    const { data: rows, error } = await supabase
      .from("marketing_contents")
      .select("*")
      .eq("company_id", companyId)
      .eq("campaign_id", data.campaign_id);
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as MarketingContentRow[];
    const feedRow = list.find((r) => r.campaign_role === "feed") ?? null;
    const storyRow = list.find((r) => r.campaign_role === "story") ?? null;
    if (!feedRow || !storyRow) throw new Error("campaign_not_found");
    if (feedRow.feed_render_job_id || storyRow.story_render_job_id) {
      // Campanha já teve texto aprovado e render disparado — regeneração
      // pós-aprovação exigiria criar nova campanha.
      throw new Error("campaign_already_approved");
    }

    // Reaproveita as referências de mídia originais gravadas no prompt.
    const prompt =
      (feedRow.ai_prompt as {
        media_ids?: string[];
        product_media_refs?: Array<{ product_id: string; image_path: string }>;
        tone?: "amigável" | "profissional" | "descontraído" | "urgente";
        audience?: string | null;
        extra_instructions?: string | null;
        promotion_id?: string | null;
      } | null) ?? {};

    const { contents: fresh } = await generateMarketingContent({
      data: {
        promotion_id: prompt.promotion_id ?? feedRow.promotion_id ?? null,
        media_ids: prompt.media_ids ?? [],
        product_media_refs: prompt.product_media_refs ?? [],
        tone: prompt.tone ?? "amigável",
        audience: prompt.audience ?? null,
        extra_instructions: prompt.extra_instructions ?? null,
      },
    });

    const freshFeed = fresh.find(
      (c) => (c.format as MarketingContentFormat) === "feed",
    ) as MarketingContentRow | undefined;
    const freshStory = fresh.find(
      (c) => (c.format as MarketingContentFormat) === "story",
    ) as MarketingContentRow | undefined;
    if (!freshFeed || !freshStory) throw new Error("ai_missing_feed_or_story");

    // Preserva os títulos/corpos originais desta campanha, sobrescreve APENAS
    // os overlays (o que é visível no vídeo). Legendas não sofrem alteração
    // aqui, para manter estabilidade do restante do funil.
    const overlayPatch = {
      overlay_headline: freshFeed.overlay_headline ?? null,
      overlay_subheadline: freshFeed.overlay_subheadline ?? null,
      overlay_cta: freshFeed.overlay_cta ?? null,
    };
    await supabase
      .from("marketing_contents")
      .update(overlayPatch)
      .eq("id", feedRow.id);
    await supabase
      .from("marketing_contents")
      .update(overlayPatch)
      .eq("id", storyRow.id);

    // Remove as linhas efêmeras geradas (não pertencem a nenhuma campanha).
    try {
      await supabase
        .from("marketing_contents")
        .delete()
        .in("id", fresh.map((c) => c.id));
    } catch {
      /* best-effort — não bloqueia o retorno. */
    }

    const { data: refreshed } = await supabase
      .from("marketing_contents")
      .select("*")
      .in("id", [feedRow.id, storyRow.id]);

    // eslint-disable-next-line no-console
    console.info(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        event: "campaign_texts_regenerated",
        campaign_id: data.campaign_id,
        company_id: companyId,
      }),
    );

    return {
      campaign_id: data.campaign_id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      contents: (refreshed ?? []) as any,
    };
  });

// ------------------------------------------------- approveCampaignAndRender
//
// Persiste os textos APROVADOS pelo usuário e enfileira o job master 9:16.
// Este é o único ponto onde o Render Engine passa a receber trabalho para
// esta campanha.

const ApproveInput = z.object({
  campaign_id: z.string().uuid(),
  headline: z.string().trim().min(1).max(80),
  subheadline: z.string().trim().max(120).nullable().optional(),
  cta: z.string().trim().max(60).nullable().optional(),
  // Fase M4-editor: layout visual + template persistidos junto do texto
  // aprovado. Nesta rodada o worker ainda não consome; ficam prontos para
  // a próxima fase ler `video_layout` do content ou `brand_snapshot.overlay_layout`.
  layout: z.record(z.string(), z.unknown()).nullable().optional(),
  template: z.string().max(40).nullable().optional(),
});

export const approveCampaignAndRender = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ApproveInput.parse(d))
  .handler(async ({ data, context }): Promise<{ job_id: string }> => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);

    const { data: rows, error } = await supabase
      .from("marketing_contents")
      .select("*")
      .eq("company_id", companyId)
      .eq("campaign_id", data.campaign_id);
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as MarketingContentRow[];
    const feedRow = list.find((r) => r.campaign_role === "feed") ?? null;
    const storyRow = list.find((r) => r.campaign_role === "story") ?? null;
    if (!feedRow || !storyRow) throw new Error("campaign_not_found");

    // Idempotência: se já existe job em andamento/concluído, apenas devolve.
    const existingJobId =
      storyRow.story_render_job_id ??
      feedRow.feed_render_job_id ??
      null;
    if (existingJobId) {
      return { job_id: existingJobId };
    }

    if (!storyRow.primary_audio_id) throw new Error("campaign_missing_primary_audio");
    if (!storyRow.primary_image_media_id && !storyRow.primary_image_product_ref) {
      throw new Error("campaign_missing_primary_image");
    }

    // Persistência do texto aprovado + layout/template do editor visual
    // (mesmos valores nas duas linhas feed/story).
    const approvedPatch: Record<string, unknown> = {
      overlay_headline: data.headline,
      overlay_subheadline: data.subheadline ?? null,
      overlay_cta: data.cta ?? null,
      overlay_approved_at: new Date().toISOString(),
    };
    if (data.layout !== undefined) approvedPatch.video_layout = data.layout;
    if (data.template !== undefined) approvedPatch.video_template = data.template;
    await supabase
      .from("marketing_contents")
      .update(approvedPatch)
      .eq("id", feedRow.id);
    await supabase
      .from("marketing_contents")
      .update(approvedPatch)
      .eq("id", storyRow.id);

    // Master 9:16 (Story) — feed reutiliza o mesmo MP4.
    const image: ImageOwnershipRef = storyRow.primary_image_media_id
      ? { source: "marketing_media", image_id: storyRow.primary_image_media_id }
      : {
          source: "product_image",
          product_id: storyRow.primary_image_product_ref!.product_id,
          product_image_path: storyRow.primary_image_product_ref!.image_path,
        };

    let companyName: string | null = null;
    try {
      const { data: companyRow } = await supabase
        .from("companies")
        .select("name")
        .eq("id", companyId)
        .maybeSingle();
      companyName = companyRow?.name ?? null;
    } catch {
      companyName = null;
    }

    const resolved = resolveOverlayContentFromRow({
      title: storyRow.title,
      body: storyRow.body,
      cta_text: storyRow.cta_text,
      overlay_headline: data.headline,
      overlay_subheadline: data.subheadline ?? null,
      overlay_cta: data.cta ?? null,
    });

    // eslint-disable-next-line no-console
    console.info(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        event: "campaign_master_render_requested",
        campaign_id: data.campaign_id,
        company_id: companyId,
        video_format: "story",
        via: "user_approval",
        overlay_fields: resolved.telemetry.overlay_fields,
        legacy_fallback: resolved.telemetry.legacy_fallback,
      }),
    );

    const { jobId } = await ensureCampaignJob(supabase, {
      companyId,
      userId,
      role: "story",
      primaryImage: image,
      primaryFocalPoint: null,
      imageSequence: null,
      audioId: storyRow.primary_audio_id,
      audioStart: Number(storyRow.audio_start_second ?? 0),
      duration: Number(storyRow.duration_seconds ?? 15),
      existingJobId: null,
      content: { ...resolved.content, companyName },
    });

    await supabase
      .from("marketing_contents")
      .update({ feed_render_job_id: jobId })
      .eq("id", feedRow.id);
    await supabase
      .from("marketing_contents")
      .update({ story_render_job_id: jobId })
      .eq("id", storyRow.id);

    return { job_id: jobId };
  });


// ------------------------------------------------- getCampaignRenderStatus

const StatusInput = z.object({ campaign_id: z.string().uuid() });

export const getCampaignRenderStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => StatusInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);

    const { data: rows, error } = await supabase
      .from("marketing_contents")
      .select(
        "id, campaign_role, feed_render_job_id, story_render_job_id, feed_video_id, story_video_id",
      )
      .eq("company_id", companyId)
      .eq("campaign_id", data.campaign_id);
    if (error) throw new Error(error.message);
    const feedRow = (rows ?? []).find((r) => r.campaign_role === "feed");
    const storyRow = (rows ?? []).find((r) => r.campaign_role === "story");

    const jobIds = [
      feedRow?.feed_render_job_id,
      storyRow?.story_render_job_id,
    ].filter((x): x is string => typeof x === "string" && x.length > 0);

    let jobs: Array<
      Pick<RenderJobRow, "id" | "status" | "progress" | "error_code" | "video_format">
    > = [];
    if (jobIds.length > 0) {
      const { data: jobRows } = await supabase
        .from("video_render_jobs")
        .select("id, status, progress, error_code, video_format")
        .in("id", jobIds);
      jobs = (jobRows ?? []) as typeof jobs;
    }
    const byId = new Map(jobs.map((j) => [j.id, j]));

    return {
      feed: {
        content_id: feedRow?.id ?? null,
        job_id: feedRow?.feed_render_job_id ?? null,
        job: feedRow?.feed_render_job_id ? byId.get(feedRow.feed_render_job_id) ?? null : null,
        video_id: feedRow?.feed_video_id ?? null,
      },
      story: {
        content_id: storyRow?.id ?? null,
        job_id: storyRow?.story_render_job_id ?? null,
        job: storyRow?.story_render_job_id ? byId.get(storyRow.story_render_job_id) ?? null : null,
        video_id: storyRow?.story_video_id ?? null,
      },
    };
  });

// ------------------------------------------------- retryCampaignRender

const RetryInput = z.object({
  campaign_id: z.string().uuid(),
  role: z.enum(["feed", "story"]),
});

export const retryCampaignRender = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RetryInput.parse(d))
  .handler(async ({ data, context }): Promise<{ job_id: string }> => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);

    // Fase M3 — retry SEMPRE opera sobre o job master (1 vídeo p/ toda campanha).
    // Independente da role solicitada, buscamos AMBAS as linhas (feed+story) e
    // reutilizamos qualquer job master já existente. Prevenção de duplicidade:
    //   1. Se qualquer linha já tem *_video_id → job já concluiu → devolve o id.
    //   2. Se alguma linha tem job em queued/processing → devolve o mesmo id.
    //   3. Só cria job novo se todas as referências forem null/failed/cancelled.
    const { data: rows, error } = await supabase
      .from("marketing_contents")
      .select(
        "id, company_id, campaign_role, primary_image_media_id, primary_image_product_ref, primary_audio_id, audio_start_second, duration_seconds, title, body, cta_text, overlay_headline, overlay_subheadline, overlay_cta, feed_render_job_id, story_render_job_id, feed_video_id, story_video_id",
      )
      .eq("company_id", companyId)
      .eq("campaign_id", data.campaign_id);
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as Array<{
      id: string;
      company_id: string;
      campaign_role: string | null;
      primary_image_media_id: string | null;
      primary_image_product_ref: { product_id: string; image_path: string } | null;
      primary_audio_id: string | null;
      audio_start_second: number | null;
      duration_seconds: number | null;
      title: string | null;
      body: string | null;
      cta_text: string | null;
      overlay_headline: string | null;
      overlay_subheadline: string | null;
      overlay_cta: string | null;
      feed_render_job_id: string | null;
      story_render_job_id: string | null;
      feed_video_id: string | null;
      story_video_id: string | null;
    }>;
    const feedRow = list.find((r) => r.campaign_role === "feed") ?? null;
    const storyRow = list.find((r) => r.campaign_role === "story") ?? null;
    if (!feedRow && !storyRow) throw new Error("campaign_role_not_found");

    // Fonte canônica de dados de render = linha da story (é o master 9:16).
    const src = storyRow ?? feedRow!;
    if (!src.primary_audio_id) throw new Error("campaign_missing_primary_audio");
    if (!src.primary_image_media_id && !src.primary_image_product_ref) {
      throw new Error("campaign_missing_primary_image");
    }

    // (1) Vídeo já existente → devolve. Se apenas UM lado tem video_id
    //     (campanha antiga), replicamos no outro se ambos apontam para o
    //     mesmo job — sem criar novo.
    const anyVideoId =
      storyRow?.story_video_id ??
      feedRow?.feed_video_id ??
      storyRow?.feed_video_id ??
      feedRow?.story_video_id ??
      null;
    const anyJobIdFromRow = (r: typeof src | null) =>
      r ? r.story_render_job_id ?? r.feed_render_job_id ?? null : null;
    if (anyVideoId) {
      // eslint-disable-next-line no-console
      console.info(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "info",
          event: "campaign_master_render_reused",
          campaign_id: data.campaign_id,
          company_id: companyId,
          reason: "already_completed",
          video_id: anyVideoId,
        }),
      );
      return { job_id: anyJobIdFromRow(src) ?? "" };
    }

    // (2) Job ativo (queued/processing) em qualquer coluna → reusa.
    const candidateJobIds = Array.from(
      new Set(
        [
          storyRow?.story_render_job_id,
          storyRow?.feed_render_job_id,
          feedRow?.feed_render_job_id,
          feedRow?.story_render_job_id,
        ].filter((x): x is string => typeof x === "string" && x.length > 0),
      ),
    );
    if (candidateJobIds.length > 0) {
      const { data: js } = await supabase
        .from("video_render_jobs")
        .select("id, status")
        .in("id", candidateJobIds);
      const active = (js ?? []).find(
        (j) => j.status === "queued" || j.status === "processing",
      );
      if (active) {
        // eslint-disable-next-line no-console
        console.info(
          JSON.stringify({
            ts: new Date().toISOString(),
            level: "info",
            event: "campaign_duplicate_render_prevented",
            campaign_id: data.campaign_id,
            company_id: companyId,
            job_id: active.id,
            state: active.status,
          }),
        );
        // Reforça o vínculo em ambas as linhas (idempotente).
        if (feedRow) {
          await supabase
            .from("marketing_contents")
            .update({ feed_render_job_id: active.id })
            .eq("id", feedRow.id);
        }
        if (storyRow) {
          await supabase
            .from("marketing_contents")
            .update({ story_render_job_id: active.id })
            .eq("id", storyRow.id);
        }
        return { job_id: active.id };
      }
    }

    // (3) Criar novo job master.
    const image: ImageOwnershipRef = src.primary_image_media_id
      ? { source: "marketing_media", image_id: src.primary_image_media_id }
      : {
          source: "product_image",
          product_id: src.primary_image_product_ref!.product_id,
          product_image_path: src.primary_image_product_ref!.image_path,
        };

    let companyNameRetry: string | null = null;
    try {
      const { data: companyRow } = await supabase
        .from("companies")
        .select("name")
        .eq("id", companyId)
        .maybeSingle();
      companyNameRetry = companyRow?.name ?? null;
    } catch {
      companyNameRetry = null;
    }

    const retryResolved = resolveOverlayContentFromRow(
      src as unknown as MarketingRowOverlaySource,
    );
    // eslint-disable-next-line no-console
    console.info(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        event: "campaign_master_render_requested",
        campaign_id: data.campaign_id,
        company_id: companyId,
        video_format: "story",
        retry: true,
        requested_role: data.role,
        overlay_fields: retryResolved.telemetry.overlay_fields,
        legacy_fallback: retryResolved.telemetry.legacy_fallback,
      }),
    );

    const { jobId } = await ensureCampaignJob(supabase, {
      companyId,
      userId,
      role: "story", // master é sempre 9:16
      primaryImage: image,
      primaryFocalPoint: null,
      imageSequence: null,
      audioId: src.primary_audio_id,
      audioStart: Number(src.audio_start_second ?? 0),
      duration: Number(src.duration_seconds ?? 15),
      existingJobId: null,
      content: { ...retryResolved.content, companyName: companyNameRetry },
    });

    if (feedRow) {
      await supabase
        .from("marketing_contents")
        .update({ feed_render_job_id: jobId })
        .eq("id", feedRow.id);
    }
    if (storyRow) {
      await supabase
        .from("marketing_contents")
        .update({ story_render_job_id: jobId })
        .eq("id", storyRow.id);
    }

    return { job_id: jobId };
  });


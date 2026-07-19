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
  imageSequence: RenderImageSequenceItem[] | null; // null quando N=1 e sem focal
  audioId: string;
  audioStart: number;
  duration: number;
  existingJobId: string | null;
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

  const basePayload = {
    company_id: args.companyId,
    created_by: args.userId,
    audio_id: args.audioId,
    video_format: CAMPAIGN_ROLE_TO_VIDEO_FORMAT[args.role],
    audio_start_second: args.audioStart,
    duration_seconds: args.duration,
    // Campos novos (opcionais)
    image_sequence: args.imageSequence as unknown as
      | Database["public"]["Tables"]["video_render_jobs"]["Insert"]["image_sequence"]
      | null,
    focal_point: args.primaryFocalPoint as unknown as
      | Database["public"]["Tables"]["video_render_jobs"]["Insert"]["focal_point"]
      | null,
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
    .insert(insertPayload)
    .select("id")
    .single();
  if (error || !inserted) throw new Error(error?.message ?? "job_insert_failed");
  return { jobId: inserted.id, created: true };
}

// ------------------------------------------------- generateMarketingCampaign

export const generateMarketingCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => GenerateCampaignInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);

    // 1) Ownership de cada imagem (validação paralela seria mais rápida, mas
    //    manter erro determinístico por posição é mais amigável ao usuário).
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
    const anyFocal = validated.some((v) => v.focalPoint != null);
    // Só materializa a sequência quando ela é multi-imagem OU quando alguma
    // imagem tem focal_point. Isso mantém jobs single-image sem focal_point
    // com o payload legado — worker novo executa o caminho existente.
    const sequence: RenderImageSequenceItem[] | null =
      validated.length > 1 || anyFocal ? validated.map((v) => v.sequenceItem) : null;

    // 2) Reuso da geração IA existente. Mídias enviadas à IA seguem sendo
    //    apenas as da biblioteca (product_media_refs preserva contrato atual).
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

    // 3) Vincula story/feed ao campaign_id.
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

    // 4) Enfileira 2 jobs (feed + story).
    const feed = await ensureCampaignJob(supabase, {
      companyId,
      userId,
      role: "feed",
      primaryImage: primary.ref,
      primaryFocalPoint: primary.focalPoint,
      imageSequence: sequence,
      audioId: data.primary_audio_id,
      audioStart: data.audio_start_second,
      duration: data.duration_seconds,
      existingJobId: null,
    });
    const story = await ensureCampaignJob(supabase, {
      companyId,
      userId,
      role: "story",
      primaryImage: primary.ref,
      primaryFocalPoint: primary.focalPoint,
      imageSequence: sequence,
      audioId: data.primary_audio_id,
      audioStart: data.audio_start_second,
      duration: data.duration_seconds,
      existingJobId: null,
    });

    await supabase
      .from("marketing_contents")
      .update({ feed_render_job_id: feed.jobId })
      .eq("id", feedRow.id);
    await supabase
      .from("marketing_contents")
      .update({ story_render_job_id: story.jobId })
      .eq("id", storyRow.id);

    const { data: refreshed } = await supabase
      .from("marketing_contents")
      .select("*")
      .in("id", contents.map((c) => c.id));

    return {
      campaign_id: campaignId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      contents: (refreshed ?? contents) as any,
      feed_job_id: feed.jobId,
      story_job_id: story.jobId,
      needs_marketing_media_for_render: false,
    };
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

    const roleColumnJob = data.role === "feed" ? "feed_render_job_id" : "story_render_job_id";
    const roleColumnVideo = data.role === "feed" ? "feed_video_id" : "story_video_id";

    const { data: row, error } = await supabase
      .from("marketing_contents")
      .select(
        `id, company_id, primary_image_media_id, primary_image_product_ref, primary_audio_id, audio_start_second, duration_seconds, ${roleColumnJob}, ${roleColumnVideo}`,
      )
      .eq("company_id", companyId)
      .eq("campaign_id", data.campaign_id)
      .eq("campaign_role", data.role)
      .maybeSingle();
    if (error || !row) throw new Error("campaign_role_not_found");
    const r = row as unknown as {
      id: string;
      company_id: string;
      primary_image_media_id: string | null;
      primary_image_product_ref: { product_id: string; image_path: string } | null;
      primary_audio_id: string | null;
      audio_start_second: number | null;
      duration_seconds: number | null;
      feed_render_job_id?: string | null;
      story_render_job_id?: string | null;
      feed_video_id?: string | null;
      story_video_id?: string | null;
    };
    if (!r.primary_audio_id) throw new Error("campaign_missing_primary_audio");
    if (!r.primary_image_media_id && !r.primary_image_product_ref) {
      throw new Error("campaign_missing_primary_image");
    }

    const existingJobId =
      data.role === "feed" ? r.feed_render_job_id ?? null : r.story_render_job_id ?? null;
    const existingVideoId =
      data.role === "feed" ? r.feed_video_id ?? null : r.story_video_id ?? null;
    if (existingVideoId) return { job_id: existingJobId ?? "" };
    if (existingJobId) {
      const { data: j } = await supabase
        .from("video_render_jobs")
        .select("id, status")
        .eq("id", existingJobId)
        .maybeSingle();
      if (j && (j.status === "queued" || j.status === "processing")) {
        return { job_id: j.id };
      }
    }

    // Retry: reusa apenas a imagem primária + comportamento legado (crop
    // central). Sequência/focal são propriedades da geração original — se o
    // usuário quiser mudar, gera uma nova campanha.
    const image: ImageOwnershipRef = r.primary_image_media_id
      ? { source: "marketing_media", image_id: r.primary_image_media_id }
      : {
          source: "product_image",
          product_id: r.primary_image_product_ref!.product_id,
          product_image_path: r.primary_image_product_ref!.image_path,
        };

    const { jobId } = await ensureCampaignJob(supabase, {
      companyId,
      userId,
      role: data.role,
      primaryImage: image,
      primaryFocalPoint: null,
      imageSequence: null,
      audioId: r.primary_audio_id,
      audioStart: Number(r.audio_start_second ?? 0),
      duration: Number(r.duration_seconds ?? 15),
      existingJobId: null,
    });

    const patch =
      data.role === "feed"
        ? { feed_render_job_id: jobId }
        : { story_render_job_id: jobId };
    await supabase.from("marketing_contents").update(patch).eq("id", r.id);

    return { job_id: jobId };
  });

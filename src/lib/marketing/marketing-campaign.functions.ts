// ============================================================================
// Marketing Campaign — server functions (Fase C.1 / Fatia 1)
//
// Uma "campanha" reune, em uma única identidade (campaign_id), as linhas de
// marketing_contents dos formatos 'feed' (4:5, 1080x1350) e 'story' (9:16,
// 1080x1920) que compartilham a mesma imagem e o mesmo áudio.
//
// Esta função:
//  1. Valida ownership da imagem (marketing_media OU products.images) e do
//     áudio (audio_library) por company_id.
//  2. Gera os textos IA usando a função existente `generateMarketingContent`
//     (reuso total — não duplica prompt/modelo/learning loop).
//  3. Atualiza as linhas 'story' e 'feed' geradas para vinculá-las ao
//     campaign_id, campaign_role, primary_image_*, primary_audio_id,
//     audio_start_second, duration_seconds.
//  4. Cria 2 jobs em video_render_jobs (feed_4_5 e story). Idempotente:
//     se a campanha já tem feed_render_job_id/story_render_job_id, não recria.
//  5. Escreve os job ids nas linhas correspondentes.
//
// Retry per-format via `retryCampaignRender({ campaign_id, role })`.
// Consulta de status por campanha via `getCampaignRenderStatus`.
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
import type { VideoFormat, RenderJobRow } from "@/lib/render-engine/render.types";

type SB = SupabaseClient<Database>;

const RENDER_DURATIONS = [8, 10, 15, 30, 60] as const;
type RenderDuration = (typeof RENDER_DURATIONS)[number];

const PrimaryImageSchema = z.union([
  z.object({ origin: z.literal("marketing"), media_id: z.string().uuid() }),
  z.object({
    origin: z.literal("product"),
    product_id: z.string().uuid(),
    image_path: z.string().min(1).max(500),
  }),
]);

const GenerateCampaignInput = z.object({
  promotion_id: z.string().uuid().nullable().optional(),
  primary_image: PrimaryImageSchema,
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
});

export type CampaignRoleFeedStory = "feed" | "story";

const CAMPAIGN_ROLE_TO_VIDEO_FORMAT: Record<CampaignRoleFeedStory, VideoFormat> = {
  feed: "feed_4_5",
  story: "story",
};

// ------------------------------------------------------------------ helpers

async function resolveCompanyId(supabase: SB, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data?.company_id) throw new Error("company_not_found");
  return data.company_id;
}

/**
 * Valida a imagem principal escolhida pela campanha.
 * - Origem 'marketing': confere ownership em marketing_media e devolve o id.
 * - Origem 'product':   confere ownership em products e que a image_path
 *   informada faz parte de products.images.
 * Devolve { media_id | null, product_ref | null } — sempre exatamente 1 preenchido.
 */
async function assertPrimaryImage(
  supabase: SB,
  companyId: string,
  input: z.infer<typeof PrimaryImageSchema>,
): Promise<{
  primary_image_media_id: string | null;
  primary_image_product_ref: { product_id: string; image_path: string } | null;
}> {
  if (input.origin === "marketing") {
    const { data, error } = await supabase
      .from("marketing_media")
      .select("id, company_id, active, media_type")
      .eq("id", input.media_id)
      .maybeSingle();
    if (error || !data) throw new Error("image_not_found");
    if (data.company_id !== companyId) throw new Error("image_cross_tenant");
    if (!data.active) throw new Error("image_inactive");
    if (data.media_type !== "image") throw new Error("image_wrong_type");
    return { primary_image_media_id: data.id, primary_image_product_ref: null };
  }
  const { data: prod, error: prodErr } = await supabase
    .from("products")
    .select("id, company_id, images")
    .eq("id", input.product_id)
    .maybeSingle();
  if (prodErr || !prod) throw new Error("product_not_found");
  if (prod.company_id !== companyId) throw new Error("product_cross_tenant");
  const images = Array.isArray(prod.images)
    ? (prod.images.filter((x) => typeof x === "string") as string[])
    : [];
  if (!images.includes(input.image_path)) throw new Error("product_image_not_owned");
  return {
    primary_image_media_id: null,
    primary_image_product_ref: {
      product_id: input.product_id,
      image_path: input.image_path,
    },
  };
}

/**
 * Valida o áudio principal escolhido pela campanha.
 * Confere ownership, ativo, e que o trecho (start + duration) cabe.
 */
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

/**
 * Enfileira um render job para a campanha, ou reaproveita se já existir e
 * ainda não terminou em falha permanente. Retorna o job_id efetivo.
 */
async function ensureCampaignJob(
  supabase: SB,
  args: {
    companyId: string;
    userId: string;
    role: CampaignRoleFeedStory;
    imageIdForRender: string; // marketing_media.id (necessário — worker só entende marketing_media hoje)
    audioId: string;
    audioStart: number;
    duration: number;
    existingJobId: string | null;
  },
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
    // Falhou/cancelado → cria novo (retry).
  }

  const { data: inserted, error } = await supabase
    .from("video_render_jobs")
    .insert({
      company_id: args.companyId,
      created_by: args.userId,
      image_id: args.imageIdForRender,
      audio_id: args.audioId,
      video_format: CAMPAIGN_ROLE_TO_VIDEO_FORMAT[args.role],
      audio_start_second: args.audioStart,
      duration_seconds: args.duration,
    })
    .select("id")
    .single();
  if (error || !inserted) throw new Error(error?.message ?? "job_insert_failed");
  return { jobId: inserted.id, created: true };
}

// ------------------------------------------------------- generateMarketingCampaign

export const generateMarketingCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => GenerateCampaignInput.parse(data))
  .handler(
    async ({
      data,
      context,
    }) => {
      const { supabase, userId } = context;
      const companyId = await resolveCompanyId(supabase, userId);

      // 1) Ownership de imagem e áudio
      const imageRef = await assertPrimaryImage(supabase, companyId, data.primary_image);
      await assertPrimaryAudio(
        supabase,
        companyId,
        data.primary_audio_id,
        data.audio_start_second,
        data.duration_seconds,
      );

      // 2) Reuso da geração IA existente: cria as 4 linhas draft.
      const genArgs: Parameters<typeof generateMarketingContent>[0] = {
        data: {
          promotion_id: data.promotion_id ?? null,
          media_ids:
            imageRef.primary_image_media_id ? [imageRef.primary_image_media_id] : [],
          product_media_refs: imageRef.primary_image_product_ref
            ? [imageRef.primary_image_product_ref]
            : [],
          tone: data.tone,
          audience: data.audience ?? null,
          extra_instructions: data.extra_instructions ?? null,
        },
      };
      const { contents } = await generateMarketingContent(genArgs);

      // 3) Anexa campaign_id / campaign_role / primary_* a story + feed.
      const campaignId = crypto.randomUUID();
      const feedRow = contents.find(
        (c) => (c.format as MarketingContentFormat) === "feed",
      );
      const storyRow = contents.find(
        (c) => (c.format as MarketingContentFormat) === "story",
      );
      if (!feedRow || !storyRow) {
        throw new Error("ai_missing_feed_or_story");
      }

      const commonPatch = {
        campaign_id: campaignId,
        primary_image_media_id: imageRef.primary_image_media_id,
        primary_image_product_ref: imageRef.primary_image_product_ref as unknown as
          | Database["public"]["Tables"]["marketing_contents"]["Update"]["primary_image_product_ref"],
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

      // 4) Criação de jobs — apenas se a imagem é da marketing_media.
      //    Produtos são mídia de leitura (bucket product-images); o worker
      //    atual só lê caminhos de marketing_media. Nesse caso a fatia 1
      //    não enfileira renders automáticos e a UI exibe orientação para o
      //    usuário registrar a imagem na Biblioteca de Marketing.
      let feedJobId: string | null = null;
      let storyJobId: string | null = null;
      const needsMarketingMediaForRender = !imageRef.primary_image_media_id;

      if (imageRef.primary_image_media_id) {
        const feed = await ensureCampaignJob(supabase, {
          companyId,
          userId,
          role: "feed",
          imageIdForRender: imageRef.primary_image_media_id,
          audioId: data.primary_audio_id,
          audioStart: data.audio_start_second,
          duration: data.duration_seconds,
          existingJobId: null,
        });
        feedJobId = feed.jobId;

        const story = await ensureCampaignJob(supabase, {
          companyId,
          userId,
          role: "story",
          imageIdForRender: imageRef.primary_image_media_id,
          audioId: data.primary_audio_id,
          audioStart: data.audio_start_second,
          duration: data.duration_seconds,
          existingJobId: null,
        });
        storyJobId = story.jobId;

        await supabase
          .from("marketing_contents")
          .update({ feed_render_job_id: feedJobId })
          .eq("id", feedRow.id);
        await supabase
          .from("marketing_contents")
          .update({ story_render_job_id: storyJobId })
          .eq("id", storyRow.id);
      }

      // 5) Refaz o fetch das linhas atualizadas para retornar ao cliente.
      const { data: refreshed } = await supabase
        .from("marketing_contents")
        .select("*")
        .in("id", contents.map((c) => c.id));

      return {
        campaign_id: campaignId,
        // Cast: contents cross the serverFn JSON boundary; MarketingContentRow.ai_prompt
        // is `unknown` (row can hold any JSON) which doesn't fit the inferred
        // structural JSON type. Callers still consume MarketingContentRow shape.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        contents: (refreshed ?? contents) as any,
        feed_job_id: feedJobId,
        story_job_id: storyJobId,
        needs_marketing_media_for_render: needsMarketingMediaForRender,
      };
    },
  );

// ---------------------------------------------------- getCampaignRenderStatus

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

    let jobs: Array<Pick<RenderJobRow, "id" | "status" | "progress" | "error_code" | "video_format">> = [];
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

// -------------------------------------------------------- retryCampaignRender

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
        `id, company_id, primary_image_media_id, primary_audio_id, audio_start_second, duration_seconds, ${roleColumnJob}, ${roleColumnVideo}`,
      )
      .eq("company_id", companyId)
      .eq("campaign_id", data.campaign_id)
      .eq("campaign_role", data.role)
      .maybeSingle();
    if (error || !row) throw new Error("campaign_role_not_found");
    // Type narrowing for dynamic select.
    const r = row as unknown as {
      id: string;
      company_id: string;
      primary_image_media_id: string | null;
      primary_audio_id: string | null;
      audio_start_second: number | null;
      duration_seconds: number | null;
      feed_render_job_id?: string | null;
      story_render_job_id?: string | null;
      feed_video_id?: string | null;
      story_video_id?: string | null;
    };
    if (!r.primary_image_media_id || !r.primary_audio_id) {
      throw new Error("campaign_missing_primary_media");
    }
    const existingJobId =
      data.role === "feed" ? r.feed_render_job_id ?? null : r.story_render_job_id ?? null;
    const existingVideoId =
      data.role === "feed" ? r.feed_video_id ?? null : r.story_video_id ?? null;
    if (existingVideoId) {
      // Já concluído — não recria.
      return { job_id: existingJobId ?? "" };
    }
    // Se o job atual ainda está queued/processing, retorna-o (não duplica).
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

    const audioStart = Number(r.audio_start_second ?? 0);
    const duration = Number(r.duration_seconds ?? 15);
    const { data: inserted, error: insErr } = await supabase
      .from("video_render_jobs")
      .insert({
        company_id: companyId,
        created_by: userId,
        image_id: r.primary_image_media_id,
        audio_id: r.primary_audio_id,
        video_format: CAMPAIGN_ROLE_TO_VIDEO_FORMAT[data.role],
        audio_start_second: audioStart,
        duration_seconds: duration,
      })
      .select("id")
      .single();
    if (insErr || !inserted) throw new Error(insErr?.message ?? "job_insert_failed");

    const patch =
      data.role === "feed"
        ? { feed_render_job_id: inserted.id }
        : { story_render_job_id: inserted.id };
    await supabase.from("marketing_contents").update(patch).eq("id", r.id);

    return { job_id: inserted.id };
  });

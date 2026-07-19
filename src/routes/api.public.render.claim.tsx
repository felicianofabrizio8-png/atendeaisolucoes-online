// POST /api/public/render/claim
// Reserva atomicamente 1 job da fila para o Render Worker externo e retorna
// URLs assinadas (download imagem/áudio + upload MP4). Nenhum path vem do
// worker; tudo é derivado no servidor. 204 = fila vazia (não é erro).
//
// Fase C.2: quando o job carrega uma `image_sequence` (múltiplas imagens),
// a bridge assina cada imagem e retorna `source.imageSequence`. Quando
// carrega um `focal_point`, retorna `source.focalPoint`. Em ambos os casos
// o campo legado `source.imageDownloadUrl` continua sendo populado com a
// imagem PRIMÁRIA — workers de qualquer versão continuam funcionando.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  authenticateRenderWorker,
  badRequest,
  correlationId,
  deriveOutputVideoPath,
  internalError,
  methodNotAllowed,
  readJsonBody,
} from "@/lib/render-engine/RenderApiAuth.server";
import {
  VIDEO_FORMAT_DIMENSIONS,
  isValidFocalPoint,
  type FocalPoint,
  type RenderImageSequenceItem,
  type RenderSourceSequenceItem,
} from "@/lib/render-engine/render.types";
import {
  isVideoBrandSnapshot,
  type VideoBrandSnapshot,
} from "@/lib/render-engine/video-brand-snapshot";

const SIGNED_TTL_SECONDS = 600;

const claimSchema = z.object({ worker_id: z.string().min(3).max(120) });

type ResolvedImage = { bucket: string; path: string };

export const Route = createFileRoute("/api/public/render/claim")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const cid = correlationId();
        const authFail = authenticateRenderWorker(request);
        if (authFail) {
          console.warn("[render-claim]", { cid, event: "render_api_auth_failed" });
          return authFail;
        }
        const body = await readJsonBody(request);
        if ("error" in body) return body.error;
        const parsed = claimSchema.safeParse(body.data);
        if (!parsed.success) return badRequest("invalid_payload");
        const workerId = parsed.data.worker_id;

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data: claimed, error: claimErr } = await supabaseAdmin.rpc("claim_render_job", {
            _worker_id: workerId,
            _lock_seconds: 600,
          });
          if (claimErr) {
            console.error("[render-claim]", { cid, event: "claim_rpc_failed", code: claimErr.code });
            return internalError();
          }
          const rows = (claimed ?? []) as Array<Record<string, unknown>>;
          if (rows.length === 0) {
            console.info("[render-claim]", { cid, event: "render_claim_empty" });
            return new Response(null, { status: 204 });
          }
          const job = rows[0] as {
            id: string;
            company_id: string;
            image_source: "marketing_media" | "product_image" | string;
            image_id: string | null;
            product_id: string | null;
            product_image_path: string | null;
            audio_id: string;
            video_format: keyof typeof VIDEO_FORMAT_DIMENSIONS;
            audio_start_second: number | string;
            duration_seconds: number | string;
            attempt_count: number;
            status: string;
            image_sequence: RenderImageSequenceItem[] | null;
            focal_point: FocalPoint | null;
            video_brand: unknown;
            brand_version_id: string | null;
          };
          if (job.status !== "processing") {
            console.warn("[render-claim]", { cid, event: "claim_status_invalid", status: job.status });
            return internalError();
          }
          const dims = VIDEO_FORMAT_DIMENSIONS[job.video_format];
          if (!dims) return internalError();

          const fail = async (code: string) => {
            await supabaseAdmin
              .from("video_render_jobs")
              .update({
                status: "failed",
                failed_at: new Date().toISOString(),
                error_code: code,
                error_message_sanitized: code,
                locked_at: null,
                locked_by: null,
              })
              .eq("id", job.id);
            console.error("[render-claim]", { cid, event: "claim_source_invalid", code });
            return internalError();
          };

          // ------------------------- resolvedores de imagem ------------------------
          async function resolveMarketing(imageId: string): Promise<ResolvedImage | { error: string }> {
            const { data: img, error } = await supabaseAdmin
              .from("marketing_media")
              .select("storage_path, company_id, active, media_type")
              .eq("id", imageId)
              .maybeSingle();
            if (error || !img) return { error: "source_image_not_found" };
            if (img.company_id !== job.company_id) return { error: "image_cross_tenant" };
            if (!img.active) return { error: "image_inactive" };
            if (img.media_type !== "image") return { error: "image_wrong_type" };
            return { bucket: "marketing-media", path: img.storage_path };
          }
          async function resolveProduct(
            productId: string,
            productImagePath: string,
          ): Promise<ResolvedImage | { error: string }> {
            const { data: prod, error } = await supabaseAdmin
              .from("products")
              .select("company_id, active, images")
              .eq("id", productId)
              .maybeSingle();
            if (error || !prod) return { error: "source_product_not_found" };
            if (prod.company_id !== job.company_id) return { error: "product_cross_tenant" };
            if (!prod.active) return { error: "product_inactive" };
            const imgs = Array.isArray(prod.images)
              ? (prod.images.filter((x) => typeof x === "string") as string[])
              : [];
            const normalizedJobPath = normalizeProductImagePath(productImagePath);
            if (!normalizedJobPath) return { error: "product_image_path_invalid" };
            const matched = imgs.some((img) => {
              const normalizedStoredPath = normalizeProductImagePath(img);
              return img === productImagePath || normalizedStoredPath === normalizedJobPath;
            });
            if (!matched) return { error: "product_image_not_owned" };
            if (normalizedJobPath.split("/")[0] !== job.company_id) {
              return { error: "product_image_cross_tenant_path" };
            }
            return { bucket: "product-images", path: normalizedJobPath };
          }

          async function resolvePrimary(): Promise<ResolvedImage | { error: string }> {
            const source = (job.image_source ?? "marketing_media") as
              | "marketing_media"
              | "product_image";
            if (source === "marketing_media") {
              if (!job.image_id) return { error: "source_image_not_found" };
              return resolveMarketing(job.image_id);
            }
            if (!job.product_id || !job.product_image_path) {
              return { error: "source_product_image_incomplete" };
            }
            return resolveProduct(job.product_id, job.product_image_path);
          }

          async function resolveSequenceItem(
            it: RenderImageSequenceItem,
          ): Promise<ResolvedImage | { error: string }> {
            if (it.source === "marketing_media") {
              if (!it.image_id) return { error: "sequence_item_missing_image_id" };
              return resolveMarketing(it.image_id);
            }
            if (!it.product_id || !it.product_image_path) {
              return { error: "sequence_item_missing_product_ref" };
            }
            return resolveProduct(it.product_id, it.product_image_path);
          }

          // ------------------------------ resolve fontes ---------------------------
          const [primaryRes, audRes] = await Promise.all([
            resolvePrimary(),
            supabaseAdmin
              .from("audio_library")
              .select("file_path, company_id, is_active, duration_seconds")
              .eq("id", job.audio_id)
              .maybeSingle(),
          ]);
          if ("error" in primaryRes) return fail(primaryRes.error);
          const { data: aud, error: audErr } = audRes;
          if (audErr || !aud) return fail("source_audio_not_found");
          if (aud.company_id !== job.company_id) return fail("audio_cross_tenant");
          if (!aud.is_active) return fail("audio_inactive");

          const audioDuration = Number(aud.duration_seconds ?? 0);
          const dur = Number(job.duration_seconds);
          const start = Number(job.audio_start_second);
          if (audioDuration > 0 && start + dur > audioDuration + 0.25) {
            return fail("audio_range_out_of_bounds");
          }

          // Sequência: quando presente, resolve em paralelo.
          const seq = Array.isArray(job.image_sequence) && job.image_sequence.length > 0
            ? job.image_sequence
            : null;
          let resolvedSeq:
            | Array<{ item: RenderImageSequenceItem; resolved: ResolvedImage }>
            | null = null;
          if (seq) {
            const results = await Promise.all(seq.map(resolveSequenceItem));
            for (const r of results) {
              if ("error" in r) return fail(r.error);
            }
            resolvedSeq = seq.map((item, i) => ({
              item,
              resolved: results[i] as ResolvedImage,
            }));
          }

          // Signed URLs
          const [dlPrimary, dlAud] = await Promise.all([
            supabaseAdmin.storage
              .from(primaryRes.bucket)
              .createSignedUrl(primaryRes.path, SIGNED_TTL_SECONDS),
            supabaseAdmin.storage
              .from("audio-library")
              .createSignedUrl(aud.file_path, SIGNED_TTL_SECONDS),
          ]);
          if (dlPrimary.error || !dlPrimary.data?.signedUrl) return fail("image_sign_failed");
          if (dlAud.error || !dlAud.data?.signedUrl) return fail("audio_sign_failed");

          let signedSequence: RenderSourceSequenceItem[] | null = null;
          if (resolvedSeq) {
            const signed = await Promise.all(
              resolvedSeq.map(({ resolved }) =>
                supabaseAdmin.storage
                  .from(resolved.bucket)
                  .createSignedUrl(resolved.path, SIGNED_TTL_SECONDS),
              ),
            );
            for (let i = 0; i < signed.length; i++) {
              const s = signed[i];
              if (s.error || !s.data?.signedUrl) return fail("image_sign_failed");
            }
            const perSlot = dur / resolvedSeq.length;
            signedSequence = resolvedSeq.map(({ item }, i) => ({
              position: item.position,
              primary: !!item.primary,
              imageDownloadUrl: signed[i].data!.signedUrl,
              focalPoint:
                item.focal_point && isValidFocalPoint(item.focal_point)
                  ? item.focal_point
                  : null,
              durationHint: perSlot,
            }));
          }

          const primaryFocal =
            job.focal_point && isValidFocalPoint(job.focal_point) ? job.focal_point : null;

          // Reserva determinística de upload
          const videoId = job.id;
          const outputPath = deriveOutputVideoPath(job.company_id, videoId);
          const { data: upl, error: uplErr } = await supabaseAdmin.storage
            .from("video-library")
            .createSignedUploadUrl(outputPath);
          if (uplErr || !upl?.signedUrl) return fail("upload_sign_failed");

          const expiresAt = new Date(Date.now() + SIGNED_TTL_SECONDS * 1000).toISOString();
          console.info("[render-claim]", {
            cid,
            event: "render_job_claimed",
            job_id: job.id,
            company_id: job.company_id,
            worker_id: workerId,
            attempt: job.attempt_count,
            has_sequence: !!signedSequence,
            sequence_len: signedSequence?.length ?? 0,
            has_focal_point: !!primaryFocal,
          });

          return Response.json({
            job: {
              id: job.id,
              companyId: job.company_id,
              workerId,
              attemptCount: job.attempt_count,
              videoFormat: job.video_format,
              audioStartSecond: start,
              durationSeconds: dur,
              width: dims.width,
              height: dims.height,
            },
            source: {
              // Legado (workers antigos continuam funcionando)
              imageDownloadUrl: dlPrimary.data.signedUrl,
              audioDownloadUrl: dlAud.data.signedUrl,
              // Fase C.2 (opcional)
              focalPoint: primaryFocal,
              imageSequence: signedSequence,
            },
            output: {
              videoId,
              uploadUrl: upl.signedUrl,
              filePath: outputPath,
            },
            expiresAt,
          });
        } catch (e) {
          console.error("[render-claim]", {
            cid,
            event: "internal_exception",
            code: e instanceof Error ? e.name : "Error",
          });
          return internalError();
        }
      },
      GET: methodNotAllowed,
      PUT: methodNotAllowed,
      PATCH: methodNotAllowed,
      DELETE: methodNotAllowed,
    },
  },
});

function normalizeProductImagePath(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) {
    const clean = trimmed.replace(/^\/+/, "");
    if (!clean || clean.includes("..")) return null;
    try {
      return decodeURIComponent(clean);
    } catch {
      return clean;
    }
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (!/\.supabase\.(co|in)$/i.test(parsed.hostname)) return null;
  const marker = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/product-images\//;
  const match = parsed.pathname.match(marker);
  if (!match) return null;
  const rest = parsed.pathname.slice(match.index! + match[0].length);
  if (!rest || rest.includes("..")) return null;
  try {
    return decodeURIComponent(rest);
  } catch {
    return rest;
  }
}

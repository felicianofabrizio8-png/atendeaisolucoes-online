/**
 * Server function que prepara o plano de composição de marca para uma
 * imagem estática do Marketing IA. Fase 4.1 — integra o compositor
 * determinístico ao fluxo real de geração.
 *
 * REGRAS
 *  - `company_id` derivado da sessão (via profiles). Nunca do cliente.
 *  - Retorna plano contendo signed URL efêmera apenas em memória do
 *    request/response. O cliente NÃO deve persistir a signed URL.
 *  - `snapshot` é o único objeto seguro para persistência em `ai_prompt`.
 *  - Nenhuma URL/logo é logada. `warnings` são strings sanitizadas.
 *  - Se a empresa não tem marca publicada e nem logo, devolvemos
 *    `applied: false` para o cliente cair no comportamento anterior.
 */

import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { prepareStaticBrandComposition } from "./static-brand-composer.server";
import {
  buildCompositionSnapshot,
  type StaticCanvasFormat,
  type StaticBrandCompositionPlan,
  type StaticBrandCompositionSnapshot,
} from "./static-brand-composer";

type SB = SupabaseClient<Database>;

const CanvasFormatSchema = z.enum(["feed_1_1", "feed_4_5", "story_9_16"]);

const InputSchema = z.object({
  format: CanvasFormatSchema,
  canvas: z.object({
    width: z.number().int().positive().max(4096),
    height: z.number().int().positive().max(4096),
  }),
  baseImage: z.object({
    mimeType: z
      .string()
      .min(1)
      .refine((v) => v.startsWith("image/"), "mime_invalido"),
    width: z.number().int().positive().max(4096),
    height: z.number().int().positive().max(4096),
  }),
  content: z
    .object({
      headline: z.string().nullable().optional(),
      subheadline: z.string().nullable().optional(),
      price: z.string().nullable().optional(),
      callToAction: z.string().nullable().optional(),
    })
    .optional(),
});

export type PrepareBrandCompositionInput = z.infer<typeof InputSchema>;

export interface PrepareBrandCompositionResult {
  /** true → cliente deve rasterizar; false → cliente usa imagem-base intacta. */
  applied: boolean;
  /**
   * Plano de composição — presente somente quando `applied === true`.
   * Contém signed URL efêmera da logo (se houver). NÃO persistir.
   */
  plan: StaticBrandCompositionPlan | null;
  /** Snapshot sanitizado, seguro para persistir em `ai_prompt`. */
  snapshot: StaticBrandCompositionSnapshot | null;
  /** Motivo do bypass (para logs sanitizados do cliente). */
  reason?: "no_brand_published" | "brand_error";
  warnings: string[];
}

export const prepareBrandComposition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }): Promise<PrepareBrandCompositionResult> => {
    const sb = context.supabase as SB;
    const userId = context.userId as string;
    const { data: prof, error } = await sb
      .from("profiles")
      .select("company_id")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error("profile_lookup_failed");
    const companyId = prof?.company_id;
    if (!companyId) throw new Error("company_not_found");

    let plan: StaticBrandCompositionPlan;
    try {
      plan = await prepareStaticBrandComposition(sb, {
        companyId,
        baseImage: {
          // href não é utilizada pelo cálculo do plano; o cliente injeta
          // a imagem real na rasterização. Mantemos o token opaco só para
          // satisfazer a validação do módulo puro.
          href: "internal://base",
          mimeType: data.baseImage.mimeType,
          width: data.baseImage.width,
          height: data.baseImage.height,
        },
        canvas: {
          width: data.canvas.width,
          height: data.canvas.height,
          format: data.format as StaticCanvasFormat,
        },
        content: data.content ?? undefined,
      });
    } catch {
      // Falha ao montar plano — cliente deve preservar imagem-base.
      return {
        applied: false,
        plan: null,
        snapshot: null,
        reason: "brand_error",
        warnings: ["brand_composition_prepare_failed"],
      };
    }

    // Feature flag efetiva: identidade publicada OU logo disponível.
    const hasBrand = plan.logo !== null || plan.appliedElements.length > 0;
    if (!hasBrand) {
      return {
        applied: false,
        plan: null,
        snapshot: null,
        reason: "no_brand_published",
        warnings: plan.warnings,
      };
    }

    const snapshot = buildCompositionSnapshot(
      {
        baseImage: {
          href: "internal://base",
          mimeType: data.baseImage.mimeType,
          width: data.baseImage.width,
          height: data.baseImage.height,
        },
        canvas: {
          width: data.canvas.width,
          height: data.canvas.height,
          format: data.format as StaticCanvasFormat,
        },
        // Snapshot não precisa do brand completo; usaremos os campos já
        // computados no plano.
        brand: {
          isFallback: false,
          visualStyle: null,
          colors: plan.colors,
          typography: {
            heading: plan.typography.headingFamily,
            body: plan.typography.bodyFamily,
            display: plan.typography.displayFamily,
            fallback: plan.typography.fallbackFamily,
            weights: plan.typography.weights,
          },
          tokens: {
            logoPosition: plan.logo?.position ?? "bottom-right",
            logoSafeMargin: plan.logo?.safeMargin ?? 0,
            overlayOpacity:
              plan.overlays.find((l) => l.kind === "solid")?.opacity ?? 0,
            radius: 0,
            gradientStyle:
              plan.overlays.some((l) => l.kind === "linearGradient")
                ? "subtle"
                : "none",
            imageStyle: "photographic",
          },
          logo: null,
        },
        content: data.content ?? undefined,
      },
      plan,
    );

    return { applied: true, plan, snapshot, warnings: plan.warnings };
  });

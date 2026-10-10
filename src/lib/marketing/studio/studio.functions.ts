// ============================================================================
// Estúdio Criativo — persistência do documento (carrossel e arte).
//
// - `company_id` SEMPRE vem da sessão (perfil do usuário), nunca do cliente,
//   e restringe toda leitura e escrita.
// - O documento é normalizado no servidor: o banco só recebe o formato válido.
// - Toda imagem citada precisa pertencer à empresa (acervo ou produto).
// - Vídeo não é salvo por aqui: segue em `approveCampaignAndRender`.
// ============================================================================

import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { KIND_PAGE_LIMITS, normalizeDocument, type StudioDocument } from "./document";
import { getRecipe } from "./carousel-recipes";
import { buildFacts, proposeCarousel, type ProposalProduct, type ProposalPromotion } from "./proposal";
import { contentFormatFor, contentTitleFor, documentMediaIds, documentProductImages, studioKindOf } from "./content-mapping";

type SB = SupabaseClient<Database>;

export const STUDIO_MIGRATION_PENDING = "studio_migration_pending";

async function companyOf(supabase: SB, userId: string): Promise<string> {
  const { data, error } = await supabase.from("profiles").select("company_id").eq("id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.company_id) throw new Error("Usuário sem empresa.");
  return data.company_id;
}

function mapWriteError(error: { code?: string; message?: string }): Error {
  // Coluna `design` ou valor `carousel` ainda não existem neste banco.
  if (error.code === "42703" || error.code === "PGRST204" || error.code === "22P02" || /design|carousel/.test(error.message ?? "")) {
    return new Error(STUDIO_MIGRATION_PENDING);
  }
  return new Error(error.message ?? "studio_save_failed");
}

/** Toda imagem do documento precisa ser da empresa da sessão. */
export async function assertDocumentImagesOwned(supabase: SB, companyId: string, doc: StudioDocument): Promise<void> {
  const mediaIds = documentMediaIds(doc);
  if (mediaIds.length > 0) {
    const { data, error } = await supabase
      .from("marketing_media")
      .select("id, media_type, active")
      .in("id", mediaIds)
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);
    const ok = new Set((data ?? []).filter((m) => m.active && m.media_type === "image").map((m) => m.id));
    if (mediaIds.some((id) => !ok.has(id))) throw new Error("studio_image_not_owned");
  }
  const products = documentProductImages(doc);
  if (products.size > 0) {
    const { data, error } = await supabase
      .from("products")
      .select("id, images")
      .in("id", [...products.keys()])
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);
    const byId = new Map((data ?? []).map((p) => [p.id, Array.isArray(p.images) ? (p.images as unknown[]).filter((x): x is string => typeof x === "string") : []]));
    for (const [productId, paths] of products) {
      const owned = byId.get(productId);
      if (!owned || [...paths].some((path) => !owned.includes(path))) throw new Error("studio_image_not_owned");
    }
  }
}

const SaveInput = z.object({
  /** Ausente = cria um conteúdo novo (rascunho). */
  id: z.string().uuid().optional(),
  title: z.string().trim().max(200).nullable().optional(),
  /** Legenda do post. */
  caption: z.string().max(2200).optional(),
  document: z.unknown(),
  /**
   * Imagens finais exportadas (uma por página, na ordem), já no acervo.
   * Sem elas o conteúdo é só um rascunho editável, sem mídia publicável.
   */
  exported_media_ids: z.array(z.string().uuid()).max(KIND_PAGE_LIMITS.carousel.max).optional(),
});

export const saveStudioContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SaveInput.parse(i))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as SB;
    const companyId = await companyOf(supabase, context.userId);

    const doc = normalizeDocument(data.document);
    if (!doc) throw new Error("studio_document_invalid");
    if (doc.kind === "video") throw new Error("studio_kind_not_supported");
    if (doc.pages.length < KIND_PAGE_LIMITS[doc.kind].min) throw new Error("studio_too_few_pages");
    await assertDocumentImagesOwned(supabase, companyId, doc);

    const exported = data.exported_media_ids;
    if (exported) {
      if (exported.length !== doc.pages.length) throw new Error("studio_export_count_mismatch");
      const { data: rows, error } = await supabase.from("marketing_media").select("id, media_type, active").in("id", exported).eq("company_id", companyId);
      if (error) throw new Error(error.message);
      const ok = new Set((rows ?? []).filter((m) => m.active && m.media_type === "image").map((m) => m.id));
      if (exported.some((id) => !ok.has(id))) throw new Error("studio_image_not_owned");
    }

    const title = contentTitleFor(doc, data.title);
    const patch = {
      design: doc as unknown as never,
      format: contentFormatFor(doc),
      title,
      ...(data.caption !== undefined ? { body: data.caption } : {}),
      ...(exported ? { media_ids: exported, primary_image_media_id: exported[0] ?? null } : {}),
    };

    if (data.id) {
      const { data: current, error: readError } = await supabase
        .from("marketing_contents")
        .select("id, design, status")
        .eq("id", data.id)
        .eq("company_id", companyId)
        .maybeSingle();
      if (readError) throw mapWriteError(readError);
      if (!current) throw new Error("studio_content_not_found");
      // Só conteúdos criados no estúdio; nunca sobrescreve um vídeo ou post antigo.
      if (!studioKindOf(current as { design: unknown })) throw new Error("studio_content_not_editable");
      const { data: row, error } = await supabase
        .from("marketing_contents")
        // Editar depois de aprovado devolve o conteúdo para rascunho: a arte mudou.
        .update({ ...patch, ...(current.status === "approved" ? { status: "draft" as const, approved_at: null, approved_by: null } : {}) })
        .eq("id", data.id)
        .eq("company_id", companyId)
        .select("*")
        .single();
      if (error) throw mapWriteError(error);
      return { content: row };
    }

    const { data: row, error } = await supabase
      .from("marketing_contents")
      .insert({
        company_id: companyId,
        created_by: context.userId,
        channel: "instagram",
        status: "draft",
        body: data.caption ?? "",
        ...patch,
      })
      .select("*")
      .single();
    if (error) throw mapWriteError(error);
    return { content: row };
  });

export const getStudioContent = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as SB;
    const companyId = await companyOf(supabase, context.userId);
    const { data: row, error } = await supabase.from("marketing_contents").select("*").eq("id", data.id).eq("company_id", companyId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("studio_content_not_found");
    return { content: row };
  });

// ------------------------------ Proposta a partir do cadastro ---------------

/** Produtos e promoções da empresa que podem originar uma proposta. */
export const listStudioSources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as SB;
    const companyId = await companyOf(supabase, context.userId);
    const [products, promotions] = await Promise.all([
      supabase.from("products").select("id, name").eq("company_id", companyId).eq("active", true).order("name").limit(300),
      supabase.from("marketing_promotions").select("id, title, status").eq("company_id", companyId).neq("status", "ended").order("created_at", { ascending: false }).limit(100),
    ]);
    if (products.error) throw new Error(products.error.message);
    if (promotions.error) throw new Error(promotions.error.message);
    return {
      products: (products.data ?? []).map((p) => ({ id: p.id, name: p.name })),
      promotions: (promotions.data ?? []).map((p) => ({ id: p.id, title: p.title })),
    };
  });

const ProposeInput = z
  .object({
    product_id: z.string().uuid().nullable().optional(),
    promotion_id: z.string().uuid().nullable().optional(),
    recipe: z.string().max(40).optional(),
    format: z.enum(["portrait", "square"]).optional(),
  })
  .refine((v) => !!v.product_id || !!v.promotion_id, { message: "studio_proposal_needs_source" });

/**
 * Monta um carrossel proposto só com dados do cadastro da empresa (produto
 * e/ou promoção). Não chama modelo de IA e não grava nada: devolve o
 * documento para o usuário revisar no estúdio.
 */
export const proposeStudioCarousel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ProposeInput.parse(i))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as SB;
    const companyId = await companyOf(supabase, context.userId);

    let promotion: ProposalPromotion | null = null;
    if (data.promotion_id) {
      const { data: row, error } = await supabase
        .from("marketing_promotions")
        .select("id, title, description, price_original, price_promo, discount_percent, ends_at, whatsapp_cta_text, cover_media_id, product_id")
        .eq("id", data.promotion_id)
        .eq("company_id", companyId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!row) throw new Error("studio_source_not_found");
      promotion = row;
      // A promoção pode apontar o produto; o pedido explícito tem prioridade.
      if (!data.product_id && row.product_id) data.product_id = row.product_id;
    }

    let product: ProposalProduct | null = null;
    if (data.product_id) {
      const { data: row, error } = await supabase
        .from("products")
        .select("id, name, description, price, promo_price, included_items, images")
        .eq("id", data.product_id)
        .eq("company_id", companyId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!row) throw new Error("studio_source_not_found");
      product = {
        id: row.id,
        name: row.name,
        description: row.description,
        price: row.price,
        promo_price: row.promo_price,
        included_items: Array.isArray(row.included_items) ? row.included_items : [],
        images: Array.isArray(row.images) ? (row.images as unknown[]).filter((x): x is string => typeof x === "string") : [],
      };
    }

    const facts = buildFacts(product, promotion);
    const document = proposeCarousel(facts, getRecipe(data.recipe ?? (promotion ? "oferta" : "produto")), data.format ?? "portrait");
    // A capa da promoção precisa ser uma imagem ativa da empresa; senão sai da proposta.
    try {
      await assertDocumentImagesOwned(supabase, companyId, document);
    } catch {
      for (const page of document.pages) if (page.image?.origin === "marketing") page.image = null;
    }
    return {
      document: document as unknown as Record<string, never>,
      used: { has_price: !!(facts.priceNow || facts.priceFrom), has_discount: !!facts.discountPercent, images: facts.images.length },
    };
  });

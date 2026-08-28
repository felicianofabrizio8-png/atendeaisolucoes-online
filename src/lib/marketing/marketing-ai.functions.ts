// AI generator for Marketing content.
// - Runs entirely server-side; LOVABLE_API_KEY nunca sai do backend.
// - Uma única chamada estruturada gera os 4 formatos (Story, Feed, Reel, WhatsApp).
// - Valida a saída com Zod antes de persistir; falha total => zero conteúdo criado.
// - Todos os conteúdos gerados são gravados com status `draft`.

import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { z } from "zod";
import {
  rolesFromSelection,
  type CampaignRole,
} from "./campaign-formats";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type {
  MarketingContentChannel,
  MarketingContentFormat,
} from "./marketing.types";
import {
  buildBrandPromptBlock,
  loadMarketingBrandContext,
  sanitizeBrandContextForPersistence,
} from "./brand-context-adapter";
import {
  buildRecentSignaturesSet,
  normalizeOverlayCandidate,
} from "./overlay-texts";

type SB = SupabaseClient<Database>;

const GATEWAY_CHAT = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.5-flash";

const InputSchema = z.object({
  promotion_id: z.string().uuid().optional().nullable(),
  product_id: z.string().uuid().optional().nullable(),
  media_ids: z.array(z.string().uuid()).max(10).optional(),
  product_media_refs: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        image_path: z.string().min(1).max(500),
      }),
    )
    .max(10)
    .optional(),
  tone: z
    .enum(["amigável", "profissional", "descontraído", "urgente"])
    .optional()
    .default("amigável"),
  audience: z.string().trim().max(300).optional().nullable(),
  extra_instructions: z.string().trim().max(1000).optional().nullable(),
  // Seleção canônica de formatos (Feed / Story / Feed+Story). Quando ausente,
  // mantemos o comportamento histórico (ambos) para não quebrar chamadores
  // antigos desta função.
  campaign_formats: z
    .enum(["feed", "story", "feed_story"])
    .optional()
    .default("feed_story"),
});

async function validateProductMediaRefs(
  sb: SB,
  companyId: string,
  refs: Array<{ product_id: string; image_path: string }>,
): Promise<
  Array<{
    product_id: string;
    product_name: string;
    category: string | null;
    image_path: string;
  }>
> {
  if (!refs.length) return [];
  const productIds = Array.from(new Set(refs.map((r) => r.product_id)));
  const { data, error } = await sb
    .from("products")
    .select("id, name, category, images")
    .in("id", productIds)
    .eq("company_id", companyId);
  if (error) throw new Error(error.message);
  const byId = new Map(
    (data ?? []).map((p) => [
      p.id,
      {
        name: p.name as string,
        category: (p.category as string | null) ?? null,
        images: Array.isArray(p.images)
          ? (p.images.filter((x) => typeof x === "string") as string[])
          : [],
      },
    ]),
  );
  const out: Array<{
    product_id: string;
    product_name: string;
    category: string | null;
    image_path: string;
  }> = [];
  for (const ref of refs) {
    const p = byId.get(ref.product_id);
    if (!p) throw new Error(`Produto ${ref.product_id} não pertence à empresa.`);
    if (!p.images.includes(ref.image_path)) {
      throw new Error(
        `Imagem não pertence ao produto ${p.name}.`,
      );
    }
    out.push({
      product_id: ref.product_id,
      product_name: p.name,
      category: p.category,
      image_path: ref.image_path,
    });
  }
  return out;
}



// Catálogo de ângulos estratégicos disponíveis (usado para diversidade).
const STRATEGIC_ANGLES = [
  "pronta entrega",
  "instalação rápida",
  "valorização do imóvel",
  "lazer em família",
  "férias",
  "segurança das crianças",
  "economia comparada ao clube",
  "parcelamento",
  "garantia",
  "qualidade da fábrica",
  "atendimento consultivo",
  "transformação do quintal",
  "qualidade de vida",
  "investimento",
] as const;

// Schema JSON estrito para a resposta da IA — validado em runtime.
const StrategySchema = z.object({
  angle: z.string().trim().min(1).max(80),
  objective: z.string().trim().max(300),
  audience: z.string().trim().max(300),
  benefit: z.string().trim().max(300),
  differential: z.string().trim().max(300),
  objection_broken: z.string().trim().max(300),
  objections: z.array(z.string().trim().max(200)).max(6).default([]),
  emotion: z.string().trim().max(120),
  cta: z.string().trim().max(200),
  intent: z.enum(["marca", "orcamento", "relacionamento", "venda"]),
});

const ReelSceneSchema = z.object({
  scene: z.number().int().min(1).max(20),
  duration_seconds: z.number().min(0.5).max(30),
  media_reference: z.string().trim().max(200),
  framing: z.string().trim().max(200),
  camera_movement: z.string().trim().max(200),
  cut_style: z.string().trim().max(120),
  on_screen_text: z.string().trim().max(200),
  voiceover: z.string().trim().max(400),
  silence: z.boolean().default(false),
});

const ReelScriptSchema = z.object({
  format: z.enum(["video_based", "slideshow"]),
  total_duration_seconds: z.number().min(5).max(90),
  hook_summary: z.string().trim().max(300),
  music_suggestion: z.string().trim().max(200),
  scenes: z.array(ReelSceneSchema).min(2).max(12),
  final_cta_overlay: z.string().trim().max(200),
});

const BundleSchema = z.object({
  strategy: StrategySchema,
  // Fase M1 — texto visual ÚNICO da campanha (mesmo overlay em Feed e Story).
  // Limites amplos aqui; a validação estrita/reescrita acontece no helper
  // `normalizeOverlayCandidate` (nunca truncar, aplicar fallback etc.).
  image_texts: z.object({
    headline: z.string().trim().min(1).max(120),
    subheadline: z.string().trim().max(200).optional().default(""),
    cta: z.string().trim().max(120).optional().default(""),
  }),
  story: z.object({
    title: z.string().trim().max(120),
    body: z.string().trim().min(1).max(1500),
    hashtags: z.array(z.string().trim().max(60)).max(15).default([]),
  }),
  feed: z.object({
    title: z.string().trim().max(120),
    body: z.string().trim().min(1).max(2500),
    hashtags: z.array(z.string().trim().max(60)).max(15).default([]),
  }),
  reel: z.object({
    title: z.string().trim().max(120),
    body: z.string().trim().min(1).max(4000),
    hashtags: z.array(z.string().trim().max(60)).max(15).default([]),
    script: ReelScriptSchema,
  }),
  whatsapp: z.object({
    title: z.string().trim().max(120),
    body: z.string().trim().min(1).max(2000),
    cta_text: z.string().trim().min(1).max(200),
  }),
});

async function loadCompany(ctx: {
  supabase: unknown;
  userId: string;
}): Promise<{ companyId: string; userId: string; supabase: SB }> {
  const sb = ctx.supabase as SB;
  const { data: prof, error } = await sb
    .from("profiles")
    .select("company_id")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!prof?.company_id) throw new Error("Usuário sem empresa.");
  return { companyId: prof.company_id, userId: ctx.userId, supabase: sb };
}

async function loadPromotion(sb: SB, companyId: string, id: string) {
  const { data, error } = await sb
    .from("marketing_promotions")
    .select("*")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Promoção não pertence à empresa.");
  return data;
}

async function loadProduct(sb: SB, companyId: string, id: string) {
  const { data, error } = await sb
    .from("products")
    .select("id, name, description, price, category, active")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Produto não pertence à empresa.");
  return data;
}

async function validateMedia(sb: SB, companyId: string, ids: string[]) {
  if (!ids.length) return [] as Array<{
    id: string;
    media_type: string;
    title: string | null;
    description: string | null;
    tags: string[] | null;
  }>;
  const { data, error } = await sb
    .from("marketing_media")
    .select("id, media_type, title, description, tags")
    .in("id", ids)
    .eq("company_id", companyId);
  if (error) throw new Error(error.message);
  const found = new Set((data ?? []).map((r) => r.id));
  for (const id of ids) {
    if (!found.has(id)) throw new Error(`Mídia ${id} não pertence à empresa.`);
  }
  return (data ?? []) as Array<{
    id: string;
    media_type: string;
    title: string | null;
    description: string | null;
    tags: string[] | null;
  }>;
}

async function loadCompanyContext(sb: SB, companyId: string) {
  const { data: co } = await sb
    .from("companies")
    .select("name")
    .eq("id", companyId)
    .maybeSingle();
  const { data: settings } = await sb
    .from("company_settings")
    .select("ai_agent_name, greeting_message, signature")
    .eq("company_id", companyId)
    .maybeSingle();
  // Tenta buscar o WhatsApp configurado via view segura, sem acesso direto à
  // tabela `integrations` (que contém tokens e não deve ser legível pelo app).
  const { data: waIntegration } = await sb
    .from("integrations_safe")
    .select("external_account_id, account_metadata")
    .eq("channel", "whatsapp")
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  const waMeta = (waIntegration?.account_metadata ?? {}) as {
    display_phone_number?: string;
    phone_number?: string;
  };
  const whatsapp =
    waMeta.display_phone_number ??
    waMeta.phone_number ??
    waIntegration?.external_account_id ??
    null;
  return {
    companyName: co?.name ?? "sua empresa",
    agentName: settings?.ai_agent_name ?? "Atendente",
    greeting: settings?.greeting_message ?? null,
    signature: settings?.signature ?? null,
    defaultWhatsapp: whatsapp,
  };
}

async function loadKnowledgeBase(sb: SB, companyId: string) {
  const { data } = await sb
    .from("marketing_knowledge_base")
    .select(
      "brand_identity, tone_of_voice, differentiators, products_services, guarantees, cities_served, gifts, commercial_terms, next_load_forecast, preferred_words, forbidden_words, copy_best_practices, extra_notes",
    )
    .eq("company_id", companyId)
    .maybeSingle();
  return data ?? null;
}

function buildKnowledgeBlock(kb: Awaited<ReturnType<typeof loadKnowledgeBase>>): string {
  if (!kb) return "Base de conhecimento da empresa: (ainda não preenchida — use apenas o briefing).";
  const rows: Array<[string, string | null]> = [
    ["Identidade da marca", kb.brand_identity],
    ["Tom de comunicação preferido", kb.tone_of_voice],
    ["Diferenciais comerciais", kb.differentiators],
    ["Produtos e serviços", kb.products_services],
    ["Garantias", kb.guarantees],
    ["Cidades atendidas", kb.cities_served],
    ["Brindes", kb.gifts],
    ["Condições comerciais", kb.commercial_terms],
    ["Próxima carga prevista", kb.next_load_forecast],
    ["Palavras e expressões preferidas", kb.preferred_words],
    ["Palavras PROIBIDAS (nunca usar)", kb.forbidden_words],
    ["Boas práticas de copy", kb.copy_best_practices],
    ["Observações adicionais", kb.extra_notes],
  ];
  const filled = rows
    .filter(([, v]) => v && v.trim().length > 0)
    .map(([k, v]) => `- ${k}: ${v!.trim()}`)
    .join("\n");
  return filled
    ? `Base de conhecimento da empresa (use como contexto obrigatório em TODOS os textos):\n${filled}`
    : "Base de conhecimento da empresa: (ainda não preenchida — use apenas o briefing).";
}


function computeKbVersion(kb: Awaited<ReturnType<typeof loadKnowledgeBase>>): string {
  if (!kb) return "empty";
  const payload = JSON.stringify(kb);
  return createHash("sha256").update(payload).digest("hex").slice(0, 12);
}

function computeStrategyId(strategy: z.infer<typeof StrategySchema>): string {
  const seed = `${strategy.intent}|${strategy.angle}|${strategy.objective}|${strategy.emotion}|${strategy.cta}`
    .toLowerCase()
    .normalize("NFKD");
  return createHash("sha256").update(seed).digest("hex").slice(0, 10);
}

async function loadPastCampaigns(
  sb: SB,
  companyId: string,
  filters: { promotionId: string | null; productId: string | null },
) {
  // Busca as 8 memórias mais recentes, priorizando mesmo produto/promoção.
  const orClauses: string[] = [];
  if (filters.promotionId) orClauses.push(`promotion_id.eq.${filters.promotionId}`);
  if (filters.productId) orClauses.push(`product_id.eq.${filters.productId}`);
  let query = sb
    .from("marketing_campaign_memory")
    .select(
      "id, created_at, strategy_id, objective, audience, tone, strategy, story_title, feed_title, reel_title, whatsapp_title, product_id, promotion_id",
    )
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(8);
  if (orClauses.length > 0) {
    // Preferência por matches, mas ainda retorna outras se não houver bastante.
    const { data: matched } = await sb
      .from("marketing_campaign_memory")
      .select(
        "id, created_at, strategy_id, objective, audience, tone, strategy, story_title, feed_title, reel_title, whatsapp_title, product_id, promotion_id",
      )
      .eq("company_id", companyId)
      .or(orClauses.join(","))
      .order("created_at", { ascending: false })
      .limit(6);
    const { data: recent } = await query;
    const seen = new Set<string>();
    const merged: NonNullable<typeof matched> = [];
    for (const r of [...(matched ?? []), ...(recent ?? [])]) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        merged.push(r);
      }
      if (merged.length >= 8) break;
    }
    return merged;
  }
  const { data } = await query;
  return data ?? [];
}

function extractRecentAngles(
  past: Awaited<ReturnType<typeof loadPastCampaigns>>,
): string[] {
  const angles: string[] = [];
  for (const p of past.slice(0, 5)) {
    const s = (p.strategy ?? {}) as Record<string, unknown>;
    const a = typeof s.angle === "string" ? s.angle.trim().toLowerCase() : "";
    if (a) angles.push(a);
  }
  return angles;
}

function buildAngleDiversityBlock(recentAngles: string[]): string {
  const catalog = STRATEGIC_ANGLES.map((a) => `- ${a}`).join("\n");
  const recent = recentAngles.length
    ? recentAngles.map((a, i) => `${i + 1}. "${a}"`).join("\n")
    : "(nenhum ainda)";
  const forbidden = recentAngles.slice(0, 3);
  const forbiddenLine = forbidden.length
    ? `PROIBIDO repetir qualquer um destes ângulos recentes: ${forbidden
        .map((a) => `"${a}"`)
        .join(", ")}. Escolha OUTRO ângulo do catálogo.`
    : "Ainda não há ângulo recente — escolha livremente do catálogo o mais adequado ao briefing.";
  return `Catálogo de ângulos estratégicos disponíveis:\n${catalog}\n\nÂngulos usados nas últimas campanhas (mais recente primeiro):\n${recent}\n\n${forbiddenLine}`;
}

function buildPastCampaignsBlock(
  past: Awaited<ReturnType<typeof loadPastCampaigns>>,
): string {
  if (!past.length) {
    return "Histórico de campanhas anteriores desta empresa: (nenhuma ainda — esta é a primeira).";
  }
  const lines = past.map((p, i) => {
    const s = (p.strategy ?? {}) as Record<string, unknown>;
    const objective = (s.objective as string) ?? p.objective ?? "-";
    const intent = (s.intent as string) ?? "-";
    const angle = (s.angle as string) ?? "-";
    const cta = (s.cta as string) ?? "-";
    const titles = [p.story_title, p.feed_title, p.reel_title, p.whatsapp_title]
      .filter(Boolean)
      .map((t) => `"${t}"`)
      .join(" | ");
    return `${i + 1}. [${new Date(p.created_at).toISOString().slice(0, 10)}] ângulo=${angle} · intenção=${intent} · objetivo=${objective} · cta=${cta} · títulos: ${titles || "-"}`;
  });
  return `Referências estratégicas de campanhas passadas (APENAS para evitar repetição — NÃO copie textos, títulos, ângulos ou CTAs; varie abertura, ângulo e estrutura):\n${lines.join("\n")}`;
}



async function loadRecentOverlays(
  sb: SB,
  companyId: string,
  limit = 30,
): Promise<Array<{ overlay_headline: string | null; overlay_subheadline: string | null }>> {
  try {
    const { data, error } = await sb
      .from("marketing_contents")
      .select("overlay_headline, overlay_subheadline")
      .eq("company_id", companyId)
      .not("overlay_headline", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return [];
    return (data ?? []) as Array<{
      overlay_headline: string | null;
      overlay_subheadline: string | null;
    }>;
  } catch {
    return [];
  }
}

export const generateMarketingContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => InputSchema.parse(i))
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY não configurada.");

    const { companyId, userId, supabase } = await loadCompany(context);

    const mediaIds = data.media_ids ?? [];
    const mediaDetails = await validateMedia(supabase, companyId, mediaIds);
    const productMediaRefs = data.product_media_refs ?? [];
    const productMediaDetails = await validateProductMediaRefs(
      supabase,
      companyId,
      productMediaRefs,
    );


    const promotion = data.promotion_id
      ? await loadPromotion(supabase, companyId, data.promotion_id)
      : null;
    const product = data.product_id
      ? await loadProduct(supabase, companyId, data.product_id)
      : null;

    const brand = await loadCompanyContext(supabase, companyId);
    // Brand Center (Fase 3): identidade visual publicada consumida via adapter.
    // Signed URL da logo é efêmera — nunca é persistida no snapshot.
    const marketingBrand = await loadMarketingBrandContext(supabase, companyId);
    const brandPromptBlock = buildBrandPromptBlock(marketingBrand);
    const kb = await loadKnowledgeBase(supabase, companyId);
    const knowledgeBlock = buildKnowledgeBlock(kb);
    const kbVersion = computeKbVersion(kb);
    const pastCampaigns = await loadPastCampaigns(supabase, companyId, {
      promotionId: data.promotion_id ?? null,
      productId: data.product_id ?? null,
    });
    const pastBlock = buildPastCampaignsBlock(pastCampaigns);
    // Fase M1 — carrega textos visuais recentes para o bloco de diversidade e
    // para a validação anti-repetição pós-geração. Best-effort; sem histórico
    // o fluxo segue normalmente.
    const recentOverlays = await loadRecentOverlays(supabase, companyId, 30);
    const recentOverlaySignatures = buildRecentSignaturesSet(recentOverlays);
    const overlayHistoryBlock = recentOverlays.length
      ? `Textos visuais (overlay) usados nas últimas ${recentOverlays.length} campanhas — NÃO repita nenhum destes headlines nem combinações headline+subtítulo:\n${recentOverlays
          .slice(0, 15)
          .map(
            (r, i) =>
              `${i + 1}. "${r.overlay_headline}"${r.overlay_subheadline ? ` · "${r.overlay_subheadline}"` : ""}`,
          )
          .join("\n")}`
      : "Ainda não há textos visuais anteriores — você tem liberdade total nesta campanha.";
    const recentAngles = extractRecentAngles(pastCampaigns);
    const angleBlock = buildAngleDiversityBlock(recentAngles);
    const productLockActive = Boolean(product && promotion);

    // Prompt estruturado — o modelo produz UM único objeto com os 4 formatos.
    const promoBlock = promotion
      ? `Promoção: ${promotion.title}
Descrição: ${promotion.description ?? "-"}
Preço original: ${promotion.price_original ?? "-"}
Preço promocional: ${promotion.price_promo ?? "-"}
Desconto: ${promotion.discount_percent ?? "-"}%
Período: ${promotion.starts_at ?? "-"} a ${promotion.ends_at ?? "-"}
CTA WhatsApp preferido: ${promotion.whatsapp_cta_text ?? "-"}
Destino WhatsApp preferido: ${promotion.whatsapp_destination ?? brand.defaultWhatsapp ?? "-"}`
      : "Sem promoção específica associada.";

    const productBlock = product
      ? `Produto: ${product.name}
Descrição: ${product.description ?? "-"}
Preço: ${product.price ?? "-"}
Categoria: ${product.category ?? "-"}`
      : "Sem produto específico associado.";

    const mediaLines: string[] = [];
    mediaDetails.forEach((m) => {
      const tags = (m.tags ?? []).filter(Boolean).join(", ");
      mediaLines.push(
        `[MARKETING · ${m.media_type}] ${m.title ?? "(sem título)"}${
          m.description ? ` — ${m.description}` : ""
        }${tags ? ` [tags: ${tags}]` : ""}`,
      );
    });
    productMediaDetails.forEach((p) => {
      mediaLines.push(
        `[PRODUTO · image] ${p.product_name}${
          p.category ? ` — categoria: ${p.category}` : ""
        } (referência oficial do catálogo, sem duplicação)`,
      );
    });
    const totalMedia = mediaLines.length;
    const mediaBlock = totalMedia
      ? `Mídias selecionadas (${totalMedia}) — use APENAS estas como base visual. Fotos com origem PRODUTO são imagens oficiais do catálogo; trate-as como material visual real disponível:\n` +
        mediaLines.map((l, i) => `${i + 1}. ${l}`).join("\n")
      : "Sem mídias selecionadas.";

    const hasVideo = mediaDetails.some((m) => m.media_type === "video");
    const hasImage =
      mediaDetails.some((m) => m.media_type === "image") ||
      productMediaDetails.length > 0;

    const reelFormat: "video_based" | "slideshow" = hasVideo
      ? "video_based"
      : "slideshow";
    const reelHint = hasVideo
      ? "Você tem vídeo(s) real(is) selecionado(s). USE-OS como base principal do roteiro. Referencie cada cena descrevendo o vídeo real (por título/tag) — nunca invente cenas inexistentes. Combine com fotos disponíveis se ajudar a contar a história."
      : hasImage
        ? "NÃO há vídeo — apenas fotos (incluindo fotos oficiais de PRODUTO, quando houver). Monte o roteiro em formato SLIDESHOW: cada cena corresponde a uma foto real com movimento simulado (zoom-in, zoom-out, pan lateral, tilt, dolly, parallax). Nunca invente cenas filmadas."
        : "Nenhuma mídia foi selecionada — descreva um roteiro genérico baseado em movimento e transições, sem inventar cenas específicas.";

    // Seed para incentivar variação entre gerações consecutivas.
    const variationSeed = Math.random().toString(36).slice(2, 10);

    const productLockBlock = productLockActive && product
      ? `# TRAVA DE FOCO NO PRODUTO (obrigatória)
A promoção está vinculada ao produto "${product.name}". Toda a campanha (Story, Feed, Reel, WhatsApp) DEVE permanecer focada exclusivamente nesse produto. É PROIBIDO citar, comparar ou sugerir outros modelos, tamanhos, linhas ou produtos da empresa, salvo se estiver explicitamente pedido nas instruções extras.`
      : "";

    const sys = `Você é um DIRETOR DE CRIAÇÃO sênior de uma agência de publicidade brasileira especializada em marketing para PISCINAS, atuando para a empresa "${brand.companyName}". Você não é um redator de legendas: você é o cérebro estratégico e criativo por trás de cada campanha. Antes de escrever qualquer palavra, você dirige a campanha.

${knowledgeBlock}

${brandPromptBlock}

# ETAPA 1 — DIREÇÃO ESTRATÉGICA (obrigatória, precede qualquer texto)
Como Diretor de Criação, decida DELIBERADAMENTE para esta campanha:
1. **ÂNGULO principal de venda** (obrigatório escolher UM do catálogo abaixo, respeitando a diversidade histórica);
2. **EMOÇÃO** que deseja despertar (ex.: aconchego familiar, orgulho, alívio financeiro, alegria das crianças, sensação de conquista, tranquilidade, pertencimento);
3. **DIFERENCIAL** da empresa que sustenta o ângulo (extraído da Base de Conhecimento — não invente);
4. **OBJEÇÃO principal a quebrar** (ex.: "é caro", "vai dar trabalho", "não vou usar tanto", "medo de manutenção", "prazo longo");
5. **CTA de maior conversão** para a intenção definida (não confunda CTA de marca com CTA de venda);
6. **INTENÇÃO** (marca, orcamento, relacionamento ou venda).

# DIVERSIDADE ESTRATÉGICA DE ÂNGULOS
${angleBlock}
Regras absolutas:
- Escolha o ângulo ANTES de escrever qualquer conteúdo.
- Um único ângulo domina toda a campanha (os 4 formatos exploram o mesmo).
- NUNCA repita automaticamente o ângulo das últimas campanhas.
- Se todos os ângulos do catálogo já foram usados recentemente, escolha o menos frequente.

${productLockBlock}

# ETAPA 2 — GERAÇÃO DOS 4 FORMATOS
Os 4 formatos (Story, Feed, Reel, WhatsApp) fazem parte da MESMA campanha, exploram o MESMO ângulo escolhido e devem conversar entre si:
- Story desperta interesse pelo ângulo;
- Feed aprofunda o argumento e quebra a objeção;
- Reel demonstra visualmente o ângulo com um roteiro cinematográfico;
- WhatsApp converte com abordagem individual.
NÃO gere quatro peças independentes.

# ORDEM DE CONTEXTO (nesta prioridade)
1. Base de Conhecimento  2. Promoção  3. Produto  4. Mídias selecionadas  5. Instruções extras.
Nunca use apenas a promoção como fonte.

# INFORMAÇÕES QUE VOCÊ NUNCA PODE INVENTAR
Descontos, parcelamentos, brindes, garantia, pronta entrega, instalação, estoque, prazos, cidades atendidas, formas de pagamento e serviços SÓ podem aparecer se estiverem explicitamente na Promoção ou na Base de Conhecimento. Se não estiverem, omita.

# REGRAS DA BASE DE CONHECIMENTO
- Reflita identidade e tom em todos os textos.
- Use palavras/expressões preferidas quando fizerem sentido natural.
- NUNCA use nenhuma das palavras proibidas.
- Não contradiga nem amplie garantias, diferenciais, cidades, brindes ou condições.
- Se a base estiver vazia, gere conteúdo neutro sem inventar atributos.

# LINGUAGEM PROIBIDA (frases genéricas — NÃO use nem variações próximas)
"Transforme seu quintal em um oásis", "Você merece", "Seu sonho começa agora", "Não perca essa oportunidade", "Oportunidade imperdível", "Última chance", "Aproveite já", "Corra que é por tempo limitado", "O melhor da região", "Qualidade incomparável".

# ESTILO POR FORMATO
- FEED: consultor experiente. Priorize benefícios reais, diferenciais verdadeiros, atendimento consultivo, linguagem humana. Emojis com parcimônia. Até 3 CTAs. Quebre a objeção definida.
- STORY: texto curto, 1 a 3 frases, CTA forte, pouquíssimo texto. Reforça o ângulo.
- REEL — ROTEIRO CINEMATOGRÁFICO COMPLETO (obrigatório): você é o diretor deste Reel. Formato desta geração: **${reelFormat}** (${reelHint}). Devolva no objeto \`reel.script\`:
  · \`format\`: "${reelFormat}";
  · \`total_duration_seconds\`: duração total entre 15 e 60s;
  · \`hook_summary\`: descrição do gancho dos 3 primeiros segundos;
  · \`music_suggestion\`: estilo musical/ritmo sugerido (ex.: "lo-fi acústico, BPM 90, sensação de aconchego familiar") — nunca cite marcas ou faixas com direitos;
  · \`scenes\`: sequência de 3 a 8 cenas numeradas, cada uma com \`duration_seconds\`, \`media_reference\` (referência textual à mídia real usada — vídeo ou foto do bloco de mídias; se não houver mídia, escreva "sem mídia"), \`framing\` (ex.: close, plano médio, plano geral, contra-plongée, drone), \`camera_movement\` (ex.: dolly-in lento, pan lateral, zoom-in suave, static, tilt-up), \`cut_style\` (ex.: corte seco, match-cut, cross-dissolve, whip-pan), \`on_screen_text\` (texto curto que aparece sobreposto, ou "" se não houver), \`voiceover\` (narração daquela cena, ou "" se não houver), \`silence\` (true se a cena for de silêncio proposital, sem narração e sem música dominante);
  · \`final_cta_overlay\`: texto de CTA visual da cena final.
  Coloque também em \`reel.body\` uma versão em texto legível do mesmo roteiro (cena por cena, para o humano aprovar). E use \`reel.title\` como título curto do vídeo.
- WHATSAPP: mensagem individual, conversacional, sem cara de disparo em massa. Foco em relacionamento. NÃO inclua telefone no corpo.

# TEXTO VISUAL DA CAMPANHA (image_texts) — obrigatório
Além dos 4 formatos, você produz UM ÚNICO bloco \`image_texts\` que será usado como texto sobreposto na imagem/vídeo. É o MESMO overlay para Feed e Story — não crie versões diferentes.
Regras rigorosas (leitura em <1s no celular):
- \`headline\`: entre 2 e 5 palavras, no máximo 28 caracteres, uma ideia só, alto impacto, jamais frase incompleta ou terminando em conectivo. Exemplos válidos: "Seu verão começa", "Mais lazer", "Piscina dos sonhos", "Conforto para família", "Qualidade Solário".
- \`subheadline\`: opcional, no máximo 45 caracteres, entre 3 e 8 palavras, UMA frase curta, complementa o headline SEM repetir literalmente. Deixe vazio se não conseguir cumprir.
- \`cta\`: opcional, no máximo 4 palavras. Exemplos: "Peça orçamento", "Conheça os modelos", "Fale conosco".
NÃO use nenhuma das frases proibidas. NÃO repita os textos visuais recentes abaixo. Não é uma legenda — é o texto grande da peça visual.

## Textos visuais recentes desta empresa
${overlayHistoryBlock}

# VARIAÇÃO
Seed desta geração: ${variationSeed}. Varie abertura, CTA, estrutura, argumentos e organização em relação a gerações anteriores.

# HISTÓRICO INTERNO (aprendizado com campanhas passadas desta empresa)
${pastBlock}
Use este histórico APENAS como referência estratégica: identifique padrões que funcionaram, evite repetir os mesmos títulos/CTAs/ângulos, mas gere textos totalmente inéditos. NUNCA copie trechos das campanhas anteriores.

# AUTOVALIDAÇÃO ANTES DE RESPONDER
Confira: (a) escolheu UM ângulo do catálogo e ele NÃO está entre os últimos usados; (b) coerência com a base de conhecimento; (c) zero informação inventada; (d) os 4 formatos formam uma campanha coerente em torno do ângulo; (e) linguagem natural; (f) nenhuma frase genérica proibida; (g) nada copiado do histórico; (h) o Reel tem roteiro cinematográfico completo com cenas, enquadramentos e cortes; (i) se há trava de produto, nenhum outro modelo/produto foi citado; (j) \`image_texts\` respeita rigorosamente os limites de palavras/caracteres e não repete textos visuais recentes.

Devolva o objeto \`strategy\` (direção interna) + \`image_texts\` + os 4 formatos em UMA ÚNICA chamada da ferramenta \`generate_marketing_bundle\`. Tom base: ${data.tone ?? "amigável"}.`;




    const usr = `Briefing desta campanha:

## Promoção
${promoBlock}

## Produto
${productBlock}

## Mídias
${mediaBlock}

## Público-alvo
${data.audience ?? "clientes locais interessados"}

## Instruções extras
${data.extra_instructions ?? "-"}

Gere agora o bundle. Lembre-se: planeje internamente antes; NÃO invente dados fora da promoção e da base de conhecimento; NÃO use as frases proibidas; os 4 formatos são uma única campanha.`;


    const bundleJsonSchema = {
      type: "object",
      additionalProperties: false,
      properties: {
        strategy: {
          type: "object",
          additionalProperties: false,
          properties: {
            angle: { type: "string" },
            objective: { type: "string" },
            audience: { type: "string" },
            benefit: { type: "string" },
            differential: { type: "string" },
            objection_broken: { type: "string" },
            objections: { type: "array", items: { type: "string" } },
            emotion: { type: "string" },
            cta: { type: "string" },
            intent: {
              type: "string",
              enum: ["marca", "orcamento", "relacionamento", "venda"],
            },
          },
          required: [
            "angle",
            "objective",
            "audience",
            "benefit",
            "differential",
            "objection_broken",
            "objections",
            "emotion",
            "cta",
            "intent",
          ],
        },
        image_texts: {
          type: "object",
          additionalProperties: false,
          properties: {
            headline: { type: "string" },
            subheadline: { type: "string" },
            cta: { type: "string" },
          },
          required: ["headline", "subheadline", "cta"],
        },
        story: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            body: { type: "string" },
            hashtags: { type: "array", items: { type: "string" } },
          },
          required: ["title", "body", "hashtags"],
        },
        feed: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            body: { type: "string" },
            hashtags: { type: "array", items: { type: "string" } },
          },
          required: ["title", "body", "hashtags"],
        },
        reel: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            body: { type: "string" },
            hashtags: { type: "array", items: { type: "string" } },
            script: {
              type: "object",
              additionalProperties: false,
              properties: {
                format: { type: "string", enum: ["video_based", "slideshow"] },
                total_duration_seconds: { type: "number" },
                hook_summary: { type: "string" },
                music_suggestion: { type: "string" },
                scenes: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      scene: { type: "number" },
                      duration_seconds: { type: "number" },
                      media_reference: { type: "string" },
                      framing: { type: "string" },
                      camera_movement: { type: "string" },
                      cut_style: { type: "string" },
                      on_screen_text: { type: "string" },
                      voiceover: { type: "string" },
                      silence: { type: "boolean" },
                    },
                    required: [
                      "scene",
                      "duration_seconds",
                      "media_reference",
                      "framing",
                      "camera_movement",
                      "cut_style",
                      "on_screen_text",
                      "voiceover",
                      "silence",
                    ],
                  },
                },
                final_cta_overlay: { type: "string" },
              },
              required: [
                "format",
                "total_duration_seconds",
                "hook_summary",
                "music_suggestion",
                "scenes",
                "final_cta_overlay",
              ],
            },
          },
          required: ["title", "body", "hashtags", "script"],
        },
        whatsapp: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            body: { type: "string" },
            cta_text: { type: "string" },
          },
          required: ["title", "body", "cta_text"],
        },
      },
      required: ["strategy", "image_texts", "story", "feed", "reel", "whatsapp"],
    };

    const payload = {
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: usr },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "generate_marketing_bundle",
            description: "Retorna os 4 formatos de conteúdo em um único objeto.",
            parameters: bundleJsonSchema,
          },
        },
      ],
      tool_choice: {
        type: "function",
        function: { name: "generate_marketing_bundle" },
      },
    };

    const res = await fetch(GATEWAY_CHAT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      if (res.status === 429) {
        throw new Error("Limite de requisições da IA atingido. Aguarde e tente novamente.");
      }
      if (res.status === 402) {
        throw new Error(
          "Créditos de IA esgotados. Adicione créditos em Configurações > Workspace.",
        );
      }
      throw new Error("Falha ao consultar a IA de marketing.");
    }

    const raw = await res.json();
    const tc = raw?.choices?.[0]?.message?.tool_calls?.[0];
    if (!tc?.function?.arguments) {
      throw new Error("A IA não retornou dados estruturados.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(tc.function.arguments);
    } catch {
      throw new Error("A IA retornou JSON inválido.");
    }
    const bundle = BundleSchema.parse(parsed);

    // Compõe uma versão legível do roteiro do Reel — sempre incluída no body
    // para que o humano aprove com todos os elementos cinematográficos à vista.
    const reelScriptText = (() => {
      const s = bundle.reel.script;
      const header = `🎬 Roteiro cinematográfico — formato: ${s.format === "video_based" ? "baseado em vídeo real" : "slideshow de fotos"} · duração total: ${s.total_duration_seconds}s
🎵 Música sugerida: ${s.music_suggestion}
🎯 Gancho (3s iniciais): ${s.hook_summary}`;
      const scenes = s.scenes
        .map((sc) => {
          const bits = [
            `Cena ${sc.scene} · ${sc.duration_seconds}s`,
            `  📺 Mídia: ${sc.media_reference || "-"}`,
            `  🎞️ Enquadramento: ${sc.framing}`,
            `  🎥 Câmera: ${sc.camera_movement}`,
            `  ✂️ Corte: ${sc.cut_style}`,
            sc.on_screen_text ? `  🅰️ Texto em tela: "${sc.on_screen_text}"` : "",
            sc.silence
              ? `  🤫 Momento de silêncio proposital`
              : sc.voiceover
                ? `  🎙️ Narração: "${sc.voiceover}"`
                : "",
          ].filter(Boolean);
          return bits.join("\n");
        })
        .join("\n\n");
      const footer = `CTA final na tela: "${s.final_cta_overlay}"`;
      return `${header}\n\n${scenes}\n\n${footer}`;
    })();
    const reelBodyComposed = `${bundle.reel.body.trim()}\n\n──────────\n${reelScriptText}`;

    // Guarda-diversidade: se por algum motivo o ângulo escolhido coincidir
    // com um dos 3 mais recentes, registramos o aviso no snapshot (não bloqueia
    // a geração — a diretriz principal já foi passada no prompt).
    const chosenAngle = bundle.strategy.angle.trim().toLowerCase();
    const angleRepeatedRecent = recentAngles.slice(0, 3).includes(chosenAngle);


    // Fase M1 — normaliza image_texts (validação/reescrita/anti-repetição).
    // Feed e Story recebem EXATAMENTE o mesmo overlay. Legendas ficam intactas.
    const overlay = normalizeOverlayCandidate(
      bundle.image_texts,
      {
        title: bundle.feed.title,
        body: bundle.feed.body,
        cta_text: bundle.whatsapp.cta_text,
      },
      recentOverlaySignatures,
    );

    // Persistência atômica: 4 registros ou nenhum.
    const promptSnapshot = {
      tone: data.tone,
      audience: data.audience ?? null,
      extra_instructions: data.extra_instructions ?? null,
      promotion_id: data.promotion_id ?? null,
      product_id: data.product_id ?? null,
      media_ids: mediaIds,
      // Persistência da escolha do usuário — fonte de verdade para aprovação,
      // render e publicação (lida por `resolveCampaignFormats`).
      formats: data.campaign_formats,
      product_media_refs: productMediaDetails.map((p) => ({
        product_id: p.product_id,
        image_path: p.image_path,
      })),
      chosen_angle: bundle.strategy.angle,
      angle_repeated_recent: angleRepeatedRecent,
      recent_angles: recentAngles.slice(0, 5),
      product_focus_locked: productLockActive,
      reel_format: bundle.reel.script.format,
      // Brand Center snapshot SEM signed URL — sanitizado no adapter.
      brand: sanitizeBrandContextForPersistence(marketingBrand),
      // Fase M1 — telemetria sanitizada da normalização do overlay.
      overlay_telemetry: overlay.telemetry,
      overlay_recent_count: recentOverlays.length,
    } as unknown as Database["public"]["Tables"]["marketing_contents"]["Insert"]["ai_prompt"];
    const rowsToInsert: Database["public"]["Tables"]["marketing_contents"]["Insert"][] = [
      {
        company_id: companyId,
        promotion_id: data.promotion_id ?? null,
        product_id: data.product_id ?? null,
        media_ids: mediaIds,
        channel: "instagram" as MarketingContentChannel,
        format: "story" as MarketingContentFormat,
        title: bundle.story.title,
        body: bundle.story.body,
        hashtags: bundle.story.hashtags,
        cta_text: null,
        cta_destination: null,
        // Fase M1 — overlay compartilhado com o Feed.
        overlay_headline: overlay.overlay_headline,
        overlay_subheadline: overlay.overlay_subheadline,
        overlay_cta: overlay.overlay_cta,
        // Approval-gate — snapshot da 1ª sugestão para "Restaurar original".
        overlay_original_headline: overlay.overlay_headline,
        overlay_original_subheadline: overlay.overlay_subheadline,
        overlay_original_cta: overlay.overlay_cta,
        ai_model: DEFAULT_MODEL,
        ai_prompt: promptSnapshot,
        ai_raw_output: bundle.story,
        status: "draft",
        created_by: userId,
      },
      {
        company_id: companyId,
        promotion_id: data.promotion_id ?? null,
        product_id: data.product_id ?? null,
        media_ids: mediaIds,
        channel: "instagram" as MarketingContentChannel,
        format: "feed" as MarketingContentFormat,
        title: bundle.feed.title,
        body: bundle.feed.body,
        hashtags: bundle.feed.hashtags,
        cta_text: null,
        cta_destination: null,
        // Fase M1 — overlay compartilhado com o Story (mesmos valores).
        overlay_headline: overlay.overlay_headline,
        overlay_subheadline: overlay.overlay_subheadline,
        overlay_cta: overlay.overlay_cta,
        // Approval-gate — snapshot da 1ª sugestão para "Restaurar original".
        overlay_original_headline: overlay.overlay_headline,
        overlay_original_subheadline: overlay.overlay_subheadline,
        overlay_original_cta: overlay.overlay_cta,
        ai_model: DEFAULT_MODEL,
        ai_prompt: promptSnapshot,
        ai_raw_output: bundle.feed,
        status: "draft",
        created_by: userId,
      },
      {
        company_id: companyId,
        promotion_id: data.promotion_id ?? null,
        product_id: data.product_id ?? null,
        media_ids: mediaIds,
        channel: "instagram" as MarketingContentChannel,
        format: "reel" as MarketingContentFormat,
        title: bundle.reel.title,
        body: reelBodyComposed,
        hashtags: bundle.reel.hashtags,
        cta_text: null,
        cta_destination: null,
        ai_model: DEFAULT_MODEL,
        ai_prompt: promptSnapshot,
        ai_raw_output: bundle.reel,
        status: "draft",
        created_by: userId,
      },
      {
        company_id: companyId,
        promotion_id: data.promotion_id ?? null,
        product_id: data.product_id ?? null,
        media_ids: mediaIds,
        channel: "whatsapp" as MarketingContentChannel,
        format: "whatsapp_cta" as MarketingContentFormat,
        title: bundle.whatsapp.title,
        body: bundle.whatsapp.body,
        hashtags: [],
        cta_text: bundle.whatsapp.cta_text,
        cta_destination:
          promotion?.whatsapp_destination ?? brand.defaultWhatsapp ?? null,
        ai_model: DEFAULT_MODEL,
        ai_prompt: promptSnapshot,
        ai_raw_output: bundle.whatsapp,
        status: "draft",
        created_by: userId,
      },
    ];

    // A IA continua produzindo o bundle completo (Story/Feed/Reel/WhatsApp),
    // mas só materializamos as linhas de campanha (feed/story) escolhidas.
    // Reel e WhatsApp são conteúdos auxiliares e seguem inalterados.
    const enabledRoles = rolesFromSelection(data.campaign_formats);
    const rowsFiltered = rowsToInsert.filter((r) => {
      const f = r.format as string;
      if (f === "feed" || f === "story") {
        return enabledRoles.includes(f as CampaignRole);
      }
      return true;
    });

    const { data: inserted, error } = await supabase
      .from("marketing_contents")
      .insert(rowsFiltered)
      .select("*");
    if (error) throw new Error(error.message);

    // Learning loop (Fase de aprendizado contínuo):
    // grava a memória histórica desta campanha. Falhas aqui não devem
    // derrubar a geração — o loop é auxiliar, não crítico.
    try {
      const strategyId = computeStrategyId(bundle.strategy);
      await supabase.from("marketing_campaign_memory").insert({
        company_id: companyId,
        promotion_id: data.promotion_id ?? null,
        product_id: data.product_id ?? null,
        strategy_id: strategyId,
        objective: bundle.strategy.objective,
        audience: bundle.strategy.audience,
        tone: data.tone ?? null,
        strategy: bundle.strategy as unknown as Database["public"]["Tables"]["marketing_campaign_memory"]["Insert"]["strategy"],
        story_title: bundle.story.title,
        story_body: bundle.story.body,
        feed_title: bundle.feed.title,
        feed_body: bundle.feed.body,
        reel_title: bundle.reel.title,
        reel_body: reelBodyComposed,
        whatsapp_title: bundle.whatsapp.title,
        whatsapp_body: bundle.whatsapp.body,
        media_ids: mediaIds,
        kb_version: kbVersion,
        created_by: userId,
      });
    } catch {
      // silencia — memória histórica é best-effort nesta fase.
    }

    return { contents: inserted ?? [] };
  });

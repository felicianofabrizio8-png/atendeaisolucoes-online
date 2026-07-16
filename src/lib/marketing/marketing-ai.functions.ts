// AI generator for Marketing content.
// - Runs entirely server-side; LOVABLE_API_KEY nunca sai do backend.
// - Uma única chamada estruturada gera os 4 formatos (Story, Feed, Reel, WhatsApp).
// - Valida a saída com Zod antes de persistir; falha total => zero conteúdo criado.
// - Todos os conteúdos gerados são gravados com status `draft`.

import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type {
  MarketingContentChannel,
  MarketingContentFormat,
} from "./marketing.types";

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



// Schema JSON estrito para a resposta da IA — validado em runtime.
const StrategySchema = z.object({
  objective: z.string().trim().max(300),
  audience: z.string().trim().max(300),
  benefit: z.string().trim().max(300),
  differential: z.string().trim().max(300),
  objections: z.array(z.string().trim().max(200)).max(6).default([]),
  emotion: z.string().trim().max(120),
  cta: z.string().trim().max(200),
  intent: z.enum(["marca", "orcamento", "relacionamento", "venda"]),
});
const BundleSchema = z.object({
  strategy: StrategySchema,
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
    body: z.string().trim().min(1).max(2500),
    hashtags: z.array(z.string().trim().max(60)).max(15).default([]),
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
  // Tenta buscar o WhatsApp configurado; se existir, sugere como destino padrão.
  const { data: waIntegration } = await sb
    .from("integrations")
    .select("external_account_id, account_metadata")
    .eq("company_id", companyId)
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
      "brand_identity, tone_of_voice, differentiators, products_services, guarantees, cities_served, gifts, commercial_terms, preferred_words, forbidden_words, copy_best_practices, extra_notes",
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
  const seed = `${strategy.intent}|${strategy.objective}|${strategy.emotion}|${strategy.cta}`
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
    const cta = (s.cta as string) ?? "-";
    const titles = [p.story_title, p.feed_title, p.reel_title, p.whatsapp_title]
      .filter(Boolean)
      .map((t) => `"${t}"`)
      .join(" | ");
    return `${i + 1}. [${new Date(p.created_at).toISOString().slice(0, 10)}] intenção=${intent} · objetivo=${objective} · cta=${cta} · títulos usados: ${titles || "-"}`;
  });
  return `Referências estratégicas de campanhas passadas (APENAS para evitar repetição — NÃO copie textos, títulos ou CTAs; varie abertura, ângulo e estrutura):\n${lines.join("\n")}`;
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
    const kb = await loadKnowledgeBase(supabase, companyId);
    const knowledgeBlock = buildKnowledgeBlock(kb);
    const kbVersion = computeKbVersion(kb);
    const pastCampaigns = await loadPastCampaigns(supabase, companyId, {
      promotionId: data.promotion_id ?? null,
      productId: data.product_id ?? null,
    });
    const pastBlock = buildPastCampaignsBlock(pastCampaigns);

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

    const reelHint = hasVideo
      ? "Você tem vídeo(s) disponível(is): descreva um roteiro que use as cenas reais informadas."
      : hasImage
        ? "NÃO há vídeo — apenas fotos. Monte o roteiro do Reel como sequência de fotos com movimento (zoom, pan, transições), sem inventar cenas filmadas."
        : "Nenhuma mídia foi selecionada — descreva um roteiro genérico baseado em movimento e transições, sem inventar cenas específicas.";

    // Seed para incentivar variação entre gerações consecutivas.
    const variationSeed = Math.random().toString(36).slice(2, 10);

    const sys = `Você é um ESTRATEGISTA de marketing digital sênior brasileiro, atuando como consultor da empresa "${brand.companyName}". Você não é apenas um copywriter: antes de escrever, você planeja a campanha.

${knowledgeBlock}

# ETAPA 1 — PLANEJAMENTO INTERNO (obrigatório, não aparece na saída)
Antes de gerar qualquer texto, defina mentalmente:
- objetivo da campanha (marca, orçamento, relacionamento ou venda);
- público-alvo específico;
- principal benefício ao cliente;
- principal diferencial da empresa (da base de conhecimento);
- objeções prováveis a reduzir;
- emoção predominante desejada;
- melhor CTA para a intenção definida.

# ETAPA 2 — GERAÇÃO DOS 4 FORMATOS
Os 4 formatos (Story, Feed, Reel, WhatsApp) fazem parte da MESMA campanha e devem conversar entre si:
- Story desperta interesse;
- Feed aprofunda o argumento;
- Reel demonstra;
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
- FEED: escreva como um consultor experiente. Priorize benefícios reais, diferenciais verdadeiros, atendimento consultivo, linguagem humana. Emojis com parcimônia. Até 3 CTAs.
- STORY: texto curto, leitura rápida, 1 a 3 frases, CTA forte, pouquíssimo texto.
- REEL: roteiro baseado APENAS nas mídias reais disponíveis (${reelHint}). Estrutura: gancho nos 3s iniciais → desenvolvimento → CTA final. Nunca sugira cenas inexistentes.
- WHATSAPP: mensagem individual, conversacional, sem cara de disparo em massa. Foco em relacionamento. NÃO inclua telefone no corpo.

# VARIAÇÃO
Seed desta geração: ${variationSeed}. Varie abertura, CTA, estrutura, argumentos e organização em relação a gerações anteriores.

# HISTÓRICO INTERNO (aprendizado com campanhas passadas desta empresa)
${pastBlock}
Use este histórico APENAS como referência estratégica: identifique padrões que funcionaram, evite repetir os mesmos títulos/CTAs/ângulos, mas gere textos totalmente inéditos. NUNCA copie trechos das campanhas anteriores.

# AUTOVALIDAÇÃO ANTES DE RESPONDER
Confira: (a) coerência com a base de conhecimento; (b) zero informação inventada; (c) os 4 formatos formam uma campanha coerente; (d) linguagem natural; (e) nenhuma frase genérica proibida; (f) nada copiado do histórico.

Devolva o objeto \`strategy\` (planejamento interno) + os 4 formatos em UMA ÚNICA chamada da ferramenta \`generate_marketing_bundle\`. Tom base: ${data.tone ?? "amigável"}.`;



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
            objective: { type: "string" },
            audience: { type: "string" },
            benefit: { type: "string" },
            differential: { type: "string" },
            objections: { type: "array", items: { type: "string" } },
            emotion: { type: "string" },
            cta: { type: "string" },
            intent: {
              type: "string",
              enum: ["marca", "orcamento", "relacionamento", "venda"],
            },
          },
          required: [
            "objective",
            "audience",
            "benefit",
            "differential",
            "objections",
            "emotion",
            "cta",
            "intent",
          ],
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
          },
          required: ["title", "body", "hashtags"],
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
      required: ["strategy", "story", "feed", "reel", "whatsapp"],
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

    // Persistência atômica: 4 registros ou nenhum.
    const promptSnapshot = {
      tone: data.tone,
      audience: data.audience ?? null,
      extra_instructions: data.extra_instructions ?? null,
      promotion_id: data.promotion_id ?? null,
      product_id: data.product_id ?? null,
      media_ids: mediaIds,
      product_media_refs: productMediaDetails.map((p) => ({
        product_id: p.product_id,
        image_path: p.image_path,
      })),
    };
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
        body: bundle.reel.body,
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

    const { data: inserted, error } = await supabase
      .from("marketing_contents")
      .insert(rowsToInsert)
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
        reel_body: bundle.reel.body,
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

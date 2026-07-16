// AI generator for Marketing content.
// - Runs entirely server-side; LOVABLE_API_KEY nunca sai do backend.
// - Uma única chamada estruturada gera os 4 formatos (Story, Feed, Reel, WhatsApp).
// - Valida a saída com Zod antes de persistir; falha total => zero conteúdo criado.
// - Todos os conteúdos gerados são gravados com status `draft`.

import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type {
  MarketingContentChannel,
  MarketingContentFormat,
  MarketingContentRow,
} from "./marketing.types";

type SB = SupabaseClient<Database>;

const GATEWAY_CHAT = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.5-flash";

const InputSchema = z.object({
  promotion_id: z.string().uuid().optional().nullable(),
  product_id: z.string().uuid().optional().nullable(),
  media_ids: z.array(z.string().uuid()).max(10).optional(),
  tone: z
    .enum(["amigável", "profissional", "descontraído", "urgente"])
    .optional()
    .default("amigável"),
  audience: z.string().trim().max(300).optional().nullable(),
  extra_instructions: z.string().trim().max(1000).optional().nullable(),
});

interface GenerateResult {
  contents: MarketingContentRow[];
}

// Schema JSON estrito para a resposta da IA — validado em runtime.
const BundleSchema = z.object({
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
  if (!ids.length) return;
  const { data, error } = await sb
    .from("marketing_media")
    .select("id")
    .in("id", ids)
    .eq("company_id", companyId);
  if (error) throw new Error(error.message);
  const found = new Set((data ?? []).map((r) => r.id));
  for (const id of ids) {
    if (!found.has(id)) throw new Error(`Mídia ${id} não pertence à empresa.`);
  }
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

export const generateMarketingContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => InputSchema.parse(i))
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY não configurada.");

    const { companyId, userId, supabase } = await loadCompany(context);

    const mediaIds = data.media_ids ?? [];
    await validateMedia(supabase, companyId, mediaIds);

    const promotion = data.promotion_id
      ? await loadPromotion(supabase, companyId, data.promotion_id)
      : null;
    const product = data.product_id
      ? await loadProduct(supabase, companyId, data.product_id)
      : null;

    const brand = await loadCompanyContext(supabase, companyId);

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

    const sys = `Você é um copywriter sênior de marketing digital brasileiro para pequenas e médias empresas.
Gere conteúdos ORIGINAIS em português do Brasil, tom ${data.tone ?? "amigável"}, sem promessas irreais,
sem inventar preços, condições, dados ou números de WhatsApp. Se um dado não estiver no briefing, NÃO invente.
Empresa: ${brand.companyName}.
Você DEVE devolver os 4 formatos em UMA ÚNICA chamada da ferramenta \`generate_marketing_bundle\`.`;

    const usr = `Briefing:
${promoBlock}

${productBlock}

Público-alvo: ${data.audience ?? "clientes locais interessados"}
Instruções extras: ${data.extra_instructions ?? "-"}

Regras dos 4 formatos:
- story: legenda curta e impactante para Story (Instagram/Facebook), 1 a 3 frases.
- feed: legenda de Feed (Instagram/Facebook), pode ter emojis, quebras de linha, e até 3 CTAs.
- reel: roteiro curto de Reel/vídeo vertical, com abertura em 3 segundos, meio e CTA final.
- whatsapp: mensagem curta para envio no WhatsApp com CTA claro. NÃO inclua telefone no corpo.`;

    const bundleJsonSchema = {
      type: "object",
      additionalProperties: false,
      properties: {
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
      required: ["story", "feed", "reel", "whatsapp"],
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
    return { contents: (inserted ?? []) as MarketingContentRow[] };
  });

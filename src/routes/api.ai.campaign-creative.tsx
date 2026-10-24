import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { OpenAiResponsesGateway } from "@/lib/ai-platform/gateway.server";
import { createSupabaseAiUsageSink } from "@/lib/ai-platform/supabase-usage-sink.server";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const LOVABLE_MODEL = "google/gemini-2.5-flash";
const OPENAI_MAX_OUTPUT_TOKENS = 512;

export function campaignCreativeOpenAiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CAMPAIGN_CREATIVE_OPENAI_RESPONSES === "enabled";
}

interface RequestBody {
  product?: {
    name?: string | null;
    description?: string | null;
    category?: string | null;
    price?: number | null;
    promoPrice?: number | null;
  };
  objective?: "whatsapp" | "instagram" | "messenger";
  goal?: "awareness" | "traffic" | "engagement" | "leads" | "sales" | "reactivation";
  city?: string | null;
  media_url?: string | null;
  media_type?: string | null;
  daily_budget?: number | null;
  radius_km?: number | null;
  start_date?: string | null;
}

const GOAL_GUIDE: Record<NonNullable<RequestBody["goal"]>, string> = {
  awareness: "Foco em marca e autoridade. Tom institucional e memorável. CTA suave (ex.: 'Saiba mais'). Público amplo.",
  traffic: "Levar a pessoa para um canal (WhatsApp/Instagram/site). CTA direto de clique. Texto curto e claro.",
  engagement: "Tom conversacional, perguntas, convite a comentar/responder. CTA 'Enviar mensagem'. Estimular interação.",
  leads: "Captar contato/orçamento. CTA 'Solicitar orçamento' ou 'Enviar mensagem'. Reforçar benefício + facilidade de contato.",
  sales: "CTA direto de compra ('Comprar agora'). Destacar preço, promoção, parcelamento, escassez.",
  reactivation: "Falar com cliente antigo. Tom próximo, lembrar relacionamento, oferta de retorno/desconto exclusivo.",
};

export const Route = createFileRoute("/api/ai/campaign-creative")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const accessToken = authHeader.startsWith("Bearer ")
          ? authHeader.slice("Bearer ".length)
          : "";
        if (!accessToken) {
          return Response.json({ error: "não autenticado" }, { status: 401 });
        }
        const { data: userRes, error: userErr } =
          await supabaseAdmin.auth.getUser(accessToken);
        if (userErr || !userRes.user) {
          return Response.json({ error: "sessão inválida" }, { status: 401 });
        }

        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("company_id")
          .eq("id", userRes.user.id)
          .maybeSingle();
        if (!profile?.company_id) {
          return Response.json({ error: "perfil sem empresa" }, { status: 403 });
        }
        const companyId = profile.company_id;

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!campaignCreativeOpenAiEnabled() && !apiKey) {
          return Response.json(
            { error: "LOVABLE_API_KEY não configurada" },
            { status: 500 },
          );
        }

        let body: RequestBody;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "JSON inválido" }, { status: 400 });
        }
        const productName = body.product?.name?.trim() || null;
        const mediaUrl = body.media_url?.trim() || null;
        const mediaType = body.media_type?.trim() || null;
        if (!productName && !mediaUrl) {
          return Response.json(
            { error: "Informe um produto ou envie um criativo para gerar o anúncio." },
            { status: 400 },
          );
        }

        const objective = body.objective ?? "whatsapp";
        const goal = body.goal ?? "leads";
        const goalGuide = GOAL_GUIDE[goal];
        const productLine = [
          productName ? `Nome: ${productName}` : "Nome: (não informado — deduzir a partir da imagem enviada)",
          body.product?.category ? `Categoria: ${body.product.category}` : null,
          body.product?.description ? `Descrição: ${body.product.description}` : null,
          body.product?.price != null ? `Preço: R$ ${body.product.price}` : null,
          body.product?.promoPrice != null
            ? `Preço promocional: R$ ${body.product.promoPrice}`
            : null,
          body.city ? `Cidade-alvo: ${body.city}` : null,
          body.daily_budget != null ? `Orçamento diário: R$ ${body.daily_budget}` : null,
          body.radius_km != null ? `Raio de alcance: ${body.radius_km} km` : null,
          body.start_date ? `Início: ${body.start_date}` : null,
          mediaUrl ? `Criativo enviado pelo lojista (${mediaType ?? "image"}): ${mediaUrl}` : null,
        ]
          .filter(Boolean)
          .join("\n");

        const systemPrompt = `Você é um copywriter sênior de Meta Ads (Facebook/Instagram) e WhatsApp Business no Brasil.

OBJETIVO ESTRATÉGICO DA CAMPANHA: "${goal}".
Diretriz: ${goalGuide}
Adapte título, texto, CTA, legenda e sugestão de público ao objetivo acima.
Quando uma imagem for fornecida, use-a como referência visual para deduzir produto/serviço, tom e benefícios destacados.

REGRA CRÍTICA DO TÍTULO (headline):
- Entre 25 e 40 caracteres. NUNCA passar de 40.
- Curto, forte, direto. Pensado para card de feed mobile.
- Sem ponto final, sem emojis, sem aspas, sem reticências.
- Priorizar gancho de oferta, parcela, estação ou benefício imediato.
- Exemplos do estilo desejado: "Dakota 6x3 em 18x", "Sua piscina em 18x", "Piscina Dakota Promo", "Verão com piscina", "Piscina pronta pro verão".
- Evitar frases descritivas longas.

Texto principal e demais campos seguem padrão Meta Ads, em pt-BR, claros e persuasivos, sem excesso de emojis.`;

        const userText = `Crie um anúncio para o canal "${objective}" com objetivo estratégico "${goal}" com base no briefing:\n${productLine}\n\nDevolva via tool call.`;

        const includeImage = !!mediaUrl && (mediaType ?? "image").startsWith("image");
        const userContent: unknown = includeImage
          ? [
              { type: "text", text: userText },
              { type: "image_url", image_url: { url: mediaUrl } },
            ]
          : userText;

        const payload = {
          model: LOVABLE_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "generate_ad",
                description: "Gera criativo de anúncio.",
                parameters: {
                  type: "object",
                  properties: {
                    headline: {
                      type: "string",
                      description:
                        "Título curto e impactante entre 25 e 40 caracteres. Sem ponto final, sem emojis, sem aspas. Estilo: 'Dakota 6x3 em 18x', 'Verão com piscina', 'Piscina Dakota Promo'.",
                    },
                    primary_text: {
                      type: "string",
                      description: "Texto principal do anúncio, até 500 caracteres.",
                    },
                    cta: {
                      type: "string",
                      enum: [
                        "Saiba mais",
                        "Enviar mensagem",
                        "Solicitar orçamento",
                        "Comprar agora",
                        "Agendar",
                      ],
                    },
                    social_caption: {
                      type: "string",
                      description: "Legenda para post orgânico no Instagram/Facebook com hashtags.",
                    },
                    audience_suggestion: {
                      type: "string",
                      description:
                        "Sugestão de público-alvo (idade, interesses, comportamento) em 1-2 frases.",
                    },
                  },
                  required: [
                    "headline",
                    "primary_text",
                    "cta",
                    "social_caption",
                    "audience_suggestion",
                  ],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "generate_ad" } },
        };

        let parsed: Record<string, unknown>;
        if (campaignCreativeOpenAiEnabled()) {
          try {
            const openAiInput: string | Array<Record<string, unknown>> = includeImage
              ? [{ role: "user", content: [
                  { type: "input_text", text: userText },
                  { type: "input_image", image_url: mediaUrl },
                ] }]
              : userText;
            const result = await new OpenAiResponsesGateway(undefined, {
              usageSink: createSupabaseAiUsageSink(supabaseAdmin),
            }).run({
              companyId,
              capability: "marketing",
              instructions: systemPrompt,
              input: openAiInput,
              tools: [{
                type: "function",
                name: "generate_ad",
                description: "Gera criativo textual de anúncio.",
                parameters: payload.tools[0].function.parameters,
                strict: false,
              }],
              toolChoice: { type: "function", name: "generate_ad" },
              store: false,
              maxOutputTokens: OPENAI_MAX_OUTPUT_TOKENS,
              tags: { feature: "campaign_creative_text", prompt_version: "2026-10-24.a" },
            });
            const call = result.toolCalls.find((item) => item.name === "generate_ad");
            if (!call?.arguments) throw new Error("structured_output_missing");
            parsed = JSON.parse(call.arguments) as Record<string, unknown>;
          } catch (error) {
            console.warn(
              "[campaign-creative] OpenAI indisponível; usando fallback Lovable",
              error instanceof Error ? error.message : "provider_error",
            );
            if (!apiKey) return Response.json({ error: "Nenhum provedor de IA configurado" }, { status: 500 });
            const fallback = await fetch(GATEWAY_URL, {
              method: "POST",
              headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            if (!fallback.ok) {
              if (fallback.status === 429) return Response.json({ error: "Limite de requisições atingido. Tente novamente em alguns segundos." }, { status: 429 });
              if (fallback.status === 402) return Response.json({ error: "Créditos esgotados. Adicione créditos em Configurações > Workspace > Uso." }, { status: 402 });
              console.error("AI gateway error", fallback.status);
              return Response.json({ error: "Falha ao consultar a IA" }, { status: 502 });
            }
            const data = await fallback.json();
            const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
            if (!toolCall?.function?.arguments) return Response.json({ error: "Resposta da IA sem dados estruturados" }, { status: 502 });
            try { parsed = JSON.parse(toolCall.function.arguments) as Record<string, unknown>; } catch {
              return Response.json({ error: "Falha ao interpretar resposta da IA" }, { status: 502 });
            }
          }
        } else {
          if (!apiKey) return Response.json({ error: "LOVABLE_API_KEY não configurada" }, { status: 500 });
          const aiRes = await fetch(GATEWAY_URL, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!aiRes.ok) {
            if (aiRes.status === 429) return Response.json({ error: "Limite de requisições atingido. Tente novamente em alguns segundos." }, { status: 429 });
            if (aiRes.status === 402) return Response.json({ error: "Créditos esgotados. Adicione créditos em Configurações > Workspace > Uso." }, { status: 402 });
            console.error("AI gateway error", aiRes.status);
            return Response.json({ error: "Falha ao consultar a IA" }, { status: 502 });
          }
          const data = await aiRes.json();
          const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
          if (!toolCall?.function?.arguments) return Response.json({ error: "Resposta da IA sem dados estruturados" }, { status: 502 });
          try { parsed = JSON.parse(toolCall.function.arguments) as Record<string, unknown>; } catch {
            return Response.json({ error: "Falha ao interpretar resposta da IA" }, { status: 502 });
          }
        }

        // Heurística preservada: encurta título se passar de 40 caracteres.
        if (typeof parsed.headline === "string") {
          let h = parsed.headline.replace(/["“”']/g, "").replace(/\.+$/g, "").replace(/\s+/g, " ").trim();
          if (h.length > 40) {
            const cut = h.slice(0, 38);
            const lastSpace = cut.lastIndexOf(" ");
            h = (lastSpace > 18 ? cut.slice(0, lastSpace) : cut).trim();
          }
          parsed.headline = h;
        }
        return Response.json(parsed);
      },
    },
  },
});

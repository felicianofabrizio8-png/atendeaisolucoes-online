import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

interface RequestBody {
  product: {
    name: string;
    description?: string | null;
    category?: string | null;
    price?: number | null;
    promoPrice?: number | null;
  };
  objective?: "whatsapp" | "instagram" | "messenger";
  city?: string | null;
}

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

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) {
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
        if (!body?.product?.name) {
          return Response.json({ error: "produto obrigatório" }, { status: 400 });
        }

        const objective = body.objective ?? "whatsapp";
        const productLine = [
          `Nome: ${body.product.name}`,
          body.product.category ? `Categoria: ${body.product.category}` : null,
          body.product.description ? `Descrição: ${body.product.description}` : null,
          body.product.price != null ? `Preço: R$ ${body.product.price}` : null,
          body.product.promoPrice != null
            ? `Preço promocional: R$ ${body.product.promoPrice}`
            : null,
          body.city ? `Cidade-alvo: ${body.city}` : null,
        ]
          .filter(Boolean)
          .join("\n");

        const systemPrompt = `Você é um copywriter sênior de Meta Ads (Facebook/Instagram) e WhatsApp Business no Brasil.

REGRA CRÍTICA DO TÍTULO (headline):
- Entre 25 e 40 caracteres. NUNCA passar de 40.
- Curto, forte, direto. Pensado para card de feed mobile.
- Sem ponto final, sem emojis, sem aspas, sem reticências.
- Priorizar gancho de oferta, parcela, estação ou benefício imediato.
- Exemplos do estilo desejado: "Dakota 6x3 em 18x", "Sua piscina em 18x", "Piscina Dakota Promo", "Verão com piscina", "Piscina pronta pro verão".
- Evitar frases descritivas longas tipo "Aproveite agora nossa incrível promoção de piscinas Dakota".

Texto principal e demais campos seguem padrão Meta Ads, em pt-BR, claros e persuasivos, sem excesso de emojis.`;

        const userPrompt = `Crie um anúncio para o objetivo "${objective}" com base no produto:\n${productLine}\n\nDevolva via tool call.`;

        const payload = {
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
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

        const aiRes = await fetch(GATEWAY_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!aiRes.ok) {
          if (aiRes.status === 429) {
            return Response.json(
              { error: "Limite de requisições atingido. Tente novamente em alguns segundos." },
              { status: 429 },
            );
          }
          if (aiRes.status === 402) {
            return Response.json(
              {
                error:
                  "Créditos esgotados. Adicione créditos em Configurações > Workspace > Uso.",
              },
              { status: 402 },
            );
          }
          const t = await aiRes.text();
          console.error("AI gateway error", aiRes.status, t);
          return Response.json({ error: "Falha ao consultar a IA" }, { status: 502 });
        }

        const data = await aiRes.json();
        const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
        if (!toolCall?.function?.arguments) {
          return Response.json(
            { error: "Resposta da IA sem dados estruturados" },
            { status: 502 },
          );
        }
        try {
          const parsed = JSON.parse(toolCall.function.arguments);
          return Response.json(parsed);
        } catch (e) {
          console.error("Parse error", e);
          return Response.json(
            { error: "Falha ao interpretar resposta da IA" },
            { status: 502 },
          );
        }
      },
    },
  },
});

// Backend do Gerador de Criativos com IA.
// Modos:
//  - analyze: análise visual da imagem (categoria, cores, público, etc.)
//  - generate-texts: gera 3 variantes (emoção, oferta, urgência) com headline/primary/CTA/desc
//  - generate-image: gera UMA imagem em determinado formato (Feed/Stories/Facebook/WA)
//  - score: nota de qualidade do criativo (0-100) + sugestões
//
// IMPORTANTE: este endpoint é NOVO e não altera o /api/ai/campaign-creative existente.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GATEWAY_CHAT = "https://ai.gateway.lovable.dev/v1/chat/completions";
const GATEWAY_IMG = "https://ai.gateway.lovable.dev/v1/images/generations";

type Mode = "analyze" | "generate-texts" | "generate-image" | "score";

interface AnalyzeReq {
  mode: "analyze";
  image_url: string;
}
interface GenerateTextsReq {
  mode: "generate-texts";
  image_url?: string | null;
  analysis?: Record<string, unknown> | null;
  config: {
    goal: string; // leads | whatsapp | sales | traffic | awareness
    style: string; // premium | offer | luxury | family | urgency | modern | minimal
    audience: string; // homens | mulheres | casais | familias | empresarios | custom
    audience_custom?: string;
    product_name?: string;
    product_description?: string;
    preserve_product: boolean;
  };
}
interface GenerateImageReq {
  mode: "generate-image";
  image_url?: string | null;
  prompt: string;
  format: "feed_1080" | "story_1920" | "facebook_feed" | "whatsapp_status";
  preserve_product: boolean;
}
interface ScoreReq {
  mode: "score";
  image_url: string;
  texts: { headline?: string; primary_text?: string; cta?: string; description?: string };
}

type ReqBody = AnalyzeReq | GenerateTextsReq | GenerateImageReq | ScoreReq;

const FORMAT_SIZE: Record<GenerateImageReq["format"], string> = {
  feed_1080: "1024x1024",
  story_1920: "1024x1792",
  facebook_feed: "1792x1024",
  whatsapp_status: "1024x1792",
};

function aiError(status: number) {
  if (status === 429) return Response.json({ error: "Limite de requisições atingido. Tente novamente em instantes." }, { status: 429 });
  if (status === 402) return Response.json({ error: "Créditos esgotados. Adicione créditos em Configurações > Workspace > Uso." }, { status: 402 });
  return Response.json({ error: "Falha ao consultar a IA" }, { status: 502 });
}

export const Route = createFileRoute("/api/ai/creative-generator")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
        if (!accessToken) return Response.json({ error: "não autenticado" }, { status: 401 });
        const { data: userRes, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
        if (userErr || !userRes.user) return Response.json({ error: "sessão inválida" }, { status: 401 });

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return Response.json({ error: "LOVABLE_API_KEY não configurada" }, { status: 500 });

        let body: ReqBody;
        try { body = await request.json(); } catch { return Response.json({ error: "JSON inválido" }, { status: 400 }); }

        // ============ ANALYZE ============
        if (body.mode === "analyze") {
          if (!body.image_url) return Response.json({ error: "image_url obrigatório" }, { status: 400 });
          const payload = {
            model: "google/gemini-2.5-flash",
            messages: [
              {
                role: "system",
                content:
                  "Você é um especialista em análise visual para publicidade no Brasil. Analise a imagem fornecida e devolva via tool call estruturado.",
              },
              {
                role: "user",
                content: [
                  { type: "text", text: "Analise esta imagem de produto para campanha publicitária." },
                  { type: "image_url", image_url: { url: body.image_url } },
                ],
              },
            ],
            tools: [
              {
                type: "function",
                function: {
                  name: "analyze_image",
                  description: "Analisa imagem de produto para uso em criativo de anúncio.",
                  parameters: {
                    type: "object",
                    properties: {
                      category: { type: "string", description: "Categoria geral (ex.: piscina, moda, móveis, salão)" },
                      main_object: { type: "string", description: "Objeto principal da foto" },
                      colors: { type: "array", items: { type: "string" }, description: "Cores predominantes (hex ou nome)" },
                      context: { type: "string", description: "Contexto/ambiente da foto" },
                      quality: { type: "string", enum: ["alta", "media", "baixa"] },
                      audience: { type: "array", items: { type: "string" }, description: "Públicos prováveis" },
                      business_type: { type: "string" },
                      style_keywords: { type: "array", items: { type: "string" } },
                    },
                    required: ["category", "main_object", "colors", "context", "quality", "audience", "business_type"],
                    additionalProperties: false,
                  },
                },
              },
            ],
            tool_choice: { type: "function", function: { name: "analyze_image" } },
          };
          const res = await fetch(GATEWAY_CHAT, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!res.ok) return aiError(res.status);
          const data = await res.json();
          const tc = data?.choices?.[0]?.message?.tool_calls?.[0];
          if (!tc?.function?.arguments) return Response.json({ error: "Resposta sem dados" }, { status: 502 });
          try { return Response.json(JSON.parse(tc.function.arguments)); }
          catch { return Response.json({ error: "Parse falhou" }, { status: 502 }); }
        }

        // ============ GENERATE-TEXTS (3 variantes) ============
        if (body.mode === "generate-texts") {
          const cfg = body.config;
          const audience = cfg.audience === "custom" ? cfg.audience_custom : cfg.audience;
          const analysisLine = body.analysis
            ? `Análise da imagem: ${JSON.stringify(body.analysis)}`
            : "";
          const sys = `Você é copywriter sênior de Meta Ads (Facebook/Instagram) e WhatsApp Business no Brasil.
Gere TRÊS variantes de copy para o MESMO criativo, cada uma com foco distinto:
- A) emotion: foco em emoção/aspiração/estilo de vida.
- B) offer: foco em oferta/benefício tangível/preço (sem prometer condições inexistentes).
- C) urgency: foco em escassez/sazonalidade/tempo limitado.

Cada variante deve ter: headline (25-40 chars, sem emojis nem ponto final), primary_text (até 500), description (até 90), cta (Saiba mais | Enviar mensagem | Solicitar orçamento | Comprar agora | Agendar), image_prompt (descrição vívida em inglês para gerador de imagem; foco no produto, cenário, iluminação, mood).`;
          const userTxt = `Objetivo: ${cfg.goal}
Estilo: ${cfg.style}
Público: ${audience ?? "geral"}
Produto: ${cfg.product_name ?? "(deduzir da imagem)"}
Descrição: ${cfg.product_description ?? "-"}
Preservar produto original na imagem: ${cfg.preserve_product ? "SIM (manter forma, proporções e identidade visual)" : "NÃO (liberdade criativa)"}
${analysisLine}`;
          const userContent: unknown = body.image_url
            ? [{ type: "text", text: userTxt }, { type: "image_url", image_url: { url: body.image_url } }]
            : userTxt;
          const variantSchema = {
            type: "object",
            properties: {
              headline: { type: "string" },
              primary_text: { type: "string" },
              description: { type: "string" },
              cta: { type: "string", enum: ["Saiba mais", "Enviar mensagem", "Solicitar orçamento", "Comprar agora", "Agendar"] },
              image_prompt: { type: "string" },
            },
            required: ["headline", "primary_text", "description", "cta", "image_prompt"],
            additionalProperties: false,
          };
          const payload = {
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: sys },
              { role: "user", content: userContent },
            ],
            tools: [{
              type: "function",
              function: {
                name: "generate_variants",
                description: "Gera 3 variantes de copy.",
                parameters: {
                  type: "object",
                  properties: {
                    emotion: variantSchema,
                    offer: variantSchema,
                    urgency: variantSchema,
                    audience_suggestion: { type: "string" },
                  },
                  required: ["emotion", "offer", "urgency", "audience_suggestion"],
                  additionalProperties: false,
                },
              },
            }],
            tool_choice: { type: "function", function: { name: "generate_variants" } },
          };
          const res = await fetch(GATEWAY_CHAT, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!res.ok) return aiError(res.status);
          const data = await res.json();
          const tc = data?.choices?.[0]?.message?.tool_calls?.[0];
          if (!tc?.function?.arguments) return Response.json({ error: "Resposta sem dados" }, { status: 502 });
          try {
            const parsed = JSON.parse(tc.function.arguments);
            // Trim headlines
            for (const k of ["emotion", "offer", "urgency"] as const) {
              const v = parsed[k];
              if (v?.headline) {
                let h = String(v.headline).replace(/["“”']/g, "").replace(/\.+$/g, "").replace(/\s+/g, " ").trim();
                if (h.length > 40) { const cut = h.slice(0, 38); const sp = cut.lastIndexOf(" "); h = (sp > 18 ? cut.slice(0, sp) : cut).trim(); }
                v.headline = h;
              }
            }
            return Response.json(parsed);
          } catch { return Response.json({ error: "Parse falhou" }, { status: 502 }); }
        }

        // ============ GENERATE-IMAGE ============
        if (body.mode === "generate-image") {
          const size = FORMAT_SIZE[body.format] ?? "1024x1024";
          const preserve = !!body.preserve_product && !!body.image_url;

          // PRESERVAR PRODUTO: usa modelo de edição/multimodal Gemini com a imagem
          // de referência. O modelo recebe a foto real e mantém o produto idêntico,
          // alterando apenas fundo/iluminação/cenário.
          if (preserve) {
            const strictPrompt = `Use the uploaded product image as the EXACT product reference. Do NOT replace, redesign, simplify, restyle, recolor, or invent a different product. Preserve shape, proportions, materials, textures, colors, edges, curves, steps, dimensions and every identifying detail of the product unchanged. You may ONLY change the background, scenery, lighting, ambience and add tasteful advertising mood. The final image must clearly show the SAME product from the reference photo. Creative direction: ${body.prompt}`;
            const payload = {
              model: "google/gemini-3.1-flash-image-preview",
              messages: [
                {
                  role: "user",
                  content: [
                    { type: "text", text: strictPrompt },
                    { type: "image_url", image_url: { url: body.image_url! } },
                  ],
                },
              ],
              modalities: ["image", "text"],
            };
            const res = await fetch(GATEWAY_IMG, {
              method: "POST",
              headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            if (!res.ok) {
              const t = await res.text().catch(() => "");
              console.error("img edit err", res.status, t);
              return aiError(res.status);
            }
            const data = await res.json();
            const b64 = data?.data?.[0]?.b64_json;
            if (!b64) {
              return Response.json({
                error: "Não foi possível preservar o produto original com segurança. Tente outra imagem ou desative a preservação.",
                preserve_failed: true,
              }, { status: 422 });
            }
            return Response.json({ b64_json: b64, format: body.format, size, preserved: true });
          }

          // Modo livre (sem preservar): geração textual com gpt-image-2.
          const payload = {
            model: "openai/gpt-image-2",
            prompt: body.prompt,
            size,
            quality: "low",
            n: 1,
          };
          const res = await fetch(GATEWAY_IMG, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            const t = await res.text().catch(() => "");
            console.error("img gen err", res.status, t);
            return aiError(res.status);
          }
          const data = await res.json();
          const b64 = data?.data?.[0]?.b64_json;
          if (!b64) return Response.json({ error: "Imagem não gerada" }, { status: 502 });
          return Response.json({ b64_json: b64, format: body.format, size, preserved: false });
        }


        // ============ SCORE ============
        if (body.mode === "score") {
          const payload = {
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: "Você avalia criativos de anúncio Meta/WhatsApp. Devolva via tool call." },
              {
                role: "user",
                content: [
                  { type: "text", text: `Avalie este criativo.\nHeadline: ${body.texts.headline ?? ""}\nTexto: ${body.texts.primary_text ?? ""}\nCTA: ${body.texts.cta ?? ""}\nDescrição: ${body.texts.description ?? ""}` },
                  { type: "image_url", image_url: { url: body.image_url } },
                ],
              },
            ],
            tools: [{
              type: "function",
              function: {
                name: "score_creative",
                parameters: {
                  type: "object",
                  properties: {
                    score: { type: "number", description: "Nota de 0 a 100" },
                    ctr_potential: { type: "string", enum: ["baixo", "medio", "alto"] },
                    conversion_potential: { type: "string", enum: ["baixo", "medio", "alto"] },
                    strengths: { type: "array", items: { type: "string" } },
                    improvements: { type: "array", items: { type: "string" } },
                  },
                  required: ["score", "ctr_potential", "conversion_potential", "strengths", "improvements"],
                  additionalProperties: false,
                },
              },
            }],
            tool_choice: { type: "function", function: { name: "score_creative" } },
          };
          const res = await fetch(GATEWAY_CHAT, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!res.ok) return aiError(res.status);
          const data = await res.json();
          const tc = data?.choices?.[0]?.message?.tool_calls?.[0];
          if (!tc?.function?.arguments) return Response.json({ error: "Resposta sem dados" }, { status: 502 });
          try { return Response.json(JSON.parse(tc.function.arguments)); }
          catch { return Response.json({ error: "Parse falhou" }, { status: 502 }); }
        }

        return Response.json({ error: "modo inválido" }, { status: 400 });
      },
    },
  },
});

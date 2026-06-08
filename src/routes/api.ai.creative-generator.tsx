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
    goal: string;
    style: string;
    audience: string;
    audience_custom?: string;
    product_name?: string;
    product_description?: string;
    preserve_product: boolean;
    // novos
    price?: string;
    promo_price?: string;
    installments?: string;
    ad_headline?: string;
    ad_subtitle?: string;
    ad_description?: string;
    cta_text?: string;
    whatsapp?: string;
    city?: string;
    ai_notes?: string;
    creative_type?: string;
    special_instructions?: string;
    show?: Record<string, boolean>;
  };
}
interface GenerateImageReq {
  mode: "generate-image";
  image_url?: string | null;
  prompt: string;
  format: "feed_1080" | "story_1920" | "facebook_feed" | "whatsapp_status";
  preserve_product: boolean;
  preserve_scene?: boolean;
  // novos (opcionais — reforço visual sobreposto ao prompt)
  ad_overlay?: {
    product_name?: string;
    price?: string;
    promo_price?: string;
    installments?: string;
    cta_text?: string;
    whatsapp?: string;
    city?: string;
    ad_headline?: string;
    ad_subtitle?: string;
    creative_type?: string;
    special_instructions?: string;
    show?: Record<string, boolean>;
  };
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
          const showList = cfg.show
            ? Object.entries(cfg.show).filter(([, v]) => !!v).map(([k]) => k).join(", ")
            : "";
          const userTxt = `Objetivo: ${cfg.goal}
Estilo: ${cfg.style}
Tipo de criativo: ${cfg.creative_type ?? "-"}
Público: ${audience ?? "geral"}
Produto: ${cfg.product_name ?? "(deduzir da imagem)"}
Descrição produto: ${cfg.product_description ?? "-"}
Preço atual: ${cfg.price ?? "-"}
Preço promocional: ${cfg.promo_price ?? "-"}
Parcelamento: ${cfg.installments ?? "-"}
Título principal sugerido: ${cfg.ad_headline ?? "-"}
Subtítulo sugerido: ${cfg.ad_subtitle ?? "-"}
Descrição do anúncio sugerida: ${cfg.ad_description ?? "-"}
CTA preferido: ${cfg.cta_text ?? "-"}
WhatsApp: ${cfg.whatsapp ?? "-"}
Cidade: ${cfg.city ?? "-"}
Observações do usuário para IA: ${cfg.ai_notes ?? "-"}
Instruções especiais: ${cfg.special_instructions ?? "-"}
Elementos a destacar no criativo: ${showList || "-"}
Preservar produto original na imagem: ${cfg.preserve_product ? "SIM (manter forma, medidas, curvas, escadas, cores e identidade visual; o produto enviado é o PROTAGONISTA)" : "NÃO (liberdade criativa)"}
${analysisLine}

Regras: se houver título/subtítulo/descrição/CTA sugeridos pelo usuário, respeite-os com pequenas melhorias. Para cada variante, o image_prompt (em inglês) deve descrever cena, iluminação, ambiente e indicar quais elementos visuais aparecem na composição (preço, selo de desconto, parcelamento, botão de WhatsApp, urgência, benefícios, garantia, logo) conforme a lista acima.`;
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

          // Reforço visual a partir dos dados do anúncio (opcional)
          const ov = body.ad_overlay ?? {};
          const showList = ov.show
            ? Object.entries(ov.show).filter(([, v]) => !!v).map(([k]) => k)
            : [];
          const overlayLines: string[] = [];
          if (ov.product_name) overlayLines.push(`Product name: ${ov.product_name}.`);
          if (ov.ad_headline) overlayLines.push(`Main headline overlay: "${ov.ad_headline}".`);
          if (ov.ad_subtitle) overlayLines.push(`Subtitle overlay: "${ov.ad_subtitle}".`);
          if (showList.includes("price") && ov.price) overlayLines.push(`Display price tag: ${ov.price}.`);
          if (showList.includes("discount") && ov.promo_price) overlayLines.push(`Display promotional price: ${ov.promo_price} (with discount badge).`);
          if (showList.includes("installments") && ov.installments) overlayLines.push(`Display installments: ${ov.installments}.`);
          if (showList.includes("whatsapp") && ov.whatsapp) overlayLines.push(`Display WhatsApp button/number: ${ov.whatsapp}.`);
          if (showList.includes("urgency")) overlayLines.push(`Add a tasteful urgency element (limited time / last units).`);
          if (showList.includes("benefits")) overlayLines.push(`Show 2-3 short benefit bullets.`);
          if (showList.includes("warranty")) overlayLines.push(`Show a small warranty/guarantee seal.`);
          if (showList.includes("promo_badge")) overlayLines.push(`Add a clean promotional badge/seal.`);
          if (showList.includes("logo")) overlayLines.push(`Reserve a small clean area for the company logo (placeholder).`);
          if (ov.cta_text) overlayLines.push(`Visible CTA button: "${ov.cta_text}".`);
          if (ov.city) overlayLines.push(`Hint at city/region: ${ov.city}.`);
          if (ov.creative_type) overlayLines.push(`Creative type: ${ov.creative_type}.`);
          if (ov.special_instructions) overlayLines.push(`Special instructions from user: ${ov.special_instructions}`);
          const overlayBlock = overlayLines.length
            ? `\n\nAd composition requirements (must appear clearly in the final image, Meta Ads style, professional typography, high contrast, no fake text/logos): ${overlayLines.join(" ")}`
            : "";

          // PRESERVAR PRODUTO — MODO RIGOROSO
          if (preserve) {
            const strictPrompt = [
              "STRICT PRESERVATION MODE — HIGHEST PRIORITY.",
              "The attached reference image IS the product. Treat it as a locked photographic asset. You are performing a SCENE EDIT, not a product redesign.",
              "",
              "ABSOLUTE RULES (must not be violated under any circumstance):",
              "1) DO NOT replace, redesign, restyle, reimagine, simplify, stylize, illustrate or invent a different product.",
              "2) DO NOT change shape, silhouette, contour, proportions, dimensions, measurements, scale, or aspect ratio of the product.",
              "3) DO NOT change the number, position, geometry, spacing or design of stairs, steps, rungs, ladders, handles, rails, edges, corners, panels, seams, joints, screws, parts or accessories.",
              "4) DO NOT change materials, finish, textures, patterns, colors, reflectivity, transparency, logos, labels or printed text on the product.",
              "5) DO NOT add, remove, merge, split, rotate or reflect any structural element of the product.",
              "6) DO NOT crop, occlude, hide, blur or partially cover the product. Show it fully visible as the clear PROTAGONIST.",
              "7) Pixel-level fidelity to the reference is REQUIRED. If in doubt, copy the product from the reference unchanged.",
              "",
              "WHAT YOU MAY CHANGE (and only these):",
              "- Background, environment, scenery, floor/wall/sky.",
              "- Lighting direction, ambience, shadows cast BY the product.",
              "- Camera framing distance ONLY to fit the same product without distorting it.",
              "- Tasteful advertising overlays (typography, badges, CTA) outside the product silhouette.",
              "",
              "Creative freedom for the product itself: ZERO. Creative freedom for the surrounding ad scene: normal.",
              "If you cannot reproduce the product with full fidelity, return the reference product unchanged on a neutral improved background — never invent a substitute.",
              "",
              `Scene/ad direction: ${body.prompt}${overlayBlock}`,
            ].join("\n");
            const payload = {
              model: "google/gemini-2.5-flash-image-preview",
              messages: [
                {
                  role: "user",
                  content: [
                    // Image first to bias the model toward the reference asset.
                    { type: "image_url", image_url: { url: body.image_url! } },
                    { type: "text", text: strictPrompt },
                  ],
                },
              ],
              modalities: ["image", "text"],
              temperature: 0.2,
            };
            const res = await fetch(GATEWAY_CHAT, {
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
            const msg = data?.choices?.[0]?.message;
            const dataUrl: string | undefined =
              msg?.images?.[0]?.image_url?.url ??
              msg?.images?.[0]?.url ??
              undefined;
            let b64: string | undefined;
            if (dataUrl) {
              const m = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/.exec(dataUrl);
              b64 = m ? m[1] : dataUrl;
            }
            if (!b64) {
              console.error("img edit no image in response", JSON.stringify(data).slice(0, 500));
              return Response.json({
                error: "Não foi possível preservar o produto original com segurança. Tente outra imagem ou desative a preservação.",
                preserve_failed: true,
              }, { status: 422 });
            }
            return Response.json({ b64_json: b64, format: body.format, size, preserved: true });
          }

          // Modo livre (sem preservar): geração textual com gpt-image-2.
          const freePrompt = `${body.prompt}${overlayBlock}`;
          const payload = {
            model: "openai/gpt-image-2",
            prompt: freePrompt,
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

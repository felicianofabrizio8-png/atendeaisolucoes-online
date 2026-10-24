import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  buildSuggestProductCatalog,
  formatSuggestProductCatalog,
} from "@/lib/product-suggestion";
import { OpenAiResponsesGateway } from "@/lib/ai-platform/gateway.server";
import { createSupabaseAiUsageSink } from "@/lib/ai-platform/supabase-usage-sink.server";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const LOVABLE_MODEL = "google/gemini-2.5-flash";
const OPENAI_MAX_OUTPUT_TOKENS = 256;

export function suggestProductOpenAiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SUGGEST_PRODUCT_OPENAI_RESPONSES === "enabled";
}

interface IncomingMessage {
  role: "lead" | "agent" | "system";
  text: string;
}

interface RequestBody {
  leadName?: string;
  product?: string; // produto já marcado no lead, se houver
  messages: IncomingMessage[];
}

export const Route = createFileRoute("/api/ai/suggest-product")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        // Auth obrigatória
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

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!suggestProductOpenAiEnabled() && !apiKey) {
          return Response.json({ error: "LOVABLE_API_KEY não configurada" }, { status: 500 });
        }

        let body: RequestBody;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "JSON inválido" }, { status: 400 });
        }

        if (!Array.isArray(body.messages) || body.messages.length === 0) {
          return Response.json({ error: "messages obrigatório" }, { status: 400 });
        }

        const transcript = body.messages
          .map((m) => `${m.role === "lead" ? "Cliente" : m.role === "agent" ? "Vendedor" : "Sistema"}: ${m.text}`)
          .join("\n");

        // Catálogo ativo da empresa do usuário (isolado por company_id).
        const companyId = profile.company_id as string;
        const { data: productRows, error: productsError } = await supabaseAdmin
          .from("products")
          .select("id, company_id, active, name, category, description")
          .eq("company_id", companyId)
          .eq("active", true)
          .order("name", { ascending: true })
          .limit(300);
        if (productsError) {
          return Response.json({ error: "Falha ao carregar o catálogo" }, { status: 502 });
        }
        const companyProducts = buildSuggestProductCatalog(productRows, companyId);
        if (companyProducts.length === 0) {
          return Response.json({ error: "Catálogo vazio para esta empresa" }, { status: 422 });
        }

        const catalog = formatSuggestProductCatalog(companyProducts);

        const productIds = companyProducts.map((p) => p.id);

        const systemPrompt = `Você é um assistente que identifica qual produto do catálogo melhor corresponde ao interesse do cliente em uma conversa de atendimento.
Analise a conversa e devolva, via tool call:
- productId: o id EXATO de um produto do catálogo que melhor corresponde ao interesse demonstrado.
- confidence: "alta" | "media" | "baixa" — quão certo você está.
- reason: uma frase curta em pt-BR explicando por que escolheu esse produto (mencione palavras-chave da conversa).
Se não houver indícios suficientes, escolha o produto mais provável com confidence "baixa".`;

        const userPrompt = `Catálogo de produtos disponíveis (id | categoria | nome):
${catalog}

Lead: ${body.leadName ?? "—"}
Produto marcado no cadastro do lead: ${body.product ?? "—"}

Conversa:
${transcript}`;

        const payload = {
          model: LOVABLE_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "suggest_product",
                description: "Sugere o produto do catálogo mais adequado.",
                parameters: {
                  type: "object",
                  properties: {
                    productId: { type: "string", enum: productIds },
                    confidence: { type: "string", enum: ["alta", "media", "baixa"] },
                    reason: { type: "string" },
                  },
                  required: ["productId", "confidence", "reason"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "suggest_product" } },
        };

        let parsed: { productId?: unknown; confidence?: unknown; reason?: unknown };
        if (suggestProductOpenAiEnabled()) {
          try {
            const result = await new OpenAiResponsesGateway(undefined, {
              usageSink: createSupabaseAiUsageSink(supabaseAdmin),
            }).run({
              companyId,
              capability: "sales_agent",
              instructions: systemPrompt,
              input: `${userPrompt}\n\nUse a ferramenta suggest_product. Não invente produtos, preços ou estoque.`,
              tools: [{
                type: "function",
                name: "suggest_product",
                description: "Sugere o produto do catálogo mais adequado.",
                parameters: payload.tools[0].function.parameters,
                strict: false,
              }],
              toolChoice: { type: "function", name: "suggest_product" },
              store: false,
              maxOutputTokens: OPENAI_MAX_OUTPUT_TOKENS,
              tags: { feature: "suggest_product", prompt_version: "2026-10-24.a" },
            });
            const call = result.toolCalls.find((item) => item.name === "suggest_product");
            if (!call?.arguments) throw new Error("structured_output_missing");
            parsed = JSON.parse(call.arguments) as typeof parsed;
          } catch (error) {
            console.warn(
              "[suggest-product] OpenAI indisponível; usando fallback Lovable",
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
            try { parsed = JSON.parse(toolCall.function.arguments) as typeof parsed; } catch {
              return Response.json({ error: "Falha ao interpretar resposta da IA" }, { status: 502 });
            }
          }
        } else {
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
          try { parsed = JSON.parse(toolCall.function.arguments) as typeof parsed; } catch {
            return Response.json({ error: "Falha ao interpretar resposta da IA" }, { status: 502 });
          }
        }

        if (typeof parsed.productId !== "string" || !productIds.includes(parsed.productId)) {
          return Response.json({ error: "Produto sugerido inválido" }, { status: 502 });
        }
        if (!parsed.reason || typeof parsed.reason !== "string") {
          return Response.json({ error: "Resposta da IA sem justificativa" }, { status: 502 });
        }
        return Response.json(parsed);
      },
    },
  },
});

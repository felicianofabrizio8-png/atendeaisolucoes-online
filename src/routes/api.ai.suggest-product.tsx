import { createFileRoute } from "@tanstack/react-router";
import { products } from "@/data/products";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

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
      POST: async ({ request }) => {
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) {
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

        const catalog = products
          .map((p) => `- ${p.id} | ${p.category} | ${p.name}${p.description ? ` — ${p.description}` : ""}`)
          .join("\n");

        const productIds = products.map((p) => p.id);

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
          model: "google/gemini-2.5-flash",
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
              { error: "Créditos esgotados. Adicione créditos em Configurações > Workspace > Uso." },
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
          return Response.json({ error: "Resposta da IA sem dados estruturados" }, { status: 502 });
        }

        try {
          const parsed = JSON.parse(toolCall.function.arguments);
          // Valida se o productId existe de fato
          if (!productIds.includes(parsed.productId)) {
            return Response.json({ error: "Produto sugerido inválido" }, { status: 502 });
          }
          return Response.json(parsed);
        } catch (e) {
          console.error("Parse error", e, toolCall.function.arguments);
          return Response.json({ error: "Falha ao interpretar resposta da IA" }, { status: 502 });
        }
      },
    },
  },
});

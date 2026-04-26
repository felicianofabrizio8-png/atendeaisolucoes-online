import { createFileRoute } from "@tanstack/react-router";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

interface IncomingMessage {
  role: "lead" | "agent" | "system";
  text: string;
}

interface RequestBody {
  leadName?: string;
  channel?: string;
  product?: string;
  tags?: string[];
  messages: IncomingMessage[];
}

export const Route = createFileRoute("/api/ai/suggest")({
  // @ts-expect-error — `server` é fornecido em runtime pelo TanStack Start
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
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

        const systemPrompt = `Você é um assistente de vendas que ajuda vendedores a fechar negócios via WhatsApp/Instagram/Facebook.
Analise a conversa abaixo e devolva, via tool call:
- classification: "frio" | "morno" | "quente"
- intent: intenção principal do cliente em poucas palavras (pt-BR)
- objection: principal objeção, se houver (pt-BR), ou null
- nextAction: próxima ação recomendada (pt-BR, curta, no infinitivo)
- suggestedReply: mensagem pronta para o vendedor enviar agora ao cliente, em português brasileiro, tom humano, próximo, profissional. Sem clichês. Trate objeções com empatia. Se faltar informação, faça uma pergunta única e objetiva. Máximo 4 frases.`;

        const userPrompt = `Lead: ${body.leadName ?? "—"}
Canal: ${body.channel ?? "—"}
Produto de interesse: ${body.product ?? "—"}
Tags: ${(body.tags ?? []).join(", ") || "—"}

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
                name: "atende_ai_suggestion",
                description: "Devolve a análise do lead e a sugestão de resposta.",
                parameters: {
                  type: "object",
                  properties: {
                    classification: { type: "string", enum: ["frio", "morno", "quente"] },
                    intent: { type: "string" },
                    objection: { type: ["string", "null"] },
                    nextAction: { type: "string" },
                    suggestedReply: { type: "string" },
                  },
                  required: ["classification", "intent", "nextAction", "suggestedReply"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "atende_ai_suggestion" } },
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
          return Response.json(parsed);
        } catch (e) {
          console.error("Parse error", e, toolCall.function.arguments);
          return Response.json({ error: "Falha ao interpretar resposta da IA" }, { status: 502 });
        }
      },
    },
  },
});

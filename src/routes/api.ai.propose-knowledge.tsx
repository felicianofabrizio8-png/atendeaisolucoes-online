import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

/**
 * Analisa as últimas conversas da empresa e cria PROPOSTAS de conhecimento
 * (FAQs, objeções, padrões). Todas entram como status="pending" e precisam
 * de aprovação do admin antes de serem usadas pela IA.
 */
export const Route = createFileRoute("/api/ai/propose-knowledge")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const accessToken = authHeader.startsWith("Bearer ")
          ? authHeader.slice("Bearer ".length)
          : "";
        if (!accessToken) return Response.json({ error: "não autenticado" }, { status: 401 });
        const { data: userRes, error } = await supabaseAdmin.auth.getUser(accessToken);
        if (error || !userRes.user) return Response.json({ error: "sessão inválida" }, { status: 401 });
        const userId = userRes.user.id;

        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("company_id")
          .eq("id", userId)
          .maybeSingle();
        if (!profile?.company_id) return Response.json({ error: "sem empresa" }, { status: 403 });
        const companyId = profile.company_id;

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return Response.json({ error: "LOVABLE_API_KEY não configurada" }, { status: 500 });

        // Coleta últimas 200 mensagens
        const { data: msgs, error: msgErr } = await supabaseAdmin
          .from("messages")
          .select("conversation_id, role, text, at")
          .eq("company_id", companyId)
          .order("at", { ascending: false })
          .limit(200);

        if (msgErr) return Response.json({ error: msgErr.message }, { status: 500 });
        if (!msgs || msgs.length < 10) {
          return Response.json({
            created: 0,
            message: "Poucas conversas para análise. Continue atendendo e tente novamente.",
          });
        }

        const transcript = [...msgs]
          .reverse()
          .map((m) => `[${m.conversation_id.slice(0, 6)}] ${m.role}: ${m.text}`)
          .join("\n")
          .slice(0, 14000);

        const systemPrompt = `Você analisa históricos de atendimento de uma empresa e identifica padrões reutilizáveis para uma base de conhecimento.

Identifique até 10 itens, priorizando:
- perguntas que os clientes fazem repetidamente (faq)
- objeções comuns à venda (objection)
- respostas que vendedores enviam recorrentemente (recurring_reply)
- padrões de venda observados (sales_pattern)

Para cada item, devolva uma "question" curta (o que o cliente pergunta / a objeção) e uma "answer" como sugestão de resposta. NÃO invente preços, prazos ou condições — use apenas o que aparece no histórico.`;

        const payload = {
          model: MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Histórico:\n${transcript}` },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "propose_knowledge",
                description: "Propostas de conhecimento extraídas das conversas.",
                parameters: {
                  type: "object",
                  properties: {
                    proposals: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          type: { type: "string", enum: ["faq", "objection", "recurring_reply", "sales_pattern"] },
                          question: { type: "string" },
                          answer: { type: "string" },
                        },
                        required: ["type", "question", "answer"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["proposals"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "propose_knowledge" } },
        };

        let aiRes: Response;
        try {
          aiRes = await fetch(GATEWAY_URL, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
        } catch (e) {
          console.error("[AI_PROPOSE_NETWORK_FAIL]", e);
          return Response.json({ error: "Falha de rede ao consultar IA" }, { status: 502 });
        }
        if (!aiRes.ok) {
          if (aiRes.status === 429) return Response.json({ error: "Rate limit" }, { status: 429 });
          if (aiRes.status === 402) return Response.json({ error: "Créditos esgotados" }, { status: 402 });
          const t = await aiRes.text();
          console.error("[AI_PROPOSE_GATEWAY_ERR]", aiRes.status, t);
          return Response.json({ error: "Falha ao consultar IA" }, { status: 502 });
        }

        const data = await aiRes.json();
        const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
        if (!args) return Response.json({ error: "Resposta sem dados" }, { status: 502 });

        let parsed: { proposals: Array<{ type: string; question: string; answer: string }> };
        try {
          parsed = JSON.parse(args);
        } catch {
          return Response.json({ error: "JSON inválido" }, { status: 502 });
        }

        const rows = (parsed.proposals ?? [])
          .filter((p) => p.question?.trim() && p.answer?.trim())
          .map((p) => ({
            company_id: companyId,
            type: p.type as "faq" | "objection" | "recurring_reply" | "sales_pattern",
            question: p.question.trim(),
            answer: p.answer.trim(),
            status: "pending" as const,
          }));

        if (rows.length === 0) return Response.json({ created: 0 });

        const { error: insErr } = await supabaseAdmin.from("ai_knowledge_proposals").insert(rows);
        if (insErr) return Response.json({ error: insErr.message }, { status: 500 });

        return Response.json({ created: rows.length });
      },
    },
  },
});

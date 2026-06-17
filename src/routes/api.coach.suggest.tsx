import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

interface SuggestBody {
  conversation_id: string;
}

interface CoachOutput {
  situation: string;
  next_action: string;
  suggestion_text: string;
  reasoning: string;
  objection_type: "price" | "timing" | "spouse" | "researching" | "discount" | "other" | null;
  urgency: "low" | "medium" | "high" | "critical";
  risk_score: number;
}

export const Route = createFileRoute("/api/coach/suggest")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
        if (!token) return Response.json({ error: "não autenticado" }, { status: 401 });
        const { data: userRes } = await supabaseAdmin.auth.getUser(token);
        if (!userRes.user) return Response.json({ error: "sessão inválida" }, { status: 401 });
        const userId = userRes.user.id;
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("company_id")
          .eq("id", userId)
          .maybeSingle();
        if (!profile?.company_id)
          return Response.json({ error: "perfil sem empresa" }, { status: 403 });
        const companyId = profile.company_id as string;

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey)
          return Response.json({ error: "LOVABLE_API_KEY ausente" }, { status: 500 });

        let body: SuggestBody;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "JSON inválido" }, { status: 400 });
        }
        if (!body.conversation_id)
          return Response.json({ error: "conversation_id obrigatório" }, { status: 400 });

        const { data: conv } = await supabaseAdmin
          .from("conversations")
          .select("id, lead_id")
          .eq("company_id", companyId)
          .eq("id", body.conversation_id)
          .maybeSingle();
        if (!conv) return Response.json({ error: "conversa não encontrada" }, { status: 404 });

        const [{ data: lead }, { data: msgs }, { data: company }] = await Promise.all([
          supabaseAdmin
            .from("leads")
            .select("name, product, status, estimated_value")
            .eq("id", conv.lead_id)
            .maybeSingle(),
          supabaseAdmin
            .from("messages")
            .select("id, role, text, at")
            .eq("conversation_id", body.conversation_id)
            .is("deleted_at", null)
            .order("at", { ascending: false })
            .limit(15),
          supabaseAdmin.from("companies").select("name").eq("id", companyId).maybeSingle(),
        ]);

        const ordered = (msgs ?? []).slice().reverse();
        const lastMessageId = [...(msgs ?? [])].find((m) => m.role === "lead")?.id ?? null;
        const transcript = ordered
          .map(
            (m) =>
              `${m.role === "lead" ? "Cliente" : m.role === "agent" ? "Vendedor" : "Sistema"}: ${m.text}`,
          )
          .join("\n");

        const systemPrompt = `Você é a "IA Coach do Vendedor" da empresa "${company?.name ?? "—"}".
Você NUNCA envia mensagens. Apenas orienta o vendedor humano.
Analise a conversa e devolva via tool call:
- situation: descrição curta do estado atual do cliente (1 frase, pt-BR).
- next_action: próxima ação recomendada ao vendedor (verbo no infinitivo, curto).
- suggestion_text: sugestão de mensagem pronta para o vendedor copiar/editar/enviar. pt-BR, humano, máx 4 frases, sem clichês, sem inventar preço/prazo/desconto.
- reasoning: por que essa sugestão (1-2 frases).
- objection_type: "price"|"timing"|"spouse"|"researching"|"discount"|"other"|null.
- urgency: "low"|"medium"|"high"|"critical".
- risk_score: 0-100 (risco de perder a venda).`;

        const userPrompt = `Lead: ${lead?.name ?? "—"}
Produto: ${lead?.product ?? "—"}
Status: ${lead?.status ?? "—"}
Valor estimado: ${lead?.estimated_value ?? "—"}

Conversa (cronológica):
${transcript || "(sem mensagens)"}`;

        const aiRes = await fetch(GATEWAY_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: MODEL,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            tools: [
              {
                type: "function",
                function: {
                  name: "coach_output",
                  description: "Devolve a orientação do Coach ao vendedor",
                  parameters: {
                    type: "object",
                    properties: {
                      situation: { type: "string" },
                      next_action: { type: "string" },
                      suggestion_text: { type: "string" },
                      reasoning: { type: "string" },
                      objection_type: {
                        type: "string",
                        enum: ["price", "timing", "spouse", "researching", "discount", "other", "none"],
                      },
                      urgency: { type: "string", enum: ["low", "medium", "high", "critical"] },
                      risk_score: { type: "integer", minimum: 0, maximum: 100 },
                    },
                    required: [
                      "situation",
                      "next_action",
                      "suggestion_text",
                      "reasoning",
                      "urgency",
                      "risk_score",
                    ],
                  },
                },
              },
            ],
            tool_choice: { type: "function", function: { name: "coach_output" } },
          }),
        });

        if (!aiRes.ok) {
          if (aiRes.status === 429)
            return Response.json({ error: "Limite de uso da IA atingido. Tente em alguns minutos." }, { status: 429 });
          if (aiRes.status === 402)
            return Response.json({ error: "Créditos de IA esgotados. Adicione créditos no workspace." }, { status: 402 });
          const errText = await aiRes.text();
          return Response.json({ error: `Falha na IA: ${errText.slice(0, 200)}` }, { status: 502 });
        }

        const payload = await aiRes.json();
        const toolCall = payload?.choices?.[0]?.message?.tool_calls?.[0];
        if (!toolCall) return Response.json({ error: "IA não retornou sugestão" }, { status: 502 });
        let parsed: CoachOutput;
        try {
          parsed = JSON.parse(toolCall.function.arguments) as CoachOutput;
        } catch {
          return Response.json({ error: "Resposta da IA inválida" }, { status: 502 });
        }

        const { data: ins, error: insErr } = await supabaseAdmin
          .from("coach_suggestions")
          .insert({
            company_id: companyId,
            conversation_id: body.conversation_id,
            message_id: lastMessageId,
            situation: parsed.situation,
            next_action: parsed.next_action,
            suggestion_text: parsed.suggestion_text,
            reasoning: parsed.reasoning,
            objection_type: parsed.objection_type ?? null,
            urgency: parsed.urgency,
            risk_score: parsed.risk_score,
            created_by: userId,
          })
          .select("*")
          .single();

        if (insErr) return Response.json({ error: insErr.message }, { status: 500 });
        return Response.json({ ok: true, suggestion: ins });
      },
    },
  },
});

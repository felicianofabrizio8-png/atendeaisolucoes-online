import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildCompanyGrounding } from "@/lib/coach-interpreter/grounding.server";
import { recordSuggestionTelemetry } from "@/lib/coach-learnings/telemetry.server";


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
          .select("id, lead_id, channel")
          .eq("company_id", companyId)
          .eq("id", body.conversation_id)
          .maybeSingle();
        if (!conv) return Response.json({ error: "conversa não encontrada" }, { status: 404 });

        // ---------------------------------------------------------------
        // SPRINT 4 · FASE 3 — o grounding agora depende da conversa.
        //
        // Ordem obrigatória: lead + mensagens PRIMEIRO, grounding DEPOIS.
        // O retriever contextual precisa da mensagem atual do cliente e do
        // produto do lead para ranquear; sem isso ele cairia em fallback
        // estático e a fase inteira perderia o sentido.
        //
        // Custo: uma ida extra ao banco em série. Aceitável — as três
        // consultas iniciais continuam paralelas e o ranking é local.
        // ---------------------------------------------------------------
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

        const orderedMsgs = (msgs ?? []).slice().reverse();
        const lastLeadMessage = [...(msgs ?? [])].find((m) => m.role === "lead") ?? null;

        // Grounding OBRIGATÓRIO — inclui aprendizados ranqueados pelo contexto
        // desta conversa, isolados por company_id. Nunca vaza entre tenants.
        const grounding = await buildCompanyGrounding(supabaseAdmin, companyId, {
          retrieval: {
            currentMessage: lastLeadMessage?.text ?? null,
            recentMessages: orderedMsgs.map((m) => ({
              role: m.role as "lead" | "agent" | "system",
              text: m.text,
            })),
            channel: (conv as { channel?: string | null }).channel ?? null,
            productContext: lead?.product ?? null,
          },
        }).catch(() => null);

        const ordered = orderedMsgs;
        const lastMessageId = lastLeadMessage?.id ?? null;
        const transcript = ordered
          .map(
            (m) =>
              `${m.role === "lead" ? "Cliente" : m.role === "agent" ? "Vendedor" : "Sistema"}: ${m.text}`,
          )
          .join("\n");

        // Auditoria de learnings usados no grounding.
        const learningIdsUsed = grounding?.learningIdsUsed ?? [];
        let learningVersionsUsed: Array<{ id: string; version: number }> = [];
        let learningConfidence: number | null = null;
        if (learningIdsUsed.length > 0) {
          const { data: lv } = await supabaseAdmin
            .from("coach_learnings" as never)
            .select("id, version, confidence, company_id")
            .in("id", learningIdsUsed);
          const rows = ((lv ?? []) as Array<{
            id: string;
            version: number;
            confidence: number;
            company_id: string;
          }>).filter((r) => r.company_id === companyId);
          learningVersionsUsed = rows.map((r) => ({ id: r.id, version: r.version }));
          if (rows.length > 0) {
            learningConfidence =
              rows.reduce((a, r) => a + Number(r.confidence ?? 0), 0) / rows.length;
          }
        }

        const groundingBlock = grounding?.block ?? "";
        const systemPrompt = `Você é a "IA Coach do Vendedor" da empresa "${company?.name ?? "—"}".
Você NUNCA envia mensagens. Apenas orienta o vendedor humano.

HIERARQUIA OBRIGATÓRIA de conhecimento (respeite nesta ordem):
1. Conversa atual e histórico do cliente.
2. APRENDIZADOS DA EQUIPE (bloco abaixo — regras específicas ensinadas pelos vendedores desta empresa; TÊM PRIORIDADE sobre a Base de Conhecimento e o catálogo, exceto quando conflitam com REGRAS COMERCIAIS ATIVAS).
3. Base de Conhecimento da empresa.
4. Catálogo de produtos.
5. FAQ / respostas rápidas.
6. Regras comerciais ativas.
7. Conhecimento geral seu.

Analise a conversa e devolva via tool call:
- situation: descrição curta do estado atual do cliente (1 frase, pt-BR).
- next_action: próxima ação recomendada ao vendedor (verbo no infinitivo, curto).
- suggestion_text: sugestão de mensagem pronta para o vendedor copiar/editar/enviar. pt-BR, humano, máx 4 frases, sem clichês, sem inventar preço/prazo/desconto, respeitando os APRENDIZADOS DA EQUIPE.
- reasoning: por que essa sugestão (1-2 frases). Se um aprendizado foi decisivo, cite-o.
- objection_type: "price"|"timing"|"spouse"|"researching"|"discount"|"other"|null.
- urgency: "low"|"medium"|"high"|"critical".
- risk_score: 0-100 (risco de perder a venda).

${groundingBlock}`;

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
            objection_type: parsed.objection_type && parsed.objection_type !== ("none" as never) ? parsed.objection_type : null,
            urgency: parsed.urgency,
            risk_score: parsed.risk_score,
            created_by: userId,
            // Auditoria — Coach Evolutivo
            learning_ids_used: learningIdsUsed,
            learning_versions_used: learningVersionsUsed as unknown as never,
            learning_confidence: learningConfidence,
            grounding_score: grounding ? Number(grounding.groundingScore.toFixed(2)) : null,
            sources_used: grounding ? (grounding.sourcesUsed as unknown as never) : null,
          } as never)
          .select("*")
          .single();

        if (insErr) return Response.json({ error: insErr.message }, { status: 500 });

        // ---------------------------------------------------------------
        // Telemetria do Coach Evolutivo (SPRINT 4 · FASE 2)
        //
        // Ordem obrigatória: sugestão persistida → suggestion_id disponível
        // → retrievals → incremento de uso. O `suggestion_id` é a chave de
        // idempotência (`generation_ref`), então um retry não duplica.
        //
        // `companyId` vem SEMPRE do JWT do usuário (profiles.company_id),
        // nunca do payload do cliente. As RPCs `_internal` revalidam cada
        // learning_id contra a empresa antes de escrever.
        //
        // Falha aqui NÃO bloqueia a entrega — mas nunca é silenciosa:
        // `recordSuggestionTelemetry` emite log estruturado sanitizado.
        // ---------------------------------------------------------------
        const suggestionId = (ins as { id?: string } | null)?.id ?? null;
        if (learningIdsUsed.length > 0 && suggestionId) {
          await recordSuggestionTelemetry(supabaseAdmin, {
            companyId,
            suggestionId,
            learningIds: learningIdsUsed,
            conversationId: body.conversation_id,
            messageId: lastMessageId,
            // Trace explicável do ranking: por que CADA aprendizado entrou.
            // Ausente (fallback estático) → a telemetria usa o motivo padrão.
            ranking: grounding?.learningRetrieval?.trace,
            selectionReason: grounding?.learningRetrieval?.strategy,
          }).catch(() => undefined);

        }


        return Response.json({ ok: true, suggestion: ins });
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

interface IncomingMessage {
  role: "lead" | "agent" | "system";
  text: string;
}

interface RequestBody {
  leadName?: string;
  channel?: string;
  product?: string;
  tags?: string[];
  conversationId?: string;
  leadId?: string;
  messages: IncomingMessage[];
}

interface AISuggestionResponse {
  classification: "frio" | "morno" | "quente";
  intent: string;
  objection?: string | null;
  nextAction: string;
  suggestedReply: string;
  lowConfidence?: boolean;
  logId?: string;
  fallbackMessage?: string;
}

function monthStart(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export const Route = createFileRoute("/api/ai/suggest")({
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
        const { data: userRes, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
        if (userErr || !userRes.user) {
          return Response.json({ error: "sessão inválida" }, { status: 401 });
        }
        const userId = userRes.user.id;

        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("company_id")
          .eq("id", userId)
          .maybeSingle();
        if (!profile?.company_id) {
          return Response.json({ error: "perfil sem empresa" }, { status: 403 });
        }
        const companyId = profile.company_id;

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

        // --- limite mensal ---
        const month = monthStart();
        const { data: counter } = await supabaseAdmin
          .from("ai_usage_counters")
          .select("count, monthly_limit")
          .eq("company_id", companyId)
          .eq("month", month)
          .maybeSingle();

        const currentCount = counter?.count ?? 0;
        const limit = counter?.monthly_limit ?? 1000;
        if (currentCount >= limit) {
          return Response.json(
            { error: `Limite mensal de uso da IA atingido (${limit}). Aumente o limite em Configurações > IA.` },
            { status: 429 },
          );
        }

        // --- perfil + base de conhecimento ---
        const [{ data: aiProfile }, { data: approvedKb }, { data: company }] = await Promise.all([
          supabaseAdmin.from("ai_profiles").select("*").eq("company_id", companyId).maybeSingle(),
          supabaseAdmin
            .from("ai_knowledge_proposals")
            .select("question, answer, type")
            .eq("company_id", companyId)
            .eq("status", "approved")
            .order("created_at", { ascending: false })
            .limit(20),
          supabaseAdmin.from("companies").select("name").eq("id", companyId).maybeSingle(),
        ]);

        const toneMap: Record<string, string> = {
          comercial: "comercial, direto, focado em fechar venda",
          amigavel: "amigável, próximo, caloroso",
          premium: "premium, refinado, exclusivo",
          tecnico: "técnico, preciso, informativo",
          informal: "informal, descontraído, conversacional",
        };
        const tone = aiProfile?.tone ? (toneMap[aiProfile.tone] ?? "natural e profissional") : "natural e profissional";

        const faqLines = Array.isArray(aiProfile?.faq)
          ? (aiProfile?.faq as Array<{ q?: string; a?: string }>)
              .filter((f) => f?.q && f?.a)
              .slice(0, 20)
              .map((f, i) => `${i + 1}. P: ${f.q}\n   R: ${f.a}`)
              .join("\n")
          : "";

        const kbLines = (approvedKb ?? [])
          .map((k, i) => `${i + 1}. [${k.type}] ${k.question}\n   → ${k.answer}`)
          .join("\n");

        const empresaNome = aiProfile?.company_name ?? company?.name ?? "—";

        const transcript = body.messages
          .map((m) =>
            `${m.role === "lead" ? "Cliente" : m.role === "agent" ? "Vendedor" : "Sistema"}: ${m.text}`,
          )
          .join("\n");

        const systemPrompt = `Você é um assistente comercial humano que ajuda VENDEDORES da empresa "${empresaNome}" a responder clientes em WhatsApp/Instagram/Facebook.

REGRAS DE SEGURANÇA — INVIOLÁVEIS:
- Você NUNCA envia mensagens sozinho. Apenas SUGERE para o vendedor revisar e enviar.
- Você NUNCA altera preços, cria descontos ou condições comerciais novas. Use apenas o que está no contexto abaixo.
- Você NUNCA inventa prazos, formas de pagamento ou diferenciais. Se faltar dado, faça UMA pergunta única ao cliente OU marque lowConfidence=true e sugira atendimento humano.

CONTEXTO DA EMPRESA:
- Nome: ${empresaNome}
- Descrição: ${aiProfile?.description ?? "—"}
- Produtos/serviços: ${aiProfile?.products ?? "—"}
- Formas de pagamento: ${aiProfile?.payment_methods ?? "—"}
- Prazo médio: ${aiProfile?.avg_lead_time ?? "—"}
- Horário de atendimento: ${aiProfile?.business_hours ?? "—"}
- Cidade/região atendida: ${aiProfile?.region ?? "—"}
- Diferenciais: ${aiProfile?.differentials ?? "—"}

TOM DE VOZ: ${tone}.

PERGUNTAS FREQUENTES:
${faqLines || "(nenhuma cadastrada)"}

BASE DE CONHECIMENTO APROVADA:
${kbLines || "(vazia)"}

INSTRUÇÕES:
Analise a conversa e retorne via tool call:
- classification: "frio" | "morno" | "quente"
- intent: intenção principal do cliente (curto, pt-BR)
- objection: principal objeção, ou null
- nextAction: próxima ação recomendada ao vendedor (curta, infinitivo)
- suggestedReply: mensagem pronta para o vendedor enviar, em pt-BR, máximo 4 frases, humana e sem clichês. Se faltar informação crítica, faça UMA pergunta objetiva.
- lowConfidence: true se você NÃO tiver dados suficientes para responder com segurança (sugerir atendimento humano).`;

        const userPrompt = `Lead: ${body.leadName ?? "—"}
Canal: ${body.channel ?? "—"}
Produto de interesse: ${body.product ?? "—"}
Tags: ${(body.tags ?? []).join(", ") || "—"}

Conversa:
${transcript}`;

        const payload = {
          model: MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "atende_ai_suggestion",
                description: "Devolve análise + sugestão de resposta.",
                parameters: {
                  type: "object",
                  properties: {
                    classification: { type: "string", enum: ["frio", "morno", "quente"] },
                    intent: { type: "string" },
                    objection: { type: ["string", "null"] },
                    nextAction: { type: "string" },
                    suggestedReply: { type: "string" },
                    lowConfidence: { type: "boolean" },
                  },
                  required: ["classification", "intent", "nextAction", "suggestedReply"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "atende_ai_suggestion" } },
        };

        let aiRes: Response;
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 20000);
          aiRes = await fetch(GATEWAY_URL, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
        } catch (e) {
          console.error("[AI_SUGGEST_NETWORK_FAIL]", e);
          return Response.json(
            {
              error: "Não foi possível consultar a IA. Recomendamos resposta humana neste momento.",
              fallbackMessage: "✋ Atendimento humano recomendado.",
            },
            { status: 502 },
          );
        }

        if (!aiRes.ok) {
          if (aiRes.status === 429) {
            return Response.json(
              { error: "IA com muitas requisições. Tente novamente em alguns segundos." },
              { status: 429 },
            );
          }
          if (aiRes.status === 402) {
            return Response.json(
              { error: "Créditos da IA esgotados. Adicione créditos em Configurações > Workspace > Uso." },
              { status: 402 },
            );
          }
          const t = await aiRes.text();
          console.error("[AI_SUGGEST_GATEWAY_ERR]", aiRes.status, t);
          return Response.json({ error: "Falha ao consultar a IA" }, { status: 502 });
        }

        const data = await aiRes.json();
        const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
        if (!toolCall?.function?.arguments) {
          return Response.json({ error: "Resposta da IA sem dados estruturados" }, { status: 502 });
        }

        let parsed: AISuggestionResponse;
        try {
          parsed = JSON.parse(toolCall.function.arguments);
        } catch (e) {
          console.error("[AI_SUGGEST_PARSE_ERR]", e);
          return Response.json({ error: "Falha ao interpretar resposta da IA" }, { status: 502 });
        }

        // --- log + contador ---
        const { data: inserted } = await supabaseAdmin
          .from("ai_suggestions_log")
          .insert({
            company_id: companyId,
            user_id: userId,
            conversation_id: body.conversationId ?? null,
            lead_id: body.leadId ?? null,
            model: MODEL,
            generated_text: parsed.suggestedReply ?? "",
            classification: parsed.classification ?? null,
            low_confidence: !!parsed.lowConfidence,
          })
          .select("id")
          .single();

        if (counter) {
          await supabaseAdmin
            .from("ai_usage_counters")
            .update({ count: currentCount + 1, updated_at: new Date().toISOString() })
            .eq("company_id", companyId)
            .eq("month", month);
        } else {
          await supabaseAdmin
            .from("ai_usage_counters")
            .insert({ company_id: companyId, month, count: 1, monthly_limit: 1000 });
        }

        return Response.json({
          ...parsed,
          logId: inserted?.id,
          fallbackMessage: parsed.lowConfidence
            ? "✋ Atendimento humano recomendado: a IA não tem dados suficientes para responder com segurança."
            : undefined,
        } satisfies AISuggestionResponse);
      },
    },
  },
});

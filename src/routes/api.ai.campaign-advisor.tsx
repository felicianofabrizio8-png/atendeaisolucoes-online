// ============================================================================
// Gestor IA (consultivo) — endpoint da aba "Gestor IA" no detalhe da campanha.
// Apenas leitura/diagnóstico. NÃO altera campanha, orçamento, público nem
// publica/edita anúncios na Meta. Reutiliza dados já sincronizados em
// `campaigns` e `campaign_metrics` (sem chamar Meta Ads aqui).
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { OpenAiResponsesGateway } from "@/lib/ai-platform/gateway.server";
import { createSupabaseAiUsageSink } from "@/lib/ai-platform/supabase-usage-sink.server";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const LOVABLE_MODEL = "google/gemini-2.5-flash";
const OPENAI_MODEL = "gpt-6-luna";
const OPENAI_MAX_OUTPUT_TOKENS = 512;

export function campaignAdvisorOpenAiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CAMPAIGN_ADVISOR_OPENAI_RESPONSES === "enabled";
}

async function authedCompanyId(request: Request): Promise<{ companyId: string | null; userId: string | null }> {
  const h = request.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return { companyId: null, userId: null };
  const { data } = await supabaseAdmin.auth.getUser(token);
  if (!data?.user) return { companyId: null, userId: null };
  const { data: prof } = await supabaseAdmin
    .from("profiles")
    .select("company_id")
    .eq("id", data.user.id)
    .maybeSingle();
  return { companyId: prof?.company_id ?? null, userId: data.user.id };
}

interface Body {
  campaignId?: string;
  mode?: "analyze" | "history";
}

export const Route = createFileRoute("/api/ai/campaign-advisor")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const { companyId } = await authedCompanyId(request);
        if (!companyId)
          return Response.json({ ok: false, error: "não autenticado" }, { status: 401 });

        let body: Body;
        try { body = await request.json(); } catch { body = {}; }
        const campaignId = body.campaignId?.trim();
        if (!campaignId)
          return Response.json({ ok: false, error: "campaignId obrigatório" }, { status: 400 });

        // Carrega campanha garantindo o escopo de empresa.
        const { data: campaign, error: cErr } = await supabaseAdmin
          .from("campaigns")
          .select("*")
          .eq("id", campaignId)
          .eq("company_id", companyId)
          .maybeSingle();
        if (cErr || !campaign)
          return Response.json({ ok: false, error: "campanha não encontrada" }, { status: 404 });

        if (body.mode === "history") {
          const { data: history } = await supabaseAdmin
            .from("campaign_ai_analyses")
            .select("id, created_at, summary, diagnosis, recommendations, creative_ideas, copy_ideas, metrics_snapshot, model")
            .eq("campaign_id", campaignId)
            .order("created_at", { ascending: false })
            .limit(10);
          return Response.json({ ok: true, history: history ?? [] });
        }

        // Última métrica sincronizada (já existe na base — não chama Meta aqui).
        const { data: metric } = await supabaseAdmin
          .from("campaign_metrics")
          .select("*")
          .eq("campaign_id", campaignId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!campaignAdvisorOpenAiEnabled() && !apiKey)
          return Response.json({ ok: false, error: "LOVABLE_API_KEY não configurada" }, { status: 500 });

        const metricsBlock = metric
          ? `Métricas reais sincronizadas da Meta:
- Impressões: ${metric.impressions}
- Alcance: ${metric.reach}
- Cliques: ${metric.clicks}
- CTR: ${metric.ctr}%
- CPC: R$ ${metric.cpc}
- CPM: R$ ${metric.cpm}
- Mensagens: ${metric.messages}
- Leads: ${metric.leads}
- Gasto: R$ ${metric.spent}`
          : "Métricas reais ainda não disponíveis (campanha não publicada ou sem entrega).";

        const briefing = `Campanha: ${campaign.name}
Canal: ${campaign.objective} · Objetivo: ${campaign.goal}
Produto: ${campaign.product ?? "—"}
Cidade: ${campaign.city ?? "—"} · Raio: ${campaign.radius_km ?? "—"} km
Orçamento diário: R$ ${campaign.daily_budget ?? "—"}
Headline: ${campaign.headline ?? "—"}
Texto principal: ${campaign.primary_text ?? "—"}
CTA: ${campaign.cta ?? "—"}
Status: ${campaign.status} · Meta delivery: ${campaign.meta_delivery_status ?? "—"}

${metricsBlock}`;

        const systemPrompt = `Você é um GESTOR DE TRÁFEGO SÊNIOR consultivo para PMEs no Brasil (Meta Ads).
Sua função é ANALISAR a campanha do lojista e dar recomendações claras.
Você NUNCA altera campanha, nunca publica, nunca muda orçamento ou público — apenas RECOMENDA.
Tom: direto, próximo, brasileiro, sem jargão técnico desnecessário.
Sempre baseie-se nos dados fornecidos. Se faltar dado real, diga "ainda sem dados suficientes" em vez de inventar.`;

        const userPrompt = `Analise a campanha abaixo e devolva via tool call:

${briefing}

Gere:
1. Um diagnóstico curto (saúde geral, pontos fortes, alertas).
2. Recomendações práticas (o que o lojista pode ajustar manualmente).
3. Ideias de novos criativos (descrições de imagens/vídeos que poderiam performar melhor).
4. Sugestões de novos textos (headline + texto principal + CTA).`;

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
                name: "campaign_advisory",
                description: "Análise consultiva da campanha.",
                parameters: {
                  type: "object",
                  properties: {
                    summary: { type: "string", description: "Resumo curto da saúde da campanha (1-2 frases)." },
                    diagnosis: {
                      type: "object",
                      properties: {
                        health: { type: "string", enum: ["boa", "atencao", "ruim", "sem_dados"] },
                        strengths: { type: "array", items: { type: "string" } },
                        risks: { type: "array", items: { type: "string" } },
                      },
                      required: ["health", "strengths", "risks"],
                    },
                    recommendations: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          title: { type: "string" },
                          detail: { type: "string" },
                          priority: { type: "string", enum: ["alta", "media", "baixa"] },
                        },
                        required: ["title", "detail", "priority"],
                      },
                    },
                    creative_ideas: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          concept: { type: "string" },
                          description: { type: "string" },
                        },
                        required: ["concept", "description"],
                      },
                    },
                    copy_ideas: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          headline: { type: "string" },
                          primary_text: { type: "string" },
                          cta: { type: "string" },
                        },
                        required: ["headline", "primary_text", "cta"],
                      },
                    },
                  },
                  required: ["summary", "diagnosis", "recommendations", "creative_ideas", "copy_ideas"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "campaign_advisory" } },
        };

        let parsed: Record<string, unknown>;
        let model = LOVABLE_MODEL;
        const openAiEnabled = campaignAdvisorOpenAiEnabled();
        if (openAiEnabled) {
          try {
            const result = await new OpenAiResponsesGateway(undefined, {
              usageSink: createSupabaseAiUsageSink(supabaseAdmin),
            }).run({
              companyId,
              capability: "marketing",
              instructions: systemPrompt,
              input: `${userPrompt}\n\nUse a ferramenta campaign_advisory e não invente dados.`,
              tools: [{
                type: "function",
                name: "campaign_advisory",
                description: "Análise consultiva da campanha.",
                parameters: payload.tools[0].function.parameters,
                strict: false,
              }],
              toolChoice: { type: "function", name: "campaign_advisory" },
              store: false,
              maxOutputTokens: OPENAI_MAX_OUTPUT_TOKENS,
              tags: { feature: "campaign_advisor", prompt_version: "2026-10-24.a" },
            });
            const toolCall = result.toolCalls.find((call) => call.name === "campaign_advisory");
            if (!toolCall?.arguments) throw new Error("structured_output_missing");
            parsed = JSON.parse(toolCall.arguments) as Record<string, unknown>;
            model = result.model;
          } catch (error) {
            console.warn(
              "[campaign-advisor] OpenAI indisponível; usando fallback Lovable",
              error instanceof Error ? error.message : "provider_error",
            );
            if (!apiKey)
              return Response.json({ ok: false, error: "Nenhum provedor de IA configurado" }, { status: 500 });
            const aiRes = await fetch(GATEWAY_URL, {
              method: "POST",
              headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            if (!aiRes.ok) {
              if (aiRes.status === 429)
                return Response.json({ ok: false, error: "Limite de requisições atingido. Tente em alguns segundos." }, { status: 429 });
              if (aiRes.status === 402)
                return Response.json({ ok: false, error: "Créditos esgotados. Adicione créditos em Configurações > Workspace > Uso." }, { status: 402 });
              console.error("[campaign-advisor] gateway error", aiRes.status);
              return Response.json({ ok: false, error: "Falha ao consultar a IA" }, { status: 502 });
            }
            const data = await aiRes.json();
            const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
            if (!toolCall?.function?.arguments)
              return Response.json({ ok: false, error: "Resposta da IA sem dados estruturados" }, { status: 502 });
            try { parsed = JSON.parse(toolCall.function.arguments) as Record<string, unknown>; } catch {
              return Response.json({ ok: false, error: "Falha ao interpretar resposta da IA" }, { status: 502 });
            }
          }
        } else {
          const aiRes = await fetch(GATEWAY_URL, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!aiRes.ok) {
            if (aiRes.status === 429)
              return Response.json({ ok: false, error: "Limite de requisições atingido. Tente em alguns segundos." }, { status: 429 });
            if (aiRes.status === 402)
              return Response.json({ ok: false, error: "Créditos esgotados. Adicione créditos em Configurações > Workspace > Uso." }, { status: 402 });
            console.error("[campaign-advisor] gateway error", aiRes.status);
            return Response.json({ ok: false, error: "Falha ao consultar a IA" }, { status: 502 });
          }
          const data = await aiRes.json();
          const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
          if (!toolCall?.function?.arguments)
            return Response.json({ ok: false, error: "Resposta da IA sem dados estruturados" }, { status: 502 });
          try { parsed = JSON.parse(toolCall.function.arguments) as Record<string, unknown>; } catch {
            return Response.json({ ok: false, error: "Falha ao interpretar resposta da IA" }, { status: 502 });
          }
        }

        const metricsSnapshot = metric
          ? {
              impressions: Number(metric.impressions),
              reach: Number(metric.reach),
              clicks: Number(metric.clicks),
              ctr: Number(metric.ctr),
              cpc: Number(metric.cpc),
              cpm: Number(metric.cpm),
              messages: Number(metric.messages),
              leads: Number(metric.leads),
              spent: Number(metric.spent),
              metric_date: metric.metric_date,
            }
          : null;

        // Salva histórico (best-effort).
        const { data: saved, error: insErr } = await supabaseAdmin
          .from("campaign_ai_analyses")
          .insert([
            {
              campaign_id: campaignId,
              company_id: companyId,
              summary: typeof parsed.summary === "string" ? parsed.summary : null,
              diagnosis: (parsed.diagnosis ?? {}) as never,
              recommendations: (parsed.recommendations ?? []) as never,
              creative_ideas: (parsed.creative_ideas ?? []) as never,
              copy_ideas: (parsed.copy_ideas ?? []) as never,
              metrics_snapshot: (metricsSnapshot ?? {}) as never,
              model,
            },
          ])
          .select("id, created_at")
          .maybeSingle();
        if (insErr) console.warn("[campaign-advisor] insert history failed", insErr);

        return Response.json({
          ok: true,
          analysis: {
            id: saved?.id ?? null,
            created_at: saved?.created_at ?? new Date().toISOString(),
            ...parsed,
            metrics_snapshot: metricsSnapshot,
            model,
          },
        });
      },
    },
  },
});

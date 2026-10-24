// ============================================================================
// POST /api/recovery/assist — Recovery AI Assistant (Sprint 6 · Fase 6.2)
//
// Fluxo: autenticar → derivar company_id do perfil → validar acesso à conversa
// → executar o Recovery Engine existente → montar o Recovery Context seguro →
// consultar a IA → validar a resposta → devolver o plano estruturado.
//
// NUNCA envia mensagem. Nenhuma escrita em tabela de conversa/lead.
// Erros do provedor reutilizam o contrato do AI Gateway já existente.
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { OpenAiResponsesGateway } from "@/lib/ai-platform/gateway.server";
import { createSupabaseAiUsageSink } from "@/lib/ai-platform/supabase-usage-sink.server";
import { AiPlatformError } from "@/lib/ai-platform/types";
import {
  COACH_INVALID_OUTPUT_CONTRACT,
  COACH_PROVIDER_TIMEOUT_MS,
  COACH_TIMEOUT_CONTRACT,
  classifyGatewayFailure,
  sanitizeProviderBody,
} from "@/lib/coach/gateway-errors";
import {
  RECOVERY_ASSIST_MODEL,
  RECOVERY_PLAN_TOOL,
  assistFingerprint,
  buildRecoveryContext,
  buildSystemPrompt,
  buildUserPrompt,
  cacheKey,
  parseRecoveryPlan,
  recoveryPlanCache,
  type RecoveryAssistResponse,
} from "@/lib/recovery-ai";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export function recoveryAssistOpenAiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.RECOVERY_ASSIST_OPENAI_RESPONSES === "enabled";
}

interface AssistBody {
  conversation_id?: unknown;
  /** Regeneração manual: ignora o cache e sobrescreve a entrada. */
  force?: unknown;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/recovery/assist")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        // ---- 1. autenticação ----
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
        if (!token) return Response.json({ error: "não autenticado" }, { status: 401 });

        const { data: userRes } = await supabaseAdmin.auth.getUser(token);
        if (!userRes?.user) return Response.json({ error: "sessão inválida" }, { status: 401 });

        // ---- 2. company_id derivado do perfil, nunca do payload ----
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("company_id")
          .eq("id", userRes.user.id)
          .maybeSingle();
        const companyId = (profile as { company_id?: string } | null)?.company_id;
        if (!companyId) return Response.json({ error: "perfil sem empresa" }, { status: 403 });

        // ---- 3. validação de entrada ----
        let body: AssistBody;
        try {
          body = (await request.json()) as AssistBody;
        } catch {
          return Response.json({ error: "JSON inválido" }, { status: 400 });
        }
        const conversationId = typeof body.conversation_id === "string" ? body.conversation_id : "";
        if (!UUID_RE.test(conversationId)) {
          return Response.json({ error: "conversation_id inválido" }, { status: 400 });
        }
        const force = body.force === true;

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!recoveryAssistOpenAiEnabled() && !apiKey) return Response.json({ error: "IA indisponível" }, { status: 500 });

        // ---- 4. Recovery Engine (Fase 6.1, intocado) ----
        const now = Date.now();
        const { readSingleRecovery } = await import("@/lib/recovery-ai/snapshot.server");
        const read = await readSingleRecovery(companyId, conversationId, now);
        if (!read) return Response.json({ error: "conversa não encontrada" }, { status: 404 });

        // ---- 5. Recovery Context seguro ----
        const ctx = buildRecoveryContext({
          assessment: read.assessment,
          messages: read.messages,
          tags: read.tags,
          source: read.source,
          templates: read.templates,
          now,
        });

        const fingerprint = assistFingerprint(ctx);
        const key = cacheKey(companyId, conversationId);

        if (force) recoveryPlanCache.invalidate(key);
        const cached = force ? null : recoveryPlanCache.get(key, fingerprint, now);
        if (cached) {
          const payload: RecoveryAssistResponse = {
            plan: cached,
            context: ctx,
            fingerprint,
            cached: true,
            generatedAt: new Date(now).toISOString(),
          };
          return Response.json(payload);
        }

        // ---- 6. consulta à IA ----
        let args: unknown;
        const legacyPayload = {
          model: RECOVERY_ASSIST_MODEL,
          messages: [
            { role: "system", content: buildSystemPrompt() },
            { role: "user", content: buildUserPrompt(ctx) },
          ],
          tools: [RECOVERY_PLAN_TOOL],
          tool_choice: { type: "function", function: { name: "recovery_plan" } },
        };

        if (recoveryAssistOpenAiEnabled()) {
          try {
            const result = await new OpenAiResponsesGateway(undefined, {
              usageSink: createSupabaseAiUsageSink(supabaseAdmin),
            }).run({
              companyId,
              capability: "recovery",
              instructions: buildSystemPrompt(),
              input: buildUserPrompt(ctx),
              tools: [{
                type: "function",
                name: RECOVERY_PLAN_TOOL.function.name,
                description: RECOVERY_PLAN_TOOL.function.description,
                parameters: RECOVERY_PLAN_TOOL.function.parameters,
                strict: false,
              }],
              toolChoice: { type: "function", name: RECOVERY_PLAN_TOOL.function.name },
              store: false,
              maxOutputTokens: 900,
              tags: { feature: "recovery_assist", prompt_version: "2026-10-24.a" },
            });
            const toolCall = result.toolCalls.find((item) => item.name === RECOVERY_PLAN_TOOL.function.name);
            args = toolCall ? JSON.parse(toolCall.arguments) : null;
          } catch (error) {
            const code = error instanceof AiPlatformError ? error.code : "ai_provider_error";
            console.error(`[recovery/assist] OpenAI failure code=${code}; using safe fallback`);
            if (!apiKey) {
              return Response.json(
                code === "ai_timeout" ? COACH_TIMEOUT_CONTRACT : COACH_INVALID_OUTPUT_CONTRACT,
                { status: code === "ai_timeout" ? COACH_TIMEOUT_CONTRACT.status : COACH_INVALID_OUTPUT_CONTRACT.status },
              );
            }
            try {
              const aiRes = await fetch(GATEWAY_URL, {
                method: "POST",
                signal: AbortSignal.timeout(COACH_PROVIDER_TIMEOUT_MS),
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
                body: JSON.stringify(legacyPayload),
              });
              if (!aiRes.ok) {
                const raw = await aiRes.text().catch(() => "");
                const contract = classifyGatewayFailure(aiRes.status, raw);
                console.error(`[recovery/assist] fallback ${aiRes.status} code=${contract.code} body=${sanitizeProviderBody(raw)}`);
                return Response.json(contract, { status: contract.status });
              }
              const payload = await aiRes.json();
              const toolCall = payload?.choices?.[0]?.message?.tool_calls?.[0];
              args = toolCall ? JSON.parse(toolCall.function.arguments) : null;
            } catch {
              return Response.json(COACH_TIMEOUT_CONTRACT, { status: COACH_TIMEOUT_CONTRACT.status });
            }
          }
        } else {
          try {
            const aiRes = await fetch(GATEWAY_URL, {
              method: "POST",
              signal: AbortSignal.timeout(COACH_PROVIDER_TIMEOUT_MS),
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
              body: JSON.stringify(legacyPayload),
            });
            if (!aiRes.ok) {
              const raw = await aiRes.text().catch(() => "");
              const contract = classifyGatewayFailure(aiRes.status, raw);
              console.error(`[recovery/assist] provider ${aiRes.status} code=${contract.code} body=${sanitizeProviderBody(raw)}`);
              return Response.json(contract, { status: contract.status });
            }
            const payload = await aiRes.json();
            const toolCall = payload?.choices?.[0]?.message?.tool_calls?.[0];
            args = toolCall ? JSON.parse(toolCall.function.arguments) : null;
          } catch {
            console.error("[recovery/assist] provider unreachable or timed out");
            return Response.json(COACH_TIMEOUT_CONTRACT, { status: COACH_TIMEOUT_CONTRACT.status });
          }
        }

        // ---- 7. validação da resposta ----
        const parsed = parseRecoveryPlan(args, ctx);
        if (!parsed.ok || !parsed.plan) {
          console.error(`[recovery/assist] invalid output: ${parsed.reason ?? "sem plano"}`);
          return Response.json(COACH_INVALID_OUTPUT_CONTRACT, {
            status: COACH_INVALID_OUTPUT_CONTRACT.status,
          });
        }

        recoveryPlanCache.set(key, fingerprint, parsed.plan, now);

        const payload: RecoveryAssistResponse = {
          plan: parsed.plan,
          context: ctx,
          fingerprint,
          cached: false,
          generatedAt: new Date(now).toISOString(),
        };
        return Response.json(payload);
      },
    },
  },
});

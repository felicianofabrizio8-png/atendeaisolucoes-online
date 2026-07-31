// ============================================================================
// POST /api/recovery/execute — Execução assistida da recuperação (Fase 6.3).
//
// PRINCÍPIO: a IA sugere, o humano confirma. Nenhuma ação deste endpoint
// dispara mensagem sem `action: "send"` originada de um clique explícito na
// tela de confirmação.
//
// TRANSPORTE: o envio real NÃO é reimplementado aqui. Reaproveitamos os
// endpoints oficiais já auditados (`/api/whatsapp/send` dentro da janela e
// `/api/whatsapp/templates/send` fora dela), que por sua vez passam pelo
// MetaOutbound — a única fronteira externa permitida.
//
// IDEMPOTÊNCIA: o lock é a transição `confirmed → sending` com compare-and-set
// no banco. Só um clique/aba/retry vence; os demais recebem 409 sem enviar.
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sanitizeForLog } from "@/lib/recovery-ai/redact";
import {
  MAX_RECOVERY_MESSAGE_CHARS,
  RECOVERY_COOLDOWN_MS,
  buildTimeline,
  canStartNewAttempt,
  nextIdempotencyKey,
  queueAttemptView,
  type RecoveryAttempt,
} from "@/lib/recovery-exec";
import {
  createAttempt,
  findActiveAttempt,
  findLatestAttempt,
  getAttempt,
  listAttemptEvents,
  logAttemptEvent,
  patchAttempt,
  resolveAuthContext,
  safeMessageText,
  transitionAttempt,
  type AuthContext,
} from "@/lib/recovery-exec/attempts.server";

type Action =
  | "state"
  | "open"
  | "select_message"
  | "select_template"
  | "confirm"
  | "send"
  | "retry"
  | "cancel"
  | "outcome";

interface Body {
  action?: Action;
  conversationId?: string;
  attemptId?: string;
  messageText?: string;
  messageStyle?: string;
  templateId?: string | null;
  templateName?: string | null;
  templateVariables?: Record<string, string>;
  outcome?: "recovered" | "not_recovered";
  plan?: Record<string, unknown>;
  score?: number;
  chance?: number;
  tier?: string;
  windowState?: string;
  strategyFingerprint?: string;
}

const bad = (error: string, status = 400, extra: Record<string, unknown> = {}) =>
  Response.json({ error, ...extra }, { status });

async function attemptPayload(companyId: string, attempt: RecoveryAttempt | null) {
  if (!attempt) return { attempt: null, events: [], timeline: [] };
  const events = await listAttemptEvents(companyId, attempt.id);
  return { attempt, events, timeline: buildTimeline(events) };
}

/** Confere que a conversa pertence à empresa e devolve o lead. */
async function loadConversation(companyId: string, conversationId: string) {
  const { data } = await supabaseAdmin
    .from("conversations")
    .select("id, company_id, lead_id, channel")
    .eq("id", conversationId)
    .eq("company_id", companyId)
    .maybeSingle();
  return data ?? null;
}

export const Route = createFileRoute("/api/recovery/execute")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ctx = await resolveAuthContext(request);
        if ("error" in ctx) return bad(ctx.error, ctx.status);
        const auth = ctx as AuthContext;

        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return bad("json inválido");
        }

        const action = body.action ?? "state";
        const conversationId = body.conversationId?.trim();

        // ---------------------------------------------------------------
        // state — leitura do fluxo atual (usada ao abrir a conversa)
        // ---------------------------------------------------------------
        if (action === "state") {
          if (!conversationId) return bad("conversationId obrigatório");
          const active = await findActiveAttempt(auth.companyId, conversationId);
          const attempt = active ?? (await findLatestAttempt(auth.companyId, conversationId));
          const view = queueAttemptView(attempt, Date.now(), RECOVERY_COOLDOWN_MS);
          return Response.json({
            ...(await attemptPayload(auth.companyId, attempt)),
            queueState: view.state,
            inCooldown: view.inCooldown,
            canStart: canStartNewAttempt(view),
          });
        }

        // ---------------------------------------------------------------
        // open — cria (ou reaproveita) a tentativa em rascunho
        // ---------------------------------------------------------------
        if (action === "open") {
          if (!conversationId) return bad("conversationId obrigatório");
          const conv = await loadConversation(auth.companyId, conversationId);
          if (!conv) return bad("conversa não encontrada", 404);

          const existingActive = await findActiveAttempt(auth.companyId, conversationId);
          if (existingActive) {
            return Response.json({
              ...(await attemptPayload(auth.companyId, existingActive)),
              reused: true,
            });
          }

          const latest = await findLatestAttempt(auth.companyId, conversationId);
          const view = queueAttemptView(latest, Date.now(), RECOVERY_COOLDOWN_MS);
          if (!canStartNewAttempt(view)) {
            return bad(
              "Já existe uma recuperação recente para este cliente. Aguarde a resposta antes de tentar de novo.",
              409,
              { queueState: view.state },
            );
          }

          const created = await createAttempt({
            companyId: auth.companyId,
            userId: auth.userId,
            conversationId,
            leadId: conv.lead_id,
            score: typeof body.score === "number" ? body.score : null,
            chance: typeof body.chance === "number" ? body.chance : null,
            tier: body.tier ?? null,
            windowState: body.windowState ?? null,
            strategyFingerprint: body.strategyFingerprint ?? null,
            planSnapshot: body.plan ?? {},
          });
          if ("conflict" in created) {
            return Response.json({
              ...(await attemptPayload(auth.companyId, created.conflict)),
              reused: true,
            });
          }
          if ("error" in created) return bad(created.error, 500);

          await logAttemptEvent({
            companyId: auth.companyId,
            attemptId: created.attempt.id,
            conversationId,
            leadId: conv.lead_id,
            userId: auth.userId,
            eventType: "recovery_workflow_opened",
            metadata: { window_state: body.windowState ?? null, score: body.score ?? null },
          });
          if (body.plan && Object.keys(body.plan).length > 0) {
            await logAttemptEvent({
              companyId: auth.companyId,
              attemptId: created.attempt.id,
              conversationId,
              leadId: conv.lead_id,
              userId: auth.userId,
              eventType: "recovery_plan_loaded",
              metadata: { fingerprint: body.strategyFingerprint ?? null },
            });
          }
          return Response.json(await attemptPayload(auth.companyId, created.attempt));
        }

        // Ações abaixo exigem uma tentativa existente da própria empresa.
        const attemptId = body.attemptId?.trim();
        if (!attemptId) return bad("attemptId obrigatório");
        const attempt = await getAttempt(auth.companyId, attemptId);
        if (!attempt) return bad("tentativa não encontrada", 404);

        // ---------------------------------------------------------------
        // select_message / select_template — preparação (sem envio)
        // ---------------------------------------------------------------
        if (action === "select_message" || action === "select_template") {
          if (attempt.status !== "draft" && attempt.status !== "awaiting_confirmation") {
            return bad("Esta recuperação não está mais em edição.", 409);
          }
          const patch: Record<string, unknown> = {};
          if (action === "select_message") {
            const text = safeMessageText(body.messageText);
            if (!text) return bad("mensagem vazia");
            patch.selected_message_text = text;
            patch.selected_message_style = body.messageStyle ?? attempt.messageStyle;
          } else {
            patch.template_id = body.templateId ?? null;
            patch.template_name = body.templateName ?? null;
            patch.template_variables = body.templateVariables ?? {};
          }
          patch.status = "awaiting_confirmation";
          const updated = await patchAttempt(auth.companyId, attemptId, patch);
          if (!updated) return bad("não foi possível salvar", 500);

          const edited =
            action === "select_message" &&
            attempt.messageText &&
            attempt.messageText !== updated.messageText;
          await logAttemptEvent({
            companyId: auth.companyId,
            attemptId,
            conversationId: attempt.conversationId,
            leadId: attempt.leadId,
            userId: auth.userId,
            eventType:
              action === "select_template"
                ? "recovery_template_selected"
                : edited
                  ? "recovery_message_edited"
                  : "recovery_message_selected",
            metadata: {
              style: updated.messageStyle,
              chars: updated.messageText?.length ?? 0,
              template: updated.templateName,
            },
          });
          return Response.json(await attemptPayload(auth.companyId, updated));
        }

        // ---------------------------------------------------------------
        // confirm — trava o conteúdo e abre a revisão final
        // ---------------------------------------------------------------
        if (action === "confirm") {
          const res = await transitionAttempt(
            auth.companyId,
            attemptId,
            attempt.status,
            "confirmed",
            { confirmed_at: new Date().toISOString() },
          );
          if (!res.ok) return bad(res.reason, 409);
          await logAttemptEvent({
            companyId: auth.companyId,
            attemptId,
            conversationId: attempt.conversationId,
            leadId: attempt.leadId,
            userId: auth.userId,
            eventType: "recovery_send_confirmed",
            metadata: { via: res.attempt.templateId ? "template" : "free_text" },
          });
          return Response.json(await attemptPayload(auth.companyId, res.attempt));
        }

        // ---------------------------------------------------------------
        // retry — só a partir de falha explícita
        // ---------------------------------------------------------------
        if (action === "retry") {
          const res = await transitionAttempt(auth.companyId, attemptId, "failed", "confirmed");
          if (!res.ok) return bad(res.reason, 409);
          await logAttemptEvent({
            companyId: auth.companyId,
            attemptId,
            conversationId: attempt.conversationId,
            leadId: attempt.leadId,
            userId: auth.userId,
            eventType: "recovery_retry_started",
            metadata: { previous_failure: attempt.failureCode },
          });
          return Response.json(await attemptPayload(auth.companyId, res.attempt));
        }

        // ---------------------------------------------------------------
        // cancel — sai do fluxo sem enviar nada
        // ---------------------------------------------------------------
        if (action === "cancel") {
          const res = await transitionAttempt(
            auth.companyId,
            attemptId,
            attempt.status,
            "cancelled",
            { outcome: "cancelled", outcome_at: new Date().toISOString(), outcome_by: auth.userId },
          );
          if (!res.ok) return bad(res.reason, 409);
          await logAttemptEvent({
            companyId: auth.companyId,
            attemptId,
            conversationId: attempt.conversationId,
            leadId: attempt.leadId,
            userId: auth.userId,
            eventType: "recovery_cancelled",
            metadata: { from: attempt.status },
          });
          return Response.json(await attemptPayload(auth.companyId, res.attempt));
        }

        // ---------------------------------------------------------------
        // outcome — desfecho manual do vendedor
        // ---------------------------------------------------------------
        if (action === "outcome") {
          const outcome = body.outcome;
          if (outcome !== "recovered" && outcome !== "not_recovered") {
            return bad("desfecho inválido");
          }
          const res = await transitionAttempt(
            auth.companyId,
            attemptId,
            attempt.status,
            outcome,
            { outcome, outcome_at: new Date().toISOString(), outcome_by: auth.userId },
          );
          if (!res.ok) return bad(res.reason, 409);
          await logAttemptEvent({
            companyId: auth.companyId,
            attemptId,
            conversationId: attempt.conversationId,
            leadId: attempt.leadId,
            userId: auth.userId,
            eventType:
              outcome === "recovered"
                ? "recovery_marked_recovered"
                : "recovery_marked_not_recovered",
            metadata: { replied: attempt.responseStatus === "replied" },
          });
          return Response.json(await attemptPayload(auth.companyId, res.attempt));
        }

        // ---------------------------------------------------------------
        // send — ÚNICO ponto que dispara mensagem, sempre após confirmação
        // ---------------------------------------------------------------
        if (action === "send") {
          if (attempt.status !== "confirmed") {
            return bad(
              attempt.status === "sending"
                ? "Este envio já está em andamento."
                : "Confirme a recuperação antes de enviar.",
              409,
              { status: attempt.status },
            );
          }
          const usesTemplate = Boolean(attempt.templateId);
          if (!usesTemplate && !attempt.messageText?.trim()) {
            return bad("Nenhuma mensagem selecionada.");
          }
          if ((attempt.messageText?.length ?? 0) > MAX_RECOVERY_MESSAGE_CHARS) {
            return bad("Mensagem acima do limite permitido.");
          }

          // LOCK: só uma execução vence esta transição.
          const lock = await transitionAttempt(auth.companyId, attemptId, "confirmed", "sending", {
            send_attempts: attempt.sendAttempts + 1,
            idempotency_key: nextIdempotencyKey(attemptId, attempt.sendAttempts),
          });
          if (!lock.ok) return bad("Este envio já está em andamento.", 409);

          await logAttemptEvent({
            companyId: auth.companyId,
            attemptId,
            conversationId: attempt.conversationId,
            leadId: attempt.leadId,
            userId: auth.userId,
            eventType: "recovery_send_started",
            metadata: { via: usesTemplate ? "template" : "free_text", dispatch: attempt.sendAttempts + 1 },
          });

          const origin = new URL(request.url).origin;
          const authHeader = request.headers.get("authorization") ?? "";
          const target = usesTemplate
            ? `${origin}/api/whatsapp/templates/send`
            : `${origin}/api/whatsapp/send`;
          const payload = usesTemplate
            ? {
                conversationId: attempt.conversationId,
                templateId: attempt.templateId,
                variables: attempt.templateVariables ?? {},
              }
            : { conversationId: attempt.conversationId, text: attempt.messageText };

          let ok = false;
          let failureCode = "unknown";
          let failureMessage = "Falha ao enviar a recuperação.";
          let messageId: string | null = null;
          let externalId: string | null = null;

          try {
            const res = await fetch(target, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: authHeader },
              body: JSON.stringify(payload),
            });
            const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
            if (res.ok && json.simulated !== true) {
              ok = true;
              messageId = typeof json.id === "string" ? json.id : null;
              externalId = typeof json.externalId === "string" ? json.externalId : null;
            } else if (json.simulated === true) {
              failureCode = "simulated";
              failureMessage = "Ambiente de simulação: nenhuma mensagem foi enviada de verdade.";
            } else {
              failureCode =
                res.status === 409 ? "window_closed" : res.status === 400 ? "invalid" : "provider";
              failureMessage =
                typeof json.error === "string" ? json.error : "Falha ao enviar a recuperação.";
            }
          } catch (e) {
            failureCode = "network";
            failureMessage = "Sem conexão com o provedor. Tente novamente.";
            console.error("[recovery/execute] send error", sanitizeForLog(String(e)));
          }

          const finished = await transitionAttempt(
            auth.companyId,
            attemptId,
            "sending",
            ok ? "sent" : "failed",
            ok
              ? {
                  sent_at: new Date().toISOString(),
                  message_id: messageId,
                  external_message_id: externalId,
                  delivery_status: "sent",
                  response_status: "no_reply",
                  failure_code: null,
                  failure_message: null,
                }
              : { failure_code: failureCode, failure_message: failureMessage },
          );

          await logAttemptEvent({
            companyId: auth.companyId,
            attemptId,
            conversationId: attempt.conversationId,
            leadId: attempt.leadId,
            userId: auth.userId,
            eventType: ok ? "recovery_send_succeeded" : "recovery_send_failed",
            metadata: ok ? { via: usesTemplate ? "template" : "free_text" } : { code: failureCode },
          });

          const current = finished.ok
            ? finished.attempt
            : await getAttempt(auth.companyId, attemptId);

          if (!ok) {
            return Response.json(
              {
                ...(await attemptPayload(auth.companyId, current)),
                error: failureMessage,
                failureCode,
              },
              { status: 502 },
            );
          }
          return Response.json(await attemptPayload(auth.companyId, current));
        }

        return bad("ação desconhecida");
      },
    },
  },
});

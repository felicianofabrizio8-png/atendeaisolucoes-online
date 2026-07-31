// ============================================================================
// CALLBACKS DE STATUS DO WHATSAPP (SPRINT 6 · FASE 6.3.1) — SERVER ONLY.
//
// Recebe o array `statuses[]` do webhook oficial e:
//  1. atualiza `messages.delivery_status` de forma MONOTÔNICA;
//  2. propaga o estado para a tentativa de recuperação vinculada, quando
//     existe vínculo válido dentro da MESMA empresa;
//  3. registra um evento amigável na timeline da recuperação.
//
// INVARIANTES
//  · nenhuma exceção sobe: o webhook nunca pode cair por causa de status;
//  · mensagens sem tentativa vinculada continuam sendo atualizadas normalmente;
//  · callbacks duplicados ou fora de ordem não alteram nada e não duplicam
//    eventos de timeline;
//  · callback de outra empresa não encontra mensagem (filtro por company_id +
//    integration_id) e é simplesmente ignorado.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sanitizeForLog } from "@/lib/recovery-ai/redact";
import {
  normalizeProviderStatus,
  reconcileDeliveryStatus,
  type DeliveryStatus,
} from "@/lib/recovery-exec/reconcile";
import type { RecoveryAttemptStatus, RecoveryEventType } from "@/lib/recovery-exec/types";
import { canTransition } from "@/lib/recovery-exec/states";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = any;

export interface ProviderStatusEvent {
  id?: string;
  status?: string;
  timestamp?: string;
  recipient_id?: string;
  errors?: Array<{ code?: number | string; title?: string; message?: string }>;
}

export interface StatusProcessingResult {
  received: number;
  messagesUpdated: number;
  attemptsUpdated: number;
  ignored: number;
}

const EVENT_BY_STATUS: Record<DeliveryStatus, RecoveryEventType | null> = {
  sent: null, // o envio já é registrado por `recovery_send_succeeded`
  delivered: "recovery_message_delivered",
  read: "recovery_message_read",
  failed: "recovery_delivery_failed",
};

/**
 * Processa todos os callbacks de status de um `change.value`.
 * Sempre resolve — erros são apenas logados de forma sanitizada.
 */
export async function processStatusEvents(args: {
  companyId: string;
  integrationId: string;
  statuses: unknown[] | undefined;
}): Promise<StatusProcessingResult> {
  const result: StatusProcessingResult = {
    received: 0,
    messagesUpdated: 0,
    attemptsUpdated: 0,
    ignored: 0,
  };
  const list = Array.isArray(args.statuses) ? args.statuses : [];
  if (list.length === 0) return result;

  for (const raw of list) {
    result.received += 1;
    try {
      const evt = (raw ?? {}) as ProviderStatusEvent;
      const externalId = typeof evt.id === "string" ? evt.id : "";
      const incoming = normalizeProviderStatus(evt.status);
      if (!externalId || !incoming) {
        result.ignored += 1;
        continue;
      }

      const at = toIso(evt.timestamp);

      // 1) mensagem — sempre escopada por empresa + integração.
      const { data: message } = await supabaseAdmin
        .from("messages")
        .select("id, delivery_status, conversation_id")
        .eq("company_id", args.companyId)
        .eq("integration_id", args.integrationId)
        .eq("external_id", externalId)
        .maybeSingle();

      if (!message) {
        // Callback sem mensagem conhecida: nada a reconciliar, sem erro.
        result.ignored += 1;
        continue;
      }

      // 2) tentativa vinculada (pode não existir — o fluxo segue igual).
      const { data: attemptRow } = await supabaseAdmin
        .from("recovery_attempts")
        .select("id, status, conversation_id, lead_id, delivery_status")
        .eq("company_id", args.companyId)
        .eq("external_message_id", externalId)
        .maybeSingle();

      const attempt = (attemptRow ?? null) as Row;

      const decision = reconcileDeliveryStatus({
        currentMessageStatus: (message as Row).delivery_status,
        incoming: evt.status,
        attemptStatus: (attempt?.status ?? null) as RecoveryAttemptStatus | null,
      });

      if (!decision.changed) {
        result.ignored += 1;
        continue;
      }

      // 3) atualização monotônica da mensagem (CAS pelo estado observado).
      const errorInfo = incoming === "failed" ? (evt.errors ?? [])[0] : undefined;
      const { data: updatedMessage } = await supabaseAdmin
        .from("messages")
        .update({
          delivery_status: decision.nextMessageStatus,
          status_updated_at: at,
          ...(errorInfo
            ? {
                delivery_error_code: String(errorInfo.code ?? ""),
                delivery_error_message: String(errorInfo.title ?? errorInfo.message ?? ""),
              }
            : {}),
        })
        .eq("company_id", args.companyId)
        .eq("id", (message as Row).id)
        .is("delivery_status", (message as Row).delivery_status ?? null)
        .select("id")
        .maybeSingle();

      if (!updatedMessage) {
        // Outro callback concorrente venceu — a monotonicidade se mantém.
        result.ignored += 1;
        continue;
      }
      result.messagesUpdated += 1;

      if (!attempt) continue;

      // 4) propaga para a tentativa, sem nunca regredir.
      const patch: Record<string, unknown> = { delivery_status: decision.nextMessageStatus };
      const nextStatus = decision.nextAttemptStatus;
      if (nextStatus && canTransition(attempt.status as RecoveryAttemptStatus, nextStatus)) {
        const { data: movedAttempt } = await supabaseAdmin
          .from("recovery_attempts")
          .update({ ...patch, status: nextStatus })
          .eq("company_id", args.companyId)
          .eq("id", attempt.id)
          .eq("status", attempt.status)
          .select("id")
          .maybeSingle();
        if (movedAttempt) result.attemptsUpdated += 1;
        else continue; // perdeu o CAS: não registra evento duplicado
      } else {
        await supabaseAdmin
          .from("recovery_attempts")
          .update(patch)
          .eq("company_id", args.companyId)
          .eq("id", attempt.id);
      }

      const eventType = EVENT_BY_STATUS[incoming];
      if (eventType) {
        await supabaseAdmin.from("recovery_attempt_events").insert({
          company_id: args.companyId,
          attempt_id: attempt.id,
          conversation_id: attempt.conversation_id,
          lead_id: attempt.lead_id,
          user_id: null,
          event_type: eventType,
          metadata: { reason: decision.reason, at },
        });
      }
    } catch (e) {
      // Resiliência: um callback problemático não derruba os demais.
      console.error("[wa-status] falha ao processar callback", sanitizeForLog(String(e)));
      result.ignored += 1;
    }
  }

  return result;
}

function toIso(timestamp: unknown): string {
  const raw = String(timestamp ?? "");
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return new Date(seconds * 1000).toISOString();
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return new Date().toISOString();
}

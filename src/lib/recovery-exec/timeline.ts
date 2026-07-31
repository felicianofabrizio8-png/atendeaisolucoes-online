// ============================================================================
// Timeline legível da recuperação (Fase 6.3) — puro.
//
// Traduz eventos técnicos em frases que o vendedor entende. Nenhum detalhe de
// provedor, código HTTP ou payload aparece aqui.
// ============================================================================

import type { RecoveryAttemptEvent, RecoveryEventType } from "./types";

const TEMPLATES: Record<RecoveryEventType, string> = {
  recovery_workflow_opened: "Recuperação iniciada",
  recovery_plan_loaded: "Estratégia carregada",
  recovery_plan_regenerated: "Estratégia gerada novamente",
  recovery_message_selected: "Mensagem escolhida",
  recovery_message_edited: "Mensagem ajustada pelo vendedor",
  recovery_template_selected: "Template selecionado",
  recovery_confirmation_opened: "Revisão final aberta",
  recovery_cancelled: "Recuperação cancelada",
  recovery_send_confirmed: "Envio confirmado",
  recovery_send_started: "Enviando mensagem",
  recovery_send_succeeded: "Recuperação enviada",
  recovery_send_failed: "Falha ao enviar a recuperação",
  recovery_retry_started: "Nova tentativa de envio",
  recovery_reply_detected: "Cliente respondeu",
  recovery_marked_recovered: "Lead marcado como recuperado",
  recovery_marked_not_recovered: "Lead marcado como não recuperado",
};

export interface TimelineEntry {
  id: string;
  at: string;
  label: string;
  actor: string | null;
}

/** Frase pronta: "Recuperação enviada por Fabrizio às 14:32." */
export function describeEvent(
  event: Pick<RecoveryAttemptEvent, "eventType" | "createdAt">,
  actorName?: string | null,
): string {
  const base = TEMPLATES[event.eventType] ?? "Atualização da recuperação";
  const time = formatTime(event.createdAt);
  const by = actorName ? ` por ${actorName}` : "";
  return `${base}${by}${time ? ` às ${time}` : ""}.`;
}

export function buildTimeline(
  events: RecoveryAttemptEvent[],
  actorNames: Record<string, string> = {},
): TimelineEntry[] {
  return events
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((e) => {
      const userId = typeof e.metadata?.user_id === "string" ? e.metadata.user_id : null;
      const actor = userId ? (actorNames[userId] ?? null) : null;
      return {
        id: e.id,
        at: e.createdAt,
        label: describeEvent(e, actor),
        actor,
      };
    });
}

function formatTime(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  return t.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

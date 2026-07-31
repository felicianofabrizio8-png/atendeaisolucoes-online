// ============================================================================
// RECONCILIAÇÃO DE STATUS DE ENTREGA (SPRINT 6 · FASE 6.3.1) — módulo PURO.
//
// Por que existir: os callbacks do provedor chegam fora de ordem, repetidos e
// às vezes atrasados. Sem uma função determinística de precedência, uma
// mensagem já `read` voltaria para `delivered` só porque o callback antigo
// chegou depois. Este módulo é a única fonte de verdade sobre "este evento
// deve mudar alguma coisa?".
//
// Propriedades garantidas (cobertas por teste):
//  · idempotência  — aplicar o mesmo evento duas vezes não muda nada;
//  · monotonicidade — o estado nunca regride na escala de entrega;
//  · pureza        — nenhuma I/O, nenhuma data implícita, nenhum efeito.
// ============================================================================

import type { RecoveryAttemptStatus } from "./types";

/** Estados de entrega que o provedor reporta, já normalizados. */
export type DeliveryStatus = "sent" | "delivered" | "read" | "failed";

/**
 * Escala de precedência. Números maiores só substituem menores.
 * `failed` fica FORA da escala: é um ramo lateral tratado por regra própria,
 * porque uma falha reportada depois de uma leitura confirmada é ruído.
 */
export const DELIVERY_PRECEDENCE: Record<DeliveryStatus, number> = {
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 0,
};

/** Converte o rótulo cru do provedor para o nosso domínio (ou null). */
export function normalizeProviderStatus(raw: unknown): DeliveryStatus | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "sent" || value === "accepted") return "sent";
  if (value === "delivered") return "delivered";
  if (value === "read") return "read";
  if (value === "failed" || value === "undelivered" || value === "error") return "failed";
  // `deleted`, `warning` e desconhecidos são ignorados de propósito: preferimos
  // não mexer no estado a inventar uma transição.
  return null;
}

export function deliveryRank(status: string | null | undefined): number {
  const normalized = normalizeProviderStatus(status);
  if (!normalized) return 0;
  return DELIVERY_PRECEDENCE[normalized];
}

export interface DeliveryDecision {
  changed: boolean;
  /** Estado final da MENSAGEM após a decisão. */
  nextMessageStatus: DeliveryStatus | null;
  /** Estado final da TENTATIVA, ou null quando ela não deve ser tocada. */
  nextAttemptStatus: RecoveryAttemptStatus | null;
  /** Motivo legível da decisão — vai para auditoria, não para o vendedor. */
  reason: string;
}

/** Estados de tentativa que ainda aceitam evolução de entrega. */
const ATTEMPT_DELIVERY_STAGES: RecoveryAttemptStatus[] = ["sent", "delivered", "read"];

/**
 * Decide o efeito de UM callback de status sobre a mensagem e sobre a
 * tentativa de recuperação vinculada (quando existe).
 *
 * @param currentMessageStatus estado atual persistido na mensagem
 * @param incoming             status cru recebido do provedor
 * @param attemptStatus        estado atual da tentativa vinculada, se houver
 */
export function reconcileDeliveryStatus(args: {
  currentMessageStatus: string | null | undefined;
  incoming: unknown;
  attemptStatus?: RecoveryAttemptStatus | null;
}): DeliveryDecision {
  const incoming = normalizeProviderStatus(args.incoming);
  const attemptStatus = args.attemptStatus ?? null;

  if (!incoming) {
    return {
      changed: false,
      nextMessageStatus: null,
      nextAttemptStatus: null,
      reason: "status_desconhecido",
    };
  }

  const currentNormalized = normalizeProviderStatus(args.currentMessageStatus);

  // --- ramo de falha -------------------------------------------------------
  if (incoming === "failed") {
    // Falha depois de entrega/leitura confirmada é ruído: não regride nada.
    if (currentNormalized === "delivered" || currentNormalized === "read") {
      return {
        changed: false,
        nextMessageStatus: null,
        nextAttemptStatus: null,
        reason: "falha_apos_entrega_ignorada",
      };
    }
    if (currentNormalized === "failed") {
      return {
        changed: false,
        nextMessageStatus: null,
        nextAttemptStatus: null,
        reason: "falha_duplicada",
      };
    }
    return {
      changed: true,
      nextMessageStatus: "failed",
      // A máquina de estados da tentativa não permite `sent → failed`; a falha
      // do provedor fica registrada na mensagem e no delivery_status, sem
      // reescrever um envio que de fato saiu.
      nextAttemptStatus: null,
      reason: "falha_registrada_na_mensagem",
    };
  }

  // --- ramo monotônico -----------------------------------------------------
  const incomingRank = DELIVERY_PRECEDENCE[incoming];
  const currentRank = currentNormalized === "failed" ? 0 : deliveryRank(currentNormalized);

  if (incomingRank <= currentRank && currentNormalized !== null) {
    return {
      changed: false,
      nextMessageStatus: null,
      nextAttemptStatus: null,
      reason:
        incomingRank === currentRank ? "evento_duplicado" : "evento_atrasado_fora_de_ordem",
    };
  }

  // A tentativa só evolui se estiver numa etapa de entrega. `replied`,
  // `recovered` e `not_recovered` são mais avançados que qualquer callback.
  const attemptShouldMove =
    attemptStatus !== null &&
    ATTEMPT_DELIVERY_STAGES.includes(attemptStatus) &&
    (incoming === "delivered" || incoming === "read") &&
    attemptDeliveryRank(incoming) > attemptDeliveryRank(attemptStatus);

  return {
    changed: true,
    nextMessageStatus: incoming,
    nextAttemptStatus: attemptShouldMove ? (incoming as RecoveryAttemptStatus) : null,
    reason: currentNormalized === null ? "primeiro_status" : "avanco_de_status",
  };
}

function attemptDeliveryRank(status: RecoveryAttemptStatus | DeliveryStatus): number {
  if (status === "sent") return 1;
  if (status === "delivered") return 2;
  if (status === "read") return 3;
  return 0;
}

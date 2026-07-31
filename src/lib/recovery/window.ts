// Janela de 24h da WhatsApp Cloud API — versão server-side do Recovery Engine.
//
// Existe `src/lib/whatsapp-window.ts`, porém ele depende dos tipos de mock do
// front (`@/data/mock`). Aqui trabalhamos com o snapshot do banco, então a
// função é reescrita SEM dependências — mesmas constantes e mesma semântica,
// para que as duas leituras nunca divirjam.

import { DAY_MS, HOUR_MS, type RecoveryChannel, type RecoveryWindow } from "./types";

export const WINDOW_MS = DAY_MS;
export const CLOSING_SOON_MS = 3 * HOUR_MS;

/**
 * Calcula o estado da janela a partir da última mensagem RECEBIDA do cliente.
 * Só WhatsApp tem essa regra; demais canais devolvem `not_applicable`.
 * Não envia nada — apenas calcula tempos.
 */
export function computeRecoveryWindow(
  channel: RecoveryChannel,
  lastInboundAt: string | null,
  now: number,
): RecoveryWindow {
  if (channel !== "whatsapp") {
    return {
      state: "not_applicable",
      openedAt: null,
      closesAt: null,
      remainingMs: 0,
      sinceClosedMs: 0,
      requiresTemplate: false,
    };
  }

  if (!lastInboundAt) {
    // Nunca recebemos mensagem do cliente: não há janela para reabrir, então
    // qualquer contato ativo depende de template aprovado.
    return {
      state: "never_opened",
      openedAt: null,
      closesAt: null,
      remainingMs: 0,
      sinceClosedMs: 0,
      requiresTemplate: true,
    };
  }

  const openedMs = new Date(lastInboundAt).getTime();
  if (!Number.isFinite(openedMs)) {
    return {
      state: "never_opened",
      openedAt: null,
      closesAt: null,
      remainingMs: 0,
      sinceClosedMs: 0,
      requiresTemplate: true,
    };
  }

  const closesMs = openedMs + WINDOW_MS;
  const remainingMs = closesMs - now;
  const closesAt = new Date(closesMs).toISOString();

  if (remainingMs <= 0) {
    return {
      state: "closed",
      openedAt: lastInboundAt,
      closesAt,
      remainingMs: 0,
      sinceClosedMs: now - closesMs,
      requiresTemplate: true,
    };
  }

  return {
    state: remainingMs <= CLOSING_SOON_MS ? "closing_soon" : "open",
    openedAt: lastInboundAt,
    closesAt,
    remainingMs,
    sinceClosedMs: 0,
    requiresTemplate: false,
  };
}

/** Formata duração em "Xd Yh" / "Yh Zm" / "Zm" — usado nas explicações. */
export function formatSpan(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

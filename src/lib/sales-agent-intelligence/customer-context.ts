// ============================================================================
// Customer Context — o que já se sabe deste cliente nesta conversa:
// necessidades, preferências, objeções, sinais de compra, estágio, última
// ação e produtos apresentados. Atualizado a cada turno pelo plano do LLM
// (interpretação semântica), saneado aqui e persistido como evento
// `sales_turn_plan` (append-only, por empresa + conversa).
// ============================================================================

import {
  isSalesNextAction,
  isSalesStage,
  type SalesNextAction,
  type SalesStage,
} from "./competence";

export interface CustomerContext {
  stage: SalesStage | null;
  lastNextAction: SalesNextAction | null;
  needs: string[];
  preferences: string[];
  objections: string[];
  buyingSignals: string[];
  presentedProductIds: string[];
}

export interface CustomerContextUpdate {
  needs?: unknown;
  preferences?: unknown;
  objections?: unknown;
  buying_signals?: unknown;
}

export const EMPTY_CUSTOMER_CONTEXT: CustomerContext = {
  stage: null,
  lastNextAction: null,
  needs: [],
  preferences: [],
  objections: [],
  buyingSignals: [],
  presentedProductIds: [],
};

const MAX_ITEMS = 8;
const MAX_ITEM_CHARS = 140;

/** Lista de observações curtas, sem duplicatas (mantém as mais recentes). */
export function sanitizeObservations(value: unknown, previous: readonly string[] = []): string[] {
  const incoming = Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.replace(/\s+/g, " ").trim().slice(0, MAX_ITEM_CHARS))
        .filter(Boolean)
    : [];
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const item of [...incoming].reverse().concat([...previous].reverse())) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged.slice(0, MAX_ITEMS).reverse();
}

export function mergeCustomerContext(
  previous: CustomerContext | null,
  update: {
    stage?: unknown;
    nextAction?: unknown;
    context?: CustomerContextUpdate | null;
    presentedProductIds?: readonly string[];
  },
): CustomerContext {
  const base = previous ?? EMPTY_CUSTOMER_CONTEXT;
  const context = update.context ?? {};
  return {
    stage: isSalesStage(update.stage) ? update.stage : base.stage,
    lastNextAction: isSalesNextAction(update.nextAction) ? update.nextAction : base.lastNextAction,
    needs: sanitizeObservations(context.needs, base.needs),
    preferences: sanitizeObservations(context.preferences, base.preferences),
    objections: sanitizeObservations(context.objections, base.objections),
    buyingSignals: sanitizeObservations(context.buying_signals, base.buyingSignals),
    presentedProductIds: [
      ...new Set([...(update.presentedProductIds ?? []), ...base.presentedProductIds]),
    ].slice(0, 20),
  };
}

/** Lê o contexto salvo num evento `sales_turn_plan` (tolerante a lixo). */
export function customerContextFromEventPayload(payload: unknown): CustomerContext | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const raw = (payload as { customer_context?: unknown }).customer_context;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  return {
    stage: isSalesStage(source.stage) ? source.stage : null,
    lastNextAction: isSalesNextAction(source.lastNextAction) ? source.lastNextAction : null,
    needs: sanitizeObservations(source.needs),
    preferences: sanitizeObservations(source.preferences),
    objections: sanitizeObservations(source.objections),
    buyingSignals: sanitizeObservations(source.buyingSignals),
    presentedProductIds: Array.isArray(source.presentedProductIds)
      ? source.presentedProductIds.filter((id): id is string => typeof id === "string").slice(0, 20)
      : [],
  };
}

export function renderCustomerContext(context: CustomerContext | null): string {
  if (!context) return "CONTEXTO DO CLIENTE: primeira interação conhecida.";
  const list = (items: string[]) => (items.length ? items.join("; ") : "—");
  return [
    "CONTEXTO DO CLIENTE (memória da conversa; confirme se algo mudou):",
    `- Estágio anterior: ${context.stage ?? "—"} | última ação: ${context.lastNextAction ?? "—"}`,
    `- Necessidades: ${list(context.needs)}`,
    `- Preferências: ${list(context.preferences)}`,
    `- Objeções: ${list(context.objections)}`,
    `- Sinais de compra: ${list(context.buyingSignals)}`,
  ].join("\n");
}

// ============================================================================
// Plano de vendas do turno: o LLM interpreta o cliente e informa estágio,
// próxima ação e atualizações do contexto (`sales_plan` em
// respond_to_customer). Aqui o plano é saneado e passa pelo GATE: a ação
// escolhida precisa caber nas capacidades/limites da empresa. O texto da
// resposta continua passando por todas as validações de fatos do core.
// ============================================================================

import type { BusinessKnowledge } from "./business-knowledge";
import {
  isSalesNextAction,
  isSalesStage,
  type SalesNextAction,
  type SalesStage,
} from "./competence";
import { sanitizeObservations, type CustomerContextUpdate } from "./customer-context";

/** Observações do turno já saneadas (listas curtas de texto). */
export interface SalesTurnContextUpdate extends CustomerContextUpdate {
  needs: string[];
  preferences: string[];
  objections: string[];
  buying_signals: string[];
}

export interface SalesTurnPlan {
  stage: SalesStage | null;
  nextAction: SalesNextAction | null;
  context: SalesTurnContextUpdate | null;
  /** Ajustes feitos pelo gate (auditoria). */
  adjustments: string[];
}

export type SalesPlanGate =
  | { outcome: "reply"; plan: SalesTurnPlan; afterReply: "handoff_for_closing" | null }
  | { outcome: "handoff"; plan: SalesTurnPlan; reason: string };

/** Plano cru do LLM → plano tipado; `null` se ausente/inválido (não bloqueia a resposta). */
export function parseSalesTurnPlan(raw: unknown): SalesTurnPlan | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const stage = isSalesStage(source.stage) ? source.stage : null;
  const nextAction = isSalesNextAction(source.next_action) ? source.next_action : null;
  const rawContext =
    source.customer_context &&
    typeof source.customer_context === "object" &&
    !Array.isArray(source.customer_context)
      ? (source.customer_context as CustomerContextUpdate)
      : null;
  const context: SalesTurnContextUpdate | null = rawContext
    ? {
        needs: sanitizeObservations(rawContext.needs),
        preferences: sanitizeObservations(rawContext.preferences),
        objections: sanitizeObservations(rawContext.objections),
        buying_signals: sanitizeObservations(rawContext.buying_signals),
      }
    : null;
  if (!stage && !nextAction && !context) return null;
  return { stage, nextAction, context, adjustments: [] };
}

/**
 * Valida a ação comercial escolhida contra o que a empresa permite:
 * - negociação: nenhuma empresa autoriza condição fora do cadastro → humano;
 * - intenção de compra/fechamento: a IA confirma a escolha e o atendente
 *   conclui (handoff logo após a resposta);
 * - recomendação sem produto validado vira resposta simples.
 */
export function gateSalesTurnPlan(
  plan: SalesTurnPlan,
  params: { knowledge: BusinessKnowledge; suggestedProductIds: readonly string[] },
): SalesPlanGate {
  if (
    plan.stage === "negotiation" &&
    params.knowledge.capabilities.negotiation === "not_authorized"
  ) {
    return { outcome: "handoff", plan, reason: "negotiation_not_authorized" };
  }
  if (plan.nextAction === "recommend_products" && params.suggestedProductIds.length === 0) {
    plan = {
      ...plan,
      nextAction: "answer_question",
      adjustments: [...plan.adjustments, "recommendation_without_products"],
    };
  }
  const closing = plan.nextAction === "confirm_purchase_intent";
  return {
    outcome: "reply",
    plan,
    afterReply:
      closing && params.knowledge.capabilities.closing === "human" ? "handoff_for_closing" : null,
  };
}

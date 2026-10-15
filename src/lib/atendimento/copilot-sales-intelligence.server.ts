import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  SALES_TURN_PLAN_EVENT,
  interpretSalesAgentTurn,
  loadAgentContext,
  resolveSalesAgentCatalogSearch,
} from "@/lib/ai-agent.server";
import { buildSalesAgentSystemPrompt, type AgentContext } from "@/lib/sales-agent-core";
import {
  loadRelevantSalesAgentLearnings,
  loadRelevantSalesAgentQuickReplies,
  selectRelevantSalesAgentCoachRules,
  type AgentHistory,
} from "@/lib/sales-agent-grounding.server";
import { listActiveCoachRulesForGrounding } from "@/lib/coach-rules/coach-rules.repository";
import {
  loadConversationSalesState,
  revalidateConversationSalesState,
} from "@/lib/conversation-sales-state.server";
import type { ConversationSalesState } from "@/lib/conversation-sales-state";
import { getConversationFocusProductIds } from "@/lib/sales-agent-focus";
import { customerContextFromEventPayload, type CustomerContext } from "@/lib/sales-agent-intelligence";
import { resolveSalesAgentNormativeContext } from "@/lib/sales-agent-normative-resolver";
import { resolveSalesAgentMode } from "@/lib/sales-agent-mode";
import { loadSellerState } from "@/lib/sales-agent-seller-state.server";
import { SALES_AGENT_PLAYBOOK } from "@/lib/sales-agent-playbook";

/**
 * Conhecimento da Vendedora IA para o copiloto do atendente.
 *
 * Monta o mesmo contexto que a Vendedora usa no turno (catálogo validado, políticas
 * oficiais, playbook, aprendizados e regras do Coach, respostas rápidas e a memória
 * comercial da conversa) e o devolve como texto de referência.
 *
 * Somente leitura: não grava estado, não registra evento, não chama a Vendedora externa
 * nem envia nada ao cliente. Qualquer falha devolve null e o copiloto segue com o
 * contexto que já tinha.
 */

const TIMEOUT_MS = 12_000;
const MAX_PRODUCTS = 15;
const ACTION_CONTRACT_MARKER = "CONTRATO DE AÇÃO:";

async function loadCustomerContext(
  companyId: string,
  conversationId: string,
): Promise<CustomerContext | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("ai_flow_events")
      .select("payload")
      .eq("company_id", companyId)
      .eq("conversation_id", conversationId)
      .eq("event_type", SALES_TURN_PLAN_EVENT)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return customerContextFromEventPayload((data as { payload?: unknown }).payload);
  } catch {
    return null;
  }
}

async function loadSalesState(
  companyId: string,
  conversationId: string,
): Promise<ConversationSalesState | null> {
  try {
    const scope = { companyId, scopeType: "whatsapp_conversation" as const, scopeId: conversationId };
    const loaded = await loadConversationSalesState(scope);
    if (loaded.status !== "found") return null;
    const validated = await revalidateConversationSalesState(scope, loaded.state);
    return validated.status === "validated" ? validated.state : null;
  } catch {
    return null;
  }
}

/** O prompt da Vendedora termina com o contrato de tool call; o copiloto responde em texto. */
export function stripActionContract(prompt: string): string {
  const index = prompt.indexOf(ACTION_CONTRACT_MARKER);
  return (index >= 0 ? prompt.slice(0, index) : prompt).trim();
}

async function build(params: {
  companyId: string;
  conversationId: string;
  history: AgentHistory;
  question: string;
}): Promise<string | null> {
  const { companyId, conversationId, history, question } = params;
  const ctx = await loadAgentContext(companyId, history);
  if (!ctx) return null;

  const [learnings, coachRules, salesState, customerContext, sellerState] = await Promise.all([
    loadRelevantSalesAgentLearnings(companyId, history).catch(() => []),
    listActiveCoachRulesForGrounding(companyId, 12, supabaseAdmin).catch(() => []),
    loadSalesState(companyId, conversationId),
    loadCustomerContext(companyId, conversationId),
    loadSellerState(companyId, conversationId),
  ]);
  const relevantRules = selectRelevantSalesAgentCoachRules(coachRules, history);
  const quickReplies = await loadRelevantSalesAgentQuickReplies(
    companyId,
    history,
    {},
    {
      paymentMethods: ctx.grounding.commercialRules.paymentMethods,
      guarantees: null,
      coachRules: relevantRules,
      playbook: SALES_AGENT_PLAYBOOK,
      catalog: [],
    },
  ).catch(() => []);
  const normative = resolveSalesAgentNormativeContext({
    companyId,
    context: {
      ...ctx,
      grounding: {
        ...ctx.grounding,
        approvedCoachLearnings: learnings,
        activeCoachRules: relevantRules,
        quickReplies,
      },
    },
  });

  // Mesma busca de catálogo do turno da Vendedora, sobre a conversa; e outra com a
  // pergunta do atendente, para ele poder consultar produtos que o cliente ainda não citou.
  const searchOptions = (interpretation: ReturnType<typeof interpretSalesAgentTurn>) => ({
    continuityEnabled: resolveSalesAgentMode(ctx.settings) !== null,
    structuredInterpretation: interpretation.structured,
  });
  const conversationTurn = interpretSalesAgentTurn(history);
  const conversationSearch = resolveSalesAgentCatalogSearch(
    conversationTurn,
    ctx,
    salesState,
    searchOptions(conversationTurn),
  );
  const questionTurn = question.trim()
    ? interpretSalesAgentTurn([...history, { role: "lead", text: question }])
    : null;
  const questionSearch = questionTurn
    ? resolveSalesAgentCatalogSearch(questionTurn, ctx, null, searchOptions(questionTurn))
    : null;
  const byId = new Map(ctx.grounding.catalog.map((product) => [product.id, product]));
  const focusIds = getConversationFocusProductIds(history, [
    ...(customerContext?.presentedProductIds ?? []),
    ...(salesState?.lastValidProductIds ?? []),
  ]).filter((id) => byId.has(id));
  const matched = [conversationSearch, questionSearch].flatMap((search) =>
    search && (search.status === "matches" || search.status === "ambiguous") ? search.products : [],
  );
  // Os produtos em foco vão primeiro e marcados, como no prompt da Vendedora.
  const focusProducts = focusIds.flatMap((id) => {
    const product = byId.get(id);
    return product ? [product] : [];
  });
  const products = [
    ...new Map([...focusProducts, ...matched].map((product) => [product.id, product])).values(),
  ].slice(0, MAX_PRODUCTS);
  const catalogSearch: AgentContext["grounding"]["catalogSearch"] = products.length
    ? { status: "matches", products, focusProductIds: focusProducts.map((product) => product.id) }
    : { status: "no_match", products: [] };

  const agentContext: AgentContext = {
    ...normative,
    grounding: { ...normative.grounding, catalogSearch },
  };
  const knowledge = stripActionContract(
    buildSalesAgentSystemPrompt(agentContext, history, [], customerContext),
  );
  const seller = sellerState ? `\n\nESTADO DA VENDEDORA NESTA CONVERSA:\n${JSON.stringify(sellerState).slice(0, 4000)}` : "";
  return `${knowledge}${seller}`;
}

export async function buildCopilotSalesIntelligence(params: {
  companyId: string;
  conversationId: string;
  history: AgentHistory;
  question: string;
}): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      build(params),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), TIMEOUT_MS);
      }),
    ]);
  } catch {
    console.warn("[COPILOT_SALES_INTELLIGENCE_FAILED]");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

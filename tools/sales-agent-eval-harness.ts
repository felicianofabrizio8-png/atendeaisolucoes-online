import {
  SalesAgentCore,
  type AgentContext,
  type AgentDecision,
  type SalesAgentCompletionResponse,
} from "../src/lib/sales-agent-core";
import { runSafetyLayer as runServerSafetyLayer } from "../src/lib/ai-agent.server";
import {
  buildTrainingHistory,
  extractSessionTrainingCorrections,
  rebuildTrainingStateFromValidMessages,
  type SessionTrainingMessage,
} from "../src/lib/sales-training-domain";
import type { ConversationSalesState } from "../src/lib/conversation-sales-state";

export interface SalesAgentEvalTurn {
  companyId: string;
  sessionId: string;
  input: string;
  reviewStatus?: "approved" | "rejected" | "corrected" | null;
  correctionText?: string | null;
}

export interface SalesAgentEvalOutput {
  message: string | null;
  productIds: string[];
  handoff: boolean;
  reason: string | null;
  transportInvoked: boolean;
  evidence: {
    /** O harness não infere proveniência; são dados disponíveis/declarados. */
    decisionGroundingSources: string[];
    decisionLearningIds: string[];
    availableCatalogProductIds: string[];
    companyId: string;
    scopeType: "training_session";
    sessionId: string;
  };
}

export interface SalesAgentEvalFixture {
  companyId: string;
  sessionId: string;
  context: AgentContext;
  state?: ConversationSalesState;
  messages?: SessionTrainingMessage[];
  mockCompletion: (request: unknown) => Promise<SalesAgentCompletionResponse>;
  transport?: { calls: number; send: (decision: AgentDecision) => Promise<void> };
}

/**
 * Harness somente para avaliação. Não chama WhatsApp, Supabase nem o gateway.
 * O mock do completion simula a resposta do LLM; o Core e a safety layer são
 * os mesmos utilizados pelo caminho de produção.
 */
export class SalesAgentEvalHarness {
  private readonly fixture: SalesAgentEvalFixture;
  private messages: SessionTrainingMessage[];
  private state: ConversationSalesState;

  constructor(fixture: SalesAgentEvalFixture) {
    this.fixture = fixture;
    this.messages = [...(fixture.messages ?? [])];
    this.state = fixture.state ?? {
      attributes: {},
      intent: null,
      productIds: [],
      lastValidProductIds: [],
    };
    this.state = rebuildTrainingStateFromValidMessages(this.state, this.messages);
    this.assertScope();
  }

  get currentState(): ConversationSalesState {
    return { ...this.state, productIds: [...this.state.productIds], lastValidProductIds: [...this.state.lastValidProductIds] };
  }

  get history(): ReturnType<typeof buildTrainingHistory> {
    return buildTrainingHistory(this.messages);
  }

  async turn(input: string): Promise<SalesAgentEvalOutput> {
    this.assertScope();
    this.recordLead(input);
    const history = this.history;
    const corrections = extractSessionTrainingCorrections(this.messages);

    const decision = await new SalesAgentCore(async (request) => ({
      ok: true as const,
      data: await this.fixture.mockCompletion(request),
    })).decide({
      ctx: this.fixture.context,
      history,
      leadName: "Cliente simulado",
      model: "eval/mock-sales-model",
      sessionCorrections: corrections,
    });

    const safeDecision = runServerSafetyLayer(decision, this.fixture.context.grounding.commercialRules.commercialTerms);
    this.recordAgent(safeDecision.kind === "reply" ? safeDecision.message ?? "" : "", safeDecision);
    // O Core já devolve somente IDs aceitos após validar a resposta do modelo.
    const productIds = [...new Set([
      ...(safeDecision.suggested_products ?? []),
      ...(safeDecision.product_image_ids ?? []),
    ])];
    return {
      message: safeDecision.kind === "reply" ? safeDecision.message ?? null : null,
      productIds,
      handoff: safeDecision.kind === "handoff",
      reason: safeDecision.reason ?? null,
      transportInvoked: (this.fixture.transport?.calls ?? 0) > 0,
      evidence: {
        decisionGroundingSources: safeDecision.grounding_sources ?? [],
        decisionLearningIds: safeDecision.learning_ids_used ?? [],
        availableCatalogProductIds: this.fixture.context.grounding.catalog.map((product) => product.id),
        companyId: this.fixture.companyId,
        scopeType: "training_session",
        sessionId: this.fixture.sessionId,
      },
    };
  }

  recordLead(content: string): void {
    this.messages.push({ role: "lead", content });
  }

  recordAgent(content: string, decision: AgentDecision, reviewStatus: "approved" | "rejected" | "corrected" | null = null, correctionText: string | null = null): void {
    this.messages.push({
      role: "agent",
      content,
      decision,
      review_status: reviewStatus,
      correction_text: correctionText,
    });
    this.state = rebuildTrainingStateFromValidMessages(this.state, this.messages);
  }

  reviewLastAgent(status: "approved" | "rejected" | "corrected", correctionText: string | null = null): void {
    const index = [...this.messages].map((message) => message.role).lastIndexOf("agent");
    if (index < 0) throw new Error("eval_agent_message_not_found");
    if (status === "corrected" && !correctionText?.trim()) throw new Error("eval_correction_required");
    this.messages[index] = {
      ...this.messages[index],
      review_status: status,
      correction_text: status === "corrected" ? correctionText?.trim() ?? null : null,
    };
    this.state = rebuildTrainingStateFromValidMessages(this.state, this.messages);
  }

  private assertScope(): void {
    if (this.fixture.context.settings.company_id !== this.fixture.companyId) {
      throw new Error("eval_company_scope_mismatch");
    }
  }
}

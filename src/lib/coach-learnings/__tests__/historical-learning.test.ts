import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ConversationRaw } from "@/lib/conversation-intelligence/ConversationIntelligenceTypes";
import type { SimilarCandidate } from "../similarity";
import {
  consolidateHistoricalCandidates,
  hasHistoricalSpecificFacts,
  isHistoricalConversationEligible,
  redactHistoricalPii,
  scoreHistoricalConversation,
  selectHistoricalConversations,
  shouldSkipHistoricalDuplicate,
} from "../historical-learning";
import type { CoachLearningDraft } from "../schema";

const serviceSource = readFileSync(
  fileURLToPath(new URL("../historical-learning.service.ts", import.meta.url)),
  "utf8",
);
const functionsSource = readFileSync(
  fileURLToPath(new URL("../coach-learnings.functions.ts", import.meta.url)),
  "utf8",
);
const adminRouteSource = readFileSync(
  fileURLToPath(new URL("../../../routes/configuracoes_.coach-learnings.tsx", import.meta.url)),
  "utf8",
);

function conversation(overrides: Partial<ConversationRaw> = {}): ConversationRaw {
  return {
    conversation_id: "conv-1",
    company_id: "company-a",
    channel: "whatsapp",
    lead_id: "lead-1",
    lead_status: "fechado",
    lead_source: null,
    lead_closed_at: "2026-08-01T00:00:00Z",
    lead_lost_at: null,
    lead_estimated_value: 100,
    quote_count: 1,
    quote_last_sent_at: "2026-07-31T00:00:00Z",
    follow_up_count: 0,
    messages: [
      { id: "1", role: "lead", text: "Oi", at: "2026-07-01", source_subtype: null },
      { id: "2", role: "agent", text: "Ola", at: "2026-07-01", source_subtype: null },
      { id: "3", role: "lead", text: "Fechado", at: "2026-07-01", source_subtype: null },
    ],
    ...overrides,
  };
}

describe("historical learning V1", () => {
  const draft = (overrides: Partial<CoachLearningDraft> = {}): CoachLearningDraft => ({
    category: "closing",
    product_ref: null,
    title: "Confirmar o proximo passo",
    description: "Conduzir o fechamento com clareza.",
    rule_structured: "Confirmar interesse e combinar o proximo passo.",
    positive_example: "Faz sentido avancarmos?",
    negative_example: null,
    priority: 60,
    confidence: 0.8,
    ...overrides,
  });

  it("isola a selecao por company_id", () => {
    const other = conversation({ conversation_id: "conv-b", company_id: "company-b" });
    expect(selectHistoricalConversations([other, conversation()], "company-a")).toHaveLength(1);
    expect(serviceSource).toContain("companyId: args.companyId");
  });

  it("prioriza venda com orcamento e depois perda clara", () => {
    const lost = conversation({
      conversation_id: "lost",
      lead_status: "perdido",
      lead_closed_at: null,
      lead_lost_at: "2026-08-02T00:00:00Z",
      quote_count: 0,
    });
    expect(scoreHistoricalConversation(conversation())).toBeGreaterThan(
      scoreHistoricalConversation(lost),
    );
  });

  it("aceita fatos, orcamento qualificado e sinais comerciais sem status terminal", () => {
    const open = { lead_status: "quente", lead_closed_at: null, lead_lost_at: null };
    expect(
      isHistoricalConversationEligible(conversation({ ...open, fact_sale_detected: true })),
    ).toBe(true);
    expect(
      isHistoricalConversationEligible(conversation({ ...open, fact_loss_detected: true })),
    ).toBe(true);
    expect(
      isHistoricalConversationEligible(conversation({ ...open, fact_quote_detected: true })),
    ).toBe(true);
    expect(
      isHistoricalConversationEligible(conversation({ ...open, qualified_quote_count: 1 })),
    ).toBe(true);
    expect(
      isHistoricalConversationEligible(conversation({ ...open, commercial_signal_count: 2 })),
    ).toBe(true);
    expect(
      isHistoricalConversationEligible(
        conversation({ ...open, commercial_signal_count: 1, quote_count: 0 }),
      ),
    ).toBe(false);
  });

  it("remove email, telefone, documento, link, usuario e nome declarado", () => {
    const clean = redactHistoricalPii(
      "Meu nome e Maria Silva, email maria@site.com, telefone (11) 99999-8888, CPF 123.456.789-00, https://site.com e @maria",
    );
    expect(clean).not.toMatch(/Maria Silva|maria@site|99999|123\.456|https|@maria/i);
    expect(clean).toContain("[email]");
  });

  it("bloqueia hash exato e qualquer similaridade relevante", () => {
    const candidate = (classification: SimilarCandidate["classification"]) =>
      ({ classification }) as SimilarCandidate;
    expect(shouldSkipHistoricalDuplicate([candidate("exact")])).toBe(true);
    expect(shouldSkipHistoricalDuplicate([candidate("highly_similar")])).toBe(true);
    expect(shouldSkipHistoricalDuplicate([candidate("related")])).toBe(true);
    expect(shouldSkipHistoricalDuplicate([])).toBe(false);
  });

  it("rejeita fatos de catalogo/cliente e aceita somente comportamento geral", () => {
    expect(hasHistoricalSpecificFacts(draft())).toBe(false);
    expect(hasHistoricalSpecificFacts(draft({ category: "pricing" }))).toBe(true);
    expect(hasHistoricalSpecificFacts(draft({ product_ref: "sku-1" }))).toBe(true);
    for (const fact of [
      "Oferecer por R$ 199",
      "Indicar a medida de 20 cm",
      "Recomendar o modelo XPTO",
      "Prometer prazo de entrega",
      "Confirmar disponibilidade em estoque",
      "O cliente precisa de uma unidade",
    ]) {
      expect(hasHistoricalSpecificFacts(draft({ rule_structured: fact }))).toBe(true);
    }
  });

  it("consolida regras semelhantes e conta conversas como evidencias unicas", () => {
    const candidates = consolidateHistoricalCandidates([
      { draft: draft(), conversationId: "conv-1" },
      {
        draft: draft({
          title: "Confirmar proximo passo",
          rule_structured: "Confirmar o interesse e combinar proximo passo.",
          confidence: 0.9,
        }),
        conversationId: "conv-2",
      },
      { draft: draft(), conversationId: "conv-1" },
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].conversationIds).toEqual(["conv-1", "conv-2"]);
    expect(candidates[0].draft.confidence).toBe(0.9);
  });

  it("cria somente paused e exige admin; ativacao continua manual", () => {
    expect(serviceSource).toMatch(/status:\s*"paused"/g);
    expect(serviceSource).not.toMatch(/status:\s*"active"/);
    expect(serviceSource).toContain("source_conversation_id: null");
    expect(serviceSource).toContain("conversation_id: conversationIds[0]");
    expect(functionsSource).toContain('if (!isAdmin) throw new Error("admin_required")');
    expect(adminRouteSource).toContain("updateCoachLearningFn");
    expect(adminRouteSource).toContain("status: draft.status as CoachLearningStatus");
  });

  it("separa falhas de IA e persistencia e expoe o resumo completo", () => {
    expect(serviceSource).toContain("aiFailed");
    expect(serviceSource).toContain("persistenceFailed");
    expect(serviceSource).toContain("aiFailureBreakdown");
    expect(serviceSource).toContain("evidence_conversation_ids");
    expect(serviceSource).toContain("processedConversationIds");
    expect(serviceSource).toContain("offset: page * HISTORICAL_SCAN_LIMIT");
    for (const field of ["scanned", "analyzed", "created", "duplicatesSkipped", "failed"]) {
      expect(adminRouteSource).toContain(`analysisSummary.${field}`);
    }
  });
});

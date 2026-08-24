import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ConversationRaw } from "@/lib/conversation-intelligence/ConversationIntelligenceTypes";
import type { SimilarCandidate } from "../similarity";
import {
  redactHistoricalPii,
  scoreHistoricalConversation,
  selectHistoricalConversations,
  shouldSkipHistoricalDuplicate,
} from "../historical-learning";

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

  it("cria somente paused e exige admin; ativacao continua manual", () => {
    expect(serviceSource).toMatch(/status:\s*"paused"/g);
    expect(serviceSource).not.toMatch(/status:\s*"active"/);
    expect(serviceSource).toContain("source_conversation_id: null");
    expect(serviceSource).toContain("conversation_id: conversation.conversation_id");
    expect(functionsSource).toContain('if (!isAdmin) throw new Error("admin_required")');
    expect(adminRouteSource).toContain("updateCoachLearningFn");
    expect(adminRouteSource).toContain("status: draft.status as CoachLearningStatus");
  });
});

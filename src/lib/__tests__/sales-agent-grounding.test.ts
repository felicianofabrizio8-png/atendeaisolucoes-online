import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, listLearningCandidates, retrieveLearnings } = vi.hoisted(() => ({
  from: vi.fn(),
  listLearningCandidates: vi.fn(),
  retrieveLearnings: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
vi.mock("../coach-learnings/coach-learnings.repository", () => ({ listLearningCandidates }));
vi.mock("../coach-learnings/retriever", () => ({ retrieveLearnings }));

import {
  loadRelevantSalesAgentLearnings,
  loadSalesAgentGrounding,
} from "../sales-agent-grounding.server";

function query(result: { data: unknown }) {
  const builder = {
    select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn(),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockResolvedValue(result);
  builder.maybeSingle.mockResolvedValue(result);
  return builder;
}

describe("SalesAgent grounding", () => {
  beforeEach(() => vi.clearAllMocks());

  it("carrega catálogo, conhecimento e regras comerciais da empresa", async () => {
    const products = query({ data: [{
      id: "product-1", name: "Piscina 6x3", description: "Fibra", price: 20_000,
      images: ["image.jpg", 123], notes: "Filtro incluso",
    }] });
    const knowledge = query({ data: [{ question: "Instala?", answer: "Sim.", type: "faq" }] });
    const commercial = query({ data: { commercial_terms: "Entrada de 50%" } });
    from.mockImplementation((table: string) => {
      if (table === "products") return products;
      if (table === "ai_knowledge_proposals") return knowledge;
      if (table === "marketing_knowledge_base") return commercial;
      throw new Error(`unexpected table: ${table}`);
    });

    const grounding = await loadSalesAgentGrounding("company-1");

    expect(grounding.catalog[0]).toMatchObject({ id: "product-1", price: 20_000, images: ["image.jpg"] });
    expect(grounding.faqKnowledge).toEqual([{ question: "Instala?", answer: "Sim.", type: "faq" }]);
    expect(grounding.commercialRules.commercialTerms).toBe("Entrada de 50%");
    expect(grounding.approvedCoachLearnings).toEqual([]);
    expect(products.eq).toHaveBeenCalledWith("active", true);
    expect(knowledge.eq).toHaveBeenCalledWith("status", "approved");
  });

  it("ranqueia candidatos pela mensagem atual e preserva company_id", async () => {
    const relevant = {
      id: "learning-1", company_id: "company-1", status: "active", category: "tone",
      title: "Abertura sobre piscinas", description: "Resposta treinada",
      rule_structured: "Responder à solicitação de informações sobre piscinas",
      product_ref: null, positive_example: "Claro! Qual tamanho você procura?",
      negative_example: "Como posso ajudar?", priority: 50, confidence: 0.7,
    };
    listLearningCandidates.mockResolvedValue([relevant]);
    retrieveLearnings.mockReturnValue({ selected: [relevant], scored: [], metrics: {} });

    const learnings = await loadRelevantSalesAgentLearnings("company-1", [
      { role: "agent", text: "Olá" },
      { role: "lead", text: "Gostaria de informações das piscinas" },
    ]);

    expect(listLearningCandidates).toHaveBeenCalledWith(expect.anything(), "company-1", 50);
    expect(retrieveLearnings).toHaveBeenCalledWith(expect.objectContaining({
      companyId: "company-1",
      currentMessage: "Gostaria de informações das piscinas",
      maxSelected: 5,
    }));
    expect(learnings[0]).toMatchObject({
      id: "learning-1",
      positiveExample: "Claro! Qual tamanho você procura?",
      negativeExample: "Como posso ajudar?",
    });
  });

  it("não cria efeitos externos durante o grounding", async () => {
    const source = await import("node:fs/promises").then(({ readFile }) =>
      readFile(new URL("../sales-agent-grounding.server.ts", import.meta.url), "utf8"),
    );
    expect(source).not.toMatch(/\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.rpc\s*\(|\bfetch\s*\(/);
    expect(source).not.toMatch(/incrementLearningUsage|recordCoachLearningRetrieval/);
  });
});

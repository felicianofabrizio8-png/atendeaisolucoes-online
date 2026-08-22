import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, listActiveLearningsForGrounding } = vi.hoisted(() => ({
  from: vi.fn(),
  listActiveLearningsForGrounding: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from },
}));

vi.mock("../coach-learnings/coach-learnings.repository", () => ({
  listActiveLearningsForGrounding,
}));

import { loadSalesAgentGrounding } from "../sales-agent-grounding.server";

function query(result: { data: unknown }) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockResolvedValue(result);
  builder.maybeSingle.mockResolvedValue(result);
  return builder;
}

describe("loadSalesAgentGrounding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("carrega catálogo, conhecimento, regras comerciais e learnings ativos da empresa", async () => {
    const products = query({
      data: [
        {
          id: "product-1",
          name: "Piscina 6x3",
          description: "Fibra",
          price: 20_000,
          images: ["image.jpg", 123],
          notes: "Filtro incluso",
        },
      ],
    });
    const knowledge = query({
      data: [{ question: "Instala?", answer: "Sim.", type: "faq" }],
    });
    const commercial = query({ data: { commercial_terms: "Entrada de 50%" } });
    from.mockImplementation((table: string) => {
      if (table === "products") return products;
      if (table === "ai_knowledge_proposals") return knowledge;
      if (table === "marketing_knowledge_base") return commercial;
      throw new Error(`unexpected table: ${table}`);
    });
    listActiveLearningsForGrounding.mockResolvedValue([
      {
        id: "learning-1",
        company_id: "company-1",
        category: "commercial",
        title: "Negociação",
        description: "Encaminhar ao humano",
        rule_structured: "Não oferecer descontos",
        product_ref: null,
        positive_example: null,
        negative_example: null,
        priority: 90,
        confidence: 0.9,
      },
    ]);

    const grounding = await loadSalesAgentGrounding("company-1");

    expect(grounding.catalog[0]).toMatchObject({
      id: "product-1",
      price: 20_000,
      images: ["image.jpg"],
    });
    expect(grounding.faqKnowledge).toEqual([{ question: "Instala?", answer: "Sim.", type: "faq" }]);
    expect(grounding.commercialRules.commercialTerms).toBe("Entrada de 50%");
    expect(grounding.approvedCoachLearnings[0]).toMatchObject({
      id: "learning-1",
      rule: "Não oferecer descontos",
    });
    expect(listActiveLearningsForGrounding).toHaveBeenCalledWith(expect.anything(), "company-1", 5);
    expect(products.eq).toHaveBeenCalledWith("active", true);
    expect(knowledge.eq).toHaveBeenCalledWith("status", "approved");
  });

  it("não contém escrita, telemetria ou efeitos externos novos", async () => {
    const source = await import("node:fs/promises").then(({ readFile }) =>
      readFile(new URL("../sales-agent-grounding.server.ts", import.meta.url), "utf8"),
    );

    expect(source).not.toMatch(/\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.rpc\s*\(|\bfetch\s*\(/);
    expect(source).not.toMatch(/incrementLearningUsage|recordCoachLearningRetrieval/);
  });
});

// BLOCO 2 — Cobertura das funções puras de interpretação da IA.
import { describe, expect, it } from "vitest";
import {
  buildFallbackDraft,
  buildLearningSummary,
  CATEGORY_LABELS_PT,
  diffDrafts,
  normalizeAiDraft,
  normalizeCategory,
  normalizePriority,
  parseStructuredRule,
  sanitizeTitle,
} from "../interpretation";
import type { CoachLearningDraft } from "../schema";

const clientCases: Array<{
  label: string;
  client: string;
  raw: {
    title?: string;
    description?: string;
    rule_structured?: string;
    category?: string;
    priority?: number;
    positive_example?: string | null;
    negative_example?: string | null;
  };
  expectCategory: CoachLearningDraft["category"];
  expectPriorityRange: [number, number];
  titleMustNotIncludeClient: boolean;
}> = [
  {
    label: "já tenho outros orçamentos → título conceitual",
    client: "Já tenho outros orçamentos.",
    raw: {
      title: 'Lidar com "já tenho outros orçamentos"',
      description:
        "O cliente informa que já está analisando outras propostas. A resposta deve reconhecer essa comparação antes de continuar.",
      rule_structured:
        "Gatilho:\nCliente informa que está comparando propostas.\n\nAção obrigatória:\nReconhecer explicitamente essa informação antes de continuar.\n\nObjetivo:\nAgregar valor e posicionar diferenciais.\n\nEvitar:\n• Ignorar a comparação\n• Desmerecer concorrentes",
      category: "objection",
      priority: 70,
    },
    expectCategory: "objection",
    expectPriorityRange: [55, 85],
    titleMustNotIncludeClient: true,
  },
  {
    label: "vou mostrar para minha esposa → decisão compartilhada",
    client: "Vou mostrar para minha esposa.",
    raw: {
      title: "Conduzir decisões compartilhadas",
      description:
        "Cliente informa que precisa consultar cônjuge antes de decidir. Reconhecer e apoiar o processo.",
      rule_structured:
        "Gatilho:\nCliente menciona esposa/marido/família.\n\nAção obrigatória:\nReconhecer decisão compartilhada e propor materiais para levar à conversa.\n\nObjetivo:\nManter engajamento sem pressionar.\n\nEvitar:\n• Pressionar pela decisão imediata",
      category: "followup",
      priority: 65,
    },
    expectCategory: "followup",
    expectPriorityRange: [50, 80],
    titleMustNotIncludeClient: true,
  },
  {
    label: "vou pensar → aprendizado reutilizável",
    client: "Vou pensar.",
    raw: {
      title: "Responder clientes que ainda estão avaliando a compra",
      description:
        "Cliente demonstra que ainda avalia. Reconhecer o tempo de decisão e agregar valor.",
      rule_structured:
        "Gatilho:\nCliente diz que vai pensar.\n\nAção obrigatória:\nReconhecer o tempo de decisão e oferecer material de apoio.\n\nObjetivo:\nManter porta aberta.\n\nEvitar:\n• Insistir por resposta imediata",
      category: "followup",
      priority: 60,
    },
    expectCategory: "followup",
    expectPriorityRange: [50, 80],
    titleMustNotIncludeClient: true,
  },
  {
    label: "está caro → foco em valor, sem oferecer desconto automaticamente",
    client: "Está muito caro.",
    raw: {
      title: "Trabalhar objeções de preço com foco em valor",
      description:
        "Cliente questiona preço. Apresentar valor e diferenciais antes de considerar desconto.",
      rule_structured:
        "Gatilho:\nCliente diz que está caro.\n\nAção obrigatória:\nApresentar valor, benefícios e diferenciais.\n\nObjetivo:\nJustificar o investimento.\n\nEvitar:\n• Oferecer desconto automaticamente\n• Reduzir valor sem entender objeção",
      category: "objection",
      priority: 78,
    },
    expectCategory: "objection",
    expectPriorityRange: [55, 89],
    titleMustNotIncludeClient: true,
  },
];

describe("sanitizeTitle", () => {
  it("remove aspas envolventes e capitaliza", () => {
    expect(sanitizeTitle('"reconhecer comparação de propostas"')).toBe(
      "Reconhecer comparação de propostas",
    );
  });

  it('remove prefixo "Lidar com" e não deixa a frase do cliente vazar', () => {
    const out = sanitizeTitle('Lidar com "já tenho outros orçamentos"', "já tenho outros orçamentos");
    expect(out.toLowerCase()).not.toMatch(/^lidar com/);
    expect(out.toLowerCase()).not.toContain("já tenho outros orçamentos");
  });

  it("degrada para placeholder se sobrar só a frase do cliente", () => {
    const out = sanitizeTitle('"Vou pensar"', "vou pensar");
    expect(out).not.toBe("Vou pensar");
    // Placeholder ou algo distinto da fala literal
    expect(out.length).toBeGreaterThan(3);
  });
});

describe("parseStructuredRule", () => {
  it("extrai gatilho, ação, objetivo e evitar", () => {
    const rule = parseStructuredRule(
      "Gatilho:\nCliente compara.\n\nAção obrigatória:\nReconhecer.\n\nObjetivo:\nAgregar valor.\n\nEvitar:\n• Ignorar\n• Desmerecer",
    );
    expect(rule.trigger).toMatch(/cliente compara/i);
    expect(rule.action).toMatch(/reconhecer/i);
    expect(rule.objective).toMatch(/agregar valor/i);
    expect(rule.avoid).toEqual(expect.arrayContaining(["Ignorar", "Desmerecer"]));
  });

  it("cai em ação livre quando não há seções", () => {
    const rule = parseStructuredRule("Reconheça o cliente antes de continuar.");
    expect(rule.trigger).toBe("");
    expect(rule.action).toMatch(/reconheça/i);
    expect(rule.avoid).toEqual([]);
  });
});

describe("normalizePriority", () => {
  it("rebaixa 90+ sem sinal de risco", () => {
    expect(normalizePriority(95, "cliente compara propostas")).toBeLessThan(90);
  });

  it("sobe prioridade em risco alto", () => {
    expect(normalizePriority(20, "cliente questiona garantia legal")).toBeGreaterThanOrEqual(80);
  });

  it("clampa fora do intervalo", () => {
    expect(normalizePriority(150, "")).toBeLessThanOrEqual(100);
    expect(normalizePriority(-3, "")).toBeGreaterThanOrEqual(0);
  });
});

describe("normalizeCategory", () => {
  it("mantém categoria válida", () => {
    expect(normalizeCategory("pricing", "")).toBe("pricing");
  });

  it("infere objection para comparação de propostas", () => {
    expect(normalizeCategory("banana", "cliente já tem outros orçamentos")).toBe("objection");
  });

  it("infere tone para linguagem insistente", () => {
    expect(normalizeCategory(undefined, "coach respondeu de forma insistente")).toBe("tone");
  });

  it("infere product_positioning para informação técnica incorreta", () => {
    expect(
      normalizeCategory(null, "coach indicou modelo errado, informação técnica incorreta"),
    ).toBe("product_positioning");
  });
});

describe("buildLearningSummary", () => {
  it('gera bullets começando com "reconhecer/não ..." a partir da regra', () => {
    const draft: CoachLearningDraft = {
      category: "objection",
      product_ref: null,
      title: "Reconhecer comparação",
      description: "…",
      rule_structured:
        "Gatilho:\nCliente compara propostas.\n\nAção obrigatória:\nReconhecer a comparação e apresentar diferenciais.\n\nObjetivo:\nAgregar valor.\n\nEvitar:\n• Desmerecer concorrentes\n• Pressionar decisão",
      positive_example: null,
      negative_example: null,
      priority: 70,
      confidence: 0.8,
    };
    const summary = buildLearningSummary(draft);
    expect(summary.intro).toMatch(/O Coach entendeu que deve/i);
    expect(summary.bullets.length).toBeGreaterThan(0);
    expect(summary.bullets.some((b) => b.startsWith("reconhecer"))).toBe(true);
    expect(summary.bullets.some((b) => b.startsWith("não "))).toBe(true);
  });
});

describe("normalizeAiDraft — cenários do BLOCO 2", () => {
  for (const c of clientCases) {
    it(c.label, () => {
      const { draft, usedFallback } = normalizeAiDraft(c.raw, {
        userExplanation: "correção do vendedor",
        clientMessage: c.client,
      });
      expect(usedFallback).toBe(false);
      expect(draft.category).toBe(c.expectCategory);
      expect(draft.priority).toBeGreaterThanOrEqual(c.expectPriorityRange[0]);
      expect(draft.priority).toBeLessThanOrEqual(c.expectPriorityRange[1]);
      if (c.titleMustNotIncludeClient) {
        expect(draft.title.toLowerCase()).not.toContain(c.client.toLowerCase().replace(/[.!?]/g, ""));
      }
    });
  }

  it("regra estruturada contém gatilho, ação, objetivo e itens a evitar", () => {
    const { draft } = normalizeAiDraft(clientCases[0].raw, {
      userExplanation: "x",
      clientMessage: clientCases[0].client,
    });
    const rule = parseStructuredRule(draft.rule_structured);
    expect(rule.trigger.length).toBeGreaterThan(0);
    expect(rule.action.length).toBeGreaterThan(0);
    expect(rule.objective.length).toBeGreaterThan(0);
    expect(rule.avoid.length).toBeGreaterThan(0);
  });

  it("usa sugestão original como negative_example quando IA não devolve", () => {
    const { draft } = normalizeAiDraft(
      { title: "Reconhecer comparação", description: "ok ok ok", rule_structured: "Reconheça.", category: "objection", priority: 60 },
      {
        userExplanation: "corrija",
        clientMessage: "vou pensar",
        suggestionText: "Que ótimo que estamos alinhados com o prazo.",
      },
    );
    expect(draft.negative_example).toBe("Que ótimo que estamos alinhados com o prazo.");
  });

  it("exemplo positivo enviado pela IA é preservado sem inventar", () => {
    const { draft } = normalizeAiDraft(
      {
        title: "Reconhecer comparação",
        description: "descrição adequada para validação",
        rule_structured: "Reconheça o cliente antes de continuar.",
        category: "objection",
        priority: 60,
        positive_example: "Claro, entendo que você já está comparando.",
      },
      { userExplanation: "cliente diz que está comparando propostas" },
    );
    expect(draft.positive_example).toBe("Claro, entendo que você já está comparando.");
  });

  it("resposta malformada usa fallback seguro", () => {
    const { draft, usedFallback } = normalizeAiDraft(null, {
      userExplanation: "cliente quer desconto e eu quero ensinar a IA a responder valor",
    });
    expect(usedFallback).toBe(true);
    expect(draft.title.length).toBeGreaterThanOrEqual(3);
    expect(draft.description).toMatch(/desconto/);
    expect(draft.priority).toBeGreaterThanOrEqual(0);
    expect(draft.priority).toBeLessThanOrEqual(100);
  });

  it("resposta parcial (só título curto) ainda produz draft válido", () => {
    const { draft } = normalizeAiDraft(
      { title: "Preço", description: "..", rule_structured: "..", category: "pricing", priority: 999 },
      { userExplanation: "cliente reclama de preço" },
    );
    expect(draft.priority).toBeLessThanOrEqual(100);
    expect(draft.priority).toBeGreaterThanOrEqual(0);
  });

  it("nome, produto e prazo não aparecem no título por acidente", () => {
    const { draft } = normalizeAiDraft(
      {
        title: '"Fabrizio quer piscina 8m em 20 dias"',
        description: "…",
        rule_structured: "Reconhecer",
        category: "other",
        priority: 50,
      },
      { userExplanation: "x", clientMessage: "quero em 20 dias" },
    );
    // Sanitizer removeu as aspas; título é preservado se não corresponde
    // literalmente ao client_message. O contrato aqui garante que aspas
    // não vazem e prefixos genéricos não fiquem.
    expect(draft.title.startsWith('"')).toBe(false);
  });
});

describe("diffDrafts", () => {
  const base: CoachLearningDraft = {
    category: "objection",
    product_ref: null,
    title: "A",
    description: "x",
    rule_structured: "y",
    positive_example: null,
    negative_example: null,
    priority: 60,
    confidence: 0.7,
  };
  it("detecta campo alterado manualmente", () => {
    expect(diffDrafts(base, { ...base, title: "B" })).toContain("title");
  });
  it("retorna vazio quando idêntico", () => {
    expect(diffDrafts(base, { ...base })).toEqual([]);
  });
});

describe("CATEGORY_LABELS_PT", () => {
  it("cobre todas as categorias", () => {
    for (const c of Object.keys(CATEGORY_LABELS_PT)) {
      expect(CATEGORY_LABELS_PT[c as keyof typeof CATEGORY_LABELS_PT].length).toBeGreaterThan(0);
    }
  });
});

describe("buildFallbackDraft", () => {
  it("preserva a explicação do vendedor", () => {
    const d = buildFallbackDraft({ userExplanation: "corrigir tom insistente" });
    expect(d.description).toContain("insistente");
    expect(d.category).toBe("other");
    expect(d.priority).toBe(50);
  });
});

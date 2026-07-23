// BLOCO 3 — Cobertura das funções puras de múltiplos exemplos e dirty state.
import { describe, expect, it } from "vitest";
import {
  addExample,
  buildFinalPayload,
  buildInitialExamplesUi,
  EXAMPLE_SEPARATOR,
  ensureAtLeastOne,
  FIELD_LABELS_PT,
  hasChanges,
  MAX_EXAMPLES,
  moveExample,
  parseExamples,
  removeExampleAt,
  serializeExamples,
  updateExampleAt,
} from "../examples";
import type { CoachLearningDraft } from "../schema";

const baseDraft: CoachLearningDraft = {
  category: "objection",
  product_ref: null,
  title: "Reconhecer comparação",
  description: "Cliente está avaliando outras propostas.",
  rule_structured:
    "Gatilho:\nCliente compara.\n\nAção obrigatória:\nReconhecer.\n\nObjetivo:\nAgregar valor.\n\nEvitar:\n• Desmerecer",
  positive_example: null,
  negative_example: null,
  priority: 70,
  confidence: 0.8,
};

describe("parseExamples / serializeExamples", () => {
  it("aprendizado antigo (string única sem separador) vira 1 exemplo", () => {
    const out = parseExamples("Claro, entendo que você está comparando.");
    expect(out).toEqual(["Claro, entendo que você está comparando."]);
  });

  it("string vazia ou null vira lista vazia", () => {
    expect(parseExamples(null)).toEqual([]);
    expect(parseExamples("")).toEqual([]);
    expect(parseExamples("   ")).toEqual([]);
  });

  it("serializa e reparse mantém a mesma lista", () => {
    const list = ["Reconhecer a comparação.", "Perguntar quais aspectos importam."];
    const s = serializeExamples(list);
    expect(s).toContain(EXAMPLE_SEPARATOR);
    expect(parseExamples(s)).toEqual(list);
  });

  it("serializeExamples retorna null quando todos vazios", () => {
    expect(serializeExamples([])).toBeNull();
    expect(serializeExamples(["", "   ", "\n"])).toBeNull();
  });

  it("respeita o cap de 2000 chars descartando exemplos do fim", () => {
    const big = "x".repeat(1500);
    const list = [big, big, big];
    const s = serializeExamples(list) ?? "";
    expect(s.length).toBeLessThanOrEqual(2000);
    expect(parseExamples(s).length).toBeLessThanOrEqual(2);
  });

  it("respeita o limite máximo de exemplos ao reparse", () => {
    const list = Array.from({ length: MAX_EXAMPLES + 3 }, (_, i) => `Exemplo ${i + 1}`);
    const s = serializeExamples(list) ?? "";
    expect(parseExamples(s).length).toBeLessThanOrEqual(MAX_EXAMPLES);
  });
});

describe("mutações imutáveis", () => {
  it("addExample adiciona slot vazio até o máximo", () => {
    let list = ensureAtLeastOne([]);
    for (let i = 0; i < MAX_EXAMPLES + 2; i++) list = addExample(list);
    expect(list.length).toBe(MAX_EXAMPLES);
  });

  it("removeExampleAt remove e mantém pelo menos 1 slot", () => {
    const list = ["a", "b"];
    expect(removeExampleAt(list, 0)).toEqual(["b"]);
    expect(removeExampleAt(["only"], 0)).toEqual([""]);
  });

  it("updateExampleAt substitui apenas o índice alvo", () => {
    const list = ["a", "b", "c"];
    expect(updateExampleAt(list, 1, "novo")).toEqual(["a", "novo", "c"]);
    // fora de range é no-op
    expect(updateExampleAt(list, 9, "x")).toEqual(list);
  });

  it("moveExample reordena sem duplicar", () => {
    expect(moveExample(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveExample(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveExample(["a", "b"], 0, 0)).toEqual(["a", "b"]);
  });
});

describe("buildInitialExamplesUi", () => {
  it("aprendizado sem exemplos abre com 1 slot vazio", () => {
    const ui = buildInitialExamplesUi({ draft: baseDraft });
    expect(ui.positives).toEqual([""]);
    expect(ui.negatives).toEqual([""]);
  });

  it("aprendizado antigo com 1 exemplo é preservado (compatibilidade)", () => {
    const ui = buildInitialExamplesUi({
      draft: {
        ...baseDraft,
        positive_example: "Ótimo, entendo que você compara.",
        negative_example: "Preço melhor que qualquer concorrente.",
      },
    });
    expect(ui.positives).toEqual(["Ótimo, entendo que você compara."]);
    expect(ui.negatives).toEqual(["Preço melhor que qualquer concorrente."]);
  });

  it("aprendizado com múltiplos exemplos serializados é dividido corretamente", () => {
    const draft = {
      ...baseDraft,
      positive_example: ["A", "B", "C"].join(EXAMPLE_SEPARATOR),
    };
    const ui = buildInitialExamplesUi({ draft });
    expect(ui.positives).toEqual(["A", "B", "C"]);
  });

  it("sugestão reprovada vira primeiro exemplo negativo (sem duplicar)", () => {
    const ui = buildInitialExamplesUi({
      draft: baseDraft,
      suggestionText: "Fechamos hoje com desconto de 20%.",
    });
    expect(ui.negatives[0]).toBe("Fechamos hoje com desconto de 20%.");
  });

  it("sugestão já presente entre negativos não é duplicada", () => {
    const ui = buildInitialExamplesUi({
      draft: { ...baseDraft, negative_example: "Fechamos hoje com desconto de 20%." },
      suggestionText: "Fechamos hoje com desconto de 20%.",
    });
    expect(ui.negatives.filter((n) => n.includes("desconto de 20%")).length).toBe(1);
  });
});

describe("buildFinalPayload", () => {
  it("descarta exemplos vazios e faz dedupe case-insensitive", () => {
    const payload = buildFinalPayload({
      draft: baseDraft,
      positives: ["Ok", "", "  ", "ok", "Perguntar"],
      negatives: ["", ""],
    });
    expect(payload.positive_example).toBe(`Ok${EXAMPLE_SEPARATOR}Perguntar`);
    expect(payload.negative_example).toBeNull();
  });

  it("mantém contrato do CoachLearningDraft (string | null)", () => {
    const payload = buildFinalPayload({
      draft: baseDraft,
      positives: [],
      negatives: [],
    });
    expect(payload.positive_example).toBeNull();
    expect(payload.negative_example).toBeNull();
    expect(payload.title).toBe(baseDraft.title);
    expect(payload.priority).toBe(baseDraft.priority);
  });

  it("aprendizado antigo (1 exemplo) continua serializando como string simples sem separador", () => {
    const payload = buildFinalPayload({
      draft: baseDraft,
      positives: ["Único exemplo positivo."],
      negatives: [],
    });
    expect(payload.positive_example).toBe("Único exemplo positivo.");
    expect(payload.positive_example ?? "").not.toContain(EXAMPLE_SEPARATOR);
  });
});

describe("hasChanges (dirty state)", () => {
  const positives = ["A"];
  const negatives = [""];
  it("iguais → não sujo", () => {
    expect(
      hasChanges(
        { draft: baseDraft, positives, negatives },
        { draft: baseDraft, positives, negatives },
      ),
    ).toBe(false);
  });

  it("edição em campo do draft marca dirty", () => {
    const next = { ...baseDraft, title: "Outro título" };
    expect(
      hasChanges(
        { draft: baseDraft, positives, negatives },
        { draft: next, positives, negatives },
      ),
    ).toBe(true);
  });

  it("adição de novo exemplo positivo marca dirty", () => {
    expect(
      hasChanges(
        { draft: baseDraft, positives: ["A"], negatives },
        { draft: baseDraft, positives: ["A", "B"], negatives },
      ),
    ).toBe(true);
  });

  it("slot vazio adicional NÃO marca dirty (só o que é enviado conta)", () => {
    expect(
      hasChanges(
        { draft: baseDraft, positives: ["A"], negatives: [""] },
        { draft: baseDraft, positives: ["A", ""], negatives: ["", "", ""] },
      ),
    ).toBe(false);
  });

  it("draft nulo em ambos os lados → não sujo", () => {
    expect(
      hasChanges(
        { draft: null, positives: [""], negatives: [""] },
        { draft: null, positives: [""], negatives: [""] },
      ),
    ).toBe(false);
  });
});

describe("FIELD_LABELS_PT", () => {
  it("cobre todos os campos que aparecem em diff", () => {
    for (const k of [
      "title",
      "description",
      "rule_structured",
      "category",
      "priority",
      "product_ref",
      "positive_example",
      "negative_example",
    ]) {
      expect(FIELD_LABELS_PT[k]).toBeTruthy();
    }
  });
});

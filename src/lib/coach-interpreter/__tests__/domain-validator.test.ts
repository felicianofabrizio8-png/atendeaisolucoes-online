import { describe, it, expect } from "vitest";
import { validateAgainstDomain } from "../domain-validator.server";
import type { CoachInterpreterOutput } from "../schema";
import type { CoachGroundingRaw } from "../grounding.server";

const baseOutput = (over: Partial<CoachInterpreterOutput> = {}): CoachInterpreterOutput => ({
  intent: "rule",
  has_rule: false,
  proposals: [],
  clarification_questions: [],
  confidence: 0.9,
  reasoning_summary: "",
  warnings: [],
  ...over,
});

const rawPools = (): CoachGroundingRaw => ({
  products: [
    { name: "Piscina Fibra Maragogi 8x3.5", category: "Piscinas de Fibra", description: "Modelo com prainha, dimensões fixas de fábrica." },
    { name: "Piscina Fibra Canyon 6x3", category: "Piscinas de Fibra", description: "Modelo tradicional." },
  ],
  forbiddenWords: ["barato", "concorrente x"],
  preferredWords: ["premium", "exclusivo"],
  activeRuleTitles: ["nunca dar desconto sem autorização"],
  detectedDomains: ["piscinas"],
});

describe("domain-validator — piscinas de fibra", () => {
  it("bloqueia pergunta 'largura ou profundidade'", () => {
    const out = baseOutput({
      clarification_questions: [
        "Prefere largura ou profundidade maior?",
        "Qual o espaço disponível no local?",
      ],
    });
    const r = validateAgainstDomain(out, rawPools());
    expect(r.passed).toBe(false);
    expect(r.blockedRules).toHaveLength(1);
    expect(r.blockedRules[0].reason).toMatch(/domain:piscinas/);
    expect(r.filteredOutput.clarification_questions).toHaveLength(1);
    expect(r.filteredOutput.clarification_questions[0]).toMatch(/espaço disponível/);
    expect(r.metadata.domains_detected).toContain("piscinas");
  });

  it("bloqueia pergunta 'qual a largura?'", () => {
    const out = baseOutput({ clarification_questions: ["Qual a largura desejada?"] });
    const r = validateAgainstDomain(out, rawPools());
    expect(r.passed).toBe(false);
    expect(r.recommendedQuestions.length).toBeGreaterThan(0);
    expect(r.filteredOutput.clarification_questions.length).toBeGreaterThan(0);
    expect(r.filteredOutput.warnings).toContain("domain_recommended_question_added");
  });

  it("bloqueia proposal do tipo mandatory_question que instrui perguntar largura", () => {
    const out = baseOutput({
      has_rule: true,
      proposals: [
        {
          title: "Perguntar largura antes do preço",
          category: "qualification",
          rule_type: "mandatory_question",
          scope_kind: "company",
          scope_ref: {},
          priority: 50,
          condition: null,
          instruction: "Antes de dar o preço, pergunte a largura preferida da piscina.",
          rationale: "Qualificar tamanho.",
          examples: [],
          confidence: 0.8,
          risk_level: "low",
          ambiguities: [],
          missing_information: [],
        },
      ],
    });
    const r = validateAgainstDomain(out, rawPools());
    expect(r.passed).toBe(false);
    expect(r.filteredOutput.proposals).toHaveLength(0);
    expect(r.metadata.blocked_rules[0].kind).toBe("proposal");
  });

  it("bloqueia pergunta com palavra proibida da KB", () => {
    const out = baseOutput({ clarification_questions: ["Quer a opção mais barato disponível?"] });
    const r = validateAgainstDomain(out, rawPools());
    expect(r.passed).toBe(false);
    expect(r.blockedRules[0].reason).toBe("kb:forbidden_word");
  });

  it("permite perguntas válidas do domínio", () => {
    const out = baseOutput({
      clarification_questions: [
        "Qual o espaço disponível no local?",
        "Tem interesse em aquecimento ou iluminação?",
      ],
    });
    const r = validateAgainstDomain(out, rawPools());
    expect(r.passed).toBe(true);
    expect(r.filteredOutput.clarification_questions).toHaveLength(2);
    expect(r.metadata.validation_reason).toBe("domain_validation_ok");
  });

  it("sem domínio detectado não bloqueia nada", () => {
    const out = baseOutput({ clarification_questions: ["Prefere largura ou profundidade?"] });
    const raw: CoachGroundingRaw = {
      products: [],
      forbiddenWords: [],
      preferredWords: [],
      activeRuleTitles: [],
      detectedDomains: [],
    };
    const r = validateAgainstDomain(out, raw);
    expect(r.passed).toBe(true);
    expect(r.filteredOutput.clarification_questions).toHaveLength(1);
  });
});

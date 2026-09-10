import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AgentContext } from "../sales-agent-core";
import { listLearningCandidates } from "../coach-learnings/coach-learnings.repository";
import { listActiveCoachRulesForGrounding } from "../coach-rules/coach-rules.repository";
import { listActiveQuickRepliesForGrounding } from "../quick-replies/quick-replies.repository";
import {
  resolveSalesAgentNormativeContext,
  resolvePersistedSalesAgentLearnings,
  type NormativeCorrection,
} from "../sales-agent-normative-resolver";

const correctionConflictKey = "qualification:measure";
const correction: NormativeCorrection = {
  question: "Como abordar a medida?",
  correction: "Pergunte a medida antes de sugerir.",
  conflictKey: correctionConflictKey,
};

const migrationSource = readFileSync(
  fileURLToPath(new URL("../../../supabase/migrations/20260909130000_persist_sales_learning_classification.sql", import.meta.url)),
  "utf8",
);

function learning(id: string, conflictKey?: string) {
  return {
    id,
    category: "qualification",
    title: id,
    description: "Orientação de teste",
    rule: "Regra de teste",
    productRef: null,
    positiveExample: null,
    negativeExample: null,
    priority: 50,
    confidence: 0.8,
    ...(conflictKey ? { conflictKey } : {}),
  };
}

function rule(ruleId: string, conflictKey?: string) {
  return {
    ruleId,
    versionId: `${ruleId}-version`,
    versionNumber: 1,
    category: "qualification" as const,
    ruleType: "mandatory_question" as const,
    title: ruleId,
    content: "Regra de teste",
    priority: 50,
    scopeKind: "company" as const,
    scopeRef: {},
    ...(conflictKey ? { conflictKey } : {}),
  };
}

function context(companyId = "company-a"): AgentContext {
  return {
    settings: { company_id: companyId } as AgentContext["settings"],
    companyName: "Empresa",
    aiProfile: null,
    products: [],
    knowledge: [],
    grounding: {
      catalog: [{ id: "pool-a", name: "Piscina A", category: null, description: null, price: 20000, promoPrice: null, images: [], notes: null }],
      faqKnowledge: [],
      commercialRules: {
        paymentMethods: "Pix",
        commercialTerms: "Sem desconto.",
        paymentPolicy: null,
        installationPolicy: "Avaliação técnica.",
        visitPolicy: null,
        heatingPolicy: null,
        shippingPolicy: "Confirmado pela equipe.",
        includedItemsPolicy: null,
      },
      approvedCoachLearnings: [],
      activeCoachRules: [],
      quickReplies: [],
    },
  };
}

describe("sales-agent normative resolver", () => {
  it("persiste classificação e proveniência no contrato real", () => {
    expect(migrationSource).toContain("ADD COLUMN IF NOT EXISTS domain text");
    expect(migrationSource).toContain("ADD COLUMN IF NOT EXISTS intent text");
    expect(migrationSource).toContain("ADD COLUMN IF NOT EXISTS conflict_key text");
    expect(migrationSource).toContain("source_training_message_id");
    expect(migrationSource).toContain("v_agent.correction_conflict_key");
    expect(migrationSource).toContain("coach_learnings_one_active_conflict_idx");
    expect(migrationSource).toContain("Supersedido por aprovação legada de treinamento.");
    expect(migrationSource).toContain("rule_structured || ' Resposta aprovada para este comportamento: '");
    expect(migrationSource).toContain("coach_learnings_source_training_company_fk");
    expect(migrationSource).toContain("coach_learnings_classification_consistent");
    expect(migrationSource).toContain("v_replaced_max_priority");
    expect(migrationSource).toContain("v_new_priority");
    expect(migrationSource).toMatch(/IF v_learning\.conflict_key IS NULL[\s\S]*?GREATEST\(90, v_replaced_max_priority \+ 1\)/);
    expect(migrationSource).toContain("priority = v_new_priority");
    expect(migrationSource).toContain("quick_replies_conflict_key_not_blank");
    expect(migrationSource).toContain("conflict_key = btrim(conflict_key)");
    expect(migrationSource).toContain("length(btrim(conflict_key)) BETWEEN 1 AND 240");
    expect(migrationSource).toContain("conrelid = 'public.quick_replies'::regclass");
    expect(migrationSource).toContain("conrelid = 'public.coach_learnings'::regclass");
    expect(migrationSource).toContain("conrelid = 'public.coach_rules'::regclass");
    expect(migrationSource).toContain("CREATE INDEX IF NOT EXISTS");
    expect(migrationSource).toContain("CREATE UNIQUE INDEX IF NOT EXISTS");
  });

  it("rejeita conflict_key vazia ou somente com espaços em quick_replies", () => {
    expect(migrationSource).toMatch(
      /quick_replies_conflict_key_not_blank[\s\S]*?conflict_key IS NULL OR \(length\(btrim\(conflict_key\)\) BETWEEN 1 AND 240 AND conflict_key = btrim\(conflict_key\)\)/,
    );
  });

  it("carrega classificação pelos repositories reais sem cruzar company_id", async () => {
    const learning = {
      id: "learning-a",
      company_id: "company-a",
      category: "qualification",
      product_ref: null,
      title: "Medida",
      description: "Perguntar medida",
      rule_structured: "Pergunte a medida.",
      positive_example: null,
      negative_example: null,
      priority: 90,
      status: "active",
      confidence: 0.9,
      usage_count: 0,
      last_used_at: null,
      times_retrieved: 0,
      last_retrieved_at: null,
      positive_feedback_count: 0,
      negative_feedback_count: 0,
      feedback_sample_count: 0,
      positive_feedback_weight: 0,
      negative_feedback_weight: 0,
      success_rate: 0.5,
      last_feedback_at: null,
      last_positive_feedback_at: null,
      last_negative_feedback_at: null,
      content_hash: "hash",
      taught_by: null,
      updated_by: null,
      source_conversation_id: null,
      source_training_message_id: "training-message-a",
      domain: "qualification",
      intent: "measure",
      conflict_key: correctionConflictKey,
      version: 1,
      created_at: "2026-09-09T00:00:00Z",
      updated_at: "2026-09-09T00:00:00Z",
      archived_at: null,
    };
    const query = (data: unknown) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => Promise.resolve({ data, error: null }),
      };
      return chain;
    };
    const candidates = await listLearningCandidates({ from: () => query([learning]) } as never, "company-a");
    expect(candidates[0]).toMatchObject({ company_id: "company-a", conflict_key: correctionConflictKey, domain: "qualification" });

    const rulesClient = {
      from: (table: string) => table === "coach_rules"
        ? {
            select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [{ id: "rule-a", active_version_id: "version-a", category: "qualification", priority: 90, company_id: "company-a", domain: "qualification", intent: "measure", conflict_key: correctionConflictKey }], error: null }) }) }) }) }),
          }
        : { select: () => ({ eq: () => ({ eq: () => ({ in: () => Promise.resolve({ data: [{ id: "version-a", rule_id: "rule-a", company_id: "company-a", version_number: 1, rule_type: "mandatory_question", category: "qualification", title: "Medida", content: "Pergunte a medida", priority: 90, scope_kind: "company", scope_ref: {}, status: "approved" }], error: null }) }) }) }) },
    };
    const rules = await listActiveCoachRulesForGrounding("company-a", 10, rulesClient as never);
    expect(rules[0]).toMatchObject({ companyId: "company-a", conflictKey: correctionConflictKey });

    const quickReplies = await listActiveQuickRepliesForGrounding("company-a", {
      from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [{ name: "Medida", category: "qualification", content: "Pergunte a medida", sort_order: 1, company_id: "company-a", conflict_key: correctionConflictKey }], error: null }) }) }) }) }) }),
    } as never);
    expect(quickReplies[0]).toMatchObject({ companyId: "company-a", conflictKey: correctionConflictKey });
  });
  it("faz correção vencer learning e rule conflitantes", () => {
    const input = context();
    input.grounding.approvedCoachLearnings = [learning("old-learning", correctionConflictKey)];
    input.grounding.activeCoachRules = [rule("old-rule", correctionConflictKey)];
    const resolved = resolveSalesAgentNormativeContext({ companyId: "company-a", context: input, sessionCorrections: [correction] });
    expect(resolved.grounding.approvedCoachLearnings).toHaveLength(0);
    expect(resolved.grounding.activeCoachRules).toHaveLength(0);
    expect(resolved.sessionCorrections).toEqual([correction]);
  });

  it("faz correção persistida vencer learning antigo antes do ranking", () => {
    const old = learning("old-learning", correctionConflictKey);
    const persisted = { ...learning("persisted-correction", correctionConflictKey), sourceTrainingMessageId: "training-a" };
    expect(resolvePersistedSalesAgentLearnings("company-a", [old, persisted]).map((item) => item.id)).toEqual([
      "persisted-correction",
    ]);
  });

  it("mantém itens não conflitantes", () => {
    const input = context();
    input.grounding.approvedCoachLearnings = [
      learning("conflict", correctionConflictKey),
      learning("other", "tone:consultive"),
    ];
    input.grounding.activeCoachRules = [rule("other-rule", "pricing:inform")];
    const resolved = resolveSalesAgentNormativeContext({ companyId: "company-a", context: input, sessionCorrections: [correction] });
    expect(resolved.grounding.approvedCoachLearnings.map((item) => item.id)).toEqual(["other"]);
    expect(resolved.grounding.activeCoachRules?.map((item) => item.ruleId)).toEqual(["other-rule"]);
  });

  it("não permite que quick reply reintroduza conflito removido", () => {
    const input = context();
    input.grounding.quickReplies = [{
      name: "Resposta antiga",
      category: "qualification",
      content: "Sugira imediatamente.",
      sort_order: 1,
      conflictKey: correctionConflictKey,
    }];
    const resolved = resolveSalesAgentNormativeContext({
      companyId: "company-a",
      context: input,
      sessionCorrections: [correction],
    });
    expect(resolved.grounding.quickReplies).toEqual([]);
  });

  it("não altera catálogo ou políticas", () => {
    const input = context();
    const resolved = resolveSalesAgentNormativeContext({ companyId: "company-a", context: input, sessionCorrections: [correction] });
    expect(resolved.grounding.catalog).toBe(input.grounding.catalog);
    expect(resolved.grounding.commercialRules).toBe(input.grounding.commercialRules);
  });

  it("exige company_id e isola empresas", () => {
    expect(() => resolveSalesAgentNormativeContext({ companyId: " ", context: context() })).toThrow("sales_agent_company_id_required");
    expect(() => resolveSalesAgentNormativeContext({ companyId: "company-b", context: context() })).toThrow("sales_agent_normative_company_scope_mismatch");
    const input = context();
    input.grounding.approvedCoachLearnings = [{ ...learning("foreign"), companyId: "company-b" }];
    expect(() => resolveSalesAgentNormativeContext({ companyId: "company-a", context: input })).toThrow("sales_agent_normative_company_scope_mismatch");
  });

  it("permite o mesmo vencedor em treino e produção", () => {
    const training = resolveSalesAgentNormativeContext({ companyId: "company-a", context: context(), sessionCorrections: [correction] });
    const production = resolveSalesAgentNormativeContext({ companyId: "company-a", context: context(), sessionCorrections: [correction] });
    expect(production.grounding.approvedCoachLearnings).toEqual(training.grounding.approvedCoachLearnings);
    expect(production.sessionCorrections).toEqual(training.sessionCorrections);
  });

  it("não supersede legacy sem classificação", () => {
    const input = context();
    input.grounding.approvedCoachLearnings = [learning("legacy-learning")];
    input.grounding.activeCoachRules = [rule("legacy-rule")];
    const resolved = resolveSalesAgentNormativeContext({ companyId: "company-a", context: input, sessionCorrections: [correction] });
    expect(resolved.grounding.approvedCoachLearnings.map((item) => item.id)).toEqual(["legacy-learning"]);
    expect(resolved.grounding.activeCoachRules?.map((item) => item.ruleId)).toEqual(["legacy-rule"]);
  });
});

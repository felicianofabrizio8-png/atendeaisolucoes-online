import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractSessionTrainingCorrections,
  getTrainingLearningDiagnostics,
  normalizeTrainingReview,
} from "../sales-training-domain";

const functionsSource = readFileSync(
  fileURLToPath(new URL("../sales-training.functions.ts", import.meta.url)),
  "utf8",
);
const trainingChatSource = readFileSync(
  fileURLToPath(new URL("../../components/ai/SalesTrainingChat.tsx", import.meta.url)),
  "utf8",
);
const migrationSource = readFileSync(
  fileURLToPath(
    new URL(
      "../../../supabase/migrations/20260822002000_create_sales_agent_training.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const promotionMigrationSource = readFileSync(
  fileURLToPath(
    new URL(
      "../../../supabase/migrations/20260822003000_promote_sales_training_corrections.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const replacementMigrationSource = readFileSync(
  fileURLToPath(
    new URL(
      "../../../supabase/migrations/20260824010000_replace_training_learnings_on_approval.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("Sales training contract", () => {
  it("isola sessões e mensagens por empresa com RLS", () => {
    expect(migrationSource).toContain("ai_training_sessions");
    expect(migrationSource).toContain("ai_training_messages");
    expect(migrationSource).toMatch(/company_id = public\.current_company_id\(\)/g);
    expect(functionsSource).toContain('.eq("company_id", companyId)');
    expect(functionsSource).toContain("admin_required");
  });

  it("usa o agente e grounding atuais sem envio ou mutação do atendimento real", () => {
    expect(functionsSource).toContain("loadAgentContext(companyId)");
    expect(functionsSource).toContain("runAgentTurn({ ctx, history");
    expect(functionsSource).toContain("runSafetyLayer");
    expect(functionsSource).not.toMatch(/sendWhatsappText|postGraph|meta-send|meta-webhook/);
    expect(functionsSource).not.toMatch(/\.from\("(?:leads|conversations|messages)"/);
  });

  it("simula imagens selecionadas sem executar envio externo", () => {
    expect(functionsSource).toContain("loadValidatedProductImages(");
    expect(functionsSource).toContain("simulated_product_images");
    expect(functionsSource).not.toContain("sendWhatsappProductImages");
  });

  it("resume os aprendizados usados somente a partir da decision existente", () => {
    expect(getTrainingLearningDiagnostics(["learning-1", "learning-2"])).toEqual({
      learningIds: ["learning-1", "learning-2"],
      count: 2,
    });
    expect(getTrainingLearningDiagnostics(undefined)).toEqual({ learningIds: [], count: 0 });
    expect(trainingChatSource).toContain("item.decision?.learning_ids_used");
    expect(trainingChatSource).toContain("learning_ids_used:");
    expect(trainingChatSource).toContain("Aprendizados usados:");
  });

  it("persiste somente histórico e avaliações de treinamento", () => {
    const writtenTables = [...functionsSource.matchAll(/\.from\("([^"]+)" as never\)/g)].map(
      (match) => match[1],
    );
    expect(new Set(writtenTables)).toEqual(
      new Set(["ai_training_sessions", "ai_training_messages"]),
    );
    expect(functionsSource).toContain('z.enum(["approved", "rejected", "corrected"])');
    expect(functionsSource).not.toContain("coach_learnings");
  });

  it.each(["approved", "rejected"] as const)("aceita avaliação %s sem correção", (status) => {
    expect(normalizeTrainingReview({ status, correctionText: "ignorada" })).toEqual({
      status,
      correctionText: null,
    });
  });

  it("exige e preserva o texto da correção", () => {
    expect(
      normalizeTrainingReview({ status: "corrected", correctionText: "  Resposta correta  " }),
    ).toEqual({ status: "corrected", correctionText: "Resposta correta" });
    expect(() => normalizeTrainingReview({ status: "corrected", correctionText: " " })).toThrow(
      "correction_required",
    );
  });

  it("mantém a correção salva isolada no histórico da sessão", () => {
    expect(
      extractSessionTrainingCorrections([
        { role: "lead", content: "Como devo começar o atendimento?" },
        {
          role: "agent",
          content: "Resposta errada",
          review_status: "corrected",
          correction_text: "Comece entendendo a necessidade do cliente.",
        },
      ]),
    ).toEqual([
      {
        question: "Como devo começar o atendimento?",
        correction: "Comece entendendo a necessidade do cliente.",
      },
    ]);
    expect(functionsSource).toContain("extractSessionTrainingCorrections(sessionMessages)");
    expect(functionsSource).toContain("sessionCorrections })");
  });

  it("promove correção em duas etapas e só ativa após aprovação explícita", () => {
    expect(promotionMigrationSource).toContain("create_training_learning_candidate");
    expect(promotionMigrationSource).toContain("approve_training_learning_candidate");
    expect(promotionMigrationSource).toContain("v_lead.content");
    expect(promotionMigrationSource).toMatch(/version,[\s\S]+status[\s\S]+1,[\s\S]+'paused'/);
    expect(promotionMigrationSource).toMatch(/SET status = 'active'/);
    expect(functionsSource).toContain("createTrainingLearningCandidate");
    expect(functionsSource).toContain("approveTrainingLearningCandidate");
  });

  it("aprova o novo learning e pausa somente os IDs usados na resposta corrigida", () => {
    expect(replacementMigrationSource).toContain("v_agent.decision -> 'learning_ids_used'");
    expect(replacementMigrationSource).toContain("l.id = ANY(v_replaced_ids)");
    expect(replacementMigrationSource).toContain("l.company_id = v_company");
    expect(replacementMigrationSource).toContain("l.status = 'active'");
    expect(replacementMigrationSource).toContain("SET status = 'paused'");
    expect(replacementMigrationSource).toContain("SET status = 'active'");
    expect(replacementMigrationSource).toContain("'replaces_learning_ids'");
  });

  it("eleva a prioridade da correção aprovada para o retrieval", () => {
    expect(replacementMigrationSource).toContain("v_replaced_max_priority + 1");
    expect(replacementMigrationSource).toContain("GREATEST(90");
    expect(replacementMigrationSource).toContain("priority = v_new_priority");
  });

  it("preserva a correção no campo de regra efetivamente usado pelo grounding", () => {
    expect(replacementMigrationSource).toContain("rule_structured = left(");
    expect(replacementMigrationSource).toContain("btrim(v_agent.correction_text)");
    expect(replacementMigrationSource).toContain("RETURNING * INTO v_learning");
  });

  it("isola promoção por empresa e exige administrador", () => {
    expect(promotionMigrationSource).toContain("public.current_company_id()");
    expect(promotionMigrationSource).toMatch(/public\.has_role\(\s*auth\.uid\(\),\s*v_company/);
    expect(promotionMigrationSource).toMatch(/company_id = v_company/g);
  });

  it("não adiciona ferramentas ou ações comerciais", () => {
    expect(functionsSource).not.toMatch(/tools\s*:|respond_to_customer|request_human_handoff/);
    expect(functionsSource).not.toMatch(/discount|desconto|checkout|quote|orçamento/iu);
  });

  it("marca a mensagem como pendente, concluída ou falha sem expor o erro", () => {
    expect(migrationSource).toContain("generation_status IN ('pending', 'completed', 'failed')");
    expect(functionsSource).toContain('generation_status: "pending"');
    expect(functionsSource).toContain('generation_status: "completed"');
    expect(functionsSource).toContain('generation_status: "failed"');
    expect(functionsSource).toContain('generation_error: "generation_failed"');
    expect(functionsSource).not.toContain("error.message");
  });
});

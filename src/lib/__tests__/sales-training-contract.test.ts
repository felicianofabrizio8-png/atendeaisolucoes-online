import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeTrainingReview } from "../sales-training-domain";

const functionsSource = readFileSync(
  fileURLToPath(new URL("../sales-training.functions.ts", import.meta.url)),
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

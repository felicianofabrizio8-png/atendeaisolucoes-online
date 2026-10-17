// src/lib/goals/__tests__/ai.test.ts
import { describe, expect, it, vi } from "vitest";
import { analyzeGoals, parseGoalsAnalysis, type GoalsContext } from "../ai.server";

const ctx: GoalsContext = {
  today: "2026-10-16",
  goals: [
    {
      id: "g1",
      name: "Orçamentos",
      indicator: "Orçamentos enviados",
      target: "40",
      value: "12",
      expected: "20,6",
      status: "Atrasada",
      weeks: [],
      people: [],
    },
  ],
  stages: [{ id: "s1", name: "Em execução" }],
  members: [{ id: "u1", name: "Ana" }],
};

describe("validação da análise da IA", () => {
  it("aceita a análise e mantém só ações válidas", () => {
    const out = parseGoalsAnalysis(
      {
        resumo: "Orçamentos abaixo do ritmo.",
        atencao: [
          { goalId: "g1", body: "12 de 20,6 esperados." },
          { goalId: "nao-existe", body: "x" },
        ],
        sugestoes: [
          { goalId: "g1", body: "Reduzir para 32.", action: { type: "ajustar_alvo", target: 32 } },
          { goalId: "g1", body: "Mover.", action: { type: "mover_etapa", stageId: "s-invalida" } },
          { goalId: "g1", body: "Foco em follow-up.", action: { type: "foco_semana" } },
        ],
        dicas: [
          { userId: "u1", body: "6 conversas paradas pedem orçamento." },
          { userId: "x", body: "y" },
        ],
      },
      ctx,
    );
    expect(out.atencao).toHaveLength(1);
    expect(out.sugestoes).toEqual([
      {
        goalId: "g1",
        body: "Reduzir para 32.",
        action: { type: "ajustar_alvo", goalId: "g1", target: 32 },
      },
      { goalId: "g1", body: "Foco em follow-up.", action: null },
    ]);
    expect(out.dicas).toEqual([{ userId: "u1", body: "6 conversas paradas pedem orçamento." }]);
  });
  it("lixo vira análise vazia, sem quebrar", () => {
    expect(parseGoalsAnalysis("não é json", ctx)).toEqual({
      resumo: "",
      atencao: [],
      sugestoes: [],
      dicas: [],
    });
  });
});

describe("chamada ao modelo", () => {
  it("manda o contexto e lê o JSON da resposta", async () => {
    process.env.LUME_AI_ENDPOINT = "https://llm.test/v1/chat/completions";
    process.env.LUME_AI_MODEL = "m";
    process.env.LUME_AI_API_KEY = "k";
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ resumo: "Ok.", atencao: [], sugestoes: [], dicas: [] }),
              },
            },
          ],
        }),
      ),
    );
    const out = await analyzeGoals(ctx, fetchImpl as unknown as typeof fetch);
    expect(out.resumo).toBe("Ok.");
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[1].content).toContain("Orçamentos enviados");
  });
});

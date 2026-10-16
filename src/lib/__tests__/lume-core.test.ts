import { beforeEach, describe, expect, it, vi } from "vitest";
import { lumeReadiness, resolveLumeLlmConfig, resolveLumeTranscribeConfig } from "@/lib/lume/config.server";
import { formatLocal, parseLocal } from "@/lib/lume/time";
import { runLumeTurn } from "@/lib/lume/agent.server";
import type { LumeContext, LumeDomain } from "@/lib/lume/types";

describe("configuração da Lume", () => {
  it("usa a chave própria e cai na da Vendedora sem ela", () => {
    expect(
      resolveLumeLlmConfig({
        LUME_AI_ENDPOINT: "https://lume.test/v1/chat",
        LUME_AI_MODEL: "m1",
        LUME_AI_API_KEY: "k1",
        SALES_AGENT_LLM_ENDPOINT: "https://v.test",
        SALES_AGENT_LLM_MODEL: "m2",
        SALES_AGENT_LLM_API_KEY: "k2",
      })?.origin,
    ).toBe("lume");
    expect(
      resolveLumeLlmConfig({
        SALES_AGENT_LLM_ENDPOINT: "https://v.test",
        SALES_AGENT_LLM_MODEL: "m2",
        SALES_AGENT_LLM_API_KEY: "k2",
      })?.origin,
    ).toBe("vendedora");
    expect(resolveLumeLlmConfig({ LUME_AI_ENDPOINT: "http://inseguro", LUME_AI_MODEL: "m", LUME_AI_API_KEY: "k" })).toBeNull();
  });

  it("áudio usa chave própria ou a da OpenAI; status não expõe segredos", () => {
    expect(resolveLumeTranscribeConfig({ OPENAI_API_KEY: "sk" })?.model).toBe("whisper-1");
    expect(resolveLumeTranscribeConfig({})).toBeNull();
    const status = lumeReadiness({ OPENAI_API_KEY: "sk" });
    expect(status).toEqual({ chat: false, origin: null, voice: true });
    expect(JSON.stringify(status)).not.toContain("sk");
  });
});

describe("horário local", () => {
  it("converte hora de São Paulo para UTC e de volta", () => {
    const at = parseLocal("2026-10-16T14:00", "America/Sao_Paulo");
    expect(at?.toISOString()).toBe("2026-10-16T17:00:00.000Z");
    expect(formatLocal(at!, "America/Sao_Paulo")).toBe("2026-10-16T14:00");
    expect(parseLocal("16/10 às 14h", "America/Sao_Paulo")).toBeNull();
    expect(parseLocal("2026-13-01T10:00", "America/Sao_Paulo")).toBeNull();
  });
});

describe("núcleo da Lume", () => {
  const executed: string[] = [];
  const domain: LumeDomain = {
    id: "teste",
    instructions: () => "DOMÍNIO DE TESTE",
    undo: async () => {},
    tools: [
      {
        name: "ler",
        domain: "teste",
        description: "lê",
        parameters: { type: "object", properties: {} },
        risk: "read",
        summarize: () => "Ler",
        execute: async () => {
          executed.push("ler");
          return { output: { itens: 1 } };
        },
      },
      {
        name: "criar",
        domain: "teste",
        description: "cria",
        parameters: { type: "object", properties: {} },
        risk: "safe",
        summarize: () => "Criar algo",
        execute: async () => {
          executed.push("criar");
          return { output: { ok: true }, undo: { op: "delete_events", ids: ["e1"] }, touched: ["e1"] };
        },
      },
      {
        name: "excluir",
        domain: "teste",
        description: "exclui",
        parameters: { type: "object", properties: {} },
        risk: "confirm",
        summarize: () => "Excluir algo",
        execute: async () => {
          executed.push("excluir");
          return { output: { ok: true } };
        },
      },
    ] as never,
  };
  const ctx = {
    client: {} as never,
    companyId: "c1",
    userId: "u1",
    userName: "Ana",
    timeZone: "America/Sao_Paulo",
    now: new Date("2026-10-15T15:00:00Z"),
    extended: true,
  } satisfies LumeContext;

  function modelReplies(...messages: unknown[]) {
    const fetchMock = vi.fn();
    for (const message of messages)
      fetchMock.mockResolvedValueOnce(Response.json({ choices: [{ message }] }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  const call = (name: string) => ({
    id: `call-${name}`,
    type: "function",
    function: { name, arguments: "{}" },
  });

  beforeEach(() => {
    executed.length = 0;
    vi.stubEnv("LUME_AI_ENDPOINT", "https://lume.test/v1/chat");
    vi.stubEnv("LUME_AI_MODEL", "m1");
    vi.stubEnv("LUME_AI_API_KEY", "k1");
  });

  it("lê e cria na hora, com desfazer; exclusão vira cartão sem executar", async () => {
    const fetchMock = modelReplies(
      { content: null, tool_calls: [call("ler"), call("criar"), call("excluir")] },
      { content: "Criei e deixei a exclusão para você confirmar." },
    );
    const result = await runLumeTurn({ ctx, domains: [domain], message: "faça", history: [] });
    expect(executed).toEqual(["ler", "criar"]);
    expect(result.reply).toContain("confirmar");
    expect(result.actions.map((a) => [a.tool, a.status])).toEqual([
      ["criar", "executada"],
      ["excluir", "pendente"],
    ]);
    expect(result.actions[0].undo).toEqual({ op: "delete_events", ids: ["e1"] });
    const firstRequest = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(firstRequest.messages[0].content).toContain("DOMÍNIO DE TESTE");
    expect(firstRequest.messages[0].content).toContain("2026-10-15T12:00");
    expect(firstRequest.tools.map((t: { function: { name: string } }) => t.function.name)).toEqual([
      "ler",
      "criar",
      "excluir",
    ]);
  });

  it("sem chave configurada, avisa em vez de inventar resposta", async () => {
    vi.stubEnv("LUME_AI_API_KEY", "");
    vi.stubEnv("SALES_AGENT_LLM_API_KEY", "");
    await expect(runLumeTurn({ ctx, domains: [domain], message: "oi", history: [] })).rejects.toThrow(
      /chave/,
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  buildResumePrompt,
  fallbackResumePhrase,
  GENERIC_RESUME_PHRASE,
  hasResumeContext,
  normalizeResumePhrase,
  RESUME_PHRASE_MAX,
  type ResumeContext,
} from "../resume-phrase";

function ctx(over: Partial<ResumeContext> = {}): ResumeContext {
  return {
    leadName: "Mariana Souza",
    product: null,
    quote: null,
    objection: null,
    intent: null,
    interest: null,
    timing: null,
    readyToClose: false,
    recentMessages: [],
    ...over,
  };
}

describe("normalizeResumePhrase", () => {
  it("aceita uma frase contextual curta", () => {
    expect(normalizeResumePhrase("Conseguiu ver o orçamento do ar split 12.000 BTUs?", ctx())).toBe(
      "Conseguiu ver o orçamento do ar split 12.000 BTUs?",
    );
  });

  it("recusa o nome do cliente, com ou sem acento e em qualquer caixa", () => {
    expect(normalizeResumePhrase("Mariana, ainda quer o orçamento?", ctx())).toBeNull();
    expect(normalizeResumePhrase("E aí SOUZA, vamos fechar?", ctx())).toBeNull();
    expect(
      normalizeResumePhrase("Ainda quer seguir, Jose?", ctx({ leadName: "José Antônio" })),
    ).toBeNull();
  });

  it("nunca devolve quebra de linha, tab ou espaços repetidos (a Meta rejeita)", () => {
    const out = normalizeResumePhrase(
      "  \n Podemos \t retomar    o pedido do sofá?\nObrigado",
      ctx(),
    );
    expect(out).toBe("Podemos retomar o pedido do sofá?");
  });

  it("tira aspas, rótulo e JSON em volta", () => {
    expect(normalizeResumePhrase('"Ficou alguma dúvida sobre a entrega?"', ctx())).toBe(
      "Ficou alguma dúvida sobre a entrega?",
    );
    expect(normalizeResumePhrase("Frase: Vamos seguir com a instalação?", ctx())).toBe(
      "Vamos seguir com a instalação?",
    );
    expect(normalizeResumePhrase('{"frase": "Posso confirmar o modelo?"}', ctx())).toBe(
      "Posso confirmar o modelo?",
    );
  });

  it("aceita um trecho longo, gerado do histórico, que continua o template", () => {
    const phrase =
      "estou passando para retomar nossa conversa sobre a piscina que você estava analisando. Vi que falamos sobre o modelo Sol 401 e queria saber se ainda posso te ajudar com esse projeto";
    expect(normalizeResumePhrase(phrase, ctx())).toBe(phrase);
  });

  it("recusa valores em dinheiro, placeholders, vazio e texto longo", () => {
    expect(normalizeResumePhrase("O orçamento de R$ 1.200 ainda vale?", ctx())).toBeNull();
    expect(normalizeResumePhrase("O valor de 1.299,90 ainda te atende?", ctx())).toBeNull();
    expect(normalizeResumePhrase("Olá {{1}}", ctx())).toBeNull();
    expect(normalizeResumePhrase("   ", ctx())).toBeNull();
    expect(normalizeResumePhrase("a".repeat(RESUME_PHRASE_MAX + 1), ctx())).toBeNull();
  });
});

describe("fallbackResumePhrase", () => {
  it("prioriza o orçamento enviado", () => {
    const out = fallbackResumePhrase(
      ctx({ quote: { productName: "Piscina 8x4" }, product: "Piscina" }),
    );
    expect(out).toEqual({
      text: "estou passando para retomar nossa conversa sobre o orçamento de Piscina 8x4 e saber se ficou alguma dúvida",
      source: "context",
    });
  });

  it("usa objeção e produto quando não há orçamento", () => {
    const out = fallbackResumePhrase(ctx({ objection: "Preço", product: "ar split 9000" }));
    expect(out.text).toBe(
      "estou passando para retomar nossa conversa sobre ar split 9000 e ver se consigo ajudar com a questão de preço",
    );
    expect(out.source).toBe("context");
  });

  it("usa o produto de interesse", () => {
    expect(fallbackResumePhrase(ctx({ interest: "cortina blackout" })).text).toBe(
      "estou passando para retomar nossa conversa sobre cortina blackout e saber se ainda posso te ajudar",
    );
  });

  it("sem contexto cai na frase genérica, e nunca com o nome", () => {
    const out = fallbackResumePhrase(ctx());
    expect(out).toEqual({ text: GENERIC_RESUME_PHRASE, source: "generic" });
    expect(out.text).not.toMatch(/mariana/i);
  });

  it("descarta candidato que carregaria o nome do cliente", () => {
    const out = fallbackResumePhrase(ctx({ leadName: "Kit Casa", product: "Kit Casa Solar" }));
    expect(out.source).toBe("generic");
  });
});

describe("hasResumeContext / buildResumePrompt", () => {
  it("sem fatos nem mensagens não há contexto", () => {
    expect(hasResumeContext(ctx())).toBe(false);
    expect(
      hasResumeContext(ctx({ recentMessages: [{ role: "lead", text: "quero orçamento" }] })),
    ).toBe(true);
  });

  it("o prompt leva o corpo do template e os fatos, mas nunca o nome", () => {
    const [system, user] = buildResumePrompt(
      ctx({
        product: "ar split 12000",
        objection: "prazo de entrega",
        recentMessages: [
          { role: "lead", text: "Qual o prazo?" },
          { role: "agent", text: "Até 5 dias úteis." },
        ],
      }),
      "Oi! {{1}} Posso te ajudar a seguir?",
    );
    expect(system.content).toContain("Oi! {{1}} Posso te ajudar a seguir?");
    expect(system.content).toMatch(/NÃO use o nome do cliente/);
    expect(user.content).toContain("ar split 12000");
    expect(user.content).toContain("Cliente: Qual o prazo?");
    expect(`${system.content}\n${user.content}`).not.toMatch(/Mariana|Souza/);
  });
});

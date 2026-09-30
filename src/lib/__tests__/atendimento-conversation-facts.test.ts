import { describe, expect, it } from "vitest";
import type { Conversation, Lead, Message } from "@/data/mock";
import { extractConversationFacts } from "@/lib/atendimento/conversation-facts";

const lead = (over: Partial<Lead> = {}): Lead => ({
  id: "lead-1",
  name: "Mariana Souza",
  phone: "5511999990000",
  channel: "whatsapp",
  status: "morno",
  tags: [],
  createdAt: "2026-09-01T10:00:00Z",
  ...over,
});

const conversation = (over: Partial<Conversation> = {}): Conversation => ({
  id: "conv-1",
  leadId: "lead-1",
  channel: "whatsapp",
  lastMessageAt: "2026-09-20T12:00:00Z",
  unread: 0,
  awaitingReply: false,
  slaBreached: false,
  detectedIntent: "informação",
  ...over,
});

let seq = 0;
const msg = (
  role: Message["role"],
  text: string,
  minute: number,
  over: Partial<Message> = {},
): Message => ({
  id: `m-${++seq}`,
  conversationId: "conv-1",
  role,
  text,
  at: new Date(Date.UTC(2026, 8, 20, 10, minute)).toISOString(),
  ...over,
});

const facts = (messages: Message[], l = lead(), c = conversation(), extra = {}) =>
  extractConversationFacts({ lead: l, conversation: c, messages, ...extra });

describe("painel Informações — fatos da conversa", () => {
  it("extrai os dados comerciais de uma conversa humana (sem detected_*)", () => {
    const f = facts([
      msg("lead", "Oi! Moro em Campinas/SP e tenho interesse em uma piscina de fibra", 1),
      msg("agent", "O modelo Sol 401 (8x4) fica R$ 25.900,00 à vista ou 10x de R$ 2.790,00", 2),
      msg("lead", "Consigo no cartão em 12x? Queria instalar até dezembro.", 3),
    ]);
    expect(f.location).toMatchObject({ value: "Campinas/SP", source: "conversa" });
    expect(f.location?.evidence).toContain("Moro em Campinas/SP");
    expect(f.interest).toMatchObject({ value: "Piscina de fibra", source: "conversa" });
    expect(f.model).toMatchObject({ value: "Sol 401", source: "conversa" });
    expect(f.presentedValue).toMatchObject({ value: "R$ 25.900,00", source: "conversa" });
    expect(f.payment?.value).toBe("Cartão · Parcelado em 12x");
    expect(f.timing?.value).toBe("Até dezembro");
    expect(f.summary).toContain("Interesse em Piscina de fibra (Sol 401), de Campinas/SP.");
    expect(f.summary).toContain("Valor apresentado: R$ 25.900,00.");
    expect(f.summary).not.toMatch(/^informa/i);
    expect(f.nextAction).toMatchObject({ value: "Responder o cliente", source: "sugerida" });
  });

  it("cadastro tem prioridade; rótulo genérico nunca vira resumo", () => {
    const f = facts(
      [msg("lead", "moro em sorocaba", 1)],
      lead({ product: "Piscina Aurora", estimatedValue: 18000 }),
      conversation({
        detectedCity: "campinas",
        detectedState: "sp",
        detectedPoolSize: "8x4",
        purchaseTiming: "30d",
      }),
    );
    expect(f.location).toEqual({ value: "Campinas/SP", source: "registro" });
    expect(f.interest).toEqual({ value: "Piscina Aurora", source: "registro" });
    expect(f.model).toEqual({ value: "8x4", source: "registro" });
    // Nenhum preço apresentado na conversa: o valor estimado do cadastro, marcado.
    expect(f.presentedValue).toEqual({ value: "R$ 18.000,00 (estimado)", source: "registro" });
    expect(f.timing).toEqual({ value: "Em até 30 dias", source: "registro" });
  });

  it("sem mensagens nem cadastro: tudo vazio, nada inventado", () => {
    const f = facts([]);
    expect(f).toMatchObject({
      location: null,
      interest: null,
      model: null,
      presentedValue: null,
      payment: null,
      timing: null,
      summary: null,
      nextAction: null,
    });
  });

  it("não confunde frases comuns com cidade, valor com interesse, parcela com medida", () => {
    const f = facts([
      msg("lead", "Estou em dúvida ainda", 1),
      msg("lead", "Sou de confiança, pode mandar. Aqui em casa todos gostaram", 2),
      msg("lead", "Queria um orçamento de R$ 5.000", 3),
      msg("agent", "Fazemos em 10x de R$ 250", 4),
    ]);
    expect(f.location).toBeNull();
    expect(f.interest).toBeNull();
    expect(f.model).toBeNull();
    // o maior valor da mensagem é o total apresentado (aqui só há a parcela)
    expect(f.presentedValue?.value).toBe("R$ 250,00");
    expect(f.payment?.value).toBe("Oferecido: Parcelado em 10x");
  });

  it("cidade em minúsculas é normalizada e cortada no fim do nome", () => {
    expect(facts([msg("lead", "moro em são josé dos campos mesmo", 1)]).location?.value).toBe(
      "São José dos Campos",
    );
    expect(facts([msg("lead", "Sou de Ribeirão Preto - SP", 1)]).location?.value).toBe(
      "Ribeirão Preto/SP",
    );
  });

  it("catálogo da empresa identifica produto e modelo citados", () => {
    const f = facts(
      [msg("agent", "Separei a AUR-800 para você, já com instalação", 1)],
      lead(),
      conversation(),
      {
        catalog: [
          { name: "Piscina Aurora", model: "AUR-800" },
          { name: "Spa Brisa", model: null },
        ],
      },
    );
    expect(f.interest).toMatchObject({ value: "Piscina Aurora", source: "conversa" });
    expect(f.model).toMatchObject({ value: "AUR-800", source: "conversa" });
  });

  it("medidas e BTUs", () => {
    expect(facts([msg("lead", "o espaço é de 8 x 4 m", 1)]).model?.value).toBe("8 x 4 m");
    expect(facts([msg("lead", "quero um ar de 12.000 btus", 1)]).model?.value).toBe("12.000 BTUs");
  });

  it("forma de pagamento dita pelo cliente vale mais que a oferecida", () => {
    const f = facts([
      msg("agent", "Aceitamos Pix, boleto e cartão de crédito", 1),
      msg("lead", "Prefiro pagar no pix à vista", 2),
    ]);
    expect(f.payment?.value).toBe("Pix · À vista");
  });

  it("próxima ação: registrada, follow-up, proposta aguardando retorno", () => {
    const registered = facts(
      [msg("lead", "ok", 1)],
      lead({ nextAction: { label: "Ligar", dueAt: "2026-09-22T13:00:00Z" } }),
    );
    expect(registered.nextAction?.source).toBe("registro");
    expect(registered.nextAction?.value).toMatch(/^Ligar · /);

    const proposal = facts([msg("lead", "pode mandar", 1), msg("agent", "Fica R$ 9.800,00", 2)]);
    expect(proposal.nextAction).toEqual({
      value: "Aguardar retorno sobre a proposta de R$ 9.800,00",
      source: "sugerida",
    });

    const withFollowup = facts(
      [msg("agent", "Qualquer dúvida estou aqui", 1)],
      lead(),
      conversation(),
      {
        followupNextAt: "2026-09-25T12:00:00Z",
      },
    );
    expect(withFollowup.nextAction?.value).toMatch(/^Follow-up · /);

    const question = facts([msg("lead", "Tem entrega em Jundiaí?", 1)]);
    expect(question.nextAction?.value).toBe("Responder o cliente — “Tem entrega em Jundiaí?”");

    expect(
      facts([msg("agent", "Fica R$ 9.800,00", 1)], lead({ status: "perdido" })).nextAction,
    ).toBeNull();
  });

  it("ignora mensagens apagadas e usa a menção mais recente", () => {
    const f = facts([
      msg("agent", "Fica R$ 30.000,00", 1),
      msg("agent", "Com desconto fica R$ 27.500,00", 2),
      msg("agent", "Errei: R$ 1,00", 3, { deletedAt: "2026-09-20T10:04:00Z" }),
    ]);
    expect(f.presentedValue?.value).toBe("R$ 27.500,00");
  });
});

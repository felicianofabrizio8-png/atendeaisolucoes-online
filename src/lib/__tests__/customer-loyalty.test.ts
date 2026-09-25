import { describe, expect, it } from "vitest";
import {
  classifyCustomer,
  describeHistory,
  relationshipAge,
  type CustomerHistory,
} from "@/lib/customer-loyalty";

const NOW = new Date("2026-09-17T12:00:00.000Z").getTime();
const DAY = 86_400_000;

function history(patch: Partial<CustomerHistory>): CustomerHistory {
  return {
    firstContactAt: new Date(NOW - DAY).toISOString(),
    totalConversations: 1,
    closedDeals: 0,
    ...patch,
  };
}

describe("classifyCustomer", () => {
  it("marca como novo quem está na primeira entrada e nunca comprou", () => {
    const info = classifyCustomer(history({}), NOW);
    expect(info.tier).toBe("novo");
    expect(info.label).toBe("Novo");
  });

  it("marca como recorrente quem voltou mas nunca fechou", () => {
    const info = classifyCustomer(history({ totalConversations: 3 }), NOW);
    expect(info.tier).toBe("recorrente");
    expect(info.reason).toContain("3ª vez");
  });

  it("marca como cliente quem tem exatamente uma compra e pouca recorrência", () => {
    const info = classifyCustomer(
      history({ totalConversations: 2, closedDeals: 1 }),
      NOW,
    );
    expect(info.tier).toBe("cliente");
  });

  it("promove a fiel quem comprou e continua voltando", () => {
    const info = classifyCustomer(
      history({ totalConversations: 4, closedDeals: 1 }),
      NOW,
    );
    expect(info.tier).toBe("fiel");
  });

  it("promove a fiel quem comprou mais de uma vez", () => {
    const info = classifyCustomer(
      history({ totalConversations: 2, closedDeals: 3 }),
      NOW,
    );
    expect(info.tier).toBe("fiel");
    expect(info.reason).toContain("3 compras");
  });

  it("nunca deixa totalConversations zerado quebrar a classificação", () => {
    const info = classifyCustomer(history({ totalConversations: 0 }), NOW);
    expect(info.tier).toBe("novo");
  });
});

describe("relationshipAge", () => {
  it("formata dias, meses e anos", () => {
    expect(relationshipAge(history({ firstContactAt: new Date(NOW).toISOString() }), NOW)).toBe("hoje");
    expect(relationshipAge(history({ firstContactAt: new Date(NOW - DAY).toISOString() }), NOW)).toBe("há 1 dia");
    expect(relationshipAge(history({ firstContactAt: new Date(NOW - 10 * DAY).toISOString() }), NOW)).toBe("há 10 dias");
    expect(relationshipAge(history({ firstContactAt: new Date(NOW - 90 * DAY).toISOString() }), NOW)).toBe("há 3 meses");
    expect(relationshipAge(history({ firstContactAt: new Date(NOW - 800 * DAY).toISOString() }), NOW)).toBe("há 2 anos");
  });

  it("não devolve idade negativa para datas no futuro", () => {
    expect(relationshipAge(history({ firstContactAt: new Date(NOW + 5 * DAY).toISOString() }), NOW)).toBe("hoje");
  });
});

describe("describeHistory", () => {
  it("monta a linha de resumo com vendas e valor gasto", () => {
    const line = describeHistory(
      history({ totalConversations: 4, closedDeals: 2, totalSpent: 18400 }),
      NOW,
    );
    expect(line).toContain("4 conversas");
    expect(line).toContain("2 vendas");
    expect(line).toContain("primeiro contato");
  });

  it("omite vendas quando o cliente nunca fechou", () => {
    const line = describeHistory(history({ totalConversations: 1 }), NOW);
    expect(line).toContain("1 conversa");
    expect(line).not.toContain("venda");
  });
});

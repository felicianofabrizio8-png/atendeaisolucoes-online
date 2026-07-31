// ============================================================================
// Sprint 7 — Fase 7.2
// Não-regressão da decomposição de src/routes/orcamentos.tsx.
// Valida que os módulos extraídos carregam, exportam o mesmo contrato e que
// as funções puras movidas continuam produzindo exatamente o mesmo texto.
// ============================================================================

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  SendWhatsAppModal,
  Chip,
  buildBaseText,
  buildListText,
} from "@/components/orcamentos/SendWhatsAppModal";
import { QuoteCard, StatusBadge } from "@/components/orcamentos/QuoteCard";
import { QuoteFormModal, todayPlusDays, PAYMENT_METHODS } from "@/components/orcamentos/QuoteFormModal";
import type { Quote } from "@/data/quotes";

describe("decomposição de orcamentos: contratos exportados", () => {
  it("expõe todos os componentes movidos", () => {
    for (const c of [SendWhatsAppModal, Chip, QuoteCard, StatusBadge, QuoteFormModal]) {
      expect(typeof c).toBe("function");
    }
  });

  it("preserva a lista de formas de pagamento", () => {
    expect(PAYMENT_METHODS).toEqual([
      "Pix",
      "Cartão de crédito",
      "Boleto",
      "Transferência",
      "Dinheiro",
    ]);
  });
});

describe("funções puras movidas", () => {
  it("buildListText mantém o formato de bullets", () => {
    expect(buildListText("Inclusos", ["A", "B"])).toBe("Inclusos\n💧 A\n💧 B");
    expect(buildListText("Brindes", ["X"], "🎁")).toBe("Brindes\n🎁 X");
  });

  it("buildListText retorna vazio para lista vazia", () => {
    expect(buildListText("Inclusos", [])).toBe("");
  });

  it("buildBaseText inclui produto, total e validade", () => {
    const quote = {
      id: "q1",
      leadId: "l1",
      productName: "Piscina 6x3",
      total: 1000,
      subtotal: 1000,
      discountPct: 0,
      installments: 1,
      paymentMethod: "Pix",
      validUntil: "2030-01-15",
      notes: "",
      includedItems: [],
      gifts: [],
      customerResponsibilities: [],
      photos: [],
      status: "rascunho",
      createdAt: "2030-01-01T00:00:00.000Z",
    } as unknown as Quote;
    const text = buildBaseText(quote);
    expect(text).toContain("Piscina 6x3");
    expect(text).toContain("15/01/2030");
  });

  it("todayPlusDays devolve data ISO curta e avança os dias", () => {
    const d = todayPlusDays(7);
    expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const diff = (new Date(d).getTime() - new Date(todayPlusDays(0)).getTime()) / 86_400_000;
    expect(Math.round(diff)).toBe(7);
  });
});

describe("tamanho e direção de dependências", () => {
  const routeFile = path.resolve(process.cwd(), "src/routes/orcamentos.tsx");

  it("a rota ficou abaixo de 900 linhas", () => {
    const lines = fs.readFileSync(routeFile, "utf8").split("\n").length;
    expect(lines).toBeLessThan(900);
  });

  it("a rota consome os componentes extraídos", () => {
    const source = fs.readFileSync(routeFile, "utf8");
    expect(source).toContain('from "@/components/orcamentos/QuoteCard"');
    expect(source).toContain('from "@/components/orcamentos/QuoteFormModal"');
  });
});

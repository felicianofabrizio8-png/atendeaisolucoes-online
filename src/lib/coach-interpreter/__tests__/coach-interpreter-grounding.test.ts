// Coach Interpreter · Fase 3.4 — Grounding obrigatório.
// Valida que:
//  1) `buildCompanyGrounding` monta um bloco com CATÁLOGO, KB, FAQ, REGRAS, CAMPANHAS
//     quando o supabase entrega dados; sinaliza grounding_score coerente.
//  2) Quando nenhuma fonte existe, retorna isEmpty=true e um bloco com aviso
//     explícito para NÃO inventar.
//  3) `buildCoachInterpreterSystemPrompt` injeta o bloco e a hierarquia
//     obrigatória de conhecimento e proíbe inventar produtos.
import { describe, it, expect } from "vitest";
import { buildCompanyGrounding } from "@/lib/coach-interpreter/grounding.server";
import {
  buildCoachInterpreterSystemPrompt,
  COACH_INTERPRETER_PROMPT_VERSION,
} from "@/lib/coach-interpreter/prompt/interpreter-prompt.v1";

type Row = Record<string, unknown>;

function mockSupabase(byTable: Record<string, { data: unknown; error?: unknown }>) {
  const builder = (table: string) => {
    const src = byTable[table] ?? { data: [] };
    // Todos os métodos encadeáveis retornam o mesmo builder-then; o `await`
    // resolve para {data, error}.
    const chain: Record<string, (...args: unknown[]) => unknown> = {};
    const self: PromiseLike<{ data: unknown; error: unknown }> & Record<string, unknown> = {
      then(onFulfilled: unknown, onRejected: unknown) {
        return Promise.resolve({ data: src.data, error: src.error ?? null }).then(
          onFulfilled,
          onRejected,
        );
      },
    } as never;
    for (const m of ["select", "eq", "in", "order", "limit", "maybeSingle"]) {
      chain[m] = () => self;
      (self as Record<string, unknown>)[m] = chain[m];
    }
    return self;
  };
  return { from: (t: string) => builder(t) } as unknown as Parameters<
    typeof buildCompanyGrounding
  >[0];
}

describe("Coach Interpreter · Grounding", () => {
  it("monta bloco completo quando há produtos, KB, FAQ, regras e campanhas", async () => {
    const sb = mockSupabase({
      products: {
        data: [
          {
            name: "Maragogi Praia 8m",
            description: "Piscina de fibra com praia integrada, 8x3.5m fixa de fábrica.",
            price: 42000,
            promo_price: null,
            category: "Piscina Fibra",
            notes: null,
            active: true,
          },
          {
            name: "Canyon 8m",
            description: "Modelo retangular esportivo, 8x3m.",
            price: 38000,
            promo_price: 35000,
            category: "Piscina Fibra",
            notes: null,
            active: true,
          },
        ] as Row[],
      },
      marketing_knowledge_base: {
        data: {
          brand_identity: "Solário — piscinas de fibra premium",
          tone_of_voice: "Acolhedor e técnico",
          differentiators: "Instalação em 7 dias",
          guarantees: "12 meses estrutural",
          cities_served: "Grande Florianópolis",
          products_services: "Piscinas de fibra",
          gifts: null,
          commercial_terms: "Pagamento em até 12x",
          preferred_words: null,
          forbidden_words: "desconto sem autorização",
          extra_notes: null,
        },
      },
      quick_replies: {
        data: [{ name: "Horário", category: "faq", content: "Atendemos seg-sáb 9h-18h" }] as Row[],
      },
      coach_rules: {
        data: [
          {
            title: "Nunca dê desconto sem autorização",
            category: "discounts",
            scope_kind: "company",
            priority: 90,
            status: "active",
          },
        ] as Row[],
      },
      campaigns: {
        data: [
          {
            name: "Verão 2026",
            product: "Maragogi Praia 8m",
            headline: "Sua piscina em 7 dias",
            primary_text: "…",
            cta: "Quero saber mais",
            status: "active",
          },
        ] as Row[],
      },
    });

    const g = await buildCompanyGrounding(sb, "company-1");
    expect(g.isEmpty).toBe(false);
    expect(g.sourcesUsed.products).toBe(true);
    expect(g.sourcesUsed.knowledge_base).toBe(true);
    expect(g.sourcesUsed.faq).toBe(true);
    expect(g.sourcesUsed.quick_replies).toBe(true);
    expect(g.sourcesUsed.active_rules).toBe(true);
    expect(g.sourcesUsed.campaigns).toBe(true);
    expect(g.groundingScore).toBeGreaterThan(0.8);
    expect(g.counts.products).toBe(2);
    expect(g.block).toMatch(/CATÁLOGO DE PRODUTOS/);
    expect(g.block).toMatch(/Maragogi Praia 8m/);
    expect(g.block).toMatch(/BASE DE CONHECIMENTO/);
    expect(g.block).toMatch(/REGRAS COMERCIAIS/);
    expect(g.block).toMatch(/CAMPANHAS VIGENTES/);
    // Cláusula anti-invenção presente.
    expect(g.block).toMatch(/nunca invente/i);
  });

  it("quando nenhuma fonte existe, retorna isEmpty=true com aviso anti-invenção", async () => {
    const sb = mockSupabase({
      products: { data: [] },
      marketing_knowledge_base: { data: null },
      quick_replies: { data: [] },
      coach_rules: { data: [] },
      campaigns: { data: [] },
    });
    const g = await buildCompanyGrounding(sb, "c");
    expect(g.isEmpty).toBe(true);
    expect(g.groundingScore).toBe(0);
    expect(g.block).toMatch(/NENHUMA fonte de conhecimento/);
    expect(g.block).toMatch(/Não invente/);
  });

  it("prompt injeta o bloco de grounding + hierarquia obrigatória + veto a inventar", () => {
    const grounding =
      "## CONTEXTO DA EMPRESA (grounding obrigatório)\n### CATÁLOGO DE PRODUTOS\n- Maragogi Praia 8m — R$ 42000";
    const prompt = buildCoachInterpreterSystemPrompt({
      companyName: "Solário Piscinas",
      groundingBlock: grounding,
    });
    expect(prompt).toContain("Maragogi Praia 8m");
    expect(prompt).toMatch(/HIERARQUIA OBRIGATÓRIA DE CONHECIMENTO/);
    expect(prompt).toMatch(/PREVALECE/);
    expect(prompt).toMatch(/compatíveis com o catálogo real/);
    expect(prompt).toMatch(/dimensões fixas de fábrica/);
    expect(prompt).toMatch(/ESPECIALISTA/);
  });

  it("bump de versão do prompt", () => {
    expect(COACH_INTERPRETER_PROMPT_VERSION).toBe("coach-interpreter@2026-07-22.1");
  });
});

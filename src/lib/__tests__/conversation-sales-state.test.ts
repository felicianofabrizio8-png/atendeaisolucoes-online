import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EMPTY_CONVERSATION_SALES_STATE,
  mergeConversationSalesState,
  revalidateConversationSalesState,
  type ConversationSalesScopeType,
} from "../conversation-sales-state";
import {
  extractCurrentProductAttributes,
  selectRelevantSalesAgentProducts,
} from "../sales-agent-grounding.server";

const agentSource = readFileSync(fileURLToPath(new URL("../ai-agent.server.ts", import.meta.url)), "utf8");
const trainingSource = readFileSync(
  fileURLToPath(new URL("../sales-training.functions.ts", import.meta.url)),
  "utf8",
);
const stateServerSource = readFileSync(
  fileURLToPath(new URL("../conversation-sales-state.server.ts", import.meta.url)),
  "utf8",
);
const migrationSource = readFileSync(
  fileURLToPath(
    new URL(
      "../../../supabase/migrations/20260825010000_create_conversation_sales_states.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const stateMigrationSource = readFileSync(
  fileURLToPath(
    new URL(
      "../../../supabase/migrations/20260917010000_add_last_catalog_query_to_conversation_sales_states.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

const catalog = [
  {
    id: "length-a",
    name: "Item A",
    category: "Categoria",
    description: null,
    lengthM: 7,
    variants: [{ color: "branca" }],
    price: null,
    promoPrice: null,
    images: [],
    notes: null,
  },
  {
    id: "length-b",
    name: "Item B",
    category: "Categoria",
    description: null,
    lengthM: 7,
    variants: [{ color: "azul" }],
    price: null,
    promoPrice: null,
    images: [],
    notes: null,
  },
  {
    id: "other-white",
    name: "Item C",
    category: "Categoria",
    description: null,
    lengthM: 8,
    variants: [{ color: "branca" }],
    price: null,
    promoPrice: null,
    images: [],
    notes: null,
  },
];

describe("ConversationSalesState", () => {
  it("persiste critérios e estado da última busca sem fatos de produto", () => {
    const state = mergeConversationSalesState(EMPTY_CONVERSATION_SALES_STATE, {
      attributes: { lengthM: 6, variantTerms: ["azul"] },
      intent: "product_inquiry",
      candidateProductIds: ["product-1", "product-2"],
      selectedProductIds: ["product-1"],
      lastCatalogQuery: {
        status: "matches",
        criteria: { lengthM: 6, variantTerms: ["azul"] },
        referencedProductIds: ["product-1"],
      },
    });

    expect(state.lastCatalogQuery).toEqual({
      status: "matches",
      criteria: { lengthM: 6, variantTerms: ["azul"] },
      referencedProductIds: ["product-1"],
    });
    expect(state.lastCatalogQuery).not.toHaveProperty("price");
    expect(state.lastCatalogQuery).not.toHaveProperty("description");
  });

  it("sanitiza o update do merge e remove chaves factuais ou desconhecidas", () => {
    const state = mergeConversationSalesState(EMPTY_CONVERSATION_SALES_STATE, {
      attributes: {
        lengthM: 6,
        price: 9999,
        description: "fato proibido",
        specs: { capacity: 1000 },
        availability: true,
        unknownKey: "remover",
      } as never,
      lastCatalogQuery: {
        status: "matches",
        criteria: {
          widthM: 3,
          price: 9999,
          description: "fato proibido",
          specs: { capacity: 1000 },
          availability: true,
          unknownKey: "remover",
        },
        referencedProductIds: ["product-1"],
        price: 9999,
        description: "fato proibido",
        availability: "in_stock",
        unknownKey: "remover",
      } as never,
    });

    expect(state.attributes).toEqual({ lengthM: 6 });
    expect(state.lastCatalogQuery).toEqual({
      status: "matches",
      criteria: { widthM: 3 },
      referencedProductIds: ["product-1"],
    });
    expect(JSON.stringify(state)).not.toMatch(/price|description|specs|availability|unknownKey/);
  });

  it("remove IDs desativados ou excluídos antes da continuidade", () => {
    const state = revalidateConversationSalesState({
      productIds: ["active", "disabled"],
      attributes: {},
      intent: "product_inquiry",
      lastValidProductIds: ["active", "deleted"],
      lastCatalogQuery: {
        status: "matches",
        criteria: {},
        referencedProductIds: ["active", "disabled"],
      },
    }, ["active"]);

    expect(state.productIds).toEqual(["active"]);
    expect(state.lastValidProductIds).toEqual(["active"]);
    expect(state.lastCatalogQuery?.referencedProductIds).toEqual(["active"]);
  });
  it.each(["training_session", "whatsapp_conversation"] as ConversationSalesScopeType[])(
    "preserva seleção e restrições na sequência do escopo %s",
    () => {
      const firstHistory = [{ role: "lead" as const, text: "quero um item de 7 metros" }];
      const firstCandidates = selectRelevantSalesAgentProducts(catalog, firstHistory);
      const firstState = mergeConversationSalesState(EMPTY_CONVERSATION_SALES_STATE, {
        attributes: extractCurrentProductAttributes(firstHistory),
        intent: "product_inquiry",
        candidateProductIds: firstCandidates.map((product) => product.id),
        selectedProductIds: firstCandidates.map((product) => product.id),
      });

      const photoHistory = [{ role: "lead" as const, text: "manda foto" }];
      const photoCandidates = selectRelevantSalesAgentProducts(catalog, photoHistory, firstState);
      const photoState = mergeConversationSalesState(firstState, {
        attributes: extractCurrentProductAttributes(photoHistory),
        intent: "product_images",
        candidateProductIds: photoCandidates.map((product) => product.id),
      });

      const colorHistory = [{ role: "lead" as const, text: "tem na cor branca?" }];
      const colorCandidates = selectRelevantSalesAgentProducts(catalog, colorHistory, photoState);

      expect(firstCandidates.map((product) => product.id)).toEqual(["length-a", "length-b"]);
      expect(photoCandidates.map((product) => product.id)).toEqual(["length-a", "length-b"]);
      expect(colorCandidates.map((product) => product.id)).toEqual(["length-a"]);
      expect(photoState.attributes.lengthM).toBe(7);
      expect(photoState.lastValidProductIds).toEqual(["length-a", "length-b"]);
    },
  );

  it("resolve a primeira opção e preserva o produto para a pergunta de preço", () => {
    const firstHistory = [{ role: "lead" as const, text: "mostre itens de 7 metros" }];
    const firstCandidates = selectRelevantSalesAgentProducts(catalog, firstHistory);
    const firstState = mergeConversationSalesState(EMPTY_CONVERSATION_SALES_STATE, {
      candidateProductIds: firstCandidates.map((product) => product.id),
      selectedProductIds: firstCandidates.map((product) => product.id),
    });
    const choiceHistory = [{ role: "lead" as const, text: "Gostei da primeira" }];
    const chosen = selectRelevantSalesAgentProducts(catalog, choiceHistory, firstState);
    const chosenState = mergeConversationSalesState(firstState, {
      candidateProductIds: chosen.map((product) => product.id),
      selectedProductIds: chosen.map((product) => product.id),
    });
    const priceCandidates = selectRelevantSalesAgentProducts(
      catalog,
      [{ role: "lead", text: "quanto custa?" }],
      chosenState,
    );

    expect(firstCandidates.map((product) => product.id)).toEqual(["length-a", "length-b"]);
    expect(chosen.map((product) => product.id)).toEqual(["length-a"]);
    expect(priceCandidates.map((product) => product.id)).toEqual(["length-a"]);
  });

  it("isola estado por empresa e escopo e conecta os dois canais", () => {
    expect(migrationSource).toContain("UNIQUE (company_id, scope_type, scope_id)");
    expect(stateMigrationSource).toContain("last_catalog_query jsonb");
    expect(migrationSource).toContain("company_id = public.current_company_id()");
    expect(stateServerSource).toContain('.eq("company_id", scope.companyId)');
    expect(stateServerSource).toContain('onConflict: "company_id,scope_type,scope_id"');
    expect(trainingSource).toContain('scopeType: "training_session"');
    expect(agentSource).toContain('scopeType: "whatsapp_conversation"');
  });

  it("carrega no WhatsApp as mensagens mais recentes e restaura ordem cronológica", () => {
    expect(agentSource).toContain('.order("at", { ascending: false })');
    expect(agentSource).toContain("[...(msgs ?? [])].reverse().map");
  });
});

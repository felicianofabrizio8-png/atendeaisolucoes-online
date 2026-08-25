import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EMPTY_CONVERSATION_SALES_STATE,
  mergeConversationSalesState,
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

  it("isola estado por empresa e escopo e conecta os dois canais", () => {
    expect(migrationSource).toContain("UNIQUE (company_id, scope_type, scope_id)");
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

// ============================================================================
// Foco da conversa: quais produtos estão em discussão agora.
//
// Mensagens de continuação ("quanto tá?", "e a 602?", "tem em outra cor?")
// muitas vezes não nomeiam o produto; a referência está no histórico. A
// busca do catálogo interpreta só a última mensagem, então o foco é resolvido
// aqui, de forma determinística, a partir do contexto da conversa — nunca de
// uma lista de frases. O LLM recebe os fatos validados desses produtos e
// decide semanticamente a que o cliente se refere.
// ============================================================================

import type { SalesAgentCatalogSearch, SalesAgentGrounding } from "./sales-agent-core";

type Product = SalesAgentGrounding["catalog"][number];
type History = ReadonlyArray<{ role: "lead" | "agent" | "system"; productIds?: string[] }>;

/** Máximo de produtos enviados ao LLM quando o foco é somado à busca. */
export const FOCUS_CATALOG_LIMIT = 10;

/**
 * Produtos em foco, do mais recente para o mais antigo:
 * 1) a última resposta da IA que apresentou produtos (em qualquer ponto da
 *    janela de histórico, não só a imediatamente anterior);
 * 2) memória da conversa (Customer Context / estado de vendas), se o
 *    histórico carregado não tiver.
 */
export function getConversationFocusProductIds(
  history: History,
  memoryProductIds: readonly string[] = [],
): string[] {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (item.role === "agent" && item.productIds && item.productIds.length > 0) {
      return [...new Set(item.productIds)];
    }
  }
  return [...new Set(memoryProductIds)];
}

/**
 * Soma o foco da conversa ao resultado da busca quando a busca tem base
 * fraca (só textual ou padrão). Referências fortes (nome, contexto, alias,
 * atributo) ficam como estão. Os produtos em foco vão primeiro e são
 * marcados para o prompt.
 */
export function withConversationFocus(
  search: SalesAgentCatalogSearch,
  focusProducts: readonly Product[],
  limit = FOCUS_CATALOG_LIMIT,
): SalesAgentCatalogSearch {
  if (search.status !== "matches" || focusProducts.length === 0) return search;
  if (search.basis !== "text_match" && search.basis !== "default") return search;
  const focusIds = new Set(focusProducts.map((product) => product.id));
  const merged = [
    ...focusProducts,
    ...search.products.filter((product) => !focusIds.has(product.id)),
  ].slice(0, Math.max(limit, focusProducts.length));
  return {
    status: "matches",
    products: merged,
    basis: "focus",
    focusProductIds: focusProducts.map((product) => product.id),
  };
}

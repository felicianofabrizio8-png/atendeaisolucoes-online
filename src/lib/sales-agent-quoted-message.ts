// ============================================================================
// Mensagem respondida pelo cliente (o "responder" do WhatsApp).
//
// Quando o cliente responde a uma mensagem específica — uma foto de produto, por
// exemplo — e escreve "qual o valor dessa?", o texto sozinho não diz de qual item ele
// fala. O webhook guarda a mensagem recebida em source_metadata.raw, que traz
// context.id (o identificador da mensagem respondida). Aqui esse vínculo vira
// contexto do histórico: o texto da mensagem citada e os produtos ligados a ela.
// ============================================================================

export interface QuotedSourceRow {
  external_id?: string | null;
  text: string | null;
  source_metadata?: unknown;
}

const QUOTED_TEXT_LIMIT = 200;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Identificador externo da mensagem que o cliente respondeu, se houver. */
export function quotedExternalId(sourceMetadata: unknown): string | null {
  const context = record(record(record(sourceMetadata).raw).context);
  return typeof context.id === "string" && context.id.trim() ? context.id.trim() : null;
}

/** Produtos ligados à mensagem citada (foto de produto enviada, por exemplo). */
export function quotedProductIds(quoted: QuotedSourceRow): string[] {
  const metadata = record(quoted.source_metadata);
  if (Array.isArray(metadata.catalog_product_ids)) {
    return metadata.catalog_product_ids.filter((id): id is string => typeof id === "string");
  }
  return typeof metadata.product_id === "string" ? [metadata.product_id] : [];
}

/** Texto do cliente com a mensagem que ele respondeu, para a IA saber do que ele fala. */
export function withQuotedContext(leadText: string, quoted: QuotedSourceRow): string {
  const quotedText = (quoted.text ?? "").replace(/\s+/g, " ").trim();
  if (!quotedText) return leadText;
  const shown = quotedText.length > QUOTED_TEXT_LIMIT ? `${quotedText.slice(0, QUOTED_TEXT_LIMIT)}…` : quotedText;
  return `[O cliente respondeu a esta mensagem: "${shown}"]\n${leadText}`;
}

/**
 * Aplica a mensagem citada a um item do histórico do cliente: o texto ganha o contexto e
 * os produtos da mensagem citada passam a acompanhar a pergunta.
 */
export function applyQuotedMessage<T extends { role: string; text: string; productIds?: string[] }>(
  item: T,
  quoted: QuotedSourceRow | null | undefined,
): T {
  if (!quoted || item.role !== "lead") return item;
  const productIds = [...new Set([...quotedProductIds(quoted), ...(item.productIds ?? [])])];
  return {
    ...item,
    text: withQuotedContext(item.text, quoted),
    ...(productIds.length > 0 ? { productIds } : {}),
  };
}

// ============================================================================
// Estado comercial da Vendedora 2.0 entre turnos.
//
// A cada turno ela devolve onde a venda está (estágio do cliente, sinais de compra,
// assuntos já perguntados, fechamentos já usados). Guardado por conversa e reenviado no
// turno seguinte, é o que dá continuidade: sem ele, toda mensagem parece a primeira.
// É memória da conversa, nunca fonte de fato — preço e condição vêm do cadastro.
// ============================================================================

export type SellerState = Record<string, unknown>;

const STRING_KEYS = ["stage", "next_step", "current_intent", "purchase_signal", "chosen_product", "buyer_stage"] as const;
const LIST_KEYS = ["objections", "skill_history", "buying_signals", "customer_topics", "recent_closings"] as const;
const MAX_LIST_ITEMS = 20;
const MAX_STRING_CHARS = 200;
const MAX_NEEDS_KEYS = 8;
const MAX_STATE_CHARS = 6000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, MAX_STRING_CHARS) : null;
}

/**
 * Só o que conhecemos do estado da Vendedora, com tipos e tamanhos limitados. Qualquer coisa
 * fora disso é descartada; estado ilegível vira null (o turno segue sem memória).
 * `shown_products` fica de fora de propósito: os produtos apresentados vêm do histórico real
 * da conversa (mensagens e fotos enviadas, inclusive por atendente).
 */
export function sanitizeSellerState(value: unknown): SellerState | null {
  if (!isPlainObject(value)) return null;
  const state: SellerState = {};
  for (const key of STRING_KEYS) {
    const text = cleanText(value[key]);
    if (text) state[key] = text;
  }
  for (const key of LIST_KEYS) {
    if (!Array.isArray(value[key])) continue;
    const items = (value[key] as unknown[]).map(cleanText).filter((item): item is string => item !== null);
    if (items.length > 0) state[key] = items.slice(-MAX_LIST_ITEMS);
  }
  if (isPlainObject(value.needs)) {
    const needs: Record<string, string> = {};
    for (const [key, raw] of Object.entries(value.needs).slice(0, MAX_NEEDS_KEYS)) {
      const text = cleanText(raw);
      if (text) needs[key.slice(0, 40)] = text;
    }
    if (Object.keys(needs).length > 0) state.needs = needs;
  }
  if (typeof value.turns === "number" && Number.isInteger(value.turns) && value.turns >= 0 && value.turns < 100_000) {
    state.turns = value.turns;
  }
  if (Object.keys(state).length === 0) return null;
  return JSON.stringify(state).length <= MAX_STATE_CHARS ? state : null;
}

const IMAGE_PLACEHOLDER = /^\[imagem: (.+)\]$/;

/**
 * Fotos enviadas em sequência viram uma linha só no histórico da Vendedora. Cada foto é uma
 * mensagem; sem isso, meia dúzia de fotos ocupa a janela de conversa que ela enxerga e o que
 * o cliente disse antes some.
 */
export function collapseImageRuns<T extends { role: string; text: string; productIds?: string[] }>(history: T[]): T[] {
  const output: T[] = [];
  let run: { names: string[]; productIds: string[]; first: T } | null = null;
  const flush = () => {
    if (!run) return;
    const names = [...new Set(run.names)];
    const productIds = [...new Set(run.productIds)];
    output.push({
      ...run.first,
      text: names.length === 1 ? `[foto enviada: ${names[0]}]` : `[fotos enviadas: ${names.join(", ")}]`,
      ...(productIds.length > 0 ? { productIds } : {}),
    });
    run = null;
  };
  for (const item of history) {
    const match = item.role === "agent" ? IMAGE_PLACEHOLDER.exec(item.text.trim()) : null;
    if (!match) {
      flush();
      output.push(item);
      continue;
    }
    if (!run) run = { names: [], productIds: [], first: item };
    run.names.push(match[1].trim());
    run.productIds.push(...(item.productIds ?? []));
  }
  flush();
  return output;
}

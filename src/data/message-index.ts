// Índice de mensagens por conversationId — estrutura pura e testável.
// Substitui varreduras O(N) sobre a coleção global de mensagens da empresa
// (P3 do docs/inbox-ux-audit.md). Cada bucket é mantido ordenado por `at`
// ascendente, com inserção binária estável (empates por id).

import type { Message } from "@/data/mock";

export type MessageIndex = Map<string, Message[]>;

export function createMessageIndex(): MessageIndex {
  return new Map();
}

function cmp(a: Message, b: Message): number {
  const da = +new Date(a.at);
  const db = +new Date(b.at);
  if (da !== db) return da - db;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function binaryInsertSlot(list: Message[], msg: Message): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cmp(list[mid], msg) <= 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Insere ou atualiza `msg` no bucket da sua conversa.
 * Mantém a lista ordenada e sem duplicidade por id.
 */
export function upsertMessage(idx: MessageIndex, msg: Message): void {
  const key = msg.conversationId;
  const cur = idx.get(key);
  if (!cur) {
    idx.set(key, [msg]);
    return;
  }
  const existing = cur.findIndex((m) => m.id === msg.id);
  if (existing !== -1) {
    // Se o `at` mudou, precisamos reposicionar.
    if (cur[existing].at === msg.at) {
      const next = cur.slice();
      next[existing] = msg;
      idx.set(key, next);
      return;
    }
    const without = cur.slice(0, existing).concat(cur.slice(existing + 1));
    const slot = binaryInsertSlot(without, msg);
    idx.set(key, [...without.slice(0, slot), msg, ...without.slice(slot)]);
    return;
  }
  const slot = binaryInsertSlot(cur, msg);
  idx.set(key, [...cur.slice(0, slot), msg, ...cur.slice(slot)]);
}

/**
 * Remove mensagem pelo id. `conversationId` acelera a busca; se omitido,
 * varre todos os buckets (usado quando o payload de DELETE só traz o id).
 */
export function removeMessage(
  idx: MessageIndex,
  messageId: string,
  conversationId?: string,
): boolean {
  if (conversationId) {
    const cur = idx.get(conversationId);
    if (!cur) return false;
    const i = cur.findIndex((m) => m.id === messageId);
    if (i === -1) return false;
    idx.set(conversationId, cur.slice(0, i).concat(cur.slice(i + 1)));
    return true;
  }
  for (const [k, arr] of idx) {
    const i = arr.findIndex((m) => m.id === messageId);
    if (i !== -1) {
      idx.set(k, arr.slice(0, i).concat(arr.slice(i + 1)));
      return true;
    }
  }
  return false;
}

/**
 * Reconstrói o índice a partir de uma coleção plana — usado no bootstrap
 * (loadRemote) e em resets. O(N log N) no total de mensagens.
 */
export function rebuildIndex(
  idx: MessageIndex,
  messages: readonly Message[],
): void {
  idx.clear();
  const grouped = new Map<string, Message[]>();
  for (const m of messages) {
    const arr = grouped.get(m.conversationId);
    if (arr) arr.push(m);
    else grouped.set(m.conversationId, [m]);
  }
  for (const [k, arr] of grouped) {
    arr.sort(cmp);
    idx.set(k, arr);
  }
}

/** Lookup O(1) + retorno já ordenado. Nunca modificado pelo chamador. */
export function getMessages(idx: MessageIndex, conversationId: string): Message[] {
  return idx.get(conversationId) ?? EMPTY;
}

const EMPTY: Message[] = Object.freeze([]) as unknown as Message[];

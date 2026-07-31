// Estado efêmero de interface da Inbox no mobile.
//
// Responsabilidades:
//  · Rascunho por conversa — o vendedor não perde o texto ao voltar para a
//    lista, abrir o Coach ou consultar os detalhes do lead.
//  · Posição de scroll da lista — voltar da conversa restaura exatamente onde
//    o dedo parou.
//
// Módulo puro em relação a React e ao DOM: recebe o storage por injeção, o que
// o torna testável em Node e seguro durante SSR (onde não há `sessionStorage`).
// Não persiste nada em banco — é estado de interface, descartável por sessão.

/** Subconjunto de `Storage` realmente usado aqui. */
export interface SessionLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const DRAFT_PREFIX = "atendeai:inbox:draft:";
const LIST_SCROLL_KEY = "atendeai:inbox:list-scroll";

/** Limite defensivo: evita estourar a cota do sessionStorage com colagens enormes. */
export const MAX_DRAFT_LENGTH = 8000;

/**
 * Retorna o `sessionStorage` quando existir.
 * Em SSR, em navegadores com storage bloqueado (modo privado do Safari) ou em
 * iframes com cookies de terceiros negados, devolve `null` — os chamadores
 * degradam silenciosamente para "sem persistência".
 */
export function getSessionStorage(): SessionLike | null {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function draftKey(conversationId: string): string {
  return `${DRAFT_PREFIX}${conversationId}`;
}

/**
 * Grava o rascunho da conversa. Texto vazio (ou só espaços) remove a entrada,
 * de modo que "limpar o campo" nunca ressuscite um rascunho antigo.
 */
export function saveDraft(
  conversationId: string,
  text: string,
  storage: SessionLike | null = getSessionStorage(),
): void {
  if (!storage || !conversationId) return;
  try {
    if (!text.trim()) {
      storage.removeItem(draftKey(conversationId));
      return;
    }
    storage.setItem(draftKey(conversationId), text.slice(0, MAX_DRAFT_LENGTH));
  } catch {
    /* cota cheia ou storage bloqueado — rascunho é best-effort */
  }
}

/** Lê o rascunho da conversa; `""` quando não houver nada salvo. */
export function readDraft(
  conversationId: string,
  storage: SessionLike | null = getSessionStorage(),
): string {
  if (!storage || !conversationId) return "";
  try {
    return storage.getItem(draftKey(conversationId)) ?? "";
  } catch {
    return "";
  }
}

/** Remove o rascunho — chamado após o envio bem-sucedido. */
export function clearDraft(
  conversationId: string,
  storage: SessionLike | null = getSessionStorage(),
): void {
  if (!storage || !conversationId) return;
  try {
    storage.removeItem(draftKey(conversationId));
  } catch {
    /* noop */
  }
}

/** Persiste a posição de rolagem da lista de conversas (em px, nunca negativa). */
export function saveListScroll(
  top: number,
  storage: SessionLike | null = getSessionStorage(),
): void {
  if (!storage) return;
  if (!Number.isFinite(top)) return;
  try {
    storage.setItem(LIST_SCROLL_KEY, String(Math.max(0, Math.round(top))));
  } catch {
    /* noop */
  }
}

/** Lê a posição de rolagem salva da lista; `0` quando ausente ou inválida. */
export function readListScroll(
  storage: SessionLike | null = getSessionStorage(),
): number {
  if (!storage) return 0;
  try {
    const raw = storage.getItem(LIST_SCROLL_KEY);
    if (raw === null) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

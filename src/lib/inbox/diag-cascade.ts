// Instrumentação cirúrgica DEV-only para investigar a cascata de re-renders
// da conversa aberta na Inbox. Alvos exclusivos:
//   1. repoMessages / visibleMessages  → identidade vs conteúdo
//   2. setAiState                      → equivalência semântica
//   3. atBottomStateChange             → sequência true/false + oscilação
//
// Objetivo: encontrar o PRIMEIRO setState redundante (mesmo conteúdo,
// referência nova) na cadeia, sem alterar comportamento de produção.

/* eslint-disable no-console */

const ENABLED =
  typeof import.meta !== "undefined" &&
  (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;

// ---- utilitários compartilhados ------------------------------------------

function shallowArrayEqualByRef<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function shallowObjectEqual(
  a: Record<string, unknown> | null,
  b: Record<string, unknown> | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

// ---- 1. Arrays de mensagens ----------------------------------------------

export type ArrayDiagSnapshot<T> = {
  ref: readonly T[];
  length: number;
  firstId: string | null;
  lastId: string | null;
};

export function snapshotArray<T extends { id: string }>(
  arr: readonly T[],
): ArrayDiagSnapshot<T> {
  return {
    ref: arr,
    length: arr.length,
    firstId: arr[0]?.id ?? null,
    lastId: arr[arr.length - 1]?.id ?? null,
  };
}

export function diffArraySnapshot<T extends { id: string }>(
  name: string,
  renderId: number,
  prev: ArrayDiagSnapshot<T> | null,
  next: ArrayDiagSnapshot<T>,
): { referenceChanged: boolean; contentChanged: boolean } {
  const referenceChanged = !prev || prev.ref !== next.ref;
  const contentChanged =
    !prev ||
    prev.length !== next.length ||
    !shallowArrayEqualByRef(prev.ref, next.ref);
  if (!ENABLED) return { referenceChanged, contentChanged };
  if (!referenceChanged && !contentChanged) return { referenceChanged, contentChanged };
  const tag = !contentChanged
    ? "REFERENCE_CHANGED (content stable)"
    : referenceChanged
      ? "CONTENT_CHANGED"
      : "CONTENT_ONLY";
  console.debug(`[cascade] ${name} ${tag}`, {
    render: renderId,
    prevLen: prev?.length ?? null,
    nextLen: next.length,
    prevLastId: prev?.lastId ?? null,
    nextLastId: next.lastId,
  });
  return { referenceChanged, contentChanged };
}

// ---- 2. setAiState (equivalência semântica) ------------------------------

export type AiStateShape = { ai_status: string | null; ai_handling: boolean } | null;

export function aiStateEqual(a: AiStateShape, b: AiStateShape): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.ai_status === b.ai_status && a.ai_handling === b.ai_handling;
}

export function logAiStateAttempt(
  renderId: number,
  reason: string,
  prev: AiStateShape,
  next: AiStateShape,
  caller: string,
): { equivalent: boolean } {
  const equivalent = aiStateEqual(prev, next);
  if (!ENABLED) return { equivalent };
  console.debug("[cascade] setAiState ATTEMPT", {
    render: renderId,
    reason,
    caller,
    prev,
    next,
    referenceChanged: prev !== next,
    contentChanged: !equivalent,
    equivalent,
    willSkipIfGuarded: equivalent,
  });
  return { equivalent };
}

// ---- 3. atBottomStateChange (sequência) ----------------------------------

type AtBottomTrace = {
  total: number;
  transitions: number;
  redundant: number;
  last: boolean | null;
  recent: Array<{ render: number; value: boolean; redundant: boolean }>;
};

const atBottomTrace: AtBottomTrace = {
  total: 0,
  transitions: 0,
  redundant: 0,
  last: null,
  recent: [],
};

export function logAtBottom(renderId: number, value: boolean): void {
  atBottomTrace.total += 1;
  const redundant = atBottomTrace.last === value;
  if (redundant) atBottomTrace.redundant += 1;
  else atBottomTrace.transitions += 1;
  atBottomTrace.last = value;
  atBottomTrace.recent.push({ render: renderId, value, redundant });
  if (atBottomTrace.recent.length > 12) atBottomTrace.recent.shift();
  if (!ENABLED) return;
  console.debug("[cascade] atBottomStateChange", {
    render: renderId,
    value,
    redundant,
    total: atBottomTrace.total,
    transitions: atBottomTrace.transitions,
    redundantCount: atBottomTrace.redundant,
    tail: atBottomTrace.recent.slice(-6),
  });
}

// ---- utilitário auxiliar público -----------------------------------------

export { shallowObjectEqual };
export const CASCADE_DIAG_ENABLED = ENABLED;

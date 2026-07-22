// Máquina de estados determinística da abertura de uma conversa na inbox.
// Pura, sem dependências de React — testável isoladamente. O componente
// chama `next()` a cada evento (mensagens chegaram, último item renderizado,
// altura estabilizou, erro de carregamento, etc.) e usa `state.name` para
// decidir se o Virtuoso permanece oculto (`visibility: hidden`) ou revelado.
//
// Estados:
//   idle       → nenhuma conversa em preparação.
//   loading    → busca do lote inicial em curso; Virtuoso NÃO deve montar.
//   preparing  → lote no índice; Virtuoso monta OCULTO para calibrar.
//   ready      → calibração concluída; próximo frame revelará.
//   visible    → chat na tela; nenhum controlador automático move o scroll.
//   error      → falha; mostra painel + retry.
//
// Regras de transição não-negociáveis:
//   - Preview isolado (length === 1 antes de load OK) nunca dispara preparing.
//   - Só transiciona para `ready` quando: último item foi renderizado
//     (`lastRenderedIndex >= totalItems - 1`) E distância ao fim ≤ TOLERANCE_PX
//     E houve pelo menos um frame com altura estável (stableFrames >= 1).
//   - Troca de `conversationId` reseta para `idle`.

export const CONVERSATION_OPEN_TOLERANCE_PX = 8;
export const CONVERSATION_OPEN_MIN_BATCH_FOR_PREPARE = 1;

export type ConversationOpenState =
  | { name: "idle" }
  | { name: "loading"; cid: string }
  | { name: "preparing"; cid: string; totalItems: number; stableFrames: number }
  | { name: "ready"; cid: string; totalItems: number }
  | { name: "visible"; cid: string; totalItems: number }
  | { name: "error"; cid: string; message: string };

export type ConversationOpenEvent =
  | { type: "open"; cid: string; cachedTotal: number }
  | { type: "load_ok"; cid: string; totalItems: number }
  | { type: "load_error"; cid: string; message: string }
  | { type: "messages_changed"; cid: string; totalItems: number }
  | {
      type: "layout_probe";
      cid: string;
      totalItems: number;
      lastRenderedIndex: number;
      distanceToEnd: number;
      heightChanged: boolean;
    }
  | { type: "reveal"; cid: string }
  | { type: "retry"; cid: string }
  | { type: "close" };

export function initialConversationOpenState(): ConversationOpenState {
  return { name: "idle" };
}

/**
 * Transição pura. Ignora eventos de conversas antigas (cid diferente do
 * estado atual) — o componente é responsável por descartar respostas
 * atrasadas via token, mas a máquina também se protege.
 */
export function reduceConversationOpen(
  state: ConversationOpenState,
  event: ConversationOpenEvent,
): ConversationOpenState {
  if (event.type === "close") return { name: "idle" };

  if (event.type === "open") {
    // Cache íntegro (≥ MIN_BATCH mensagens) → pula loading e vai direto
    // para preparing para reancorar sem nova rede.
    if (event.cachedTotal >= CONVERSATION_OPEN_MIN_BATCH_FOR_PREPARE + 1) {
      return {
        name: "preparing",
        cid: event.cid,
        totalItems: event.cachedTotal,
        stableFrames: 0,
      };
    }
    return { name: "loading", cid: event.cid };
  }

  // Todos os demais eventos devem casar com a conversa corrente.
  if (state.name === "idle") return state;
  if ("cid" in event && event.cid !== stateCid(state)) return state;

  switch (event.type) {
    case "load_ok": {
      if (state.name === "loading" || state.name === "error") {
        if (event.totalItems < CONVERSATION_OPEN_MIN_BATCH_FOR_PREPARE) {
          return state;
        }
        return {
          name: "preparing",
          cid: event.cid,
          totalItems: event.totalItems,
          stableFrames: 0,
        };
      }
      if (state.name === "preparing") {
        // Realtime já elevou o total antes do load_ok chegar — mantém o
        // maior e reseta frames (a lista mudou implicitamente).
        return {
          ...state,
          totalItems: Math.max(state.totalItems, event.totalItems),
          stableFrames: 0,
        };
      }
      return state;
    }

    case "load_error": {
      return { name: "error", cid: event.cid, message: event.message };
    }

    case "retry": {
      return { name: "loading", cid: event.cid };
    }

    case "messages_changed": {
      // Realtime durante loading/preparing: absorve novo total, reseta
      // frames estáveis (altura mudou implicitamente).
      if (state.name === "loading") {
        if (event.totalItems >= CONVERSATION_OPEN_MIN_BATCH_FOR_PREPARE) {
          return {
            name: "preparing",
            cid: event.cid,
            totalItems: event.totalItems,
            stableFrames: 0,
          };
        }
        return state;
      }
      if (state.name === "preparing") {
        return { ...state, totalItems: event.totalItems, stableFrames: 0 };
      }
      // Em ready/visible apenas atualiza o total.
      if (state.name === "ready" || state.name === "visible") {
        return { ...state, totalItems: event.totalItems };
      }
      return state;
    }

    case "layout_probe": {
      if (state.name !== "preparing") return state;
      const lastRenderedOk = event.lastRenderedIndex >= event.totalItems - 1;
      const nearBottom =
        event.distanceToEnd <= CONVERSATION_OPEN_TOLERANCE_PX;
      if (event.heightChanged) {
        return { ...state, totalItems: event.totalItems, stableFrames: 0 };
      }
      if (!lastRenderedOk || !nearBottom) {
        return { ...state, totalItems: event.totalItems, stableFrames: 0 };
      }
      const nextStable = state.stableFrames + 1;
      if (nextStable >= 1) {
        return { name: "ready", cid: state.cid, totalItems: event.totalItems };
      }
      return { ...state, totalItems: event.totalItems, stableFrames: nextStable };
    }

    case "reveal": {
      if (state.name !== "ready") return state;
      return { name: "visible", cid: state.cid, totalItems: state.totalItems };
    }
  }
}

function stateCid(state: ConversationOpenState): string | null {
  if (state.name === "idle") return null;
  return state.cid;
}

/** Utilitário para o componente: o Virtuoso deve ser montado neste estado? */
export function shouldMountVirtuoso(state: ConversationOpenState): boolean {
  return (
    state.name === "preparing" ||
    state.name === "ready" ||
    state.name === "visible"
  );
}

/** Utilitário para o componente: o Virtuoso deve estar visível? */
export function shouldRevealVirtuoso(state: ConversationOpenState): boolean {
  return state.name === "visible";
}

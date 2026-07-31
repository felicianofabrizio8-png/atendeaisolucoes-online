// ============================================================================
// Resumo determinístico do histórico.
//
// Por que determinístico: o resumo entra no fingerprint do cache e no prompt.
// Se ele variasse a cada chamada, o cache nunca acertaria e a resposta da IA
// oscilaria sem motivo. Nada aqui usa IA, aleatoriedade ou relógio implícito.
//
// Estratégia de seleção: as primeiras 2 mensagens (contexto de origem) e as
// últimas N (estado atual). O miolo vira uma linha de elisão com a contagem.
// ============================================================================

import { sanitizeForPrompt } from "./redact";
import {
  MAX_CONTEXT_MESSAGES,
  MAX_MESSAGE_CHARS,
  MAX_SUMMARY_CHARS,
  type LastSpeaker,
  type SafeMessage,
} from "./types";

const ROLE_LABEL: Record<SafeMessage["role"], string> = {
  cliente: "Cliente",
  vendedor: "Vendedor",
  sistema: "Sistema",
};

/** Ordena por data crescente sem mutar a entrada. */
function chronological(messages: SafeMessage[]): SafeMessage[] {
  return [...messages].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );
}

/** Quem falou por último — sinal central para escolher o tom da retomada. */
export function lastSpeakerOf(messages: SafeMessage[]): LastSpeaker {
  const ordered = chronological(messages).filter((m) => m.role !== "sistema");
  const last = ordered[ordered.length - 1];
  if (!last) return "ninguem";
  return last.role === "cliente" ? "cliente" : "vendedor";
}

/**
 * Monta o resumo seguro. Sempre mascarado, sempre limitado, sempre com a
 * mesma saída para a mesma entrada.
 */
export function buildSafeSummary(
  messages: SafeMessage[],
  opts: { maxMessages?: number; maxChars?: number } = {},
): string {
  const maxMessages = opts.maxMessages ?? MAX_CONTEXT_MESSAGES;
  const maxChars = opts.maxChars ?? MAX_SUMMARY_CHARS;

  const ordered = chronological(messages).filter((m) => m.text && m.text.trim());
  if (ordered.length === 0) return "(sem histórico de mensagens)";

  let selected: SafeMessage[] = ordered;
  let elided = 0;
  if (ordered.length > maxMessages) {
    const head = ordered.slice(0, 2);
    const tail = ordered.slice(ordered.length - (maxMessages - 2));
    elided = ordered.length - head.length - tail.length;
    selected = [...head, ...tail];
  }

  const lines: string[] = [];
  selected.forEach((m, i) => {
    if (elided > 0 && i === 2) {
      lines.push(`… (${elided} mensagens intermediárias omitidas)`);
    }
    const text = sanitizeForPrompt(m.text, MAX_MESSAGE_CHARS);
    if (!text) return;
    lines.push(`${ROLE_LABEL[m.role]}: ${text}`);
  });

  let out = lines.join("\n");
  if (out.length > maxChars) out = `${out.slice(0, maxChars - 1)}…`;
  return out;
}

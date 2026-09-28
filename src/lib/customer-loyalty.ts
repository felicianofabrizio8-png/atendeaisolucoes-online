// Classificação de relacionamento do cliente ("novo" vs "fiel").
//
// A regra olha para o histórico de ENTRADA do contato — quantas vezes ele já
// abriu conversa com a empresa e quantas dessas conversas viraram venda. Não
// depende de nenhum campo novo no banco: `totalConversations` sai da contagem
// de conversas do lead e `closedDeals` da contagem de leads/orçamentos
// marcados como fechados para o mesmo telefone.
//
// Tiers (do mais frio para o mais quente):
//   novo        → primeira entrada, nunca comprou
//   recorrente  → já voltou a falar mais de uma vez, mas ainda não comprou
//   cliente     → comprou uma vez
//   fiel        → comprou 2+ vezes, ou comprou e continua voltando

export type CustomerTier = "novo" | "recorrente" | "cliente" | "fiel";

export interface CustomerHistory {
  /** ISO da primeira vez que o contato entrou (primeira mensagem registrada). */
  firstContactAt: string;
  /** Quantas conversas distintas esse contato já abriu, incluindo a atual. */
  totalConversations: number;
  /** Quantas dessas conversas viraram venda fechada. */
  closedDeals: number;
  /** ISO da última compra, quando houve. */
  lastPurchaseAt?: string | null;
  /** Soma em BRL do que já comprou. */
  totalSpent?: number;
}

export interface CustomerTierInfo {
  tier: CustomerTier;
  label: string;
  emoji: string;
  /** Frase curta explicando por que o contato caiu nesse tier. */
  reason: string;
  /** Token de cor do design system usado no badge. */
  color: string;
}

const TIER_STYLE: Record<CustomerTier, Omit<CustomerTierInfo, "tier" | "reason">> = {
  novo: { label: "Novo", emoji: "✦", color: "var(--primary)" },
  recorrente: { label: "Recorrente", emoji: "↻", color: "var(--status-warm)" },
  cliente: { label: "Cliente", emoji: "✓", color: "var(--status-won)" },
  fiel: { label: "Fiel", emoji: "🔥", color: "var(--status-hot)" },
};

const DAY_MS = 86_400_000;

function daysBetween(fromIso: string, now: number): number {
  const from = new Date(fromIso).getTime();
  if (!Number.isFinite(from)) return 0;
  return Math.max(0, Math.floor((now - from) / DAY_MS));
}

/** Tempo de casa em formato humano: "há 3 dias", "há 4 meses", "há 2 anos". */
export function relationshipAge(history: CustomerHistory, now = Date.now()): string {
  const days = daysBetween(history.firstContactAt, now);
  if (days < 1) return "hoje";
  if (days === 1) return "há 1 dia";
  if (days < 30) return `há ${days} dias`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? "há 1 mês" : `há ${months} meses`;
  const years = Math.floor(months / 12);
  return years === 1 ? "há 1 ano" : `há ${years} anos`;
}

export function classifyCustomer(history: CustomerHistory, now = Date.now()): CustomerTierInfo {
  const conversations = Math.max(1, history.totalConversations);
  const deals = Math.max(0, history.closedDeals);
  const age = relationshipAge(history, now);

  if (deals >= 2) {
    return {
      tier: "fiel",
      ...TIER_STYLE.fiel,
      reason: `${deals} compras fechadas · cliente ${age}`,
    };
  }

  if (deals === 1 && conversations >= 3) {
    return {
      tier: "fiel",
      ...TIER_STYLE.fiel,
      reason: `Comprou e voltou ${conversations - 1}x · cliente ${age}`,
    };
  }

  if (deals === 1) {
    return {
      tier: "cliente",
      ...TIER_STYLE.cliente,
      reason: `1 compra fechada · cliente ${age}`,
    };
  }

  if (conversations >= 2) {
    return {
      tier: "recorrente",
      ...TIER_STYLE.recorrente,
      reason: `${conversations}ª vez que entra em contato · sem compra ainda`,
    };
  }

  return {
    tier: "novo",
    ...TIER_STYLE.novo,
    reason: `Primeira conversa · entrou ${age}`,
  };
}

/** Linha de resumo do histórico, usada no painel de informações. */
export function describeHistory(history: CustomerHistory, now = Date.now()): string {
  const parts = [
    `${history.totalConversations} conversa${history.totalConversations === 1 ? "" : "s"}`,
  ];
  if (history.closedDeals > 0) {
    parts.push(`${history.closedDeals} venda${history.closedDeals === 1 ? "" : "s"}`);
  }
  if (history.totalSpent && history.totalSpent > 0) {
    parts.push(
      history.totalSpent.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
        maximumFractionDigits: 0,
      }),
    );
  }
  parts.push(`primeiro contato ${relationshipAge(history, now)}`);
  return parts.join(" · ");
}

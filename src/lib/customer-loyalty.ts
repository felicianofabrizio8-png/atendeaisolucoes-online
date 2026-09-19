export type CustomerTier = "novo" | "recorrente" | "cliente" | "fiel";

export interface CustomerHistory {
  firstContactAt: string;
  totalConversations: number;
  closedDeals: number;
  lastPurchaseAt?: string | null;
  totalSpent?: number;
}

export interface CustomerTierInfo {
  tier: CustomerTier;
  label: string;
  emoji: string;
  reason: string;
  color: string;
}

const styles: Record<CustomerTier, Omit<CustomerTierInfo, "tier" | "reason">> = {
  novo: { label: "Novo", emoji: "✦", color: "var(--primary)" },
  recorrente: { label: "Recorrente", emoji: "↻", color: "var(--status-warm)" },
  cliente: { label: "Cliente", emoji: "✓", color: "var(--status-won)" },
  fiel: { label: "Fiel", emoji: "🔥", color: "var(--status-hot)" },
};

function age(firstContactAt: string, now: number): string {
  const days = Math.max(0, Math.floor((now - new Date(firstContactAt).getTime()) / 86_400_000));
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
  const joined = age(history.firstContactAt, now);
  if (deals >= 2) return { tier: "fiel", ...styles.fiel, reason: `${deals} compras fechadas · cliente ${joined}` };
  if (deals === 1 && conversations >= 3) return { tier: "fiel", ...styles.fiel, reason: `Comprou e voltou ${conversations - 1}x · cliente ${joined}` };
  if (deals === 1) return { tier: "cliente", ...styles.cliente, reason: `1 compra fechada · cliente ${joined}` };
  if (conversations >= 2) return { tier: "recorrente", ...styles.recorrente, reason: `${conversations}ª vez que entra em contato · sem compra ainda` };
  return { tier: "novo", ...styles.novo, reason: `Primeira conversa · entrou ${joined}` };
}

export function describeHistory(history: CustomerHistory, now = Date.now()): string {
  const parts = [`${history.totalConversations} conversa${history.totalConversations === 1 ? "" : "s"}`];
  if (history.closedDeals > 0) parts.push(`${history.closedDeals} venda${history.closedDeals === 1 ? "" : "s"}`);
  if (history.totalSpent && history.totalSpent > 0) {
    parts.push(history.totalSpent.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }));
  }
  parts.push(`primeiro contato ${age(history.firstContactAt, now)}`);
  return parts.join(" · ");
}

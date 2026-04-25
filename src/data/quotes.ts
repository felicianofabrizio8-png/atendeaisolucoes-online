// Store em memória de orçamentos. Substituir por backend (Supabase) depois.
// Usa um pequeno pub/sub para componentes React reagirem a inserções.

import { formatBRL } from "./mock";
import { activePrice, getProduct, type Product } from "./products";

export type PaymentMethod = "Pix" | "Cartão de crédito" | "Boleto" | "Transferência" | "Dinheiro";

export interface Quote {
  id: string;
  leadId: string;
  conversationId?: string;
  productId: string;
  productName: string;
  unitPrice: number; // preço base do produto no momento da criação
  discount: number; // valor absoluto em R$
  finalValue: number; // unitPrice - discount
  paymentMethod: PaymentMethod;
  installments: number; // 1 = à vista
  validUntil: string; // ISO date
  message: string;
  createdAt: string;
  sent: boolean;
}

const quotes: Quote[] = [];
const listeners = new Set<() => void>();
let snapshot: Quote[] = [];

function rebuildSnapshot() {
  snapshot = [...quotes].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

function notify() {
  rebuildSnapshot();
  for (const l of listeners) l();
}

export function subscribeQuotes(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// CRITICAL: returns a stable reference between mutations so useSyncExternalStore
// doesn't loop. The snapshot is rebuilt only inside notify().
export function listQuotes(): Quote[] {
  return snapshot;
}

export function quotesForLead(leadId: string): Quote[] {
  return snapshot.filter((q) => q.leadId === leadId);
}

export function getQuote(id: string): Quote | undefined {
  return quotes.find((q) => q.id === id);
}

export interface QuoteInput {
  leadId: string;
  conversationId?: string;
  productId: string;
  discount: number;
  paymentMethod: PaymentMethod;
  installments: number;
  validUntil: string;
}

export function buildQuoteMessage(args: {
  product: Product;
  finalValue: number;
  installments: number;
  paymentMethod: PaymentMethod;
  validUntil: string;
  discount: number;
}): string {
  const { product, finalValue, installments, paymentMethod, validUntil, discount } = args;
  const validStr = new Date(validUntil).toLocaleDateString("pt-BR");
  const lines: string[] = [];
  lines.push(`Seu orçamento de *${product.name}* ficou em *${formatBRL(finalValue)}*.`);
  if (discount > 0) {
    lines.push(`Aplicamos um desconto de ${formatBRL(discount)} para fechar com você. 🎉`);
  }
  if (installments > 1) {
    const parcela = finalValue / installments;
    lines.push(
      `Pode ser parcelado em até *${installments}x de ${formatBRL(parcela)}* no ${paymentMethod.toLowerCase()}.`,
    );
  } else {
    lines.push(`Forma de pagamento: *${paymentMethod}* (à vista).`);
  }
  lines.push(`Proposta válida até *${validStr}*.`);
  lines.push("");
  lines.push("Posso reservar para você?");
  return lines.join("\n");
}

export function createQuote(input: QuoteInput): Quote {
  const product = getProduct(input.productId);
  if (!product) throw new Error("Produto não encontrado");
  const unitPrice = activePrice(product);
  const discount = Math.max(0, Math.min(input.discount, unitPrice));
  const finalValue = Math.max(0, unitPrice - discount);
  const message = buildQuoteMessage({
    product,
    finalValue,
    installments: input.installments,
    paymentMethod: input.paymentMethod,
    validUntil: input.validUntil,
    discount,
  });
  const quote: Quote = {
    id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    leadId: input.leadId,
    conversationId: input.conversationId,
    productId: product.id,
    productName: product.name,
    unitPrice,
    discount,
    finalValue,
    paymentMethod: input.paymentMethod,
    installments: input.installments,
    validUntil: input.validUntil,
    message,
    createdAt: new Date().toISOString(),
    sent: false,
  };
  quotes.unshift(quote);
  notify();
  return quote;
}

export function markQuoteSent(id: string) {
  const q = quotes.find((x) => x.id === id);
  if (q) {
    q.sent = true;
    notify();
  }
}

// Store de orçamentos com dois modos:
//  - "demo": memória local (não persiste).
//  - "remote": grava na tabela `quotes` do Supabase, vinculando lead_id, product_id
//    e conversation_id. Realtime mantém a UI sincronizada entre sessões.
//
// A API pública (createQuote, listQuotes, getQuote, markQuoteSent, etc.) é mantida.

import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "./mock";
import { activePrice, getProduct, type Product } from "./products";

export type PaymentMethod = "Pix" | "Cartão de crédito" | "Boleto" | "Transferência" | "Dinheiro";

export type QuoteStatus = "pendente" | "enviado" | "visualizado" | "aprovado" | "vencido";

export interface Quote {
  id: string;
  leadId: string;
  conversationId?: string;
  productId: string;
  productName: string;
  unitPrice: number;
  discount: number;
  finalValue: number;
  paymentMethod: PaymentMethod;
  installments: number;
  validUntil: string;
  message: string;
  createdAt: string;
  sent: boolean;
  sentAt?: string;
  viewedAt?: string;
  externalMessageId?: string;
  rawStatus?: string;
}

export function computeQuoteStatus(q: Quote): QuoteStatus {
  if (q.rawStatus === "aceito") return "aprovado";
  const today = new Date().toISOString().slice(0, 10);
  if (q.rawStatus === "expirado" || (q.validUntil && q.validUntil < today && !q.sent)) return "vencido";
  if (q.viewedAt || q.rawStatus === "visualizado") return "visualizado";
  if (q.sent) return "enviado";
  return "pendente";
}

// ---------- estado ----------
type Mode = "demo" | "remote";
let mode: Mode = "demo";
let companyId: string | null = null;
let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;

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

// ---------- mappers ----------
type DbQuote = {
  id: string;
  lead_id: string | null;
  conversation_id: string | null;
  product_id: string | null;
  product_name: string | null;
  unit_price: number | string | null;
  discount: number | string | null;
  final_value: number | string | null;
  payment_method: string | null;
  installments: number | null;
  valid_until: string | null;
  message: string | null;
  sent: boolean | null;
  created_at: string;
  sent_at?: string | null;
  viewed_at?: string | null;
  external_message_id?: string | null;
  status?: string | null;
};

const QUOTE_SELECT =
  "id,lead_id,conversation_id,product_id,product_name,unit_price,discount,final_value,payment_method,installments,valid_until,message,sent,created_at,sent_at,viewed_at,external_message_id,status";

function toQuote(r: DbQuote): Quote {
  return {
    id: r.id,
    leadId: r.lead_id ?? "",
    conversationId: r.conversation_id ?? undefined,
    productId: r.product_id ?? "",
    productName: r.product_name ?? "",
    unitPrice: r.unit_price != null ? Number(r.unit_price) : 0,
    discount: r.discount != null ? Number(r.discount) : 0,
    finalValue: r.final_value != null ? Number(r.final_value) : 0,
    paymentMethod: (r.payment_method as PaymentMethod) ?? "Pix",
    installments: r.installments ?? 1,
    validUntil: r.valid_until ?? new Date().toISOString().slice(0, 10),
    message: r.message ?? "",
    createdAt: r.created_at,
    sent: !!r.sent,
    sentAt: r.sent_at ?? undefined,
    viewedAt: r.viewed_at ?? undefined,
    externalMessageId: r.external_message_id ?? undefined,
    rawStatus: r.status ?? undefined,
  };
}

// ---------- modo & realtime ----------
export function getQuotesMode(): Mode {
  return mode;
}

export function setQuotesMode(next: Mode) {
  if (mode === next) return;
  mode = next;
  if (next === "demo") {
    quotes.length = 0;
    detachRealtime();
    companyId = null;
    notify();
  }
}

function attachRealtime(cid: string) {
  detachRealtime();
  realtimeChannel = supabase
    .channel(`quotes-${cid}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "quotes", filter: `company_id=eq.${cid}` },
      (payload) => {
        if (payload.eventType === "INSERT") {
          const q = toQuote(payload.new as DbQuote);
          if (!quotes.some((x) => x.id === q.id)) {
            quotes.unshift(q);
            notify();
          }
        } else if (payload.eventType === "UPDATE") {
          const q = toQuote(payload.new as DbQuote);
          const idx = quotes.findIndex((x) => x.id === q.id);
          if (idx >= 0) {
            quotes[idx] = q;
            notify();
          }
        } else if (payload.eventType === "DELETE") {
          const oldId = (payload.old as { id?: string }).id;
          if (oldId) {
            const idx = quotes.findIndex((x) => x.id === oldId);
            if (idx >= 0) {
              quotes.splice(idx, 1);
              notify();
            }
          }
        }
      },
    )
    .subscribe();
}

function detachRealtime() {
  if (realtimeChannel) {
    void supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

// ---------- carga remota ----------
export async function loadQuotesRemote(cid: string) {
  companyId = cid;
  mode = "remote";
  const { data, error } = await supabase
    .from("quotes")
    .select(QUOTE_SELECT)
    .eq("company_id", cid)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("loadQuotesRemote", error);
    return;
  }
  quotes.length = 0;
  for (const row of data ?? []) quotes.push(toQuote(row as DbQuote));
  attachRealtime(cid);
  notify();
}

// ---------- mutações ----------
export async function createQuote(input: QuoteInput): Promise<Quote> {
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

  if (mode === "remote" && companyId) {
    const { data, error } = await supabase
      .from("quotes")
      .insert({
        company_id: companyId,
        lead_id: input.leadId,
        conversation_id: input.conversationId ?? null,
        product_id: product.id,
        product_name: product.name,
        unit_price: unitPrice,
        discount,
        final_value: finalValue,
        total: finalValue,
        payment_method: input.paymentMethod,
        installments: input.installments,
        valid_until: input.validUntil,
        message,
        sent: false,
        status: "rascunho",
        items: [
          {
            product_id: product.id,
            name: product.name,
            unit_price: unitPrice,
            quantity: 1,
            discount,
            total: finalValue,
          },
        ],
      })
      .select(QUOTE_SELECT)
      .single();
    if (error) throw error;
    const quote = toQuote(data as DbQuote);
    if (!quotes.some((q) => q.id === quote.id)) {
      quotes.unshift(quote);
      notify();
    }
    return quote;
  }

  // demo
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

export async function markQuoteSent(
  id: string,
  meta?: { externalMessageId?: string; conversationId?: string },
): Promise<void> {
  const nowIso = new Date().toISOString();
  const q = quotes.find((x) => x.id === id);
  if (q) {
    q.sent = true;
    q.sentAt = nowIso;
    if (meta?.externalMessageId) q.externalMessageId = meta.externalMessageId;
    if (meta?.conversationId) q.conversationId = meta.conversationId;
    q.rawStatus = "enviado";
    notify();
  }
  if (mode === "remote" && companyId) {
    const patch: {
      sent: boolean;
      status: "enviado";
      sent_at: string;
      external_message_id?: string;
      conversation_id?: string;
    } = { sent: true, status: "enviado", sent_at: nowIso };
    if (meta?.externalMessageId) patch.external_message_id = meta.externalMessageId;
    if (meta?.conversationId) patch.conversation_id = meta.conversationId;
    const { error } = await supabase.from("quotes").update(patch).eq("id", id);
    if (error) console.error("markQuoteSent", error);
  }
}

/**
 * Sends a quote message through WhatsApp Cloud API via the meta-send edge function.
 * Returns the new/existing conversationId so the caller can open the chat.
 */
export async function sendQuoteWhatsApp(args: {
  quoteId: string;
  phone: string;
  contactName?: string;
  leadId?: string;
  text: string;
  imageUrls?: string[];
}): Promise<{ conversationId?: string; messageId?: string }> {
  console.log("QUOTE_SEND_WA_START", {
    quoteId: args.quoteId,
    phone: args.phone,
    images: args.imageUrls?.length ?? 0,
  });
  const { data, error } = await supabase.functions.invoke("meta-send", {
    body: {
      channel: "whatsapp",
      phone: args.phone,
      contactName: args.contactName,
      leadId: args.leadId,
      text: args.text,
      imageUrls: args.imageUrls,
    },
  });
  if (error) {
    console.error("QUOTE_SEND_WA_ERROR", error);
    throw new Error(error.message || "Falha ao enviar pelo WhatsApp");
  }
  const payload = (data ?? {}) as {
    ok?: boolean;
    error?: string;
    messageId?: string;
    conversationId?: string;
  };
  if (!payload.ok) {
    console.error("QUOTE_SEND_WA_ERROR", payload);
    throw new Error(payload.error || "Falha ao enviar pelo WhatsApp");
  }
  await markQuoteSent(args.quoteId, {
    externalMessageId: payload.messageId,
    conversationId: payload.conversationId,
  });
  console.log("QUOTE_SEND_WA_SUCCESS", payload);
  return { conversationId: payload.conversationId, messageId: payload.messageId };
}


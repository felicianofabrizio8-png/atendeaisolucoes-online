// Ações comerciais de uma conversa, compartilhadas pela Caixa de atendimento
// (`/inbox/$conversationId`) e pelo Atendimento 2.0 (`/atendimento`).
//
// Cada função faz a mutação e a auditoria e devolve o texto da mensagem de
// sistema que a tela mostra no histórico. Estado de UI (modais abertos,
// mensagens locais, toasts) continua em cada tela — só a regra mora aqui, para
// as duas superfícies não divergirem.

import { supabase } from "@/integrations/supabase/client";
import { markLeadLost, markLeadWon, updateLeadNextAction } from "@/data/leadRepo";
import { recordAudit } from "@/lib/audit";
import { formatBRL, type Lead, type Message } from "@/data/mock";
import { messageForAi } from "@/components/inbox/message/MessageBubble";

export type VisitType = "visita_tecnica" | "loja" | "retorno_comercial" | "instalacao";

export interface VisitPayload {
  date: string;
  time: string;
  address: string;
  appointmentType: VisitType;
  confirmed: boolean;
  notes: string;
}

export interface NextActionPayload {
  label: string;
  dueAt: string;
  notes?: string;
}

const VISIT_TYPE_LABEL: Record<VisitType, string> = {
  visita_tecnica: "Visita técnica",
  loja: "Cliente na loja",
  retorno_comercial: "Retorno comercial",
  instalacao: "Instalação",
};

async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Marca a venda como ganha. Não aguarda a gravação: a UI reflete na hora. */
export function closeSale(leadId: string, value: number): string {
  void markLeadWon(leadId, value);
  recordAudit({ action: "mark_lead_won", entity: "lead", entityId: leadId, after: { value } });
  return `✅ Venda fechada — ${formatBRL(value)}`;
}

export function markLost(leadId: string, reason: string, notes?: string): string {
  void markLeadLost(leadId, reason);
  recordAudit({
    action: "mark_lead_lost",
    entity: "lead",
    entityId: leadId,
    after: { reason, notes: notes ?? null },
  });
  const detail = notes ? ` — ${reason} (${notes})` : ` — ${reason}`;
  return `❌ Lead marcado como perdido${detail}`;
}

export async function saveNextAction(leadId: string, payload: NextActionPayload): Promise<string> {
  await updateLeadNextAction(leadId, { label: payload.label, dueAt: payload.dueAt });
  recordAudit({ action: "create_next_action", entity: "lead", entityId: leadId, after: payload });
  return `🎯 Próxima ação: ${payload.label} — ${new Date(payload.dueAt).toLocaleString("pt-BR")}`;
}

/** Cria a visita e a espelha como próxima ação do lead. */
export async function scheduleVisit(args: {
  companyId: string;
  lead: Pick<Lead, "id" | "name" | "phone" | "product">;
  payload: VisitPayload;
}): Promise<string> {
  const { companyId, lead, payload } = args;
  const scheduledAt = new Date(`${payload.date}T${payload.time}:00`).toISOString();
  const typeLabel = VISIT_TYPE_LABEL[payload.appointmentType];
  const { data, error } = await supabase
    .from("visits")
    .insert({
      company_id: companyId,
      title: `${typeLabel} — ${lead.name}`,
      appointment_type: payload.appointmentType,
      address: payload.appointmentType === "loja" ? null : payload.address || null,
      scheduled_at: scheduledAt,
      status: payload.confirmed ? "confirmada" : "agendada",
      notes: payload.notes || null,
      customer_name: lead.name,
      customer_phone: lead.phone ?? null,
      product: lead.product ?? null,
      lead_id: lead.id,
    })
    .select("id")
    .single();
  if (error) throw error;
  recordAudit({
    action: "schedule_visit",
    entity: "visit",
    entityId: data?.id ?? null,
    after: { leadId: lead.id, scheduledAt, type: payload.appointmentType },
  });
  await updateLeadNextAction(lead.id, { label: typeLabel, dueAt: scheduledAt });
  return `📅 ${typeLabel} agendada — ${new Date(scheduledAt).toLocaleString("pt-BR")}`;
}

/** Humano assume a conversa: a IA fica pausada para ela. */
export async function takeOverConversation(conversationId: string): Promise<void> {
  const token = await accessToken();
  const res = await fetch("/api/ai/agent-takeover", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ conversation_id: conversationId }),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Falha ao assumir");
}

/** Devolve a conversa para a IA: ela volta a atuar na próxima mensagem do cliente. */
export async function releaseConversationToAi(conversationId: string): Promise<void> {
  const token = await accessToken();
  const res = await fetch("/api/ai/agent-takeover", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ conversation_id: conversationId, action: "release" }),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Falha ao devolver para a IA");
}

/**
 * Produto sugerido para um orçamento novo. Falha silenciosa por contrato: sem
 * sugestão o vendedor escolhe o produto manualmente.
 */
export async function suggestQuoteProduct(args: {
  lead: Pick<Lead, "name" | "product">;
  messages: Message[];
}): Promise<{ productId: string; reason: string } | null> {
  try {
    const token = await accessToken();
    if (!token) return null;
    const res = await fetch("/api/ai/suggest-product", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        leadName: args.lead.name,
        product: args.lead.product,
        messages: args.messages.map((m) => messageForAi(m)),
      }),
    });
    if (!res.ok) return null;
    return (await res.json()) as { productId: string; reason: string };
  } catch {
    return null;
  }
}

/** Rótulo curto de uma mensagem para citação ("Respondendo a…"). */
export function quotedPreview(m: Pick<Message, "text" | "sourceSubtype">, max = 160): string {
  const t = (m.text ?? "").trim();
  if (t) return t.length > max ? `${t.slice(0, max)}…` : t;
  const sub = (m.sourceSubtype ?? "").toLowerCase();
  if (sub === "image") return "📷 Foto";
  if (sub === "video") return "🎥 Vídeo";
  if (sub === "audio") return "🎤 Áudio";
  if (sub === "document") return "📎 Documento";
  if (sub === "sticker") return "🌟 Sticker";
  if (sub === "location") return "📍 Localização";
  return "[mensagem]";
}

/** Id externo da mensagem citada; sem ele o WhatsApp não aceita reply nativo. */
export function replyExternalId(m: Message): string | null {
  return (
    ((m as unknown as { externalId?: string | null }).externalId ?? null) ||
    ((m.sourceMetadata as { external_id?: string } | undefined)?.external_id ?? null)
  );
}

/** Texto final quando a citação não pode ir como reply nativo: prefixa a citação. */
export function withInlineQuote(text: string, quoted: Message): string {
  return `Respondendo:\n\n"${quotedPreview(quoted)}"\n\n${text}`;
}

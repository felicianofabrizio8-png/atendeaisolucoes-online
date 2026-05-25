// Repositório unificado de leads/conversas/mensagens.
// - Quando autenticado: lê e escreve no Supabase (filtrado por company_id via RLS).
// - Quando em modo demo (não autenticado): usa o store em memória do mock.
// Mantém a mesma forma de Lead/Conversation/Message do mock para minimizar
// refatoração nas telas.

import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  conversations as mockConversations,
  leads as mockLeads,
  messages as mockMessages,
  type Conversation,
  type Lead,
  type Message,
} from "@/data/mock";
import {
  appendMessage as appendMessageMock,
  markLeadLost as markLeadLostMock,
  markLeadWon as markLeadWonMock,
  subscribeLeadStore,
  getLeadsSnapshot,
  getMessagesSnapshot,
} from "@/data/leadStore";

// ---------- estado em memória sincronizado com o supabase ----------
type Mode = "demo" | "remote";

let mode: Mode = "demo";
let remoteLeads: Lead[] = [];
let remoteConversations: Conversation[] = [];
let remoteMessages: Message[] = [];
let remoteLoaded = false;
let loadingPromise: Promise<void> | null = null;
let realtimeChannel: RealtimeChannel | null = null;
let realtimeCompanyId: string | null = null;
let currentSlaMinutes = 30;

const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export function subscribeRepo(cb: () => void): () => void {
  listeners.add(cb);
  // também escuta mutações do mock pra propagar quando em demo
  const unsubMock = subscribeLeadStore(() => {
    if (mode === "demo") cb();
  });
  return () => {
    listeners.delete(cb);
    unsubMock();
  };
}

export function getRepoMode(): Mode {
  return mode;
}

export function setRepoMode(next: Mode) {
  if (mode === next) return;
  mode = next;
  if (next === "demo") {
    remoteLeads = [];
    remoteConversations = [];
    remoteMessages = [];
    remoteLoaded = false;
    unsubscribeRealtime();
  }
  notify();
}

// ---------- mappers ----------
type DbLead = {
  id: string;
  name: string;
  phone: string | null;
  handle: string | null;
  channel: "whatsapp" | "instagram" | "facebook";
  status: Lead["status"];
  tags: string[] | null;
  estimated_value: number | string | null;
  product: string | null;
  next_action_label: string | null;
  next_action_due_at: string | null;
  loss_reason: string | null;
  lost_at: string | null;
  closed_value: number | string | null;
  closed_at: string | null;
  created_at: string;
};

function toLead(r: DbLead): Lead {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone ?? undefined,
    handle: r.handle ?? undefined,
    channel: r.channel,
    status: r.status,
    tags: r.tags ?? [],
    estimatedValue: r.estimated_value != null ? Number(r.estimated_value) : undefined,
    product: r.product ?? undefined,
    nextAction:
      r.next_action_label && r.next_action_due_at
        ? { label: r.next_action_label, dueAt: r.next_action_due_at }
        : undefined,
    createdAt: r.created_at,
    closedAt: r.closed_at ?? undefined,
    closedValue: r.closed_value != null ? Number(r.closed_value) : undefined,
    lostAt: r.lost_at ?? undefined,
    lossReason: r.loss_reason ?? undefined,
  };
}

type DbConversation = {
  id: string;
  lead_id: string;
  channel: "whatsapp" | "instagram" | "facebook";
  last_message_at: string;
  unread: number;
  awaiting_reply: boolean;
  interaction_type?: string;
};

function toConversation(r: DbConversation, slaMinutes: number): Conversation {
  const ageMin = (Date.now() - new Date(r.last_message_at).getTime()) / 60_000;
  return {
    id: r.id,
    leadId: r.lead_id,
    channel: r.channel,
    lastMessageAt: r.last_message_at,
    unread: r.unread,
    awaitingReply: r.awaiting_reply,
    slaBreached: r.awaiting_reply && ageMin >= slaMinutes,
    interactionType: (r.interaction_type ?? "direct_message") as
      | "direct_message"
      | "comment",
  };
}

type DbMessage = {
  id: string;
  conversation_id: string;
  role: Message["role"];
  text: string;
  at: string;
  source_subtype?: string | null;
  source_metadata?: Record<string, unknown> | null;
};

function toMessage(r: DbMessage): Message {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    role: r.role,
    text: r.text,
    at: r.at,
    sourceSubtype: r.source_subtype ?? undefined,
    sourceMetadata: r.source_metadata ?? undefined,
  };
}

// ---------- API pública ----------
export function getLeads(): Lead[] {
  return mode === "remote" ? remoteLeads : getLeadsSnapshot();
}

export function getConversations(): Conversation[] {
  if (mode === "remote") return remoteConversations;
  return mockConversations;
}

export function getMessagesFor(conversationId: string): Message[] {
  const list = mode === "remote" ? remoteMessages : getMessagesSnapshot();
  return list
    .filter((m) => m.conversationId === conversationId)
    .sort((a, b) => +new Date(a.at) - +new Date(b.at));
}

export function getLeadById(id: string): Lead | undefined {
  return getLeads().find((l) => l.id === id);
}

export function getConversationById(id: string): Conversation | undefined {
  return getConversations().find((c) => c.id === id);
}

// ---------- carga remota ----------
export async function loadRemote(companyId: string, slaMinutes = 30) {
  if (loadingPromise) return loadingPromise;
  currentSlaMinutes = slaMinutes;
  loadingPromise = (async () => {
    const [{ data: ls }, { data: cs }, { data: ms }] = await Promise.all([
      supabase
        .from("leads")
        .select(
          "id,name,phone,handle,channel,status,tags,estimated_value,product,next_action_label,next_action_due_at,loss_reason,lost_at,closed_value,closed_at,created_at",
        )
        .eq("company_id", companyId),
      supabase
        .from("conversations")
        .select("id,lead_id,channel,last_message_at,unread,awaiting_reply")
        .eq("company_id", companyId),
      supabase
        .from("messages")
        .select("id,conversation_id,role,text,at")
        .eq("company_id", companyId)
        .order("at", { ascending: true }),
    ]);
    remoteLeads = (ls ?? []).map((r) => toLead(r as DbLead));
    remoteConversations = (cs ?? []).map((r) =>
      toConversation(r as DbConversation, slaMinutes),
    );
    remoteMessages = (ms ?? []).map((r) => toMessage(r as DbMessage));
    remoteLoaded = true;
    mode = "remote";
    notify();
    subscribeRealtime(companyId);
  })();
  try {
    await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

export function isRemoteLoaded() {
  return remoteLoaded;
}

// ---------- realtime (mensagens chegando via webhook) ----------
function subscribeRealtime(companyId: string) {
  if (realtimeCompanyId === companyId && realtimeChannel) return;
  if (realtimeChannel) {
    void supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  realtimeCompanyId = companyId;
  realtimeChannel = supabase
    .channel(`inbox-${companyId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `company_id=eq.${companyId}`,
      },
      (payload) => {
        const row = payload.new as DbMessage & { company_id: string };
        // Dedup: se já temos essa msg em memória (id ou external_id local), ignora.
        if (remoteMessages.some((m) => m.id === row.id)) return;
        remoteMessages = [...remoteMessages, toMessage(row)];
        notify();
      },
    )
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "leads",
        filter: `company_id=eq.${companyId}`,
      },
      (payload) => {
        const row = payload.new as DbLead;
        if (remoteLeads.some((l) => l.id === row.id)) return;
        remoteLeads = [...remoteLeads, toLead(row)];
        notify();
      },
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "conversations",
        filter: `company_id=eq.${companyId}`,
      },
      (payload) => {
        if (payload.eventType === "DELETE") {
          const old = payload.old as { id?: string };
          if (!old.id) return;
          remoteConversations = remoteConversations.filter((c) => c.id !== old.id);
          notify();
          return;
        }
        const row = payload.new as DbConversation;
        const next = toConversation(row, currentSlaMinutes);
        const exists = remoteConversations.some((c) => c.id === next.id);
        remoteConversations = exists
          ? remoteConversations.map((c) => (c.id === next.id ? next : c))
          : [...remoteConversations, next];
        notify();
      },
    )
    .subscribe();
}

export function unsubscribeRealtime() {
  if (realtimeChannel) {
    void supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
    realtimeCompanyId = null;
  }
}

// ---------- mutations ----------
export async function markLeadWon(leadId: string, value: number) {
  if (mode === "demo") {
    markLeadWonMock(leadId, value);
    return;
  }
  const closedAt = new Date().toISOString();
  await supabase
    .from("leads")
    .update({ status: "fechado", closed_value: value, closed_at: closedAt })
    .eq("id", leadId);
  remoteLeads = remoteLeads.map((l) =>
    l.id === leadId
      ? { ...l, status: "fechado", closedValue: value, closedAt }
      : l,
  );
  notify();
}

export async function markLeadLost(leadId: string, reason: string) {
  if (mode === "demo") {
    markLeadLostMock(leadId, reason);
    return;
  }
  const lostAt = new Date().toISOString();
  await supabase
    .from("leads")
    .update({ status: "perdido", loss_reason: reason, lost_at: lostAt })
    .eq("id", leadId);
  remoteLeads = remoteLeads.map((l) =>
    l.id === leadId
      ? { ...l, status: "perdido", lossReason: reason, lostAt }
      : l,
  );
  notify();
}

export async function appendMessage(
  message: Omit<Message, "id"> & { id?: string },
  companyId?: string,
) {
  if (mode === "demo") {
    appendMessageMock({
      ...message,
      id: message.id ?? `m-${Date.now()}`,
    } as Message);
    return;
  }
  if (!companyId) throw new Error("companyId obrigatório no modo remoto");
  const { data, error } = await supabase
    .from("messages")
    .insert({
      company_id: companyId,
      conversation_id: message.conversationId,
      role: message.role,
      text: message.text,
      at: message.at,
    })
    .select("id,conversation_id,role,text,at")
    .single();
  if (error) throw error;

  const newMsg = toMessage(data as DbMessage);
  remoteMessages = [...remoteMessages, newMsg];

  // atualiza conversa
  const conv = remoteConversations.find((c) => c.id === message.conversationId);
  if (conv) {
    const updated: Partial<DbConversation> = { last_message_at: message.at };
    if (message.role === "agent") {
      updated.awaiting_reply = false;
      updated.unread = 0;
    } else if (message.role === "lead") {
      updated.awaiting_reply = true;
      updated.unread = (conv.unread ?? 0) + 1;
    }
    await supabase
      .from("conversations")
      .update(updated)
      .eq("id", conv.id);
    remoteConversations = remoteConversations.map((c) =>
      c.id === conv.id
        ? {
            ...c,
            lastMessageAt: message.at,
            awaitingReply:
              updated.awaiting_reply !== undefined
                ? updated.awaiting_reply
                : c.awaitingReply,
            unread: updated.unread !== undefined ? updated.unread : c.unread,
          }
        : c,
    );
  }
  notify();
}

// ---------- seed: copia o mock para o banco da empresa atual ----------
export async function seedMockIntoCompany(companyId: string) {
  // Mapa id mock -> id supabase pra preservar relações
  const leadIdMap = new Map<string, string>();
  const convIdMap = new Map<string, string>();

  for (const l of mockLeads) {
    const { data, error } = await supabase
      .from("leads")
      .insert({
        company_id: companyId,
        name: l.name,
        phone: l.phone ?? null,
        handle: l.handle ?? null,
        channel: l.channel,
        status: l.status,
        tags: l.tags,
        estimated_value: l.estimatedValue ?? null,
        product: l.product ?? null,
        next_action_label: l.nextAction?.label ?? null,
        next_action_due_at: l.nextAction?.dueAt ?? null,
        loss_reason: l.lossReason ?? null,
        lost_at: l.lostAt ?? null,
        closed_value: l.closedValue ?? null,
        closed_at: l.closedAt ?? null,
        created_at: l.createdAt,
      })
      .select("id")
      .single();
    if (error) throw error;
    leadIdMap.set(l.id, data.id);
  }

  for (const c of mockConversations) {
    const newLeadId = leadIdMap.get(c.leadId);
    if (!newLeadId) continue;
    const { data, error } = await supabase
      .from("conversations")
      .insert({
        company_id: companyId,
        lead_id: newLeadId,
        channel: c.channel,
        last_message_at: c.lastMessageAt,
        unread: c.unread,
        awaiting_reply: c.awaitingReply,
      })
      .select("id")
      .single();
    if (error) throw error;
    convIdMap.set(c.id, data.id);
  }

  for (const m of mockMessages) {
    const newConvId = convIdMap.get(m.conversationId);
    if (!newConvId) continue;
    await supabase.from("messages").insert({
      company_id: companyId,
      conversation_id: newConvId,
      role: m.role,
      text: m.text,
      at: m.at,
    });
  }
}

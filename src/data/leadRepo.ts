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
  addLead as addLeadMock,
} from "@/data/leadStore";
import {
  createMessageIndex,
  upsertMessage as idxUpsert,
  removeMessage as idxRemove,
  rebuildIndex as idxRebuild,
  getMessages as idxGet,
} from "@/data/message-index";


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

// P3 — Índice de mensagens por conversationId (O(1) por lookup).
// Substitui filter+sort O(N total) do antigo getMessagesFor.
const messagesIndex = createMessageIndex();

// P3 — Contador de versão do repo. Consumido via useSyncExternalStore para
// habilitar memoização real (`buildSortedItems`, etc.) sem depender de
// referências que trocam a cada render.
let repoVersion = 0;

// Paginação por conversa (Onda 2.2): histórico antigo via scroll-up.
const olderHasMore = new Map<string, boolean>();
const olderLoading = new Set<string>();
const recentLoaded = new Set<string>();


const listeners = new Set<() => void>();

function notify() {
  repoVersion++;
  for (const l of listeners) l();
}

export function getRepoVersion(): number {
  return repoVersion;
}

// ---------- emitter de novas mensagens de lead (observador) ----------
export type NewLeadMessageEvent = {
  messageId: string;
  externalId: string | null;
  conversationId: string;
  text: string;
  subtype: string | null;
  metadata: Record<string, unknown> | null;
  at: string;
};

const newLeadMessageListeners = new Set<(evt: NewLeadMessageEvent) => void>();

function emitNewLeadMessage(evt: NewLeadMessageEvent) {
  for (const l of newLeadMessageListeners) {
    try {
      l(evt);
    } catch {
      // ignore listener errors
    }
  }
}

export function subscribeNewLeadMessage(
  cb: (evt: NewLeadMessageEvent) => void,
): () => void {
  newLeadMessageListeners.add(cb);
  return () => {
    newLeadMessageListeners.delete(cb);
  };
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
    messagesIndex.clear();
    remoteLoaded = false;
    olderHasMore.clear();
    olderLoading.clear();
    recentLoaded.clear();
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
  ai_status?: string | null;
  ai_handling?: boolean;
  auto_reply_count?: number;
  human_takeover_at?: string | null;
  last_auto_reply_at?: string | null;
  detected_city?: string | null;
  detected_state?: string | null;
  detected_pool_size?: string | null;
  detected_intent?: string | null;
  detected_interest?: string | null;
  detected_budget?: string | null;
  purchase_timing?: string | null;
  customer_stage?: string | null;
  lead_temperature?: string | null;
  lead_score?: number;
  lead_ready_to_close?: boolean;
  detected_objections?: string[];
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
    aiStatus: r.ai_status ?? null,
    aiHandling: r.ai_handling ?? false,
    autoReplyCount: r.auto_reply_count ?? 0,
    humanTakeoverAt: r.human_takeover_at ?? null,
    lastAutoReplyAt: r.last_auto_reply_at ?? null,
    detectedCity: r.detected_city ?? null,
    detectedState: r.detected_state ?? null,
    detectedPoolSize: r.detected_pool_size ?? null,
    detectedIntent: r.detected_intent ?? null,
    detectedInterest: r.detected_interest ?? null,
    detectedBudget: r.detected_budget ?? null,
    purchaseTiming: r.purchase_timing ?? null,
    customerStage: r.customer_stage ?? null,
    leadTemperature: (r.lead_temperature as "frio" | "morno" | "quente" | null) ?? null,
    leadScore: r.lead_score ?? 0,
    leadReadyToClose: r.lead_ready_to_close ?? false,
    detectedObjections: r.detected_objections ?? [],
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
  edited_at?: string | null;
  deleted_at?: string | null;
  deleted_for?: string | null;
  delivery_status?: string | null;
  delivery_error_code?: string | null;
  delivery_error_message?: string | null;
  delivery_error_details?: Record<string, unknown> | null;
  status_updated_at?: string | null;
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
    editedAt: r.edited_at ?? undefined,
    deletedAt: r.deleted_at ?? undefined,
    deletedFor: (r.deleted_for as "me" | "everyone" | null) ?? undefined,
    deliveryStatus: (r.delivery_status as Message["deliveryStatus"]) ?? null,
    deliveryErrorCode: r.delivery_error_code ?? null,
    deliveryErrorMessage: r.delivery_error_message ?? null,
    deliveryErrorDetails: r.delivery_error_details ?? null,
    statusUpdatedAt: r.status_updated_at ?? null,
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
        .select("id,lead_id,channel,last_message_at,unread,awaiting_reply,interaction_type,ai_status,ai_handling,auto_reply_count,human_takeover_at,last_auto_reply_at,detected_city,detected_state,detected_pool_size,detected_intent,detected_interest,detected_budget,purchase_timing,customer_stage,lead_temperature,lead_score,lead_ready_to_close,detected_objections")
        .eq("company_id", companyId),
      // Onda 2.3: somente a última mensagem de cada conversa (preview do inbox).
      // O histórico de cada conversa é carregado sob demanda em loadConversationRecent().
      (supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: DbMessage[] | null; error: unknown }>)(
        "latest_messages_per_conversation",
        { _company_id: companyId },
      ),
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
  // Troca de empresa: invalida paginação cacheada da empresa anterior.
  if (realtimeCompanyId && realtimeCompanyId !== companyId) {
    olderHasMore.clear();
    olderLoading.clear();
    recentLoaded.clear();
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
        const row = payload.new as DbMessage & {
          company_id: string;
          external_id?: string | null;
        };
        // Dedup: se já temos essa msg em memória (id ou external_id local), ignora.
        if (remoteMessages.some((m) => m.id === row.id)) return;
        remoteMessages = [...remoteMessages, toMessage(row)];

        // P2 — Bump local imediato da conversa correspondente. Sem esperar
        // o trigger de banco emitir `conversations UPDATE`, a fila reordena
        // no mesmo tick da chegada da mensagem. Quando o UPDATE chegar em
        // seguida, o handler de `conversations` sobrescreve com o estado
        // canônico (idempotente).
        const convIdx = remoteConversations.findIndex(
          (c) => c.id === row.conversation_id,
        );
        if (convIdx !== -1) {
          const prev = remoteConversations[convIdx];
          const ageMin =
            (Date.now() - new Date(row.at).getTime()) / 60_000;
          const isLead = row.role === "lead";
          const nextConv: Conversation = {
            ...prev,
            lastMessageAt: row.at,
            unread: isLead ? (prev.unread ?? 0) + 1 : prev.unread,
            awaitingReply: isLead ? true : prev.awaitingReply,
            slaBreached: isLead
              ? ageMin >= currentSlaMinutes
              : false,
          };
          remoteConversations = [
            ...remoteConversations.slice(0, convIdx),
            nextConv,
            ...remoteConversations.slice(convIdx + 1),
          ];
        }

        notify();
        // Emitter de novas mensagens (apenas role=lead). Observador puro,
        // não altera nenhuma lógica acima. Consumido por NotificationBridge.
        if (row.role === "lead") {
          emitNewLeadMessage({
            messageId: row.id,
            externalId: row.external_id ?? null,
            conversationId: row.conversation_id,
            text: row.text,
            subtype: row.source_subtype ?? null,
            metadata: row.source_metadata ?? null,
            at: row.at,
          });
        }
      },
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "messages",
        filter: `company_id=eq.${companyId}`,
      },
      (payload) => {
        const row = payload.new as DbMessage & { company_id: string };
        const idx = remoteMessages.findIndex((m) => m.id === row.id);
        if (idx === -1) return;
        remoteMessages = [
          ...remoteMessages.slice(0, idx),
          toMessage(row),
          ...remoteMessages.slice(idx + 1),
        ];
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
    // P1 — UPDATE de leads: propaga em tempo real mudanças de status,
    // etapa, tags, nextAction, closedAt, lossReason, estimatedValue etc.
    // Fecha a lacuna documentada em docs/inbox-ux-audit.md §2.
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "leads",
        filter: `company_id=eq.${companyId}`,
      },
      (payload) => {
        const row = payload.new as DbLead;
        const idx = remoteLeads.findIndex((l) => l.id === row.id);
        if (idx === -1) {
          // Lead veio de update sem estar em memória: insere para não
          // deixar a UI dessincronizada até o próximo full-refresh.
          remoteLeads = [...remoteLeads, toLead(row)];
        } else {
          remoteLeads = [
            ...remoteLeads.slice(0, idx),
            toLead(row),
            ...remoteLeads.slice(idx + 1),
          ];
        }
        notify();
      },
    )
    // P1 — DELETE de leads: remove localmente para evitar cartões-fantasma.
    .on(
      "postgres_changes",
      {
        event: "DELETE",
        schema: "public",
        table: "leads",
        filter: `company_id=eq.${companyId}`,
      },
      (payload) => {
        const old = payload.old as { id?: string };
        if (!old.id) return;
        const before = remoteLeads.length;
        remoteLeads = remoteLeads.filter((l) => l.id !== old.id);
        if (remoteLeads.length !== before) notify();
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

// Fallback usado pela tela de conversa quando o Realtime falhar:
// busca mensagens recentes e mescla no estado em memória (sem duplicar).
export async function refetchConversationMessages(conversationId: string) {
  if (mode !== "remote") return;
  const { data, error } = await supabase
    .from("messages")
    .select("id,conversation_id,role,text,at,source_subtype,source_metadata,edited_at,deleted_at,deleted_for,delivery_status,delivery_error_code,delivery_error_message,delivery_error_details,status_updated_at")
    .eq("conversation_id", conversationId)
    .order("at", { ascending: true })
    .limit(200);
  if (error || !data) return;
  const existing = new Set(remoteMessages.map((m) => m.id));
  const fresh = data
    .map((r) => toMessage(r as DbMessage))
    .filter((m) => !existing.has(m.id));
  if (fresh.length === 0) return;
  remoteMessages = [...remoteMessages, ...fresh];
  notify();
}

// ---------- paginação por conversa (Onda 2.2) ----------

const MSG_SELECT =
  "id,conversation_id,role,text,at,source_subtype,source_metadata,edited_at,deleted_at,deleted_for,delivery_status,delivery_error_code,delivery_error_message,delivery_error_details,status_updated_at";

export function hasMoreOlderMessages(conversationId: string): boolean {
  return olderHasMore.get(conversationId) ?? true;
}

// Ao abrir a conversa: garante que temos pelo menos `limit` mensagens recentes
// dessa conversa em memória. Idempotente — só executa uma vez por conversa por sessão.
export async function loadConversationRecent(
  conversationId: string,
  limit = 100,
): Promise<void> {
  if (mode !== "remote") return;
  if (recentLoaded.has(conversationId)) return;
  recentLoaded.add(conversationId);
  const { data, error } = await supabase
    .from("messages")
    .select(MSG_SELECT)
    .eq("conversation_id", conversationId)
    .order("at", { ascending: false })
    .limit(limit);
  if (error || !data) {
    recentLoaded.delete(conversationId);
    return;
  }
  const existing = new Set(remoteMessages.map((m) => m.id));
  const fresh = data
    .map((r) => toMessage(r as DbMessage))
    .filter((m) => !existing.has(m.id));
  if (fresh.length > 0) {
    remoteMessages = [...remoteMessages, ...fresh];
    notify();
  }
  // Se voltou menos que o limite, não há mais histórico antigo.
  if (data.length < limit) olderHasMore.set(conversationId, false);
}

// Scroll-up: busca mensagens anteriores ao cursor composto (at, id) para
// evitar pular mensagens com o mesmo timestamp. Usa o índice
// (company_id, conversation_id, at DESC). Dedup por id.
export async function loadConversationOlder(
  conversationId: string,
  beforeAt: string,
  beforeId?: string,
  limit = 50,
): Promise<{ added: number; hasMore: boolean }> {
  if (mode !== "remote") return { added: 0, hasMore: false };
  if (olderLoading.has(conversationId)) {
    return { added: 0, hasMore: hasMoreOlderMessages(conversationId) };
  }
  if (olderHasMore.get(conversationId) === false) {
    return { added: 0, hasMore: false };
  }
  olderLoading.add(conversationId);
  try {
    // Cursor composto via PostgREST .or(): at < beforeAt OR (at = beforeAt AND id < beforeId)
    // Ordem espelhada na cláusula ORDER BY (at DESC, id DESC) garante estabilidade.
    let q = supabase
      .from("messages")
      .select(MSG_SELECT)
      .eq("conversation_id", conversationId);
    if (beforeId) {
      q = q.or(`at.lt.${beforeAt},and(at.eq.${beforeAt},id.lt.${beforeId})`);
    } else {
      q = q.lt("at", beforeAt);
    }
    const { data, error } = await q
      .order("at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);
    if (error || !data) {
      return { added: 0, hasMore: hasMoreOlderMessages(conversationId) };
    }
    const existing = new Set(remoteMessages.map((m) => m.id));
    const fresh = data
      .map((r) => toMessage(r as DbMessage))
      .filter((m) => !existing.has(m.id));
    if (fresh.length > 0) {
      remoteMessages = [...remoteMessages, ...fresh];
      notify();
    }
    const hasMore = data.length === limit;
    olderHasMore.set(conversationId, hasMore);
    return { added: fresh.length, hasMore };
  } finally {
    olderLoading.delete(conversationId);
  }
}

// Edita o texto de uma mensagem (somente role=agent). Registra edited_at.
export async function editMessage(messageId: string, newText: string) {
  const editedAt = new Date().toISOString();
  if (mode === "remote") {
    const { error } = await supabase
      .from("messages")
      .update({ text: newText, edited_at: editedAt })
      .eq("id", messageId)
      .eq("role", "agent");
    if (error) throw error;
  }
  remoteMessages = remoteMessages.map((m) =>
    m.id === messageId && m.role === "agent"
      ? { ...m, text: newText, editedAt }
      : m,
  );
  notify();
}

// Apaga uma mensagem do agente. scope:
// - "me": só esconde localmente (deleted_for=me).
// - "everyone": marca deleted_at + deleted_for=everyone + deleted_by (auditoria).
//   Mantém histórico no DB; realtime propaga para todos os usuários conectados.
export async function deleteMessage(
  messageId: string,
  scope: "me" | "everyone",
) {
  const deletedAt = new Date().toISOString();
  let deletedBy: string | null = null;
  if (mode === "remote") {
    const { data: userData } = await supabase.auth.getUser();
    deletedBy = userData.user?.id ?? null;
    const { error } = await supabase
      .from("messages")
      .update({ deleted_at: deletedAt, deleted_for: scope, deleted_by: deletedBy })
      .eq("id", messageId)
      .eq("role", "agent");
    if (error) throw error;
  }
  // Log de auditoria estruturado (MESSAGE_DELETED).
  console.warn("MESSAGE_DELETED", {
    message_id: messageId,
    deleted_by: deletedBy,
    deleted_at: deletedAt,
    scope,
  });
  remoteMessages = remoteMessages.map((m) =>
    m.id === messageId && m.role === "agent"
      ? { ...m, deletedAt, deletedFor: scope }
      : m,
  );
  notify();
}

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

export async function updateLeadNextAction(
  leadId: string,
  next: { label: string; dueAt: string } | null,
) {
  if (mode === "demo") {
    const idx = mockLeads.findIndex((l) => l.id === leadId);
    if (idx !== -1) {
      mockLeads[idx] = {
        ...mockLeads[idx],
        nextAction: next ? { label: next.label, dueAt: next.dueAt } : undefined,
      };
    }
    notify();
    return;
  }
  await supabase
    .from("leads")
    .update({
      next_action_label: next?.label ?? null,
      next_action_due_at: next?.dueAt ?? null,
    })
    .eq("id", leadId);
  remoteLeads = remoteLeads.map((l) =>
    l.id === leadId
      ? {
          ...l,
          nextAction: next ? { label: next.label, dueAt: next.dueAt } : undefined,
        }
      : l,
  );
  notify();
}

export async function createLead(
  input: {
    name: string;
    phone?: string;
    handle?: string;
    channel: "whatsapp" | "instagram" | "facebook";
  },
  companyId?: string,
): Promise<Lead> {
  if (mode === "demo") {
    const newLead: Lead = {
      id: `l-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: input.name,
      phone: input.phone,
      handle: input.handle,
      channel: input.channel,
      status: "novo",
      tags: [],
      createdAt: new Date().toISOString(),
    };
    addLeadMock(newLead);
    notify();
    return newLead;
  }
  if (!companyId) throw new Error("companyId obrigatório para criar cliente");
  const { data, error } = await supabase
    .from("leads")
    .insert({
      company_id: companyId,
      name: input.name,
      phone: input.phone ?? null,
      handle: input.handle ?? null,
      channel: input.channel,
      status: "novo",
      tags: [],
    })
    .select(
      "id,name,phone,handle,channel,status,tags,estimated_value,product,next_action_label,next_action_due_at,loss_reason,lost_at,closed_value,closed_at,created_at",
    )
    .single();
  if (error) throw error;
  const lead = toLead(data as DbLead);
  if (!remoteLeads.some((l) => l.id === lead.id)) {
    remoteLeads = [...remoteLeads, lead];
  }
  notify();
  return lead;
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

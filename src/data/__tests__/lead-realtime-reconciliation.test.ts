import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (payload: { eventType: string; new: unknown; old: unknown }) => void;
type Registration = { table: string; event: string; handler: Handler };

const mock = vi.hoisted(() => ({
  leads: [] as Record<string, unknown>[],
  conversations: [] as Record<string, unknown>[],
  messages: [] as Record<string, unknown>[],
  errors: {} as Record<string, { message: string } | undefined>,
  registrations: [] as Registration[],
  statusCallback: null as ((status: string) => void) | null,
  removeChannel: vi.fn(),
  lookupCounts: { leads: 0, conversations: 0 },
  snapshotCount: 0,
  deferredConversation: null as null | {
    promise: Promise<{ data: unknown; error: null }>;
    resolve: (value: { data: unknown; error: null }) => void;
  },
}));

function resultFor(table: string, filters: Record<string, unknown>, single: boolean) {
  const rows = table === "leads" ? mock.leads : mock.conversations;
  const filtered = rows.filter((row) =>
    Object.entries(filters).every(([key, value]) => row[key] === value),
  );
  const error = mock.errors[table] ?? null;
  return single ? { data: filtered[0] ?? null, error } : { data: filtered, error };
}

function query(table: string) {
  const filters: Record<string, unknown> = {};
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((key: string, value: unknown) => {
      filters[key] = value;
      return builder;
    }),
    maybeSingle: vi.fn(() => {
      mock.lookupCounts[table as "leads" | "conversations"]++;
      if (table === "conversations" && mock.deferredConversation) {
        return mock.deferredConversation.promise;
      }
      return Promise.resolve(resultFor(table, filters, true));
    }),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
      mock.snapshotCount++;
      return Promise.resolve(resultFor(table, filters, false)).then(resolve, reject);
    },
  };
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn((table: string) => query(table)),
    rpc: vi.fn(() => {
      mock.snapshotCount++;
      return Promise.resolve({ data: mock.messages, error: mock.errors.messages ?? null });
    }),
    channel: vi.fn(() => {
      const channel = {
        on: vi.fn((_kind: string, config: { table: string; event: string }, handler: Handler) => {
          mock.registrations.push({ table: config.table, event: config.event, handler });
          return channel;
        }),
        subscribe: vi.fn((callback: (status: string) => void) => {
          mock.statusCallback = callback;
          return channel;
        }),
      };
      return channel;
    }),
    removeChannel: mock.removeChannel,
  },
}));

const companyId = "company-a";
const otherCompanyId = "company-b";

function lead(id = "lead-1", company_id = companyId) {
  return {
    id,
    company_id,
    name: "Lead",
    phone: null,
    handle: null,
    channel: "whatsapp",
    status: "novo",
    tags: [],
    estimated_value: null,
    product: null,
    next_action_label: null,
    next_action_due_at: null,
    loss_reason: null,
    lost_at: null,
    closed_value: null,
    closed_at: null,
    created_at: "2026-08-17T10:00:00Z",
  };
}

function conversation(id = "conv-1", lead_id = "lead-1", company_id = companyId) {
  return {
    id,
    company_id,
    lead_id,
    channel: "whatsapp",
    last_message_at: "2026-08-17T10:00:00Z",
    unread: 0,
    awaiting_reply: false,
  };
}

function message(id = "msg-1", conversation_id = "conv-1") {
  return {
    id,
    company_id: companyId,
    conversation_id,
    role: "lead",
    text: "mensagem",
    at: "2026-08-17T10:01:00Z",
    external_id: `wamid.${id}`,
  };
}

function emit(table: string, event: string, row: Record<string, unknown>) {
  const registration = mock.registrations.find(
    (item) => item.table === table && (item.event === event || item.event === "*"),
  );
  if (!registration) throw new Error(`handler ausente: ${table}/${event}`);
  registration.handler({ eventType: event, new: row, old: row });
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function load() {
  const repo = await import("@/data/leadRepo");
  await repo.loadRemote(companyId);
  return repo;
}

beforeEach(() => {
  vi.resetModules();
  mock.leads = [];
  mock.conversations = [];
  mock.messages = [];
  mock.errors = {};
  mock.registrations = [];
  mock.statusCallback = null;
  mock.removeChannel.mockReset();
  mock.lookupCounts = { leads: 0, conversations: 0 };
  mock.snapshotCount = 0;
  mock.deferredConversation = null;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

describe("leadRepo — reconciliação de Realtime", () => {
  it("preserva o bump imediato quando conversation e lead já estão carregados", async () => {
    mock.leads = [lead()];
    mock.conversations = [conversation()];
    const repo = await load();
    emit("messages", "INSERT", message());
    expect(repo.getConversationById("conv-1")?.unread).toBe(1);
    expect(repo.getMessagesFor("conv-1")).toHaveLength(1);
  });

  it("busca e adiciona uma conversation ausente", async () => {
    mock.leads = [lead()];
    const repo = await load();
    mock.conversations = [conversation()];
    emit("messages", "INSERT", message());
    await settle();
    expect(repo.getConversationById("conv-1")?.leadId).toBe("lead-1");
  });

  it("busca conversation e lead ausentes e incorpora ambos", async () => {
    const repo = await load();
    mock.leads = [lead()];
    mock.conversations = [conversation()];
    emit("messages", "INSERT", message());
    await settle();
    expect(repo.getLeadById("lead-1")).toBeDefined();
    expect(repo.getConversationById("conv-1")).toBeDefined();
  });

  it("rejeita conversation devolvida com company_id divergente", async () => {
    const repo = await load();
    mock.conversations = [conversation("conv-1", "lead-1", otherCompanyId)];
    emit("messages", "INSERT", message());
    await settle();
    expect(repo.getConversationById("conv-1")).toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it("rejeita lead devolvido com company_id divergente", async () => {
    const repo = await load();
    mock.conversations = [conversation()];
    mock.leads = [lead("lead-1", otherCompanyId)];
    emit("messages", "INSERT", message());
    await settle();
    expect(repo.getLeadById("lead-1")).toBeUndefined();
    expect(repo.getConversationById("conv-1")).toBeUndefined();
  });

  it("torna falha corretiva observável sem corromper o cache", async () => {
    const repo = await load();
    mock.errors.conversations = { message: "lookup failed" };
    emit("messages", "INSERT", message());
    await settle();
    expect(repo.getConversationById("conv-1")).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      "[inbox-reconcile] falha",
      expect.objectContaining({ stage: "message_graph" }),
    );
  });

  it("deduplica recuperação de duas messages simultâneas", async () => {
    const repo = await load();
    mock.leads = [lead()];
    mock.conversations = [conversation()];
    let resolve!: (value: { data: unknown; error: null }) => void;
    const promise = new Promise<{ data: unknown; error: null }>((r) => {
      resolve = r;
    });
    mock.deferredConversation = { promise, resolve };
    emit("messages", "INSERT", message("msg-1"));
    emit("messages", "INSERT", message("msg-2"));
    expect(mock.lookupCounts.conversations).toBe(1);
    resolve({ data: conversation(), error: null });
    await settle();
    expect(repo.getConversations().filter((item) => item.id === "conv-1")).toHaveLength(1);
    expect(repo.getConversationById("conv-1")?.unread).toBe(2);
  });

  it("não duplica conversation se INSERT chegar durante recuperação", async () => {
    const repo = await load();
    mock.leads = [lead()];
    let resolve!: (value: { data: unknown; error: null }) => void;
    const promise = new Promise<{ data: unknown; error: null }>((r) => {
      resolve = r;
    });
    mock.deferredConversation = { promise, resolve };
    emit("messages", "INSERT", message());
    emit("conversations", "INSERT", conversation());
    resolve({ data: conversation(), error: null });
    await settle();
    expect(repo.getConversations().filter((item) => item.id === "conv-1")).toHaveLength(1);
  });

  it("não duplica lead se INSERT chegar durante recuperação", async () => {
    const repo = await load();
    mock.conversations = [conversation()];
    mock.leads = [lead()];
    emit("messages", "INSERT", message());
    emit("leads", "INSERT", lead());
    await settle();
    expect(repo.getLeads().filter((item) => item.id === "lead-1")).toHaveLength(1);
  });

  it("reconcilia evento ocorrido na janela de inicialização", async () => {
    const repo = await load();
    mock.leads = [lead()];
    mock.conversations = [conversation()];
    mock.statusCallback?.("SUBSCRIBED");
    await settle();
    expect(repo.getConversationById("conv-1")).toBeDefined();
  });

  it("executa nova reconciliação em reconnect", async () => {
    const repo = await load();
    mock.statusCallback?.("SUBSCRIBED");
    await settle();
    const before = mock.snapshotCount;
    mock.leads = [lead()];
    mock.conversations = [conversation()];
    mock.statusCallback?.("SUBSCRIBED");
    await settle();
    expect(mock.snapshotCount).toBeGreaterThan(before);
    expect(repo.getConversationById("conv-1")).toBeDefined();
  });

  it("cleanup remove canal e descarta recuperação tardia", async () => {
    const repo = await load();
    let resolve!: (value: { data: unknown; error: null }) => void;
    const promise = new Promise<{ data: unknown; error: null }>((r) => {
      resolve = r;
    });
    mock.deferredConversation = { promise, resolve };
    emit("messages", "INSERT", message());
    repo.unsubscribeRealtime();
    resolve({ data: conversation(), error: null });
    await settle();
    expect(mock.removeChannel).toHaveBeenCalledTimes(1);
    expect(repo.getConversationById("conv-1")).toBeUndefined();
  });
});

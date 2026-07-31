// ============================================================================
// FASE 6.3.1 — PROVA PONTA A PONTA do pipeline de callbacks (adapter fake).
//
// Ambiente de teste: NÃO produção, NÃO cliente real. Um stub em memória
// substitui o cliente administrativo, exercitando exatamente o mesmo código
// do webhook oficial (`processStatusEvents`).
//
// Cenários cobertos: janela aberta (A), janela fechada/template (B), falha e
// retry (C), evento fora de ordem e duplicado (D), além de callbacks órfãos e
// cross-tenant.
// ============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const db: Record<string, Row[]> = { messages: [], recovery_attempts: [], recovery_attempt_events: [] };

function matches(row: Row, filters: Array<[string, any]>, isNull: Array<[string, any]>) {
  return (
    filters.every(([k, v]) => row[k] === v) &&
    isNull.every(([k, v]) => (v === null ? row[k] == null : row[k] === v))
  );
}

function table(name: string) {
  const filters: Array<[string, any]> = [];
  const isNullFilters: Array<[string, any]> = [];
  let pending: "select" | "update" | "insert" = "select";
  let patch: Row = {};

  const api: any = {
    select: () => api,
    eq: (k: string, v: any) => (filters.push([k, v]), api),
    is: (k: string, v: any) => (isNullFilters.push([k, v]), api),
    update: (p: Row) => ((pending = "update"), (patch = p), api),
    insert: (p: Row) => {
      db[name].push({ id: `x${db[name].length + 1}`, ...p });
      return Promise.resolve({ data: null, error: null });
    },
    maybeSingle: () => {
      const rows = db[name].filter((r) => matches(r, filters, isNullFilters));
      if (pending === "update") {
        if (rows.length === 0) return Promise.resolve({ data: null, error: null });
        Object.assign(rows[0], patch);
        return Promise.resolve({ data: { id: rows[0].id }, error: null });
      }
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    },
    then: (resolve: any) => {
      const rows = db[name].filter((r) => matches(r, filters, isNullFilters));
      if (pending === "update") rows.forEach((r) => Object.assign(r, patch));
      return Promise.resolve({ data: rows, error: null }).then(resolve);
    },
  };
  return api;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (name: string) => table(name) },
}));

const { processStatusEvents } = await import("@/lib/whatsapp/status.server");

const COMPANY = "company-1";
const INTEGRATION = "integration-1";

function seed(externalId: string, opts: { withAttempt?: boolean; company?: string } = {}) {
  const company = opts.company ?? COMPANY;
  db.messages.push({
    id: `m-${externalId}`,
    company_id: company,
    integration_id: INTEGRATION,
    external_id: externalId,
    conversation_id: "conv-1",
    delivery_status: "sent",
  });
  if (opts.withAttempt !== false) {
    db.recovery_attempts.push({
      id: `att-${externalId}`,
      company_id: company,
      conversation_id: "conv-1",
      lead_id: "lead-1",
      external_message_id: externalId,
      status: "sent",
      delivery_status: "sent",
    });
  }
}

const attemptOf = (externalId: string) =>
  db.recovery_attempts.find((a) => a.external_message_id === externalId)!;
const messageOf = (externalId: string) =>
  db.messages.find((m) => m.external_id === externalId)!;

async function callback(externalId: string, status: string, errors?: unknown[]) {
  return processStatusEvents({
    companyId: COMPANY,
    integrationId: INTEGRATION,
    statuses: [{ id: externalId, status, timestamp: "1780000000", errors }],
  });
}

beforeEach(() => {
  db.messages = [];
  db.recovery_attempts = [];
  db.recovery_attempt_events = [];
});

describe("CENÁRIO A — janela aberta: sent → delivered → read", () => {
  it("evolui a tentativa e registra a timeline", async () => {
    seed("wamid.A");
    await callback("wamid.A", "delivered");
    expect(attemptOf("wamid.A").status).toBe("delivered");
    await callback("wamid.A", "read");
    expect(attemptOf("wamid.A").status).toBe("read");
    expect(messageOf("wamid.A").delivery_status).toBe("read");
    expect(db.recovery_attempt_events.map((e) => e.event_type)).toEqual([
      "recovery_message_delivered",
      "recovery_message_read",
    ]);
  });
});

describe("CENÁRIO B — janela fechada (template): mesmo pipeline de status", () => {
  it("vincula attempt de template e evolui até read", async () => {
    seed("wamid.B");
    attemptOf("wamid.B").template_name = "reengajamento_24h";
    await callback("wamid.B", "delivered");
    await callback("wamid.B", "read");
    expect(attemptOf("wamid.B").status).toBe("read");
    expect(attemptOf("wamid.B").delivery_status).toBe("read");
  });
});

describe("CENÁRIO C — falha e retry", () => {
  it("marca a mensagem como falha sem regredir o estado da tentativa", async () => {
    seed("wamid.C");
    await callback("wamid.C", "failed", [{ code: 131047, title: "Re-engagement message" }]);
    expect(messageOf("wamid.C").delivery_status).toBe("failed");
    expect(messageOf("wamid.C").delivery_error_code).toBe("131047");
    // A tentativa não é reescrita para `failed`: o envio saiu de fato.
    expect(attemptOf("wamid.C").status).toBe("sent");
    expect(db.recovery_attempt_events.map((e) => e.event_type)).toEqual([
      "recovery_delivery_failed",
    ]);
  });

  it("um retry gera outra mensagem e cada status é reconciliado no seu vínculo", async () => {
    seed("wamid.C1");
    seed("wamid.C2");
    await callback("wamid.C1", "failed");
    await callback("wamid.C2", "delivered");
    expect(messageOf("wamid.C1").delivery_status).toBe("failed");
    expect(attemptOf("wamid.C2").status).toBe("delivered");
  });
});

describe("CENÁRIO D — eventos fora de ordem e duplicados", () => {
  it("read antes de delivered termina em read e não regride", async () => {
    seed("wamid.D");
    await callback("wamid.D", "read");
    expect(attemptOf("wamid.D").status).toBe("read");
    await callback("wamid.D", "delivered");
    expect(attemptOf("wamid.D").status).toBe("read");
    expect(messageOf("wamid.D").delivery_status).toBe("read");
  });

  it("callback duplicado é idempotente e não duplica timeline", async () => {
    seed("wamid.D2");
    await callback("wamid.D2", "delivered");
    const r = await callback("wamid.D2", "delivered");
    expect(r.ignored).toBe(1);
    expect(db.recovery_attempt_events).toHaveLength(1);
  });

  it("failed depois de read é ignorado", async () => {
    seed("wamid.D3");
    await callback("wamid.D3", "read");
    await callback("wamid.D3", "failed");
    expect(messageOf("wamid.D3").delivery_status).toBe("read");
  });
});

describe("resiliência do webhook", () => {
  it("callback sem mensagem conhecida é ignorado sem erro", async () => {
    const r = await callback("wamid.desconhecido", "delivered");
    expect(r).toMatchObject({ received: 1, messagesUpdated: 0, ignored: 1 });
  });

  it("mensagem sem attempt continua sendo atualizada", async () => {
    seed("wamid.NOATT", { withAttempt: false });
    const r = await callback("wamid.NOATT", "delivered");
    expect(r.messagesUpdated).toBe(1);
    expect(r.attemptsUpdated).toBe(0);
    expect(messageOf("wamid.NOATT").delivery_status).toBe("delivered");
  });

  it("callback de outra empresa não altera nada", async () => {
    seed("wamid.OTHER", { company: "company-2" });
    const r = await callback("wamid.OTHER", "read");
    expect(r.messagesUpdated).toBe(0);
    expect(messageOf("wamid.OTHER").delivery_status).toBe("sent");
  });

  it("status desconhecido e payload vazio não quebram", async () => {
    seed("wamid.X");
    const r = await callback("wamid.X", "deleted");
    expect(r.ignored).toBe(1);
    const empty = await processStatusEvents({
      companyId: COMPANY,
      integrationId: INTEGRATION,
      statuses: undefined,
    });
    expect(empty.received).toBe(0);
  });

  it("nenhum disparo automático: o processador só lê e atualiza estado", async () => {
    seed("wamid.Z");
    await callback("wamid.Z", "delivered");
    const eventTypes = db.recovery_attempt_events.map((e) => e.event_type);
    expect(eventTypes.some((t) => t.includes("send"))).toBe(false);
  });
});

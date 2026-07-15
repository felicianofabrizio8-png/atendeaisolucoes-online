// Fase B.2 — Testes de contrato para send-media, send-audio, forward-message.
// Prova: request enviada por postGraph é bit-a-bit idêntica ao caminho legado,
// simulação em staging não persiste entrega real, falhas preservam contrato.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------- Mocks de tabela ----------
type Row = Record<string, unknown> | null;

const tableRows: Record<string, Row> = {};
const insertedRows: Array<{ table: string; row: unknown }> = [];
const storageRemovals: Array<{ bucket: string; paths: string[] }> = [];
const storageUploads: Array<{ bucket: string; path: string }> = [];

function makeChain(row: Row) {
  const chain: any = {
    _row: row,
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    or: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: chain._row, error: null }),
    single: async () => ({ data: chain._row, error: null }),
    insert: (row2: unknown) => ({
      select: () => ({
        single: async () => ({
          data: { id: "msg-new", conversation_id: "conv-1", role: "agent", text: "x", at: "t" },
          error: null,
        }),
      }),
      then: (r: any) => r({ data: null, error: null }),
    }),
    update: () => ({ eq: async () => ({ error: null }) }),
  };
  return chain;
}

const supabaseAdmin: any = {
  auth: {
    getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
  },
  from: vi.fn((t: string) => {
    const chain = makeChain(tableRows[t] ?? null);
    const origInsert = chain.insert;
    chain.insert = (row: unknown) => {
      insertedRows.push({ table: t, row });
      return origInsert(row);
    };
    return chain;
  }),
  rpc: vi.fn(async () => ({ data: null, error: null })),
  storage: {
    from: (bucket: string) => ({
      upload: async (path: string) => {
        storageUploads.push({ bucket, path });
        return { data: { path }, error: null };
      },
      createSignedUrl: async (_p: string, _ttl: number) => ({
        data: { signedUrl: "https://sb.example/signed-media" },
        error: null,
      }),
      remove: (paths: string[]) => {
        storageRemovals.push({ bucket, paths });
        return { then: (r: any) => r(null) };
      },
    }),
  },
};

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));
vi.mock("@/lib/wa-templates.server", () => ({
  isWithin24hWindow: vi.fn(async () => ({ inside: true, lastLeadAt: null })),
}));

// Spy postGraph
const postGraphSpy = vi.fn();
vi.mock("@/lib/outbound/MetaOutbound.server", () => ({
  postGraph: (...args: unknown[]) => postGraphSpy(...args),
}));

// ---------- Helpers ----------
function jsonRequest(body: unknown) {
  return new Request("http://x/api", {
    method: "POST",
    headers: {
      authorization: "Bearer session-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

// Mock global fetch (HEAD/GET às signed URLs de storage — nunca à Meta)
const originalFetch = global.fetch;
global.fetch = vi.fn(async (_url: any, init?: RequestInit) => {
  const method = init?.method ?? "GET";
  // HEAD → responde 200 com content-type & length adequados p/ áudio ogg opus + validação bytes.
  if (method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers: { "content-type": "audio/ogg", "content-length": "1024" },
    });
  }
  // GET (preflight áudio ou range fallback): retorna bytes OGG/Opus válidos.
  // OggS + OpusHead assinatura mínima.
  const magic = new Uint8Array([
    0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    // "OpusHead"
    0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64,
  ]);
  return new Response(magic, {
    status: 200,
    headers: { "content-type": "audio/ogg", "content-length": String(magic.length) },
  });
}) as any;

async function invoke(routePath: string, request: Request) {
  const mod = await import(routePath);
  const handler = (mod.Route as any).options.server.handlers.POST;
  return handler({ request });
}

beforeEach(() => {
  postGraphSpy.mockReset();
  insertedRows.length = 0;
  storageRemovals.length = 0;
  storageUploads.length = 0;
  Object.keys(tableRows).forEach((k) => delete tableRows[k]);
});

// =====================================================
// api.whatsapp.send-media.tsx
// =====================================================
describe("api.whatsapp.send-media — migração B.2", () => {
  beforeEach(() => {
    tableRows.profiles = { company_id: "company-1" };
    tableRows.conversations = {
      id: "conv-1", company_id: "company-1", channel: "whatsapp", lead_id: "lead-1",
    };
    tableRows.leads = {
      id: "lead-1", company_id: "company-1",
      phone: "11999998888", external_id: "5511999998888", integration_id: "int-1",
    };
    tableRows.integrations = {
      id: "int-1", access_token: "EAAG-token", external_account_id: "PHONE-ID",
    };
  });

  it("A. legacy → postGraph recebe URL/headers/body idênticos ao legado", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: true, simulated: false, environment: "legacy",
      externalRequestSent: true, externalId: "wamid.M", status: 200,
      raw: { messages: [{ id: "wamid.M" }] },
    });
    const res = await invoke(
      "@/routes/api.whatsapp.send-media",
      jsonRequest({ conversationId: "conv-1", mediaUrl: "https://cdn.example/foto.jpg", kind: "image", caption: "cap" }),
    );
    expect(postGraphSpy).toHaveBeenCalledOnce();
    const call = postGraphSpy.mock.calls[0][0];
    expect(call.url).toBe("https://graph.facebook.com/v20.0/PHONE-ID/messages");
    expect(call.headers.Authorization).toBe("Bearer EAAG-token");
    const parsed = JSON.parse(call.body);
    expect(parsed.messaging_product).toBe("whatsapp");
    expect(parsed.type).toBe("image");
    expect(parsed.to).toBe("5511999998888");
    expect(parsed.image).toEqual({ link: "https://cdn.example/foto.jpg", caption: "cap" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.externalId).toBe("wamid.M");
    expect(json.kind).toBe("image");
  });

  it("B. staging → simulated=true, sem persistência", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: true, simulated: true, environment: "staging",
      externalRequestSent: false, simulationId: "sim-m",
      would: { url: "x", method: "POST" },
    });
    const res = await invoke(
      "@/routes/api.whatsapp.send-media",
      jsonRequest({ conversationId: "conv-1", mediaUrl: "https://cdn.example/x.jpg", kind: "image" }),
    );
    const json = await res.json();
    expect(json.simulated).toBe(true);
    expect(json.externalRequestSent).toBe(false);
    expect(json.simulationId).toBe("sim-m");
    // Nenhum insert em messages
    expect(insertedRows.some((r) => r.table === "messages")).toBe(false);
  });

  it("C. provider 400 → 502 com metaError, sem duplicar envio", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: false, simulated: false, environment: "legacy",
      externalRequestSent: true, error: "invalid media", status: 400, retryable: false,
      providerError: { message: "invalid media", code: 131009 },
    });
    const res = await invoke(
      "@/routes/api.whatsapp.send-media",
      jsonRequest({ conversationId: "conv-1", mediaUrl: "https://cdn.example/x.jpg", kind: "image" }),
    );
    expect(postGraphSpy).toHaveBeenCalledOnce();
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toContain("invalid media");
    expect(json.status).toBe(400);
    expect(json.metaError.code).toBe(131009);
  });
});

// =====================================================
// api.whatsapp.send-audio.tsx (multipart)
// =====================================================
function multipartRequest(fields: Record<string, string | Blob>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v as any);
  return new Request("http://x/api", {
    method: "POST",
    headers: { authorization: "Bearer session-token" },
    body: fd,
  });
}

describe("api.whatsapp.send-audio — migração B.2", () => {
  beforeEach(() => {
    tableRows.profiles = { company_id: "company-1" };
    tableRows.conversations = {
      id: "conv-1", company_id: "company-1", channel: "whatsapp", lead_id: "lead-1",
    };
    tableRows.leads = {
      id: "lead-1", company_id: "company-1",
      phone: "11999998888", external_id: "5511999998888", integration_id: "int-1",
    };
    tableRows.integrations = {
      id: "int-1", access_token: "EAAG-token", external_account_id: "PHONE-ID",
    };
  });

  function oggBlob(): Blob {
    // OggS + zeros + OpusHead
    const arr = new Uint8Array([
      0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64,
    ]);
    return new Blob([arr], { type: "audio/ogg" });
  }

  it("A. legacy → postGraph recebe payload audio idêntico ao legado", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: true, simulated: false, environment: "legacy",
      externalRequestSent: true, externalId: "wamid.A", status: 200,
      raw: { messages: [{ id: "wamid.A" }] },
    });
    const res = await invoke(
      "@/routes/api.whatsapp.send-audio",
      multipartRequest({ file: oggBlob(), conversationId: "conv-1", duration: "2" }),
    );
    expect(postGraphSpy).toHaveBeenCalledOnce();
    const call = postGraphSpy.mock.calls[0][0];
    expect(call.url).toBe("https://graph.facebook.com/v20.0/PHONE-ID/messages");
    expect(call.headers["Content-Type"]).toBe("application/json");
    expect(call.headers.Authorization).toBe("Bearer EAAG-token");
    const parsed = JSON.parse(call.body);
    expect(parsed.messaging_product).toBe("whatsapp");
    expect(parsed.type).toBe("audio");
    expect(parsed.to).toBe("5511999998888");
    expect(parsed.audio.link).toBe("https://sb.example/signed-media");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.externalId).toBe("wamid.A");
  });

  it("B. staging → simulated=true, storage limpo, sem insert de messages", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: true, simulated: true, environment: "staging",
      externalRequestSent: false, simulationId: "sim-a",
      would: { url: "x", method: "POST" },
    });
    const res = await invoke(
      "@/routes/api.whatsapp.send-audio",
      multipartRequest({ file: oggBlob(), conversationId: "conv-1" }),
    );
    const json = await res.json();
    expect(json.simulated).toBe(true);
    expect(json.externalRequestSent).toBe(false);
    expect(insertedRows.some((r) => r.table === "messages")).toBe(false);
    // storage cleanup do upload de staging
    expect(storageRemovals.length).toBeGreaterThan(0);
    expect(storageRemovals[0].bucket).toBe("whatsapp-media");
  });

  it("C. provider 400 → 502, storage removido, error_log gerado", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: false, simulated: false, environment: "legacy",
      externalRequestSent: true, error: "bad audio", status: 400, retryable: false,
      providerError: { message: "bad audio", code: 100, error_subcode: 2494048 },
    });
    const res = await invoke(
      "@/routes/api.whatsapp.send-audio",
      multipartRequest({ file: oggBlob(), conversationId: "conv-1" }),
    );
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.stage).toBe("meta_api");
    expect(json.meta_error_message).toBe("bad audio");
    expect(json.meta_error_code).toBe(100);
    expect(storageRemovals.length).toBeGreaterThan(0);
    expect(insertedRows.some((r) => r.table === "error_log")).toBe(true);
    expect(insertedRows.some((r) => r.table === "messages")).toBe(false);
  });

  it("D. network error → 502 stage=network, sem insert de messages", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: false, simulated: false, environment: "legacy",
      externalRequestSent: false, error: "ECONNRESET", retryable: true,
    });
    const res = await invoke(
      "@/routes/api.whatsapp.send-audio",
      multipartRequest({ file: oggBlob(), conversationId: "conv-1" }),
    );
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.stage).toBe("network");
    expect(json.detail).toBe("ECONNRESET");
    expect(insertedRows.some((r) => r.table === "messages")).toBe(false);
  });
});

// =====================================================
// api.whatsapp.forward-message.tsx
// =====================================================
describe("api.whatsapp.forward-message — migração B.2", () => {
  beforeEach(() => {
    tableRows.profiles = { company_id: "company-1" };
    tableRows.messages = {
      id: "src-1", company_id: "company-1", role: "lead",
      source_subtype: "image",
      source_metadata: {
        media_path: "company-1/inbound/f.jpg",
        media_bucket: "whatsapp-media",
        media_kind: "image",
        media_mime: "image/jpeg",
        media_filename: "f.jpg",
        media_size: 100,
      },
    };
    tableRows.leads = {
      id: "lead-target", company_id: "company-1",
      phone: "11888887777", external_id: "5511888887777", integration_id: "int-1",
    };
    tableRows.conversations = {
      id: "conv-t", company_id: "company-1", channel: "whatsapp", lead_id: "lead-target",
    };
    tableRows.integrations = {
      id: "int-1", access_token: "EAAG-token", external_account_id: "PHONE-ID",
    };
  });

  it("A. legacy → postGraph recebe payload forward idêntico ao legado", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: true, simulated: false, environment: "legacy",
      externalRequestSent: true, externalId: "wamid.F", status: 200,
      raw: { messages: [{ id: "wamid.F" }] },
    });
    const res = await invoke(
      "@/routes/api.whatsapp.forward-message",
      jsonRequest({ sourceMessageId: "src-1", targetLeadId: "lead-target", note: "veja" }),
    );
    expect(postGraphSpy).toHaveBeenCalledOnce();
    const call = postGraphSpy.mock.calls[0][0];
    expect(call.url).toBe("https://graph.facebook.com/v20.0/PHONE-ID/messages");
    expect(call.headers.Authorization).toBe("Bearer EAAG-token");
    const parsed = JSON.parse(call.body);
    expect(parsed.messaging_product).toBe("whatsapp");
    expect(parsed.type).toBe("image");
    expect(parsed.to).toBe("5511888887777");
    expect(parsed.image).toEqual({
      link: "https://sb.example/signed-media",
      caption: "veja",
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.externalId).toBe("wamid.F");
    expect(json.kind).toBe("image");
  });

  it("B. staging → simulated=true, sem insert de messages", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: true, simulated: true, environment: "staging",
      externalRequestSent: false, simulationId: "sim-f",
      would: { url: "x", method: "POST" },
    });
    const res = await invoke(
      "@/routes/api.whatsapp.forward-message",
      jsonRequest({ sourceMessageId: "src-1", targetLeadId: "lead-target" }),
    );
    const json = await res.json();
    expect(json.simulated).toBe(true);
    expect(json.externalRequestSent).toBe(false);
    expect(json.simulationId).toBe("sim-f");
    expect(insertedRows.some((r) => r.table === "messages")).toBe(false);
  });

  it("C. provider 400 → 502 com metaError e debug preservados", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: false, simulated: false, environment: "legacy",
      externalRequestSent: true, error: "bad recipient", status: 400, retryable: false,
      providerError: { message: "bad recipient", code: 131026 },
    });
    const res = await invoke(
      "@/routes/api.whatsapp.forward-message",
      jsonRequest({ sourceMessageId: "src-1", targetLeadId: "lead-target" }),
    );
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toContain("bad recipient");
    expect(json.status).toBe(400);
    expect(json.metaError.code).toBe(131026);
    expect(json.debug).toBeTruthy();
  });

  it("D. network error → 502, sem insert de messages, nunca duplica", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: false, simulated: false, environment: "legacy",
      externalRequestSent: false, error: "ETIMEDOUT", retryable: true,
    });
    const res = await invoke(
      "@/routes/api.whatsapp.forward-message",
      jsonRequest({ sourceMessageId: "src-1", targetLeadId: "lead-target" }),
    );
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toContain("ETIMEDOUT");
    expect(postGraphSpy).toHaveBeenCalledOnce();
    expect(insertedRows.some((r) => r.table === "messages")).toBe(false);
  });
});

// Restore fetch after suite
afterAll(() => {
  global.fetch = originalFetch;
});

// vitest globals=false → import afterAll
import { afterAll } from "vitest";

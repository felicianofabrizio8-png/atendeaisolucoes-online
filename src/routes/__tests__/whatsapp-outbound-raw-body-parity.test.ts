// Fase B.2.1 — Paridade de rawBody:
// Garante que send-audio (error_log.meta_body) e forward-message
// (debug.meta.rawBody) usam o corpo BRUTO retornado pela Meta
// (via outbound.rawBody), e não JSON.stringify(providerError).

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// ------------- Fixtures do mock supabase (mesmo padrão do arquivo B.2) -------------
type Row = Record<string, unknown> | null;

const tableRows: Record<string, Row> = {};
const insertedRows: Array<{ table: string; row: unknown }> = [];
const storageRemovals: Array<{ bucket: string; paths: string[] }> = [];

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
    insert: (_row2: unknown) => ({
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
      upload: async (path: string) => ({ data: { path }, error: null }),
      createSignedUrl: async () => ({
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

const postGraphSpy = vi.fn();
vi.mock("@/lib/outbound/MetaOutbound.server", () => ({
  postGraph: (...args: unknown[]) => postGraphSpy(...args),
}));

// Preflight de áudio: fetch HEAD/GET a bucket (nunca à Meta — postGraph está mockado).
const originalFetch = global.fetch;
global.fetch = vi.fn(async (_url: any, init?: RequestInit) => {
  const method = init?.method ?? "GET";
  if (method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers: { "content-type": "audio/ogg", "content-length": "1024" },
    });
  }
  const magic = new Uint8Array([
    0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
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

function multipartRequest(fields: Record<string, string | Blob>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v as any);
  return new Request("http://x/api", {
    method: "POST",
    headers: { authorization: "Bearer session-token" },
    body: fd,
  });
}

function oggBlob(): Blob {
  const arr = new Uint8Array([
    0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64,
  ]);
  return new Blob([arr], { type: "audio/ogg" });
}

beforeEach(() => {
  postGraphSpy.mockReset();
  insertedRows.length = 0;
  storageRemovals.length = 0;
  Object.keys(tableRows).forEach((k) => delete tableRows[k]);
});

afterAll(() => {
  global.fetch = originalFetch;
});

// ============================================================
// send-audio — meta_body deve usar rawBody, não JSON.stringify
// ============================================================
describe("send-audio — rawBody parity (B.2.1)", () => {
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

  it("error_log.meta_body = rawBody bruto retornado pela Meta (JSON string original)", async () => {
    const rawText = '{"error":{"message":"bad audio","code":100,"error_subcode":2494048,"fbtrace_id":"XYZ","type":"OAuthException"}}';
    postGraphSpy.mockResolvedValueOnce({
      success: false, simulated: false, environment: "legacy",
      externalRequestSent: true,
      error: "bad audio", status: 400, retryable: false,
      providerError: { message: "bad audio", code: 100, error_subcode: 2494048, fbtrace_id: "XYZ", type: "OAuthException" },
      rawBody: rawText,
      parsedBody: JSON.parse(rawText),
    });
    const res = await invoke(
      "@/routes/api.whatsapp.send-audio",
      multipartRequest({ file: oggBlob(), conversationId: "conv-1" }),
    );
    expect(res.status).toBe(502);
    const json = await res.json();
    // resposta HTTP preserva o rawBody (via meta_body) idêntico ao legado
    expect(json.meta_body).toBe(rawText);
    expect(json.meta_error_code).toBe(100);
    expect(json.meta_error_subcode).toBe(2494048);
    expect(json.meta_error_type).toBe("OAuthException");
    expect(json.fbtrace_id).toBe("XYZ");
    expect(json.http_status).toBe(400);

    const errLog = insertedRows.find((r) => r.table === "error_log")?.row as any;
    expect(errLog).toBeTruthy();
    // meta_body no error_log = rawBody bruto (nunca JSON.stringify(providerError))
    expect(errLog.context.meta_body).toBe(rawText);
    expect(errLog.context.meta_error_code).toBe(100);
    expect(errLog.context.meta_error_subcode).toBe(2494048);
    expect(errLog.context.fbtrace_id).toBe("XYZ");
    expect(errLog.context.http_status).toBe(400);
    // cleanup storage acontece nos mesmos cenários do legado
    expect(storageRemovals.length).toBeGreaterThan(0);
  });

  it("rawBody NÃO-JSON (texto puro) → preservado integralmente em meta_body", async () => {
    const rawText = "upstream 502 gateway";
    postGraphSpy.mockResolvedValueOnce({
      success: false, simulated: false, environment: "legacy",
      externalRequestSent: true,
      error: "HTTP 502", status: 502, retryable: true,
      providerError: rawText,
      rawBody: rawText,
      parsedBody: null,
    });
    const res = await invoke(
      "@/routes/api.whatsapp.send-audio",
      multipartRequest({ file: oggBlob(), conversationId: "conv-1" }),
    );
    const json = await res.json();
    expect(json.meta_body).toBe(rawText);
    const errLog = insertedRows.find((r) => r.table === "error_log")?.row as any;
    expect(errLog.context.meta_body).toBe(rawText);
  });

  it("network error → meta_body permanece null (rawBody nunca fabricado)", async () => {
    postGraphSpy.mockResolvedValueOnce({
      success: false, simulated: false, environment: "legacy",
      externalRequestSent: false, error: "ECONNRESET", retryable: true,
    });
    await invoke(
      "@/routes/api.whatsapp.send-audio",
      multipartRequest({ file: oggBlob(), conversationId: "conv-1" }),
    );
    const errLog = insertedRows.find((r) => r.table === "error_log")?.row as any;
    expect(errLog.context.meta_body).toBeNull();
  });

  it("staging → simulated=true, nenhuma persistência de erro, sem rawBody fabricado", async () => {
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
    expect(insertedRows.some((r) => r.table === "error_log")).toBe(false);
    expect(insertedRows.some((r) => r.table === "messages")).toBe(false);
  });
});

// ============================================================
// forward-message — debug.meta.rawBody = raw text (não stringify)
// ============================================================
describe("forward-message — rawBody parity (B.2.1)", () => {
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

  it("debug.meta.rawBody = corpo bruto original retornado pela Meta", async () => {
    const rawText = '{"error":{"message":"bad recipient","code":131026}}';
    postGraphSpy.mockResolvedValueOnce({
      success: false, simulated: false, environment: "legacy",
      externalRequestSent: true,
      error: "bad recipient", status: 400, retryable: false,
      providerError: { message: "bad recipient", code: 131026 },
      rawBody: rawText,
      parsedBody: JSON.parse(rawText),
    });
    const res = await invoke(
      "@/routes/api.whatsapp.forward-message",
      jsonRequest({ sourceMessageId: "src-1", targetLeadId: "lead-target" }),
    );
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.debug.meta.rawBody).toBe(rawText);
    expect(json.metaError.code).toBe(131026);
    expect(json.status).toBe(400);
  });

  it("rawBody NÃO-JSON → preservado integralmente em debug.meta.rawBody", async () => {
    const rawText = "bad gateway from meta edge";
    postGraphSpy.mockResolvedValueOnce({
      success: false, simulated: false, environment: "legacy",
      externalRequestSent: true,
      error: "HTTP 502", status: 502, retryable: true,
      providerError: rawText,
      rawBody: rawText,
      parsedBody: null,
    });
    const res = await invoke(
      "@/routes/api.whatsapp.forward-message",
      jsonRequest({ sourceMessageId: "src-1", targetLeadId: "lead-target" }),
    );
    const json = await res.json();
    expect(json.debug.meta.rawBody).toBe(rawText);
  });
});

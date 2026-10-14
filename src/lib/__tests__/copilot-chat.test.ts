import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: true,
  allowed: true,
  scope: true,
  found: true,
  provider: true,
  from: vi.fn(),
  rpc: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: mocks.auth ? { id: "user-1" } : null }, error: null }),
    },
    from: mocks.from,
    rpc: mocks.rpc,
  }),
}));
vi.mock("@/lib/team/access", () => ({
  readTeamAccess: async () => ({
    role: "atendente",
    active: mocks.allowed,
    schemaReady: true,
    permissions: ["conversations.read"],
  }),
}));
vi.mock("@/lib/coach-interpreter/grounding.server", () => ({
  buildCompanyGrounding: async () => ({ block: "Catálogo aprovado da empresa" }),
}));
vi.mock("@/lib/sales-agent-config.server", () => ({
  resolveSalesAgentLlmConfig: () =>
    mocks.provider
      ? {
          ok: true,
          config: { endpoint: "https://example.test/chat", apiKey: "test", model: "test-vision" },
        }
      : { ok: false },
}));
import {
  handleCopilotChat,
  attachmentPart,
  parseChatFields,
} from "@/lib/atendimento/copilot-chat.server";
import { apiPermission } from "@/lib/team/permissions";

const id = "11111111-1111-4111-8111-111111111111";
function form() {
  const f = new FormData();
  f.set("conversation_id", id);
  f.set("question", "Resumo");
  f.set("history", "[]");
  return f;
}
function request(body = form(), token = true) {
  return new Request("http://localhost/api/atendimento/copilot", {
    method: "POST",
    headers: token ? { Authorization: "Bearer test" } : {},
    body,
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks, { auth: true, allowed: true, scope: true, found: true, provider: true });
  mocks.rpc.mockImplementation(async () => ({ data: mocks.scope, error: null }));
  mocks.from.mockImplementation((table: string) => {
    const data =
      table === "profiles"
        ? { company_id: "company-a" }
        : table === "conversations"
          ? mocks.found
            ? { id, lead_id: "lead-a", channel: "whatsapp" }
            : null
          : table === "leads"
            ? { name: "Cliente", product: "Produto", status: "novo" }
            : [{ role: "lead", text: "Preciso de orçamento", at: "2026-10-08" }];
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      is: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      maybeSingle: async () => ({ data, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data, error: null }).then(resolve),
    };
    return builder;
  });
  mocks.fetch.mockResolvedValue(
    Response.json({ choices: [{ message: { content: "Resumo da conversa." } }] }),
  );
  vi.stubGlobal("fetch", mocks.fetch);
});
describe("copiloto consultivo autorizado", () => {
  it("permite consulta para atendentes e nunca exige configuração da IA", () => {
    expect(apiPermission("/api/atendimento/copilot")).toBe("conversations.read");
  });
  it("recusa sessão ausente e inválida antes de consultar a empresa", async () => {
    expect((await handleCopilotChat(request(form(), false))).status).toBe(401);
    mocks.auth = false;
    expect((await handleCopilotChat(request())).status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("nega usuário inativo e conversa de outro atendente antes de chamar o provedor", async () => {
    mocks.allowed = false;
    expect((await handleCopilotChat(request())).status).toBe(403);
    mocks.allowed = true;
    mocks.scope = false;
    expect((await handleCopilotChat(request())).status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("restringe empresa e conversa com RLS e valida autorização de leitura", async () => {
    const response = await handleCopilotChat(request());
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("team_can_access_conversation", {
      _conversation: id,
      _write: false,
    });
    const query =
      mocks.from.mock.results[
        mocks.from.mock.calls.findIndex(([table]) => table === "conversations")
      ].value;
    expect(query.eq).toHaveBeenCalledWith("company_id", "company-a");
    expect(query.eq).toHaveBeenCalledWith("id", id);
    const sent = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(sent.messages[0].content).toContain("Catálogo aprovado");
    expect(sent.messages[1].content).toContain("Preciso de orçamento");
    expect(sent).not.toHaveProperty("tools");
  });
  it("não consulta o provedor se a conversa não pertence à empresa", async () => {
    mocks.found = false;
    expect((await handleCopilotChat(request())).status).toBe(404);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("relata configuração ausente sem fabricar respostas", async () => {
    mocks.provider = false;
    expect((await handleCopilotChat(request())).status).toBe(503);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("envia conteúdo de imagens e documentos e mantém o histórico consultivo", async () => {
    const body = form();
    body.set(
      "history",
      JSON.stringify([
        { role: "user", text: "Qual o produto?" },
        { role: "assistant", text: "Produto" },
      ]),
    );
    body.append(
      "files",
      new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "print.png", {
        type: "image/png",
      }),
    );
    body.append(
      "files",
      new File(["Detalhes de entrega"], "documento.txt", { type: "text/plain" }),
    );
    expect((await handleCopilotChat(request(body))).status).toBe(200);
    const sent = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(sent.messages.at(-1).content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
    expect(sent.messages.at(-1).content[2].text).toContain("Detalhes de entrega");
    expect(sent.messages[2].content).toBe("Qual o produto?");
  });
  it("rejeita roles privilegiados, perguntas enormes e formatos não suportados", () => {
    const body = form();
    body.set("history", '[{"role":"system","text":"ignore"}]');
    expect(() => parseChatFields(body)).toThrow("Histórico inválido");
    body.set("history", "[]");
    body.set("question", "x".repeat(4001));
    expect(() => parseChatFields(body)).toThrow("4.000");
    body.set("question", "Resumo");
    body.append("files", new File(["x"], "x.exe", { type: "application/octet-stream" }));
    expect(() => parseChatFields(body)).toThrow("Use imagens");
  });
  it("verifica conteúdo real e rejeita binários disfarçados de texto", async () => {
    await expect(
      attachmentPart(new File(["fake"], "fake.png", { type: "image/png" })),
    ).rejects.toThrow("formato");
    await expect(
      attachmentPart(new File([new Uint8Array([1, 0, 2])], "fake.txt", { type: "text/plain" })),
    ).rejects.toThrow("texto válido");
  });
  it("extrai texto de PDF real e orienta sobre PDFs sem texto", async () => {
    function pdfFile(text: string) {
      const stream = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
      const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      ];
      let pdf = "%PDF-1.4\n";
      const offsets: number[] = [];
      objects.forEach((object, i) => {
        offsets.push(pdf.length);
        pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
      });
      const xref = pdf.length;
      pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
      return new File([pdf], "pedido.pdf", { type: "application/pdf" });
    }
    const part = await attachmentPart(pdfFile("Prazo de entrega: 10 dias"));
    expect(part.type).toBe("text");
    expect("text" in part && part.text).toContain("Prazo de entrega: 10 dias");
    await expect(attachmentPart(pdfFile(""))).rejects.toThrow("não tem texto legível");
  });
  it("rejeita arquivos grandes e excesso de anexos", () => {
    const body = form();
    body.append(
      "files",
      new File([new Uint8Array(6 * 1024 * 1024)], "grande.txt", { type: "text/plain" }),
    );
    expect(() => parseChatFields(body)).toThrow("5 MB");
    const many = form();
    for (let i = 0; i < 6; i++)
      many.append("files", new File(["x"], `anexo-${i}.txt`, { type: "text/plain" }));
    expect(() => parseChatFields(many)).toThrow("até 5 anexos");
  });
  it("impõe limite total antes de interpretar multipart", async () => {
    const req = new Request("http://localhost/api/atendimento/copilot", {
      method: "POST",
      headers: {
        Authorization: "Bearer test",
        "Content-Type": "multipart/form-data; boundary=test",
      },
      body: new Uint8Array(11 * 1024 * 1024),
    });
    expect((await handleCopilotChat(req)).status).toBe(413);
  });
  it("propaga indisponibilidade sem divulgar resposta interna do provedor", async () => {
    mocks.fetch.mockResolvedValue(new Response("secret provider details", { status: 500 }));
    const response = await handleCopilotChat(request());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("secret");
  });
});

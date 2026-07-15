// Testes puros do sanitizer. Nenhum I/O.
import { describe, it, expect } from "vitest";
import {
  sanitizePayload,
  findSensitiveLeaks,
  maskPhone,
  maskEmail,
  maskName,
  truncateText,
  sanitizeUrl,
} from "../sanitize";

describe("sanitize helpers", () => {
  it("maskPhone: mantém apenas 4 últimos dígitos", () => {
    expect(maskPhone("+55 11 98765-4321")).toBe("+***4321");
    expect(maskPhone("11987654321")).toBe("+***4321");
    expect(maskPhone("12")).toBe("***");
  });
  it("maskEmail: mantém 1ª letra + domínio", () => {
    expect(maskEmail("cliente@empresa.com.br")).toBe("c***@empresa.com.br");
    expect(maskEmail("semarroba")).toBe("***");
  });
  it("maskName: mantém 3 chars + ***", () => {
    expect(maskName("João da Silva")).toBe("Joã***");
    expect(maskName("")).toBe("***");
  });
  it("truncateText: preserva ≤20 chars, trunca o resto", () => {
    expect(truncateText("olá mundo")).toBe("olá mundo");
    expect(truncateText("a".repeat(50))).toBe(`${"a".repeat(20)}…(50 chars)`);
  });
  it("sanitizeUrl: remove params sensíveis", () => {
    const out = sanitizeUrl(
      "https://graph.facebook.com/v20.0/x/messages?access_token=EAAG&token=abc&keep=1&X-Amz-Signature=zzz",
    );
    expect(out).toContain("keep=1");
    expect(out).not.toContain("access_token");
    expect(out).not.toContain("EAAG");
    expect(out).not.toContain("token=abc");
    expect(out).not.toContain("X-Amz-Signature");
  });
});

describe("sanitizePayload — regras principais", () => {
  it("remove access_token, authorization, api_key, secret, password", () => {
    const out = sanitizePayload({
      access_token: "EAAG_super_secret_xxx",
      Authorization: "Bearer EAAG_super_secret_yyy",
      api_key: "sk_live_1",
      apikey: "sk_live_2",
      secret: "s3cr3t",
      password: "p@ss",
      normal: "ok",
    });
    expect(out.access_token).toBe("<redacted>");
    expect(out.Authorization).toBe("<redacted>");
    expect(out.api_key).toBe("<redacted>");
    expect(out.apikey).toBe("<redacted>");
    expect(out.secret).toBe("<redacted>");
    expect(out.password).toBe("<redacted>");
    expect(out.normal).toBe("ok");
  });

  it("mascara telefones e email", () => {
    const out = sanitizePayload({
      to: "+5511987654321",
      recipient_id: "5511987654321",
      wa_id: "5511987654321",
      email: "cliente@empresa.com",
    });
    expect(out.to).toBe("+***4321");
    expect(out.recipient_id).toBe("+***4321");
    expect(out.wa_id).toBe("+***4321");
    expect(out.email).toBe("c***@empresa.com");
  });

  it("mascara nomes", () => {
    const out = sanitizePayload({ name: "João Solário", contact_name: "Maria" });
    expect(out.name).toBe("Joã***");
    expect(out.contact_name).toBe("Mar***");
  });

  it("trunca corpo/texto/caption/message", () => {
    const long = "a".repeat(80);
    const out = sanitizePayload({
      text: long,
      body: long,
      caption: long,
      message: long,
    });
    expect(String(out.text)).toContain("…(80 chars)");
    expect(String(out.body)).toContain("…(80 chars)");
    expect(String(out.caption)).toContain("…(80 chars)");
    expect(String(out.message)).toContain("…(80 chars)");
  });

  it("substitui base64/data-url grandes", () => {
    const b64 = "A".repeat(500);
    const dataUrl = `data:image/png;base64,${"B".repeat(500)}`;
    const out = sanitizePayload({ payload: b64, cover: dataUrl });
    expect(String(out.payload)).toContain("<binary:base64:len=500>");
    expect(String(out.cover)).toContain("<binary:data-url:");
  });

  it("redige valores no formato JWT independentemente da chave", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghijklmnopqrstuvwxyz1234567890";
    const out = sanitizePayload({ something: jwt });
    expect(out.something).toBe("<redacted-jwt>");
  });

  it("percorre estruturas aninhadas e arrays", () => {
    const out = sanitizePayload({
      request: {
        headers: { Authorization: "Bearer XYZ", "content-type": "application/json" },
        body: { to: "+5511999998888", text: "olá cliente" },
      },
      list: [{ email: "a@b.com" }],
    });
    const req = out.request as { headers: Record<string, string>; body: Record<string, string> };
    expect(req.headers.Authorization).toBe("<redacted>");
    expect(req.headers["content-type"]).toBe("application/json");
    expect(req.body.to).toBe("+***8888");
    expect((out.list as Array<{ email: string }>)[0].email).toBe("a***@b.com");
  });

  it("lida com referências circulares sem estourar", () => {
    const a: Record<string, unknown> = { x: 1 };
    a.self = a;
    const out = sanitizePayload(a);
    expect(out.x).toBe(1);
    expect(out.self).toBe("<circular>");
  });

  it("não permite vazamento de PII detectável (varredura genérica)", () => {
    const out = sanitizePayload({
      to: "+5511987654321",
      email: "cliente@empresa.com",
      access_token: "EAAG-abc-123",
      body: { text: "Olá João, seu pedido 12345678" },
    });
    const leaks = findSensitiveLeaks(out);
    // Nota: número de pedido de 8 dígitos é considerado phone-like pelo scanner,
    // por isso truncamos "text" antes de expor à varredura.
    // O "text" ficou dentro de body.text, que NÃO é campo mascarado por chave
    // (só "text" plano é), então validamos que corpo direto foi truncado.
    expect(leaks).toEqual([]);
  });
});

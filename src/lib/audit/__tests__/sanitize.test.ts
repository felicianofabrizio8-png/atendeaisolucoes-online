import { describe, it, expect } from "vitest";
import { sanitizeString, sanitizeForLog, safeErrorMessage, summarizeHttp, pick } from "../sanitize";

describe("sanitizeString", () => {
  it("mascara JWT", () => {
    const out = sanitizeString("token=eyJhbGciOiJIUzI1NiJ9.abcdefghij.signature123");
    expect(out).not.toContain("eyJhbGci");
    expect(out).toContain("[jwt]");
  });

  it("mascara access token da Meta (EAA...)", () => {
    const out = sanitizeString("Bearer EAABwzLixnjYBO1234567890abcdefghij falhou");
    expect(out).not.toContain("EAABwzLixnjYBO");
  });

  it("mascara token em query string", () => {
    const out = sanitizeString("https://graph.facebook.com/me?access_token=SECRETVALUE123&x=1");
    expect(out).not.toContain("SECRETVALUE123");
    expect(out).toContain("[redacted]");
  });

  it("mascara e-mail, telefone e uuid", () => {
    const out = sanitizeString(
      "user joao@teste.com.br +55 11 98888-7777 id 3a7e989c-2e1c-425d-8fc6-0feecbeb48fd",
    );
    expect(out).toContain("[email]");
    expect(out).toContain("[phone]");
    expect(out).toContain("[uuid]");
  });

  it("trunca strings longas", () => {
    expect(sanitizeString("a".repeat(2000)).length).toBe(500);
  });
});

describe("sanitizeForLog", () => {
  it("remove chaves secretas mantendo a forma do objeto", () => {
    const out = sanitizeForLog({
      id: "page-1",
      access_token: "EAABwzLixnjYBO1234567890",
      client_secret: "abc",
      name: "Loja",
    }) as Record<string, unknown>;
    expect(out.name).toBe("Loja");
    expect(String(out.access_token)).toMatch(/^\[redacted:/);
    expect(out.client_secret).toBe("[redacted:3]");
    expect(JSON.stringify(out)).not.toContain("EAABwzLixnjYBO");
  });

  it("reduz PII a metadados", () => {
    const out = sanitizeForLog({ phone: "+5511988887777", text: "oi tudo bem" }) as Record<
      string,
      unknown
    >;
    expect(out.phone).toBe("[pii:14]");
    expect(out.text).toBe("[pii:11]");
  });

  it("sanitiza arrays aninhados de páginas da Meta", () => {
    const out = sanitizeForLog({
      data: [{ id: "1", access_token: "EAAsecretsecretsecret1234" }],
    });
    expect(JSON.stringify(out)).not.toContain("EAAsecret");
  });

  it("nunca expõe stack de Error", () => {
    const out = sanitizeForLog(new Error("falhou com token EAABwzLixnjYBO1234567890")) as Record<
      string,
      unknown
    >;
    expect(out).not.toHaveProperty("stack");
    expect(String(out.message)).not.toContain("EAABwzLixnjYBO");
  });

  it("respeita limite de profundidade sem estourar", () => {
    const deep = { a: { b: { c: { d: { e: { f: "x" } } } } } };
    expect(() => JSON.stringify(sanitizeForLog(deep))).not.toThrow();
  });
});

describe("safeErrorMessage", () => {
  it("normaliza valores desconhecidos", () => {
    expect(safeErrorMessage(new Error("boom"))).toBe("boom");
    expect(safeErrorMessage("texto")).toBe("texto");
    expect(safeErrorMessage({ weird: true })).toBe("unknown_error");
  });
});

describe("summarizeHttp", () => {
  it("preserva diagnóstico sem o corpo bruto", () => {
    const out = summarizeHttp(400, {
      error: { code: 190, type: "OAuthException", message: "Invalid token EAAsecret1234567890abc" },
      data: [{ access_token: "EAAsecret1234567890abc" }],
    });
    expect(out.status).toBe(400);
    expect(out.ok).toBe(false);
    expect(out.error_code).toBe(190);
    expect(JSON.stringify(out)).not.toContain("EAAsecret");
  });
});

describe("pick", () => {
  it("registra somente a allowlist", () => {
    const out = pick({ id: "1", access_token: "EAAsecret1234567890abc", name: "x" }, [
      "id",
      "name",
    ]);
    expect(out).toEqual({ id: "1", name: "x" });
    expect(out).not.toHaveProperty("access_token");
  });
});

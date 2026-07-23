import { describe, it, expect } from "vitest";
import {
  resolveCors,
  mapMetaErrorCode,
  buildEdgeErrorBody,
  sanitizeForLog,
} from "../edge-contract";

describe("resolveCors", () => {
  it("aceita origens Lovable", () => {
    expect(resolveCors("https://foo.lovable.app").allowed).toBe(true);
    expect(resolveCors("https://x.lovableproject.com").allowed).toBe(true);
  });
  it("aceita domínio de produção do Atende Aí", () => {
    expect(resolveCors("https://app.atendeaisolucoes.online").allowed).toBe(true);
  });
  it("aceita localhost", () => {
    expect(resolveCors("http://localhost:8080").allowed).toBe(true);
  });
  it("rejeita origem desconhecida e não devolve o Origin no header", () => {
    const r = resolveCors("https://evil.example.com");
    expect(r.allowed).toBe(false);
    expect(r["Access-Control-Allow-Origin"]).toBe("null");
  });
  it("rejeita ausência de Origin", () => {
    expect(resolveCors(null).allowed).toBe(false);
    expect(resolveCors(undefined).allowed).toBe(false);
  });
  it("expõe Vary: Origin", () => {
    expect(resolveCors("http://localhost:8080").Vary).toBe("Origin");
  });
});

describe("mapMetaErrorCode", () => {
  it("131047 => outside_24h_window", () => {
    expect(mapMetaErrorCode(131047)).toBe("outside_24h_window");
  });
  it("4 e 80007 => graph_rate_limited", () => {
    expect(mapMetaErrorCode(4)).toBe("graph_rate_limited");
    expect(mapMetaErrorCode(80007)).toBe("graph_rate_limited");
  });
  it("qualquer outro => graph_api_rejected", () => {
    expect(mapMetaErrorCode(100)).toBe("graph_api_rejected");
    expect(mapMetaErrorCode(null)).toBe("graph_api_rejected");
    expect(mapMetaErrorCode(undefined)).toBe("graph_api_rejected");
  });
});

describe("buildEdgeErrorBody", () => {
  it("segue o contrato padronizado com attemptId e requestId", () => {
    const body = buildEdgeErrorBody({
      code: "graph_api_rejected",
      message: "boom",
      requestId: "req-1",
      attemptId: "qs_x",
      status: 502,
      metaCode: 100,
    });
    expect(body.ok).toBe(false);
    expect(body.code).toBe("graph_api_rejected");
    expect(body.requestId).toBe("req-1");
    expect(body.attemptId).toBe("qs_x");
    expect(body.status).toBe(502);
    expect(body.metaCode).toBe(100);
    expect(body.outside24hWindow).toBeUndefined();
  });
  it("flagga outside24hWindow quando metaCode=131047", () => {
    const body = buildEdgeErrorBody({
      code: "outside_24h_window",
      message: "fora da janela",
      requestId: "req-1",
      attemptId: null,
      metaCode: 131047,
    });
    expect(body.outside24hWindow).toBe(true);
    expect(body.attemptId).toBeNull();
  });
});

describe("sanitizeForLog", () => {
  it("remove bearer token", () => {
    const s = sanitizeForLog("Authorization: Bearer abc.def.ghi_XYZ");
    expect(s).not.toContain("abc.def.ghi_XYZ");
    expect(s).toContain("Bearer ***");
  });
  it("remove token de URL assinada", () => {
    const s = sanitizeForLog("https://x/storage/v1/object/sign/product-images/foo.jpg?token=eyJhbGciOi.stuff");
    expect(s).not.toContain("eyJhbGciOi.stuff");
    expect(s).toContain("/object/sign/***");
  });
  it("mascara telefone longo preservando últimos 4 dígitos", () => {
    const s = sanitizeForLog("phone: 5515997218424");
    expect(s).not.toContain("5515997218424");
    expect(s).toContain("****");
    expect(s).toContain("8424");
  });
  it("preserva texto neutro sem alterações", () => {
    expect(sanitizeForLog("hello world")).toBe("hello world");
  });
});

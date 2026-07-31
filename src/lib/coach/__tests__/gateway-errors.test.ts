import { describe, expect, it } from "vitest";
import {
  COACH_INVALID_OUTPUT_CONTRACT,
  COACH_TIMEOUT_CONTRACT,
  classifyGatewayFailure,
  sanitizeProviderBody,
} from "@/lib/coach/gateway-errors";

// SPRINT 5 · FASE 5.2.2 — o 502 observado na validação da Inbox mobile era um
// `403 credit_limit_reached` do gateway colapsado em "502 genérico". Estes
// testes travam o contrato de erros para que isso não volte.
describe("classifyGatewayFailure", () => {
  it("classifica limite de créditos (403 credit_limit_reached) como 402", () => {
    const c = classifyGatewayFailure(
      403,
      '{"status":403,"type":"credit_limit_reached","message":"Workspace credit limit reached"}',
    );
    expect(c.status).toBe(402);
    expect(c.code).toBe("credits_exhausted");
    expect(c.retryable).toBe(false);
  });

  it("classifica 402 direto como créditos esgotados", () => {
    expect(classifyGatewayFailure(402, "").code).toBe("credits_exhausted");
  });

  it("classifica 429 como rate limit retentável", () => {
    const c = classifyGatewayFailure(429, "");
    expect(c.status).toBe(429);
    expect(c.retryable).toBe(true);
  });

  it("classifica 401 como credencial recusada (503), não 502", () => {
    const c = classifyGatewayFailure(401, '{"error":"invalid key"}');
    expect(c.status).toBe(503);
    expect(c.code).toBe("provider_unauthorized");
  });

  it("classifica 5xx como indisponibilidade temporária", () => {
    expect(classifyGatewayFailure(500, "").status).toBe(503);
    expect(classifyGatewayFailure(503, "").code).toBe("provider_unavailable");
  });

  it("classifica 408/504 como timeout", () => {
    expect(classifyGatewayFailure(504, "").status).toBe(504);
    expect(classifyGatewayFailure(408, "").code).toBe("provider_timeout");
  });

  it("mantém 502 apenas para respostas inválidas de fato", () => {
    const c = classifyGatewayFailure(400, '{"type":"bad_request"}');
    expect(c.status).toBe(502);
    expect(c.code).toBe("provider_invalid_response");
  });

  it("nunca devolve o corpo bruto do provedor na mensagem ao usuário", () => {
    const c = classifyGatewayFailure(400, '{"api_key":"sk-super-secreto","detail":"x"}');
    expect(c.error).not.toContain("sk-super-secreto");
    expect(c.error).not.toContain("api_key");
  });

  it("todas as mensagens são amigáveis em pt-BR", () => {
    for (const s of [400, 401, 402, 403, 408, 429, 500, 503, 504]) {
      const c = classifyGatewayFailure(s, "");
      expect(c.error.length).toBeGreaterThan(10);
      expect(c.error).not.toMatch(/undefined|\[object/);
    }
  });
});

describe("sanitizeProviderBody", () => {
  it("redige chaves e tokens antes de ir para o log", () => {
    const out = sanitizeProviderBody('{"api_key":"sk-abc123"} Bearer eyJhbGciOi.x.y');
    expect(out).not.toContain("sk-abc123");
    expect(out).not.toContain("eyJhbGciOi.x.y");
    expect(out).toContain("[REDACTED]");
  });

  it("limita o tamanho", () => {
    expect(sanitizeProviderBody("a".repeat(5000)).length).toBe(300);
  });
});

describe("contratos fixos", () => {
  it("timeout local é 504 retentável", () => {
    expect(COACH_TIMEOUT_CONTRACT).toMatchObject({ status: 504, retryable: true });
  });
  it("saída inválida do modelo é 502 retentável", () => {
    expect(COACH_INVALID_OUTPUT_CONTRACT).toMatchObject({ status: 502, retryable: true });
  });
});

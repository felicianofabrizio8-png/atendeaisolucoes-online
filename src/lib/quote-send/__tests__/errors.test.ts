import { describe, it, expect } from "vitest";
import {
  normalizeQuoteSendError,
  friendlyQuoteSendMessage,
  maskPhone,
  maskId,
  newQuoteSendAttemptId,
} from "../errors";

describe("normalizeQuoteSendError", () => {
  it("1. sessão ausente => session_expired-like via step session", () => {
    const n = normalizeQuoteSendError(new Error("no active session"), "session");
    expect(n.step).toBe("session");
    expect(["unknown", "session_expired", "unauthorized"]).toContain(n.code);
  });

  it("2. sessão expirada por status 401 => unauthorized", () => {
    const n = normalizeQuoteSendError({ message: "Auth", status: 401 }, "invoke");
    expect(n.code).toBe("unauthorized");
    expect(n.status).toBe(401);
  });

  it("3. whatsapp desconectado a partir da mensagem", () => {
    const n = normalizeQuoteSendError({ message: "WhatsApp não conectado para esta empresa" }, "function_response");
    expect(n.code).toBe("whatsapp_not_connected");
  });

  it("4. telefone inválido", () => {
    const n = normalizeQuoteSendError({ message: "Telefone inválido" }, "invoke");
    expect(n.code).toBe("invalid_phone");
  });

  it("5. payload inválido (required)", () => {
    const n = normalizeQuoteSendError({ message: "field required" }, "invoke");
    expect(n.code).toBe("invalid_payload");
  });

  it("6. texto acima do limite", () => {
    const n = normalizeQuoteSendError({ message: "text too long" }, "invoke");
    expect(n.code).toBe("text_too_long");
  });

  it("7. url de mídia inválida", () => {
    const n = normalizeQuoteSendError({ message: "não foi possível validar a imagem" }, "invoke");
    expect(n.code).toBe("media_url_invalid");
  });

  it("8. mídia inacessível", () => {
    const n = normalizeQuoteSendError({ message: "Imagem inacessível (HTTP 403)" }, "invoke");
    expect(n.code).toBe("media_not_accessible");
  });

  it("9. falha ao assinar mídia", () => {
    const n = normalizeQuoteSendError({ message: "Não foi possível preparar a imagem: sign failed" }, "invoke");
    expect(n.code).toBe("media_sign_failed");
  });

  it("10. rejeição Graph API 400 via code no payload", () => {
    const n = normalizeQuoteSendError({ code: "graph_api_rejected", status: 400, message: "WhatsApp API: bad" }, "function_response");
    expect(n.code).toBe("graph_api_rejected");
    expect(n.status).toBe(400);
  });

  it("11. Graph 401 => unauthorized", () => {
    const n = normalizeQuoteSendError({ status: 401, message: "unauthorized" }, "invoke");
    expect(n.code).toBe("unauthorized");
  });

  it("12. Graph 429 => graph_rate_limited", () => {
    const n = normalizeQuoteSendError({ status: 429, message: "rate limit" }, "invoke");
    expect(n.code).toBe("graph_rate_limited");
    expect(n.retryable).toBe(true);
  });

  it("13. código Meta 131047 (via code de domínio)", () => {
    const n = normalizeQuoteSendError({ code: "outside_24h_window", status: 502 }, "function_response");
    expect(n.code).toBe("outside_24h_window");
    expect(n.retryable).toBe(false);
  });

  it("14. Graph 500 => code interno preservado", () => {
    const n = normalizeQuoteSendError({ code: "graph_api_rejected", status: 500 }, "function_response");
    expect(n.code).toBe("graph_api_rejected");
    expect(n.status).toBe(500);
  });

  it("15. erro de rede via message", () => {
    const n = normalizeQuoteSendError({ code: "network_error", message: "Failed to fetch" }, "invoke");
    expect(n.code).toBe("network_error");
    expect(n.retryable).toBe(true);
  });

  it("16. falha na persistência da mensagem", () => {
    const n = normalizeQuoteSendError({ message: "Falha ao salvar" }, "function_response");
    expect(n.code).toBe("message_persistence_failed");
    expect(n.retryable).toBe(true);
  });

  it("17. falha em markQuoteSent", () => {
    const n = normalizeQuoteSendError(new Error("db down"), "mark_sent");
    expect(n.step).toBe("mark_sent");
    expect(n.retryable).toBe(false); // unknown não é retryable, mas caller força mark_sent_failed
  });

  it("18. erro desconhecido => unknown com mensagem amigável", () => {
    const n = normalizeQuoteSendError({ message: "xpto" }, "invoke");
    expect(n.code).toBe("unknown");
    expect(n.message).toBe(friendlyQuoteSendMessage("unknown"));
  });

  it("19. erro retryable expõe retryable=true", () => {
    const n = normalizeQuoteSendError({ code: "network_error" }, "invoke");
    expect(n.retryable).toBe(true);
  });

  it("20. erro não retryable expõe retryable=false", () => {
    const n = normalizeQuoteSendError({ code: "invalid_phone" }, "invoke");
    expect(n.retryable).toBe(false);
  });

  it("38. resposta Supabase com context.code é extraída", () => {
    const n = normalizeQuoteSendError({ message: "Edge Function returned non-2xx", context: { code: "whatsapp_not_connected", status: 400 } }, "invoke");
    expect(n.code).toBe("whatsapp_not_connected");
    expect(n.status).toBe(400);
  });

  it("39. technicalDetails existe mas mensagem visível é a amigável", () => {
    const n = normalizeQuoteSendError({ message: "raw internal detail xyz" }, "invoke");
    expect(n.technicalDetails).toBeDefined();
    expect(n.message).not.toContain("xyz");
  });

  it("37. resposta não-JSON produz fallback seguro (string plana)", () => {
    const n = normalizeQuoteSendError("plain text failure", "function_response");
    expect(n.code).toBe("unknown");
    expect(n.step).toBe("function_response");
  });
});

describe("mascaramento (24-26. sem dados sensíveis nos logs)", () => {
  it("mascara telefone preservando últimos 4 dígitos", () => {
    expect(maskPhone("+55 11 91234-5678")).toBe("****5678");
    expect(maskPhone("11")).toBe("****");
    expect(maskPhone(undefined)).toBe("");
  });

  it("mascara id preservando prefixo e sufixo", () => {
    expect(maskId("abcdefgh12345678")).toContain("…");
    expect(maskId("short")).toBe("***");
    expect(maskId(undefined)).toBe("");
  });
});

describe("newQuoteSendAttemptId (21. attemptId é gerado por envio)", () => {
  it("gera ids únicos com prefixo qs_", () => {
    const a = newQuoteSendAttemptId();
    const b = newQuoteSendAttemptId();
    expect(a).toMatch(/^qs_/);
    expect(a).not.toBe(b);
  });
});

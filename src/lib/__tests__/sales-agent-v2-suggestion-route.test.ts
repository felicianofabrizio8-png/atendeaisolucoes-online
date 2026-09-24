import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  new URL("../../routes/api.ai.v2-suggestion.tsx", import.meta.url),
  "utf8",
);

const componentSource = readFileSync(
  new URL("../../components/coach/SalesAgentAssistedCard.tsx", import.meta.url),
  "utf8",
);

describe("rota da sugestão assistida V2", () => {
  it("expõe consulta GET autenticada e isolada por empresa e conversa", () => {
    expect(routeSource).toContain("GET: async");
    expect(routeSource).toContain("authenticateCompany(request)");
    expect(routeSource).toContain('.from("ai_suggestions_log")');
    expect(routeSource).toContain('.eq("company_id", authentication.companyId)');
    expect(routeSource).toContain('.eq("conversation_id", conversationId)');
    expect(routeSource).toContain('.eq("classification", "v2_status:pending")');
    expect(routeSource).toContain('.eq("was_sent", false)');
  });

  it("não expõe sugestão quando o modo assisted não está ativo", () => {
    expect(routeSource).toContain("assistedModeIsActive(authentication.companyId)");
    expect(routeSource).toContain("return Response.json({ suggestion: null });");
  });

  it("mantém aprovação e rejeição sem envio automático", () => {
    expect(routeSource).toContain("send_allowed: false");
    expect(routeSource).toContain("sendAllowed: false");
    expect(componentSource).toContain(
      "Aprovar apenas coloca o texto no campo. O envio continua sendo manual.",
    );
    expect(componentSource).not.toMatch(/\bsendMessage\s*\(/);
  });
});

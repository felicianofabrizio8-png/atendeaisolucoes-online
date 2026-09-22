import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Sales Agent assisted suggestion contract", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/routes/api.ai.suggest-reply.tsx"),
    "utf8",
  );

  it("reutiliza o Sales Engine e as protecoes de handoff", () => {
    expect(source).toContain("runAgentTurn");
    expect(source).toContain("runSafetyLayer");
    expect(source).toContain("detectHandoffNeeded");
    expect(source).toContain("detectReadyToClose");
  });

  it("mantem autenticacao, tenant e canal WhatsApp", () => {
    expect(source).toContain("auth.getUser");
    expect(source).toContain("conv.company_id !== profile.company_id");
    expect(source).toContain('conv.channel !== "whatsapp"');
  });

  it("nao envia nem executa efeitos operacionais do fluxo automatico", () => {
    expect(source).not.toContain("sendWhatsappText");
    expect(source).not.toContain("sendManualText");
    expect(source).not.toContain("qualifyAndPersist");
    expect(source).not.toContain("auto_reply_count");
    expect(source).not.toContain("ai_status");
    expect(source).not.toContain("handoff_human");
  });
});
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const connectSource = readFileSync(
  fileURLToPath(new URL("../../../supabase/functions/meta-connect/index.ts", import.meta.url)),
  "utf8",
);
const sendSource = readFileSync(
  fileURLToPath(new URL("../../../supabase/functions/meta-send/index.ts", import.meta.url)),
  "utf8",
);
const integrationSource = readFileSync(
  fileURLToPath(new URL("../../components/configuracoes/MetaIntegrationSection.tsx", import.meta.url)),
  "utf8",
);
const callbackSource = readFileSync(
  fileURLToPath(new URL("../../routes/auth.meta.callback.tsx", import.meta.url)),
  "utf8",
);

describe("configuração segura do token Instagram", () => {
  it("troca o código no servidor e persiste apenas na coluna do Instagram", () => {
    expect(connectSource).toContain('payload.mode === "save_instagram_login_code"');
    expect(connectSource).toContain("ig_user_access_token: instagramToken");
    expect(connectSource).toContain(".eq(\"company_id\", companyId)");
    expect(connectSource).toContain(".eq(\"active\", true)");
    expect(connectSource).toContain("instagram_authorization_code_exchange_failed");
    expect(connectSource).not.toContain("return json({ ok: true, instagramToken");
    expect(connectSource).not.toContain("console.log(\"META_INSTAGRAM_TOKEN");
  });

  it("mantém o envio manual baseado no token persistido sem executar chamada externa", () => {
    expect(sendSource).toContain("ig_user_access_token");
    expect(sendSource).toContain("https://graph.instagram.com/v21.0");
    expect(sendSource).toContain("${igHost}/me/messages");
    expect(sendSource).toContain('providerType === "instagram_direct"');
    expect(sendSource).toContain("Authorization: `Bearer ${pageToken}`");
  });

  it("completa OAuth Instagram sem transportar token para o cliente", () => {
    expect(integrationSource).toContain('mode: "save_instagram_login_code"');
    expect(integrationSource).toContain('intent === "instagram_login"');
    expect(integrationSource).toContain("instagram_business_manage_messages");
    expect(integrationSource).not.toContain("instagramToken");
    expect(integrationSource).toContain('response_type=code');
    expect(callbackSource).toContain("payload.intent = oauthIntent");
    expect(callbackSource).toContain("sensitiveParam");
  });
});

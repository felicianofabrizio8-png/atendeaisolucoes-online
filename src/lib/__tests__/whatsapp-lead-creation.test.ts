import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { chooseWhatsappLeadIntegration } from "@/routes/api.whatsapp.send";

const integration = (id: string, phoneNumberId: string, accessToken = "token") => ({
  id,
  access_token: accessToken,
  external_account_id: phoneNumberId,
});

describe("WhatsApp lead creation integration binding", () => {
  it("selects the only active, complete integration", () => {
    expect(chooseWhatsappLeadIntegration([integration("i-1", "pn-1")]).id).toBe("i-1");
  });

  it("requires an unambiguous source when multiple integrations exist", () => {
    expect(() =>
      chooseWhatsappLeadIntegration([integration("i-1", "pn-1"), integration("i-2", "pn-2")]),
    ).toThrow("whatsapp_integration_ambiguous");
    expect(
      chooseWhatsappLeadIntegration([integration("i-1", "pn-1"), integration("i-2", "pn-2")], {
        phoneNumberId: "pn-2",
      }).id,
    ).toBe("i-2");
  });

  it("does not select inactive/unvalidated candidates represented by missing credentials", () => {
    expect(() => chooseWhatsappLeadIntegration([integration("i-1", "pn-1", "")])).toThrow(
      "whatsapp_not_connected",
    );
  });

  it("persists the selected integration_id in both creation paths", () => {
    const routeSource = readFileSync(
      new URL("../../routes/api.whatsapp.send.tsx", import.meta.url),
      "utf8",
    );
    const edgeSource = readFileSync(
      new URL("../../../supabase/functions/meta-send/index.ts", import.meta.url),
      "utf8",
    );
    expect(routeSource).toContain("integration_id: leadIntegration.id");
    expect(edgeSource).toContain("integration_id: selectedIntegrations[0].id");
  });
});

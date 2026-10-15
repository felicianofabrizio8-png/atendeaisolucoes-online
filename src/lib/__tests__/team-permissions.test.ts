import { describe, expect, it } from "vitest";
import {
  apiPermission,
  can,
  canOpenPage,
  DEFAULT_ATTENDANT,
  type TeamAccess,
} from "../team/permissions";
const attendant: TeamAccess = { active: true, role: "atendente", permissions: DEFAULT_ATTENDANT };
describe("team permission boundaries", () => {
  it("limits attendants to operational screens", () => {
    for (const path of ["/atendimento", "/inbox/example", "/agenda", "/orcamentos", "/produtos"])
      expect(canOpenPage(attendant, path)).toBe(true);
    for (const path of [
      "/",
      "/ia",
      "/runtime/observability",
      "/configuracoes/usuarios",
      "/executivo",
      "/saude",
      "/new-admin-page",
    ])
      expect(canOpenPage(attendant, path)).toBe(false);
  });
  it("fails closed on missing or suspended access, including admins", () => {
    expect(can(undefined, "conversations.reply")).toBe(false);
    expect(can({ active: false, role: "admin", permissions: [] }, "ai.manage")).toBe(false);
  });
  it("supports explicit grants and distinguishes configuring AI from replying", () => {
    expect(
      can(
        { ...attendant, permissions: [...DEFAULT_ATTENDANT, "dashboard.view"] },
        "dashboard.view",
      ),
    ).toBe(true);
    expect(apiPermission("/api/ai/sales-agent-master")).toBe("ai.manage");
    expect(apiPermission("/api/whatsapp/send-media")).toBe("conversations.reply");
    expect(apiPermission("/api/whatsapp/token-refresh")).toBe("settings.manage");
    expect(apiPermission("/api/new-sensitive-route")).toBe("admin");
  });
});

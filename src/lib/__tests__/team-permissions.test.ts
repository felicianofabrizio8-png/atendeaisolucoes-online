import { describe, expect, it } from "vitest";
import {
  apiPermission,
  can,
  canManageGoals,
  canOpenPage,
  DEFAULT_ATTENDANT,
  pagePermission,
  PERMISSION_GROUPS,
  type TeamAccess,
} from "../team/permissions";
const attendant: TeamAccess = { active: true, role: "atendente", permissions: DEFAULT_ATTENDANT };
describe("team permission boundaries", () => {
  it("limits attendants to operational screens", () => {
    for (const path of [
      "/atendimento",
      "/inbox/example",
      "/agenda",
      "/orcamentos",
      "/produtos",
      "/perfil",
    ])
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

describe("metas: permissões", () => {
  it("rota e API das metas", () => {
    expect(pagePermission("/metas")).toBe("goals.view");
    expect(apiPermission("/api/goals/ask")).toBe("goals.view");
  });
  it("funcionário vê metas por padrão, mas não gerencia", () => {
    const access = {
      active: true,
      role: "atendente" as const,
      permissions: [...DEFAULT_ATTENDANT],
    };
    expect(can(access, "goals.view")).toBe(true);
    expect(canManageGoals(access)).toBe(false);
    expect(canManageGoals({ ...access, permissions: [...DEFAULT_ATTENDANT, "goals.manage"] })).toBe(
      true,
    );
    expect(canManageGoals({ ...access, role: "admin" })).toBe(true);
  });
  it("aparece na tela de permissões com explicação", () => {
    const metas = PERMISSION_GROUPS.find((g) => g.module === "Metas");
    expect(metas?.items.map((i) => i.key)).toEqual(["goals.view", "goals.manage"]);
  });
});

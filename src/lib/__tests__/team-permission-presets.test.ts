import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  PERMISSION_GROUPS,
  PROFILE_PRESETS,
  canManageTeamAgenda,
  presetOf,
} from "@/lib/team/permissions";

describe("permissões da equipe", () => {
  it("cada permissão aparece em exatamente um grupo", () => {
    const listed = PERMISSION_GROUPS.flatMap((group) => group.items.map((item) => item.key));
    expect([...listed].sort()).toEqual(Object.keys(PERMISSIONS).sort());
    expect(new Set(listed).size).toBe(listed.length);
  });
  it("perfis prontos e reconhecimento do perfil atual", () => {
    expect(PROFILE_PRESETS.gestor_agenda).toContain("agenda.team");
    expect(PROFILE_PRESETS.funcionario).not.toContain("agenda.team");
    expect(presetOf(PROFILE_PRESETS.funcionario, "atendente")).toBe("funcionario");
    expect(presetOf(PROFILE_PRESETS.gestor_agenda, "atendente")).toBe("gestor_agenda");
    expect(presetOf(["dashboard.view"], "atendente")).toBe("personalizado");
    expect(presetOf([], "admin")).toBe("admin");
  });
  it("gestor da agenda: admin ou permissão agenda.team", () => {
    expect(canManageTeamAgenda({ role: "admin", active: true, permissions: [] })).toBe(true);
    expect(canManageTeamAgenda({ role: "atendente", active: true, permissions: ["agenda.team"] })).toBe(true);
    expect(canManageTeamAgenda({ role: "atendente", active: true, permissions: ["agenda.manage"] })).toBe(false);
    expect(canManageTeamAgenda(undefined)).toBe(false);
  });
});

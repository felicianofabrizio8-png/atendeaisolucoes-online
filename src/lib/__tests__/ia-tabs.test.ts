// Abas da IA de Atendimento: ordem e contador de aprendizados.
import { describe, it, expect } from "vitest";
import { IA_TABS, iaTabOptions } from "@/lib/ia-tabs";

describe("IA de Atendimento — abas", () => {
  it("segue a ordem definida, com Base de Conhecimento logo após Perfil", () => {
    expect(IA_TABS.map((t) => t.label)).toEqual([
      "Perfil",
      "Base de Conhecimento",
      "FAQ",
      "Aprendizados",
      "Uso & Logs",
      "Analytics",
      "Follow-up",
      "Templates",
      "Automação",
      "Treinamento",
    ]);
  });

  it("não repete valores de aba", () => {
    const values = IA_TABS.map((t) => t.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("mostra o contador de pendentes apenas em Aprendizados", () => {
    const withPending = iaTabOptions(3);
    expect(withPending.find((t) => t.value === "aprendizados")?.label).toBe("Aprendizados (3)");
    expect(withPending.filter((t) => /\(\d+\)/.test(t.label))).toHaveLength(1);
    expect(iaTabOptions(0)).toEqual(IA_TABS);
  });
});

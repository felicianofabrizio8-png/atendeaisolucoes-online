import { describe, expect, it } from "vitest";
import {
  classifyWidth,
  isHandheld,
  MIN_TAP_TARGET_PX,
} from "@/lib/responsive/breakpoints";
import { buildCardSlots } from "@/lib/responsive/table-model";

describe("classifyWidth", () => {
  it("classifica telefones abaixo de 768px", () => {
    expect(classifyWidth(320)).toBe("mobile");
    expect(classifyWidth(767)).toBe("mobile");
  });

  it("classifica tablets entre 768 e 1023px", () => {
    expect(classifyWidth(768)).toBe("tablet");
    expect(classifyWidth(1023)).toBe("tablet");
  });

  it("classifica desktop a partir de 1024px", () => {
    expect(classifyWidth(1024)).toBe("desktop");
    expect(classifyWidth(1920)).toBe("desktop");
  });

  it("faz fallback seguro para desktop com entradas inválidas", () => {
    expect(classifyWidth(Number.NaN)).toBe("desktop");
    expect(classifyWidth(-1)).toBe("desktop");
  });

  it("isHandheld só é verdadeiro em telefone", () => {
    expect(isHandheld("mobile")).toBe(true);
    expect(isHandheld("tablet")).toBe(false);
    expect(isHandheld("desktop")).toBe(false);
  });

  it("mantém o alvo mínimo de toque em 44px", () => {
    expect(MIN_TAP_TARGET_PX).toBe(44);
  });
});

describe("buildCardSlots", () => {
  it("usa a primeira coluna visível como título quando nenhuma é primary", () => {
    const slots = buildCardSlots([
      { id: "a", header: "A" },
      { id: "b", header: "B" },
    ]);
    expect(slots.primary).toBe("a");
    expect(slots.fields).toEqual(["b"]);
  });

  it("respeita roles explícitos", () => {
    const slots = buildCardSlots([
      { id: "x", header: "X" },
      { id: "name", header: "Nome", role: "primary" },
      { id: "sub", header: "Sub", role: "secondary" },
      { id: "st", header: "Status", role: "badge" },
    ]);
    expect(slots).toEqual({
      primary: "name",
      secondary: "sub",
      badges: ["st"],
      fields: ["x"],
    });
  });

  it("usa apenas o primeiro secondary; os demais viram campos", () => {
    const slots = buildCardSlots([
      { id: "p", header: "P", role: "primary" },
      { id: "s1", header: "S1", role: "secondary" },
      { id: "s2", header: "S2", role: "secondary" },
    ]);
    expect(slots.secondary).toBe("s1");
    expect(slots.fields).toEqual(["s2"]);
  });

  it("descarta colunas hideOnMobile", () => {
    const slots = buildCardSlots([
      { id: "p", header: "P", role: "primary" },
      { id: "hidden", header: "H", hideOnMobile: true },
      { id: "f", header: "F" },
    ]);
    expect(slots.fields).toEqual(["f"]);
  });

  it("não quebra com lista vazia", () => {
    expect(buildCardSlots([])).toEqual({
      primary: null,
      secondary: null,
      badges: [],
      fields: [],
    });
  });

  it("nunca duplica uma coluna entre slots", () => {
    const cols = [
      { id: "p", header: "P", role: "primary" as const },
      { id: "s", header: "S", role: "secondary" as const },
      { id: "b", header: "B", role: "badge" as const },
      { id: "f", header: "F" },
    ];
    const slots = buildCardSlots(cols);
    const all = [slots.primary, slots.secondary, ...slots.badges, ...slots.fields].filter(
      Boolean,
    );
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(cols.length);
  });
});

import { describe, it, expect } from "vitest";
import { DEFAULT_MARKETING_GROUP, GENERATED_DESTINATION, MARKETING_NAV, defaultMarketingScreens } from "@/lib/marketing/marketing-nav";

describe("Marketing IA 2.0 — navegação", () => {
  it("tem quatro áreas principais", () => {
    expect(MARKETING_NAV.map((group) => group.id)).toEqual(["inicio", "criar", "acervo", "publicar"]);
  });
  it("mantém criação, acervo e publicação como experiências compostas", () => {
    expect(MARKETING_NAV.find((group) => group.id === "criar")?.screens.map((screen) => screen.id)).toEqual(["generator", "promotions"]);
    expect(MARKETING_NAV.find((group) => group.id === "acervo")?.screens.map((screen) => screen.id)).toEqual(["library"]);
    expect(MARKETING_NAV.find((group) => group.id === "publicar")?.screens.map((screen) => screen.id)).toEqual(["publish"]);
  });
  it("não expõe Base de Conhecimento na navegação do Marketing", () => {
    const labels = MARKETING_NAV.flatMap((group) => [group.label, ...group.screens.map((screen) => screen.label)]);
    expect(labels.some((label) => /conhecimento/i.test(label))).toBe(false);
  });
  it("abre em Início e direciona uma nova geração para Publicar", () => {
    expect(DEFAULT_MARKETING_GROUP).toBe("inicio");
    expect(defaultMarketingScreens()).toEqual({ inicio: "dashboard", criar: "generator", acervo: "library", publicar: "publish" });
    expect(GENERATED_DESTINATION).toEqual({ group: "publicar", screen: "publish" });
  });
});
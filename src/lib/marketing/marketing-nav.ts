// Navegação do Marketing IA — definição pura (sem React, sem rede).
// A navegação principal tem quatro áreas compostas.

export type MarketingGroupId = "inicio" | "criar" | "acervo" | "publicar";
export type MarketingScreenId = "dashboard" | "generator" | "promotions" | "library" | "publish";
export interface MarketingScreen { id: MarketingScreenId; label: string; }
export interface MarketingGroup { id: MarketingGroupId; label: string; screens: MarketingScreen[]; }

export const MARKETING_NAV: MarketingGroup[] = [
  { id: "inicio", label: "Início", screens: [{ id: "dashboard", label: "Início" }] },
  { id: "criar", label: "Criar", screens: [
    { id: "generator", label: "Gerar conteúdo" },
    { id: "promotions", label: "Promoções" },
  ] },
  { id: "acervo", label: "Acervo", screens: [{ id: "library", label: "Acervo" }] },
  { id: "publicar", label: "Publicar", screens: [{ id: "publish", label: "Publicar" }] },
];

export const DEFAULT_MARKETING_GROUP: MarketingGroupId = "inicio";
export const GENERATED_DESTINATION: { group: MarketingGroupId; screen: MarketingScreenId } = {
  group: "publicar",
  screen: "publish",
};
export function defaultMarketingScreens(): Record<MarketingGroupId, MarketingScreenId> {
  return Object.fromEntries(MARKETING_NAV.map((g) => [g.id, g.screens[0].id])) as Record<MarketingGroupId, MarketingScreenId>;
}
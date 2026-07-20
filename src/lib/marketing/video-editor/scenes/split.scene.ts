// Cena "Split" — metade inferior é um painel colorido sólido com textos.
import type { SceneDefinition } from "../scene.types";

const SANS = 'Inter, "Helvetica Neue", Arial, sans-serif';

export const SPLIT_SCENE: SceneDefinition = {
  id: "split",
  label: "Split",
  description: "Metade inferior em painel sólido colorido. Impacto visual claro.",
  vibe: "moderno",
  layers: [
    { kind: "solid", color: "#0F172A", y: "bottom", height: 42, opacity: 1 },
    // Faixa de acento acima do painel
    { kind: "solid", color: "#F97316", y: "bottom", height: 0.9, opacity: 1 },
  ],
  text: {
    padding: "6% 7%",
    gap: 2,
    title: {
      fontFamily: SANS,
      weight: 800,
      color: "#ffffff",
      lineHeight: 1.05,
    },
    subtitle: {
      fontFamily: SANS,
      weight: 500,
      color: "rgba(255,255,255,0.85)",
      lineHeight: 1.3,
    },
    cta: {
      fontFamily: SANS,
      weight: 700,
      color: "#0F172A",
      letterSpacing: "0.08em",
      transform: "uppercase",
      pill: { background: "#F97316", foreground: "#0F172A", radius: "4px", padding: "0.55em 1.1em" },
    },
  },
  defaultLayout: {
    template: "split",
    logo: { scale: 1, vAnchor: "top", hAnchor: "left", marginTop: 5, marginBottom: 0, marginLeft: 5, marginRight: 0 },
    title: { scale: 1.15, vAnchor: "bottom", align: "left", spacing: 2 },
    subtitle: { scale: 1, vAnchor: "bottom", align: "left" },
    cta: { scale: 1, vAnchor: "bottom", align: "left" },
  },
};

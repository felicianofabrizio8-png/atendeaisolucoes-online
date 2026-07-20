// Cena "Editorial" — faixa branca sólida no rodapé + serif clássico.
import type { SceneDefinition } from "../scene.types";

const SERIF = '"Playfair Display", Georgia, serif';
const SANS = 'Inter, "Helvetica Neue", Arial, sans-serif';

export const EDITORIAL_SCENE: SceneDefinition = {
  id: "editorial",
  label: "Editorial",
  description: "Faixa branca sólida com serif clássico. Look de revista.",
  vibe: "editorial",
  layers: [
    { kind: "solid", color: "#ffffff", y: "bottom", height: 34, opacity: 1 },
    { kind: "solid", color: "#111111", y: "bottom", height: 0.6, opacity: 1 },
  ],
  text: {
    padding: "6% 8%",
    gap: 1.6,
    title: {
      fontFamily: SERIF,
      weight: 700,
      color: "#111111",
      lineHeight: 1.05,
      letterSpacing: "-0.01em",
    },
    subtitle: {
      fontFamily: SANS,
      weight: 400,
      color: "#4b4b4b",
      lineHeight: 1.35,
      letterSpacing: "0.04em",
      transform: "uppercase",
    },
    cta: {
      fontFamily: SANS,
      weight: 700,
      color: "#ffffff",
      letterSpacing: "0.12em",
      transform: "uppercase",
      pill: { background: "#111111", foreground: "#ffffff", radius: "0", padding: "0.6em 1.2em" },
    },
  },
  defaultLayout: {
    template: "editorial",
    logo: { scale: 1, vAnchor: "top", hAnchor: "left", marginTop: 5, marginBottom: 0, marginLeft: 5, marginRight: 0 },
    title: { scale: 1.05, vAnchor: "bottom", align: "left", spacing: 1.4 },
    subtitle: { scale: 0.9, vAnchor: "bottom", align: "left" },
    cta: { scale: 1, vAnchor: "bottom", align: "left" },
  },
};

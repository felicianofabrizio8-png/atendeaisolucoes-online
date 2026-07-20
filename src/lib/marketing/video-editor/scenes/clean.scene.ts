// Cena "Clean" — mínima, tudo respira, tipografia leve.
import type { SceneDefinition } from "../scene.types";

const SANS = 'Inter, "Helvetica Neue", Arial, sans-serif';

export const CLEAN_SCENE: SceneDefinition = {
  id: "clean",
  label: "Clean",
  description: "Gradiente leve, tipografia fina, muito respiro.",
  vibe: "clean",
  layers: [
    {
      kind: "gradient",
      direction: "180deg",
      y: "bottom",
      height: 40,
      stops: [
        { color: "rgba(0,0,0,0)", at: 0 },
        { color: "rgba(0,0,0,0.45)", at: 100 },
      ],
    },
  ],
  text: {
    padding: "8% 8%",
    gap: 1.6,
    title: {
      fontFamily: SANS,
      weight: 400,
      color: "#ffffff",
      lineHeight: 1.15,
      letterSpacing: "-0.005em",
    },
    subtitle: {
      fontFamily: SANS,
      weight: 300,
      color: "rgba(255,255,255,0.85)",
      lineHeight: 1.4,
    },
    cta: {
      fontFamily: SANS,
      weight: 500,
      color: "#ffffff",
      letterSpacing: "0.14em",
      transform: "uppercase",
      underline: { color: "rgba(255,255,255,0.9)", thickness: "1px", offset: "6px" },
      pill: null,
    },
  },
  defaultLayout: {
    template: "clean",
    logo: { scale: 0.8, vAnchor: "top", hAnchor: "center", marginTop: 6, marginBottom: 0, marginLeft: 0, marginRight: 0 },
    title: { scale: 0.95, vAnchor: "bottom", align: "left", spacing: 1 },
    subtitle: { scale: 0.85, vAnchor: "bottom", align: "left" },
    cta: { scale: 0.85, vAnchor: "bottom", align: "left" },
  },
};

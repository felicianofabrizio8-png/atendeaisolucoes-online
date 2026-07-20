// Cena "Institucional" — logo grande no topo, textos centrados, calmo.
import type { SceneDefinition } from "../scene.types";

const SANS = 'Inter, "Helvetica Neue", Arial, sans-serif';

export const INSTITUCIONAL_SCENE: SceneDefinition = {
  id: "institucional",
  label: "Institucional",
  description: "Logo grande no topo, textos centrais, tom sério.",
  vibe: "moderno",
  layers: [
    {
      kind: "gradient",
      direction: "180deg",
      y: "top",
      height: 30,
      stops: [
        { color: "rgba(0,0,0,0.5)", at: 0 },
        { color: "rgba(0,0,0,0)", at: 100 },
      ],
    },
    {
      kind: "gradient",
      direction: "180deg",
      y: "bottom",
      height: 45,
      stops: [
        { color: "rgba(0,0,0,0)", at: 0 },
        { color: "rgba(0,0,0,0.85)", at: 100 },
      ],
    },
  ],
  text: {
    padding: "8% 8%",
    gap: 2,
    title: {
      fontFamily: SANS,
      weight: 600,
      color: "#ffffff",
      lineHeight: 1.1,
    },
    subtitle: {
      fontFamily: SANS,
      weight: 400,
      color: "rgba(255,255,255,0.9)",
      lineHeight: 1.35,
    },
    cta: {
      fontFamily: SANS,
      weight: 600,
      color: "#111111",
      letterSpacing: "0.08em",
      transform: "uppercase",
      pill: { background: "#ffffff", foreground: "#111111", radius: "999px", padding: "0.55em 1.1em" },
    },
  },
  defaultLayout: {
    template: "institucional",
    logo: { scale: 1.4, vAnchor: "top", hAnchor: "center", marginTop: 6, marginBottom: 0, marginLeft: 0, marginRight: 0 },
    title: { scale: 1, vAnchor: "bottom", align: "center", spacing: 2 },
    subtitle: { scale: 0.95, vAnchor: "bottom", align: "center" },
    cta: { scale: 1, vAnchor: "bottom", align: "center" },
  },
};

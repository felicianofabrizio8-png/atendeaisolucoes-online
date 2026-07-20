// Cena "Moderno" — sans bold, gradiente inferior forte, sem molduras.
import type { SceneDefinition } from "../scene.types";

const SANS = 'Inter, "Helvetica Neue", Arial, sans-serif';

export const MODERNO_SCENE: SceneDefinition = {
  id: "moderno",
  label: "Moderno",
  description: "Sans bold direto ao ponto. Gradiente inferior sólido.",
  vibe: "moderno",
  layers: [
    {
      kind: "gradient",
      direction: "180deg",
      y: "bottom",
      height: 55,
      stops: [
        { color: "rgba(0,0,0,0)", at: 0 },
        { color: "rgba(0,0,0,0.55)", at: 45 },
        { color: "rgba(0,0,0,0.92)", at: 100 },
      ],
    },
  ],
  text: {
    padding: "6% 7%",
    gap: 2.2,
    title: {
      fontFamily: SANS,
      weight: 800,
      color: "#ffffff",
      lineHeight: 1.05,
      textShadow: "0 2px 12px rgba(0,0,0,0.45)",
    },
    subtitle: {
      fontFamily: SANS,
      weight: 500,
      color: "rgba(255,255,255,0.95)",
      lineHeight: 1.25,
      textShadow: "0 1px 8px rgba(0,0,0,0.35)",
    },
    cta: {
      fontFamily: SANS,
      weight: 700,
      color: "#000",
      letterSpacing: "0.08em",
      transform: "uppercase",
      pill: { background: "#ffffff", foreground: "#000", radius: "999px", padding: "0.5em 1em" },
    },
  },
  defaultLayout: {
    template: "moderno",
    logo: { scale: 1, vAnchor: "top", hAnchor: "right", marginTop: 5, marginBottom: 0, marginLeft: 0, marginRight: 5 },
    title: { scale: 1, vAnchor: "bottom", align: "left", spacing: 2 },
    subtitle: { scale: 1, vAnchor: "bottom", align: "left" },
    cta: { scale: 1, vAnchor: "bottom", align: "left" },
  },
};

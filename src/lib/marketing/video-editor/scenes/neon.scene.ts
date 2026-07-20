// Cena "Neon" — moldura brilhante + faixa escura no rodapé. Vibe noturna.
import type { SceneDefinition } from "../scene.types";

const SANS = 'Inter, "Helvetica Neue", Arial, sans-serif';

export const NEON_SCENE: SceneDefinition = {
  id: "neon",
  label: "Neon",
  description: "Moldura brilhante ciano e barra escura inferior. Tech/noite.",
  vibe: "dark",
  layers: [
    { kind: "vignette", intensity: 0.7 },
    {
      kind: "gradient",
      direction: "180deg",
      y: "bottom",
      height: 45,
      stops: [
        { color: "rgba(6,8,20,0)", at: 0 },
        { color: "rgba(6,8,20,0.95)", at: 100 },
      ],
    },
    { kind: "frame", color: "#22D3EE", width: 0.5, inset: 2.4, radius: 2.8, opacity: 0.9 },
  ],
  text: {
    padding: "6% 7%",
    gap: 2.2,
    title: {
      fontFamily: SANS,
      weight: 800,
      color: "#ffffff",
      lineHeight: 1.05,
      textShadow: "0 0 18px rgba(34,211,238,0.45), 0 2px 14px rgba(0,0,0,0.7)",
    },
    subtitle: {
      fontFamily: SANS,
      weight: 500,
      color: "rgba(255,255,255,0.9)",
      lineHeight: 1.3,
      letterSpacing: "0.02em",
    },
    cta: {
      fontFamily: SANS,
      weight: 700,
      color: "#06121A",
      letterSpacing: "0.08em",
      transform: "uppercase",
      pill: { background: "#22D3EE", foreground: "#06121A", radius: "999px", padding: "0.55em 1.1em" },
    },
  },
  defaultLayout: {
    template: "neon",
    logo: { scale: 1, vAnchor: "top", hAnchor: "left", marginTop: 5, marginBottom: 0, marginLeft: 5, marginRight: 0 },
    title: { scale: 1.15, vAnchor: "bottom", align: "left", spacing: 2 },
    subtitle: { scale: 1, vAnchor: "bottom", align: "left" },
    cta: { scale: 1, vAnchor: "bottom", align: "left" },
  },
};

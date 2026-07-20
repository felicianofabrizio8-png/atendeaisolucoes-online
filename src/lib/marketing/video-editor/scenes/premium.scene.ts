// Cena "Premium" — editorial serif, título centralizado, moldura fina dourada.
import type { SceneDefinition } from "../scene.types";

const SERIF = '"Playfair Display", Georgia, serif';
const SANS = 'Inter, "Helvetica Neue", Arial, sans-serif';

export const PREMIUM_SCENE: SceneDefinition = {
  id: "premium",
  label: "Premium",
  description: "Serif editorial com moldura dourada e vinheta suave.",
  vibe: "editorial",
  layers: [
    { kind: "vignette", intensity: 0.55 },
    {
      kind: "gradient",
      direction: "180deg",
      y: "full",
      stops: [
        { color: "rgba(0,0,0,0.55)", at: 0 },
        { color: "rgba(0,0,0,0.15)", at: 45 },
        { color: "rgba(0,0,0,0.75)", at: 100 },
      ],
    },
    { kind: "frame", color: "rgba(212,175,55,0.85)", width: 0.6, inset: 3.2, radius: 1.2 },
  ],
  text: {
    padding: "12% 9%",
    gap: 2.6,
    title: {
      fontFamily: SERIF,
      weight: 700,
      color: "#ffffff",
      lineHeight: 1.08,
      letterSpacing: "-0.01em",
      textShadow: "0 2px 18px rgba(0,0,0,0.55)",
    },
    subtitle: {
      fontFamily: SANS,
      weight: 400,
      color: "rgba(255,255,255,0.9)",
      lineHeight: 1.35,
      letterSpacing: "0.02em",
    },
    cta: {
      fontFamily: SANS,
      weight: 600,
      color: "#1a1206",
      letterSpacing: "0.16em",
      transform: "uppercase",
      pill: { background: "#D4AF37", foreground: "#1a1206", radius: "2px", padding: "0.7em 1.4em" },
    },
  },
  defaultLayout: {
    template: "premium",
    logo: { scale: 1.15, vAnchor: "top", hAnchor: "center", marginTop: 6, marginBottom: 0, marginLeft: 0, marginRight: 0 },
    title: { scale: 1.2, vAnchor: "center", align: "center", spacing: 3 },
    subtitle: { scale: 1.05, vAnchor: "center", align: "center" },
    cta: { scale: 1, vAnchor: "bottom", align: "center" },
  },
};

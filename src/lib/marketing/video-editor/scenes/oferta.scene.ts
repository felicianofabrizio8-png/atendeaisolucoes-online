// Cena "Oferta" — corte diagonal vermelho + display bold. Energia comercial.
import type { SceneDefinition } from "../scene.types";

const SANS = 'Inter, "Helvetica Neue", Arial, sans-serif';
const DISPLAY = '"Playfair Display", Georgia, serif';

export const OFERTA_SCENE: SceneDefinition = {
  id: "oferta",
  label: "Oferta",
  description: "Corte diagonal vermelho e display pesado. Alta conversão.",
  vibe: "energetico",
  layers: [
    {
      kind: "gradient",
      direction: "180deg",
      y: "bottom",
      height: 60,
      stops: [
        { color: "rgba(0,0,0,0)", at: 0 },
        { color: "rgba(0,0,0,0.85)", at: 100 },
      ],
    },
    // Faixa diagonal vermelha inferior
    { kind: "angular", color: "#E11D2E", opacity: 0.92, points: "0,100 100,72 100,100" },
    // Faixa amarela fina acima
    { kind: "angular", color: "#F7C948", opacity: 0.95, points: "0,72 100,58 100,60 0,74" },
  ],
  text: {
    padding: "6% 7%",
    gap: 1.8,
    title: {
      fontFamily: DISPLAY,
      weight: 900,
      color: "#ffffff",
      lineHeight: 1.0,
      textShadow: "0 3px 14px rgba(0,0,0,0.6)",
    },
    subtitle: {
      fontFamily: SANS,
      weight: 600,
      color: "#ffffff",
      lineHeight: 1.2,
    },
    cta: {
      fontFamily: SANS,
      weight: 800,
      color: "#E11D2E",
      letterSpacing: "0.06em",
      transform: "uppercase",
      pill: { background: "#ffffff", foreground: "#E11D2E", radius: "6px", padding: "0.55em 1.1em" },
    },
  },
  defaultLayout: {
    template: "oferta",
    logo: { scale: 1, vAnchor: "top", hAnchor: "left", marginTop: 5, marginBottom: 0, marginLeft: 5, marginRight: 0 },
    title: { scale: 1.35, vAnchor: "bottom", align: "left", spacing: 2 },
    subtitle: { scale: 1.1, vAnchor: "bottom", align: "left" },
    cta: { scale: 1.2, vAnchor: "bottom", align: "left" },
  },
};

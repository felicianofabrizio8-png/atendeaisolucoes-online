// ============================================================================
// Scene contract — espelho serializável do `SceneDefinition` do frontend
// (`src/lib/marketing/video-editor/scene.types.ts` + `scenes/*.scene.ts`).
//
// Mantido inline no worker para evitar dependência cruzada com o pacote
// principal. Ao adicionar/alterar cenas no frontend, propagar aqui — os IDs
// e as camadas precisam bater 1:1 para o vídeo final refletir o preview.
//
// A composição SVG vive em `scene-composer.ts`; este arquivo é só dados.
// ============================================================================

export type TemplateId =
  | "premium"
  | "moderno"
  | "elegante"
  | "minimalista"
  | "oferta"
  | "institucional"
  | "black"
  | "clean"
  | "editorial"
  | "neon"
  | "split";

export type Anchor = "top" | "center" | "bottom";
export type Align = "left" | "center" | "right";

export interface LogoLayout {
  scale: number;
  vAnchor: Anchor;
  hAnchor: Align;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
}
export interface TextLayout {
  scale: number;
  vAnchor: Anchor;
  align: Align;
  spacing?: number;
}
export interface VideoLayout {
  template: TemplateId;
  logo: LogoLayout;
  title: TextLayout;
  subtitle: TextLayout;
  cta: TextLayout;
}

export type LayerY = "top" | "bottom" | "full";

export interface GradientLayer {
  kind: "gradient";
  direction: string;
  stops: Array<{ color: string; at?: number }>;
  y: LayerY;
  height?: number;
  opacity?: number;
}
export interface SolidLayer {
  kind: "solid";
  color: string;
  y: LayerY;
  height?: number;
  opacity?: number;
}
export interface AngularLayer {
  kind: "angular";
  color: string;
  opacity?: number;
  points: string;
}
export interface FrameLayer {
  kind: "frame";
  color: string;
  width: number;
  inset?: number;
  radius?: number;
  opacity?: number;
}
export interface VignetteLayer {
  kind: "vignette";
  intensity: number;
}
export type SceneLayer = GradientLayer | SolidLayer | AngularLayer | FrameLayer | VignetteLayer;

export interface TextStyle {
  fontFamily: string;
  weight: number;
  color?: string;
  transform?: "uppercase" | "none";
  letterSpacing?: string;
  lineHeight?: number;
  textShadow?: string;
  pill?: { background: string; foreground: string; radius: string; padding: string } | null;
  underline?: { color: string; thickness: string; offset: string } | null;
}
export interface TextBlockStyle {
  padding: string;
  gap: number;
  title: TextStyle;
  subtitle: TextStyle;
  cta: TextStyle;
}

export interface SceneDefinition {
  id: TemplateId;
  label: string;
  layers: SceneLayer[];
  text: TextBlockStyle;
  defaultLayout: VideoLayout;
}

// ----------------- Definições (mirror do frontend) ------------------------

const SANS = 'Inter, "Helvetica Neue", Arial, sans-serif';
const SERIF = '"Playfair Display", Georgia, serif';

const MODERNO: SceneDefinition = {
  id: "moderno", label: "Moderno",
  layers: [
    { kind: "gradient", direction: "180deg", y: "bottom", height: 55,
      stops: [ { color: "rgba(0,0,0,0)", at: 0 }, { color: "rgba(0,0,0,0.55)", at: 45 }, { color: "rgba(0,0,0,0.92)", at: 100 } ] },
  ],
  text: {
    padding: "6% 7%", gap: 2.2,
    title:    { fontFamily: SANS, weight: 800, color: "#ffffff", lineHeight: 1.05 },
    subtitle: { fontFamily: SANS, weight: 500, color: "rgba(255,255,255,0.95)", lineHeight: 1.25 },
    cta:      { fontFamily: SANS, weight: 700, color: "#000", letterSpacing: "0.08em", transform: "uppercase",
                pill: { background: "#ffffff", foreground: "#000", radius: "999px", padding: "0.5em 1em" } },
  },
  defaultLayout: {
    template: "moderno",
    logo: { scale: 1, vAnchor: "top", hAnchor: "right", marginTop: 5, marginBottom: 0, marginLeft: 0, marginRight: 5 },
    title: { scale: 1, vAnchor: "bottom", align: "left", spacing: 2 },
    subtitle: { scale: 1, vAnchor: "bottom", align: "left" },
    cta: { scale: 1, vAnchor: "bottom", align: "left" },
  },
};

const PREMIUM: SceneDefinition = {
  id: "premium", label: "Premium",
  layers: [
    { kind: "vignette", intensity: 0.55 },
    { kind: "gradient", direction: "180deg", y: "full",
      stops: [ { color: "rgba(0,0,0,0.55)", at: 0 }, { color: "rgba(0,0,0,0.15)", at: 45 }, { color: "rgba(0,0,0,0.75)", at: 100 } ] },
    { kind: "frame", color: "rgba(212,175,55,0.85)", width: 0.6, inset: 3.2, radius: 1.2 },
  ],
  text: {
    padding: "12% 9%", gap: 2.6,
    title:    { fontFamily: SERIF, weight: 700, color: "#ffffff", lineHeight: 1.08, letterSpacing: "-0.01em" },
    subtitle: { fontFamily: SANS, weight: 400, color: "rgba(255,255,255,0.9)", lineHeight: 1.35, letterSpacing: "0.02em" },
    cta:      { fontFamily: SANS, weight: 600, color: "#1a1206", letterSpacing: "0.16em", transform: "uppercase",
                pill: { background: "#D4AF37", foreground: "#1a1206", radius: "2px", padding: "0.7em 1.4em" } },
  },
  defaultLayout: {
    template: "premium",
    logo: { scale: 1.15, vAnchor: "top", hAnchor: "center", marginTop: 6, marginBottom: 0, marginLeft: 0, marginRight: 0 },
    title: { scale: 1.2, vAnchor: "center", align: "center", spacing: 3 },
    subtitle: { scale: 1.05, vAnchor: "center", align: "center" },
    cta: { scale: 1, vAnchor: "bottom", align: "center" },
  },
};

const OFERTA: SceneDefinition = {
  id: "oferta", label: "Oferta",
  layers: [
    { kind: "gradient", direction: "180deg", y: "bottom", height: 60,
      stops: [ { color: "rgba(0,0,0,0)", at: 0 }, { color: "rgba(0,0,0,0.85)", at: 100 } ] },
    { kind: "angular", color: "#E11D2E", opacity: 0.92, points: "0,100 100,72 100,100" },
    { kind: "angular", color: "#F7C948", opacity: 0.95, points: "0,72 100,58 100,60 0,74" },
  ],
  text: {
    padding: "6% 7%", gap: 1.8,
    title:    { fontFamily: SERIF, weight: 900, color: "#ffffff", lineHeight: 1.0 },
    subtitle: { fontFamily: SANS, weight: 600, color: "#ffffff", lineHeight: 1.2 },
    cta:      { fontFamily: SANS, weight: 800, color: "#E11D2E", letterSpacing: "0.06em", transform: "uppercase",
                pill: { background: "#ffffff", foreground: "#E11D2E", radius: "6px", padding: "0.55em 1.1em" } },
  },
  defaultLayout: {
    template: "oferta",
    logo: { scale: 1, vAnchor: "top", hAnchor: "left", marginTop: 5, marginBottom: 0, marginLeft: 5, marginRight: 0 },
    title: { scale: 1.35, vAnchor: "bottom", align: "left", spacing: 2 },
    subtitle: { scale: 1.1, vAnchor: "bottom", align: "left" },
    cta: { scale: 1.2, vAnchor: "bottom", align: "left" },
  },
};

const EDITORIAL: SceneDefinition = {
  id: "editorial", label: "Editorial",
  layers: [
    { kind: "solid", color: "#ffffff", y: "bottom", height: 34, opacity: 1 },
    { kind: "solid", color: "#111111", y: "bottom", height: 0.6, opacity: 1 },
  ],
  text: {
    padding: "6% 8%", gap: 1.6,
    title:    { fontFamily: SERIF, weight: 700, color: "#111111", lineHeight: 1.05, letterSpacing: "-0.01em" },
    subtitle: { fontFamily: SANS, weight: 400, color: "#4b4b4b", lineHeight: 1.35, letterSpacing: "0.04em", transform: "uppercase" },
    cta:      { fontFamily: SANS, weight: 700, color: "#ffffff", letterSpacing: "0.12em", transform: "uppercase",
                pill: { background: "#111111", foreground: "#ffffff", radius: "0", padding: "0.6em 1.2em" } },
  },
  defaultLayout: {
    template: "editorial",
    logo: { scale: 1, vAnchor: "top", hAnchor: "left", marginTop: 5, marginBottom: 0, marginLeft: 5, marginRight: 0 },
    title: { scale: 1.05, vAnchor: "bottom", align: "left", spacing: 1.4 },
    subtitle: { scale: 0.9, vAnchor: "bottom", align: "left" },
    cta: { scale: 1, vAnchor: "bottom", align: "left" },
  },
};

const NEON: SceneDefinition = {
  id: "neon", label: "Neon",
  layers: [
    { kind: "vignette", intensity: 0.7 },
    { kind: "gradient", direction: "180deg", y: "bottom", height: 45,
      stops: [ { color: "rgba(6,8,20,0)", at: 0 }, { color: "rgba(6,8,20,0.95)", at: 100 } ] },
    { kind: "frame", color: "#22D3EE", width: 0.5, inset: 2.4, radius: 2.8, opacity: 0.9 },
  ],
  text: {
    padding: "6% 7%", gap: 2.2,
    title:    { fontFamily: SANS, weight: 800, color: "#ffffff", lineHeight: 1.05 },
    subtitle: { fontFamily: SANS, weight: 500, color: "rgba(255,255,255,0.9)", lineHeight: 1.3, letterSpacing: "0.02em" },
    cta:      { fontFamily: SANS, weight: 700, color: "#06121A", letterSpacing: "0.08em", transform: "uppercase",
                pill: { background: "#22D3EE", foreground: "#06121A", radius: "999px", padding: "0.55em 1.1em" } },
  },
  defaultLayout: {
    template: "neon",
    logo: { scale: 1, vAnchor: "top", hAnchor: "left", marginTop: 5, marginBottom: 0, marginLeft: 5, marginRight: 0 },
    title: { scale: 1.15, vAnchor: "bottom", align: "left", spacing: 2 },
    subtitle: { scale: 1, vAnchor: "bottom", align: "left" },
    cta: { scale: 1, vAnchor: "bottom", align: "left" },
  },
};

const CLEAN: SceneDefinition = {
  id: "clean", label: "Clean",
  layers: [
    { kind: "gradient", direction: "180deg", y: "bottom", height: 40,
      stops: [ { color: "rgba(0,0,0,0)", at: 0 }, { color: "rgba(0,0,0,0.45)", at: 100 } ] },
  ],
  text: {
    padding: "8% 8%", gap: 1.6,
    title:    { fontFamily: SANS, weight: 400, color: "#ffffff", lineHeight: 1.15, letterSpacing: "-0.005em" },
    subtitle: { fontFamily: SANS, weight: 300, color: "rgba(255,255,255,0.85)", lineHeight: 1.4 },
    cta:      { fontFamily: SANS, weight: 500, color: "#ffffff", letterSpacing: "0.14em", transform: "uppercase",
                underline: { color: "rgba(255,255,255,0.9)", thickness: "1px", offset: "6px" }, pill: null },
  },
  defaultLayout: {
    template: "clean",
    logo: { scale: 0.8, vAnchor: "top", hAnchor: "center", marginTop: 6, marginBottom: 0, marginLeft: 0, marginRight: 0 },
    title: { scale: 0.95, vAnchor: "bottom", align: "left", spacing: 1 },
    subtitle: { scale: 0.85, vAnchor: "bottom", align: "left" },
    cta: { scale: 0.85, vAnchor: "bottom", align: "left" },
  },
};

const SPLIT: SceneDefinition = {
  id: "split", label: "Split",
  layers: [
    { kind: "solid", color: "#0F172A", y: "bottom", height: 42, opacity: 1 },
    { kind: "solid", color: "#F97316", y: "bottom", height: 0.9, opacity: 1 },
  ],
  text: {
    padding: "6% 7%", gap: 2,
    title:    { fontFamily: SANS, weight: 800, color: "#ffffff", lineHeight: 1.05 },
    subtitle: { fontFamily: SANS, weight: 500, color: "rgba(255,255,255,0.85)", lineHeight: 1.3 },
    cta:      { fontFamily: SANS, weight: 700, color: "#0F172A", letterSpacing: "0.08em", transform: "uppercase",
                pill: { background: "#F97316", foreground: "#0F172A", radius: "4px", padding: "0.55em 1.1em" } },
  },
  defaultLayout: {
    template: "split",
    logo: { scale: 1, vAnchor: "top", hAnchor: "left", marginTop: 5, marginBottom: 0, marginLeft: 5, marginRight: 0 },
    title: { scale: 1.15, vAnchor: "bottom", align: "left", spacing: 2 },
    subtitle: { scale: 1, vAnchor: "bottom", align: "left" },
    cta: { scale: 1, vAnchor: "bottom", align: "left" },
  },
};

const INSTITUCIONAL: SceneDefinition = {
  id: "institucional", label: "Institucional",
  layers: [
    { kind: "gradient", direction: "180deg", y: "top", height: 30,
      stops: [ { color: "rgba(0,0,0,0.5)", at: 0 }, { color: "rgba(0,0,0,0)", at: 100 } ] },
    { kind: "gradient", direction: "180deg", y: "bottom", height: 45,
      stops: [ { color: "rgba(0,0,0,0)", at: 0 }, { color: "rgba(0,0,0,0.85)", at: 100 } ] },
  ],
  text: {
    padding: "8% 8%", gap: 2,
    title:    { fontFamily: SANS, weight: 600, color: "#ffffff", lineHeight: 1.1 },
    subtitle: { fontFamily: SANS, weight: 400, color: "rgba(255,255,255,0.9)", lineHeight: 1.35 },
    cta:      { fontFamily: SANS, weight: 600, color: "#111111", letterSpacing: "0.08em", transform: "uppercase",
                pill: { background: "#ffffff", foreground: "#111111", radius: "999px", padding: "0.55em 1.1em" } },
  },
  defaultLayout: {
    template: "institucional",
    logo: { scale: 1.4, vAnchor: "top", hAnchor: "center", marginTop: 6, marginBottom: 0, marginLeft: 0, marginRight: 0 },
    title: { scale: 1, vAnchor: "bottom", align: "center", spacing: 2 },
    subtitle: { scale: 0.95, vAnchor: "bottom", align: "center" },
    cta: { scale: 1, vAnchor: "bottom", align: "center" },
  },
};

// Aliases (compat) — templates antigos apontam para cenas equivalentes.
export const SCENES: Record<TemplateId, SceneDefinition> = {
  moderno: MODERNO,
  premium: PREMIUM,
  oferta: OFERTA,
  editorial: EDITORIAL,
  neon: NEON,
  clean: CLEAN,
  split: SPLIT,
  institucional: INSTITUCIONAL,
  elegante: PREMIUM,
  minimalista: CLEAN,
  black: NEON,
};

export function getSceneById(id: string | null | undefined): SceneDefinition | null {
  if (!id) return null;
  const s = (SCENES as Record<string, SceneDefinition | undefined>)[id];
  return s ?? null;
}

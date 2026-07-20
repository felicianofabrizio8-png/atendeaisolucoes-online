// Biblioteca de templates do Editor Visual do Vídeo IA.
// Cada template define um `VideoLayout` inicial e uma "vibe" tipográfica.
// Escolher um template RESETA o layout para o preset; edições subsequentes
// permanecem até o usuário trocar de template.

import type { TemplateId, VideoLayout } from "./layout.types";

export interface TemplatePreset {
  id: TemplateId;
  label: string;
  description: string;
  /** Fonte usada no preview. */
  titleFontFamily: string;
  subtitleFontFamily: string;
  ctaFontFamily: string;
  titleWeight: number;
  subtitleWeight: number;
  /** Escala tipográfica base — casa com o brand-composer atual em 1.0. */
  layout: VideoLayout;
  /** Cor de fundo extra sob o painel (0–1). 0 = usa apenas gradiente. */
  panelDarkness: number;
}

const SERIF = '"Playfair Display", Georgia, serif';
const SANS = 'Inter, "Helvetica Neue", Arial, sans-serif';
const DISPLAY = '"Playfair Display", Georgia, serif';

function base(): VideoLayout {
  return {
    template: "moderno",
    logo: {
      scale: 1,
      vAnchor: "top",
      hAnchor: "center",
      marginTop: 4,
      marginBottom: 0,
      marginLeft: 0,
      marginRight: 0,
    },
    title: { scale: 1, vAnchor: "bottom", align: "left", spacing: 2 },
    subtitle: { scale: 1, vAnchor: "bottom", align: "left" },
    cta: { scale: 1, vAnchor: "bottom", align: "left" },
  };
}

export const TEMPLATES: Record<TemplateId, TemplatePreset> = {
  premium: {
    id: "premium",
    label: "Premium",
    description: "Serif grande centralizado, presença editorial",
    titleFontFamily: SERIF,
    subtitleFontFamily: SANS,
    ctaFontFamily: SANS,
    titleWeight: 700,
    subtitleWeight: 500,
    panelDarkness: 0.15,
    layout: {
      ...base(),
      template: "premium",
      logo: { ...base().logo, scale: 1.15 },
      title: { scale: 1.2, vAnchor: "center", align: "center", spacing: 3 },
      subtitle: { scale: 1.05, vAnchor: "center", align: "center" },
      cta: { scale: 1, vAnchor: "bottom", align: "center" },
    },
  },
  moderno: {
    id: "moderno",
    label: "Moderno",
    description: "Sans bold, texto inferior, energia direta",
    titleFontFamily: SANS,
    subtitleFontFamily: SANS,
    ctaFontFamily: SANS,
    titleWeight: 800,
    subtitleWeight: 500,
    panelDarkness: 0,
    layout: {
      ...base(),
      template: "moderno",
      logo: { ...base().logo, hAnchor: "right", marginRight: 5, marginTop: 5 },
    },
  },
  elegante: {
    id: "elegante",
    label: "Elegante",
    description: "Serif fino, texto centro-baixo",
    titleFontFamily: SERIF,
    subtitleFontFamily: SERIF,
    ctaFontFamily: SANS,
    titleWeight: 500,
    subtitleWeight: 400,
    panelDarkness: 0.1,
    layout: {
      ...base(),
      template: "elegante",
      title: { scale: 1.05, vAnchor: "center", align: "center", spacing: 2 },
      subtitle: { scale: 1, vAnchor: "center", align: "center" },
      cta: { scale: 0.95, vAnchor: "bottom", align: "center" },
    },
  },
  minimalista: {
    id: "minimalista",
    label: "Minimalista",
    description: "Sans light, texto pequeno inferior",
    titleFontFamily: SANS,
    subtitleFontFamily: SANS,
    ctaFontFamily: SANS,
    titleWeight: 300,
    subtitleWeight: 300,
    panelDarkness: 0,
    layout: {
      ...base(),
      template: "minimalista",
      logo: { ...base().logo, scale: 0.85 },
      title: { scale: 0.85, vAnchor: "bottom", align: "left", spacing: 1 },
      subtitle: { scale: 0.8, vAnchor: "bottom", align: "left" },
      cta: { scale: 0.85, vAnchor: "bottom", align: "left" },
    },
  },
  oferta: {
    id: "oferta",
    label: "Oferta",
    description: "Display bold, CTA em destaque",
    titleFontFamily: DISPLAY,
    subtitleFontFamily: SANS,
    ctaFontFamily: SANS,
    titleWeight: 900,
    subtitleWeight: 600,
    panelDarkness: 0.25,
    layout: {
      ...base(),
      template: "oferta",
      title: { scale: 1.35, vAnchor: "bottom", align: "left", spacing: 2 },
      subtitle: { scale: 1.1, vAnchor: "bottom", align: "left" },
      cta: { scale: 1.2, vAnchor: "bottom", align: "left" },
    },
  },
  institucional: {
    id: "institucional",
    label: "Institucional",
    description: "Sans regular, logo grande no topo",
    titleFontFamily: SANS,
    subtitleFontFamily: SANS,
    ctaFontFamily: SANS,
    titleWeight: 600,
    subtitleWeight: 400,
    panelDarkness: 0.1,
    layout: {
      ...base(),
      template: "institucional",
      logo: { ...base().logo, scale: 1.4, marginTop: 6 },
      title: { scale: 1, vAnchor: "bottom", align: "center", spacing: 2 },
      subtitle: { scale: 0.95, vAnchor: "bottom", align: "center" },
      cta: { scale: 1, vAnchor: "bottom", align: "center" },
    },
  },
  black: {
    id: "black",
    label: "Black",
    description: "Alto contraste, painel escuro reforçado",
    titleFontFamily: DISPLAY,
    subtitleFontFamily: SANS,
    ctaFontFamily: SANS,
    titleWeight: 900,
    subtitleWeight: 600,
    panelDarkness: 0.45,
    layout: {
      ...base(),
      template: "black",
      title: { scale: 1.25, vAnchor: "bottom", align: "left", spacing: 2 },
      subtitle: { scale: 1.05, vAnchor: "bottom", align: "left" },
      cta: { scale: 1.1, vAnchor: "bottom", align: "left" },
    },
  },
  clean: {
    id: "clean",
    label: "Clean",
    description: "Mínimo — só título fino",
    titleFontFamily: SANS,
    subtitleFontFamily: SANS,
    ctaFontFamily: SANS,
    titleWeight: 400,
    subtitleWeight: 300,
    panelDarkness: 0,
    layout: {
      ...base(),
      template: "clean",
      logo: { ...base().logo, scale: 0.8 },
      title: { scale: 0.95, vAnchor: "bottom", align: "left", spacing: 1 },
      subtitle: { scale: 0.85, vAnchor: "bottom", align: "left" },
      cta: { scale: 0.85, vAnchor: "bottom", align: "left" },
    },
  },
};

export const TEMPLATE_LIST: TemplatePreset[] = [
  TEMPLATES.premium,
  TEMPLATES.moderno,
  TEMPLATES.elegante,
  TEMPLATES.minimalista,
  TEMPLATES.oferta,
  TEMPLATES.institucional,
  TEMPLATES.black,
  TEMPLATES.clean,
];

export function getTemplate(id: TemplateId): TemplatePreset {
  return TEMPLATES[id] ?? TEMPLATES.moderno;
}

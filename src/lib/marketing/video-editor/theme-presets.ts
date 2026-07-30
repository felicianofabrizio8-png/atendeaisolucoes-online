// ============================================================================
// Biblioteca de Temas (ocasiões) — camada fina sobre as Cenas existentes.
//
// Um tema NÃO cria um novo motor de render: ele apenas escolhe uma Scene
// (`TemplateId`), cores de destaque e a posição da logo. O Render Engine
// continua sendo o mesmo — o tema só alimenta `template` + `layout` no
// momento da aprovação.
//
// Para adicionar um tema novo, basta adicionar um item em THEME_PRESETS.
// ============================================================================

import type { TemplateId } from "./layout.types";
import { getScene } from "./scenes/registry";
import type { VideoLayout } from "./layout.types";

export type ThemeId =
  | "promocao"
  | "oferta"
  | "lancamento"
  | "institucional"
  | "piscinas"
  | "moda"
  | "dia_dos_pais"
  | "natal"
  | "black_friday"
  | "aniversario";

export interface ThemePreset {
  id: ThemeId;
  label: string;
  description: string;
  /** Cena (motor visual) reutilizada por este tema. */
  template: TemplateId;
  /** Cores de destaque exibidas na UI e usadas como accent do overlay. */
  colors: { primary: string; accent: string; foreground: string };
  /** Sugestão de CTA quando o usuário não informar. */
  suggestedCta: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "promocao",
    label: "Promoção",
    description: "Destaque forte de preço e urgência.",
    template: "oferta",
    colors: { primary: "#E11D2E", accent: "#F7C948", foreground: "#FFFFFF" },
    suggestedCta: "Aproveite agora",
  },
  {
    id: "oferta",
    label: "Oferta",
    description: "Comunicação direta, foco em conversão.",
    template: "moderno",
    colors: { primary: "#0F172A", accent: "#22D3EE", foreground: "#FFFFFF" },
    suggestedCta: "Peça pelo WhatsApp",
  },
  {
    id: "lancamento",
    label: "Lançamento",
    description: "Clima de novidade e expectativa.",
    template: "neon",
    colors: { primary: "#06121A", accent: "#22D3EE", foreground: "#FFFFFF" },
    suggestedCta: "Conheça a novidade",
  },
  {
    id: "institucional",
    label: "Institucional",
    description: "Marca em primeiro plano, tom sóbrio.",
    template: "institucional",
    colors: { primary: "#111111", accent: "#FFFFFF", foreground: "#FFFFFF" },
    suggestedCta: "Fale com a gente",
  },
  {
    id: "piscinas",
    label: "Piscinas",
    description: "Tons de água, leve e arejado.",
    template: "clean",
    colors: { primary: "#0369A1", accent: "#38BDF8", foreground: "#FFFFFF" },
    suggestedCta: "Solicite um orçamento",
  },
  {
    id: "moda",
    label: "Moda",
    description: "Editorial, tipografia elegante.",
    template: "editorial",
    colors: { primary: "#111111", accent: "#C9A227", foreground: "#111111" },
    suggestedCta: "Ver coleção",
  },
  {
    id: "dia_dos_pais",
    label: "Dia dos Pais",
    description: "Data comemorativa, tom afetivo.",
    template: "premium",
    colors: { primary: "#1F2937", accent: "#D4AF37", foreground: "#FFFFFF" },
    suggestedCta: "Presenteie o seu pai",
  },
  {
    id: "natal",
    label: "Natal",
    description: "Vermelho e dourado, clima natalino.",
    template: "premium",
    colors: { primary: "#7F1D1D", accent: "#D4AF37", foreground: "#FFFFFF" },
    suggestedCta: "Garanta o seu",
  },
  {
    id: "black_friday",
    label: "Black Friday",
    description: "Alto contraste, desconto em destaque.",
    template: "split",
    colors: { primary: "#000000", accent: "#F97316", foreground: "#FFFFFF" },
    suggestedCta: "Só hoje",
  },
  {
    id: "aniversario",
    label: "Aniversário",
    description: "Comemorativo, festivo e colorido.",
    template: "moderno",
    colors: { primary: "#6D28D9", accent: "#F472B6", foreground: "#FFFFFF" },
    suggestedCta: "Participe",
  },
];

export function getThemePreset(id: string | null | undefined): ThemePreset | null {
  if (!id) return null;
  return THEME_PRESETS.find((t) => t.id === id) ?? null;
}

/** Layout inicial derivado do tema — sempre uma Scene real do editor. */
export function layoutForTheme(id: ThemeId): VideoLayout {
  const preset = getThemePreset(id);
  return getScene(preset?.template ?? "moderno").defaultLayout;
}

// ============================================================================
// Scene architecture — Onda 1 do Editor Criativo IA.
//
// Uma "Scene" é a definição visual completa de um template: camadas de fundo,
// molduras, tratamento tipográfico e slots (logo/textos). É o que torna cada
// template *visualmente distinto* — não apenas fonte/posição diferente.
//
// A arquitetura é declarativa e extensível:
//  - Adicionar um novo template = criar um arquivo em `scenes/` e registrar no
//    `scenes/registry.ts`. Nenhuma outra alteração no editor é necessária.
//  - Adicionar um novo tipo de camada (ex.: "brush", "splash") = estender a
//    union `SceneLayer` e implementar o render correspondente em
//    `SceneRenderer.tsx`.
//  - Preparado para a futura "biblioteca de elementos gráficos" (Onda 2/3):
//    cada `SceneLayer` do tipo `element` referencia um id do
//    `elements/registry.ts`.
//
// A `SceneDefinition` NÃO substitui `VideoLayout` — ela o COMPLEMENTA:
//  - `SceneDefinition` = look-and-feel (imutável por template).
//  - `VideoLayout`     = ajustes do usuário (persistidos em marketing_contents).
// O `SceneRenderer` combina os dois em tempo de render.
// ============================================================================

import type { TemplateId, VideoLayout } from "./layout.types";

// ------------------------------ Camadas visuais -----------------------------

export type LayerY = "top" | "bottom" | "full";

export interface GradientLayer {
  kind: "gradient";
  /** Direção CSS (ex.: "to top", "135deg"). */
  direction: string;
  /** Paradas de cor (rgba/hex + posição opcional em %). */
  stops: Array<{ color: string; at?: number }>;
  /** Onde a camada é ancorada verticalmente. */
  y: LayerY;
  /** Altura em % (quando y != "full"). */
  height?: number;
  /** Multiplicador global de opacidade (0..1). */
  opacity?: number;
}

export interface SolidLayer {
  kind: "solid";
  color: string;
  y: LayerY;
  height?: number;
  opacity?: number;
}

/** Painel angular/diagonal (SVG). Ótimo para "energia" e cortes gráficos. */
export interface AngularLayer {
  kind: "angular";
  color: string;
  opacity?: number;
  /** Polígono em coordenadas viewbox 100x100 (ex.: "0,100 100,60 100,100"). */
  points: string;
}

/** Moldura interna (borda). */
export interface FrameLayer {
  kind: "frame";
  color: string;
  /** Espessura em % da menor dimensão. */
  width: number;
  /** Distância interna em % (0 = colada na borda). */
  inset?: number;
  /** Raio em %. */
  radius?: number;
  opacity?: number;
}

export interface VignetteLayer {
  kind: "vignette";
  /** 0..1. */
  intensity: number;
}

/**
 * Referência a um elemento gráfico da biblioteca extensível (Onda 2+).
 * Nesta onda a lista está vazia; o renderer ignora com segurança.
 */
export interface ElementLayer {
  kind: "element";
  elementId: string;
  /** Posicionamento livre em %. */
  x: number;
  y: number;
  width: number;
  opacity?: number;
  rotation?: number;
}

export type SceneLayer =
  | GradientLayer
  | SolidLayer
  | AngularLayer
  | FrameLayer
  | VignetteLayer
  | ElementLayer;

// ------------------------------ Tipografia ---------------------------------

export interface TextStyle {
  fontFamily: string;
  weight: number;
  color?: string;
  transform?: "uppercase" | "none";
  letterSpacing?: string;
  lineHeight?: number;
  /** Ex.: "0 2px 12px rgba(0,0,0,0.45)". */
  textShadow?: string;
  /** "Pill" para o CTA (fundo arredondado). */
  pill?: { background: string; foreground: string; radius: string; padding: string } | null;
  /** Underline decorativo. */
  underline?: { color: string; thickness: string; offset: string } | null;
}

export interface TextBlockStyle {
  /** Padding do bloco em % (top right bottom left). */
  padding: string;
  /** Gap vertical em cqi. */
  gap: number;
  title: TextStyle;
  subtitle: TextStyle;
  cta: TextStyle;
}

// ------------------------------ Cena completa ------------------------------

export type SceneVibe =
  | "editorial"
  | "moderno"
  | "energetico"
  | "luxo"
  | "minimalista"
  | "dark"
  | "clean";

export interface SceneDefinition {
  id: TemplateId;
  label: string;
  description: string;
  vibe: SceneVibe;
  /** Camadas renderizadas em ordem (index 0 = mais atrás). */
  layers: SceneLayer[];
  /** Estilo dos textos (título/subtítulo/CTA). */
  text: TextBlockStyle;
  /** Layout padrão sugerido (aplicado ao trocar de template). */
  defaultLayout: VideoLayout;
}

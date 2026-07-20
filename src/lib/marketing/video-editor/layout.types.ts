// Tipos do Editor Visual do Vídeo IA (Fase M4-editor).
// - `VideoLayout` é persistido em `marketing_contents.video_layout` (jsonb).
// - Nesta fase o layout é aplicado FIELMENTE no preview do editor. O worker
//   continua usando o layout atual do Brand Composer; a próxima fase
//   (M4-render) consome `video_layout` no FFmpeg sem migration adicional.

export type TemplateId =
  | "premium"
  | "moderno"
  | "elegante"
  | "minimalista"
  | "oferta"
  | "institucional"
  | "black"
  | "clean"
  // Novos templates da Onda 1 do Editor Criativo IA.
  | "editorial"
  | "neon"
  | "split";

export type Anchor = "top" | "center" | "bottom";
export type Align = "left" | "center" | "right";

export interface LogoLayout {
  /** Escala relativa (1 = 100% do default do composer). Range 0.4–2.0. */
  scale: number;
  /** Âncora vertical. */
  vAnchor: Anchor;
  /** Âncora horizontal. */
  hAnchor: Align;
  /** Margens em % da altura do canvas (0–20). */
  marginTop: number;
  marginBottom: number;
  /** Margens em % da largura do canvas (0–20). */
  marginLeft: number;
  marginRight: number;
}

export interface TextLayout {
  /** Multiplicador do tamanho base do template (0.5–2). */
  scale: number;
  /** Âncora vertical do bloco de textos. */
  vAnchor: Anchor;
  /** Alinhamento horizontal do texto. */
  align: Align;
  /** Espaço extra em % da altura (0–20). Usado só no título. */
  spacing?: number;
}

export interface VideoLayout {
  template: TemplateId;
  logo: LogoLayout;
  title: TextLayout;
  subtitle: TextLayout;
  cta: TextLayout;
}

export const DEFAULT_TEMPLATE: TemplateId = "moderno";

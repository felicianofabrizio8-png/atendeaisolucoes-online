// Tipos do Editor Visual do Vídeo IA.
// `VideoLayout` é persistido em `marketing_contents.video_layout` (jsonb) e
// enviado ao Render Engine. A definição vive no worker — o mesmo código
// desenha a prévia e o vídeo — e é reexportada aqui para o app.

export type {
  Align,
  Anchor,
  ColorMode,
  FontId,
  LogoLayout,
  ScenePalette,
  TemplateId,
  TextLayout,
  TransitionId,
  VideoLayout,
} from "../../../../worker/render-engine/src/scenes";

import type { TemplateId } from "../../../../worker/render-engine/src/scenes";

export const DEFAULT_TEMPLATE: TemplateId = "moderno";

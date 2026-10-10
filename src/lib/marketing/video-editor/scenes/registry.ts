// ============================================================================
// Registry de cenas — ponto único para o editor descobrir templates.
//
// As cenas são definidas UMA vez, em `worker/render-engine/src/scenes.ts`, e
// desenhadas pelo `scene-composer.ts` do worker tanto na prévia quanto no
// vídeo. Para adicionar um template, edite só aquele arquivo: ele aparece no
// editor automaticamente e passa a valer no render após o deploy do worker.
// ============================================================================

import {
  SCENES,
  SCENE_LIST,
  getSceneById,
  type SceneDefinition,
} from "../../../../../worker/render-engine/src/scenes";

export {
  COLOR_ROLES,
  DEFAULT_TRANSITION,
  FONTS,
  FONT_IDS,
  SCENE_PURPOSES,
  TEMPLATE_IDS,
  TRANSITIONS,
  isFontId,
  isTransitionId,
  normalizeLayout,
  sanitizePalette,
} from "../../../../../worker/render-engine/src/scenes";
export {
  buildSceneOverlaySvgWithMeta,
  hasNoText,
  sceneImageAreas,
  type Box,
  type TextPart,
} from "../../../../../worker/render-engine/src/scene-composer";
export {
  isFullyVisible,
  normalizeFraming,
  placeImage,
  type ImageAreas,
  type ImageFill,
  type ImageFit,
  type ImageFraming,
} from "../../../../../worker/render-engine/src/image-fit";

export { BLUR } from "../../../../../worker/render-engine/src/image-prepare-params";
export { TEXT_ANIMATION, TEXT_ANIMATIONS, textAnimationAt, type TextAnimationId } from "../../../../../worker/render-engine/src/scenes";
export { MIN_SCENE_SECONDS, OUTRO_SECONDS, outroSecondsOf, sceneDurations, transitionSeconds } from "../../../../../worker/render-engine/src/scenes";
export { SCENE_FORMATS, formatOf, sceneForFormat, type SceneFormat } from "../../../../../worker/render-engine/src/scenes";

export { SCENES, SCENE_LIST };

/** Cena do template; ids desconhecidos caem no template padrão. */
export function getScene(id: string | null | undefined): SceneDefinition {
  return getSceneById(id) ?? SCENES.moderno;
}

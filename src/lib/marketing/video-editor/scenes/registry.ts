// ============================================================================
// Registry de cenas — ponto único para o editor descobrir templates.
//
// Para adicionar um novo template no futuro:
//   1) Criar `scenes/<nome>.scene.ts` exportando uma `SceneDefinition`.
//   2) Adicionar o id em `layout.types.ts` (union `TemplateId`).
//   3) Importar e registrar aqui.
// Nenhuma alteração em `SceneRenderer`, `EditorPreview` ou `CampaignVideoEditor`
// é necessária para o novo template aparecer no editor.
// ============================================================================

import type { TemplateId } from "../layout.types";
import type { SceneDefinition } from "../scene.types";
import { MODERNO_SCENE } from "./moderno.scene";
import { PREMIUM_SCENE } from "./premium.scene";
import { OFERTA_SCENE } from "./oferta.scene";
import { EDITORIAL_SCENE } from "./editorial.scene";
import { NEON_SCENE } from "./neon.scene";
import { CLEAN_SCENE } from "./clean.scene";
import { SPLIT_SCENE } from "./split.scene";
import { INSTITUCIONAL_SCENE } from "./institucional.scene";

export const SCENES: Record<TemplateId, SceneDefinition> = {
  moderno: MODERNO_SCENE,
  premium: PREMIUM_SCENE,
  oferta: OFERTA_SCENE,
  editorial: EDITORIAL_SCENE,
  neon: NEON_SCENE,
  clean: CLEAN_SCENE,
  split: SPLIT_SCENE,
  institucional: INSTITUCIONAL_SCENE,
  // Aliases dos templates antigos (compat com marketing_contents existentes).
  elegante: PREMIUM_SCENE,
  minimalista: CLEAN_SCENE,
  black: NEON_SCENE,
};

export const SCENE_LIST: SceneDefinition[] = [
  MODERNO_SCENE,
  PREMIUM_SCENE,
  OFERTA_SCENE,
  EDITORIAL_SCENE,
  NEON_SCENE,
  CLEAN_SCENE,
  SPLIT_SCENE,
  INSTITUCIONAL_SCENE,
];

export function getScene(id: TemplateId): SceneDefinition {
  return SCENES[id] ?? MODERNO_SCENE;
}

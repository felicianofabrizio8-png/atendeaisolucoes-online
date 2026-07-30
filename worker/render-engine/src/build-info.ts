// ============================================================================
// Build Info — FONTE ÚNICA da assinatura de build do Render Worker.
//
// Sprint 3: antes desta fase existiam três strings independentes
// (`render-scene-svg-escape-build-003`, `render-phase-5b1-build-001`,
// `brand-phase-5b1-v1`) espalhadas por `index.ts`, `render.ts` e o gate de
// composição. Isso tornava impossível provar qual binário processou um job.
//
// REGRA: nenhum outro módulo pode declarar literal de assinatura. O teste
// `build-signature-unique.test.ts` falha se aparecer literal fora daqui.
// ============================================================================

/** Assinatura única do binário. Alterar a cada deploy relevante. */
export const BUILD_SIGNATURE = "render-manual-themes-build-005";

/** Data do build (ISO curta), apenas informativa. */
export const BUILD_DATE = "2026-07-30";

/** Versão do motor de cenas usado pelo scene-composer. */
export const SCENE_COMPOSER_VERSION = "scene-v1";

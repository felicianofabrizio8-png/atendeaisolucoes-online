import { describe, it, expect } from "vitest";
import { applyThemeToScene, sanitizeThemeSnapshot } from "../theme.js";
import { getSceneById, listSceneIds } from "../scenes/registry.js";
import { BUILD_SIGNATURE } from "../build-info.js";

const THEME = {
  id: "natal",
  accentColor: "#C81E1E",
  backgroundColor: "#0B3D2E",
  textColor: "#FFFFFF",
  overlayColor: "#0B3D2E",
  ctaColor: "#C81E1E",
  ctaTextColor: "#FFFFFF",
};

describe("worker theme application (build-005)", () => {
  it("assinatura de build atualizada", () => {
    expect(BUILD_SIGNATURE).toBe("render-manual-themes-build-005");
  });

  it("aplica cores do tema em todas as cenas sem quebrar o contrato", () => {
    for (const id of listSceneIds()) {
      const scene = getSceneById(id);
      expect(scene).toBeTruthy();
      const themed = applyThemeToScene(scene!, sanitizeThemeSnapshot(THEME));
      expect(themed.id).toBe(scene!.id);
      expect(JSON.stringify(themed)).toContain("#C81E1E");
    }
  });

  it("sem tema, a cena permanece idêntica (compatibilidade)", () => {
    const scene = getSceneById(listSceneIds()[0])!;
    expect(applyThemeToScene(scene, null)).toEqual(scene);
    expect(applyThemeToScene(scene, sanitizeThemeSnapshot("promo"))).toEqual(scene);
  });
});

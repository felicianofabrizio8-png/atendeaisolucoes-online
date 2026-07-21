// Fase M4-render — HOTFIX build-003
//
// Garante que `buildSceneOverlaySvg()` produz SVG válido para TODAS as cenas
// registradas, rasterizável pelo @resvg/resvg-js. Regride o bug
// "SVG data parsing failed: expected space not 'P'" causado por aspas duplas
// não escapadas em `font-family` (ex.: `"Playfair Display", Georgia, serif`).

import { describe, it, expect } from "vitest";
import { Resvg } from "@resvg/resvg-js";
import { SCENES, type TemplateId, type VideoLayout } from "../scenes.js";
import { buildSceneOverlaySvg } from "../scene-composer.js";

const WIDTH = 1080;
const HEIGHT = 1920;

const CONTENT = {
  headline: "Promoção de Inverno & Verão",
  supportingText: "Peças com <desconto> especial: até 50% off!",
  ctaText: "Compre agora",
};

// dataURI representativo (1x1 png transparente) — força o caminho com <image>.
const LOGO_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function layoutFor(scene: (typeof SCENES)[TemplateId]): VideoLayout {
  return scene.defaultLayout;
}

describe("scene-composer — SVG válido em todas as cenas", () => {
  const ids = Object.keys(SCENES) as TemplateId[];

  it.each(ids)("cena '%s' — sem logo, rasteriza sem erro", (id) => {
    const scene = SCENES[id];
    const svg = buildSceneOverlaySvg({
      width: WIDTH,
      height: HEIGHT,
      scene,
      layout: layoutFor(scene),
      content: CONTENT,
      logo: null,
    });
    expect(() => new Resvg(svg, { background: "rgba(0,0,0,0)" })).not.toThrow();
  });

  it.each(ids)("cena '%s' — com logo (dataURI), rasteriza sem erro", (id) => {
    const scene = SCENES[id];
    const svg = buildSceneOverlaySvg({
      width: WIDTH,
      height: HEIGHT,
      scene,
      layout: layoutFor(scene),
      content: CONTENT,
      logo: { dataUri: LOGO_DATA_URI, layout: scene.defaultLayout.logo },
    });
    expect(() => new Resvg(svg, { background: "rgba(0,0,0,0)" })).not.toThrow();
  });

  it("aspas duplas em font-family são escapadas (regressão do bug 'expected space not P')", () => {
    const scene = SCENES.oferta; // fontFamily contém "Playfair Display"
    const svg = buildSceneOverlaySvg({
      width: WIDTH,
      height: HEIGHT,
      scene,
      layout: layoutFor(scene),
      content: CONTENT,
      logo: null,
    });
    // O caractere " literal NÃO deve aparecer dentro de font-family; ele
    // precisa vir codificado como &quot;.
    expect(svg).not.toMatch(/font-family="[^"]*"[A-Za-z]/);
    expect(svg).toContain("&quot;Playfair Display&quot;");
  });
});

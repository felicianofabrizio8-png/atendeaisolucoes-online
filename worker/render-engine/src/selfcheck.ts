// ============================================================================
// Selfcheck — prova, sem rede e sem fila, que ESTA imagem consegue desenhar
// todas as cenas: binário nativo do rasterizador carregado, todas as fontes
// do registro presentes e cada cena rasterizando em PNG.
//
// Roda no build do Docker (`RUN node dist/selfcheck.js`): se algo faltar, a
// imagem nem é criada — em vez de o problema aparecer só no primeiro vídeo.
// Uso local: `npm run selfcheck`.
// ============================================================================

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { BUILD_SIGNATURE, SCENE_COMPOSER_VERSION } from "./build-info.js";
import { buildSceneOverlaySvgWithMeta } from "./scene-composer.js";
import { FONTS, SCENE_LIST, fontLicenseFile } from "./scenes.js";

const FONTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "fonts");

function main(): void {
  const files = Array.from(new Set(Object.values(FONTS).map((f) => f.file)));
  const missing = files.filter((f) => !existsSync(path.join(FONTS_DIR, f)));
  if (missing.length > 0) throw new Error(`fontes ausentes em ${FONTS_DIR}: ${missing.join(", ")}`);
  const fontFiles = files.map((f) => path.join(FONTS_DIR, f));

  // A licença (OFL) de cada fonte precisa acompanhar o arquivo na imagem.
  const licenses = Array.from(new Set(files.map(fontLicenseFile)));
  const missingLicenses = licenses.filter((f) => !existsSync(path.join(FONTS_DIR, "licenses", f)));
  if (missingLicenses.length > 0) throw new Error(`licenças de fonte ausentes: ${missingLicenses.join(", ")}`);

  for (const scene of SCENE_LIST) {
    const { svg } = buildSceneOverlaySvgWithMeta({
      width: 1080,
      height: 1920,
      scene,
      layout: scene.defaultLayout,
      content: { headline: "Selfcheck do render", supportingText: "Fontes e cenas da imagem", ctaText: "Tudo certo" },
    });
    const png = new Resvg(svg, {
      background: "rgba(0,0,0,0)",
      fitTo: { mode: "width", value: 270 },
      font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "Inter" },
    })
      .render()
      .asPng();
    if (png.length < 500) throw new Error(`cena ${scene.id}: PNG vazio`);
  }

  process.stdout.write(
    `${JSON.stringify({
      event: "selfcheck_ok",
      build_signature: BUILD_SIGNATURE,
      scene_composer_version: SCENE_COMPOSER_VERSION,
      scenes: SCENE_LIST.length,
      fonts: files.length,
      font_licenses: licenses.length,
    })}\n`,
  );
}

try {
  main();
} catch (e) {
  process.stderr.write(`${JSON.stringify({ event: "selfcheck_failed", message: e instanceof Error ? e.message : String(e) })}\n`);
  process.exit(1);
}

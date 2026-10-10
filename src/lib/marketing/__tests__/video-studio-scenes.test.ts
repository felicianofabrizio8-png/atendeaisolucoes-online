// Contrato do estúdio do Vídeo IA: catálogo de modelos, compositor compartilhado
// entre prévia e worker, fontes, cores e transições.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FONTS,
  FONT_IDS,
  SCENE_LIST,
  SCENE_PURPOSES,
  TEMPLATE_IDS,
  TRANSITIONS,
  buildSceneOverlaySvgWithMeta,
  getScene,
  normalizeLayout,
} from "../video-editor/scenes/registry";
import { brandPalette, fitPaletteToScene, sceneWithPalette, usedColorRoles } from "../video-editor/palette";
import { contrastRatio } from "../theme-snapshot";
import { getSceneById } from "../../../../worker/render-engine/src/scenes";
import { applyThemeToScene, sanitizeThemeSnapshot } from "../../../../worker/render-engine/src/theme";
import { resolveXfadeTransition } from "../../../../worker/render-engine/src/ffmpeg";
import { FONT_METRICS } from "../../../../worker/render-engine/src/font-metrics";

const root = process.cwd();
const W = 1080;
const H = 1920;
const LONG = {
  headline: "Liquidação extraordinariamente imperdível de verão",
  supportingText: "Condições especialíssimas para clientes cadastrados em todo o território nacional",
  ctaText: "Garanta o seu agora mesmo",
};

function compose(id: string, layout?: unknown, content = LONG) {
  const scene = getScene(id);
  return buildSceneOverlaySvgWithMeta({ width: W, height: H, scene, layout: layout ?? scene.defaultLayout, content });
}

describe("catálogo de modelos", () => {
  it("oferece pelo menos 24 modelos, todos com id único e categoria", () => {
    expect(SCENE_LIST.length).toBeGreaterThanOrEqual(24);
    expect(new Set(SCENE_LIST.map((s) => s.id)).size).toBe(SCENE_LIST.length);
    expect(SCENE_LIST.map((s) => s.id).sort()).toEqual([...TEMPLATE_IDS].sort());
  });

  it("todo modelo declara finalidade comercial, e toda finalidade tem modelos", () => {
    const purposes = Object.keys(SCENE_PURPOSES);
    for (const scene of SCENE_LIST) {
      expect(scene.purposes.length).toBeGreaterThan(0);
      for (const p of scene.purposes) expect(purposes).toContain(p);
    }
    for (const p of purposes) expect(SCENE_LIST.filter((s) => s.purposes.includes(p as never)).length).toBeGreaterThanOrEqual(2);
  });

  it("serve a qualquer segmento: nada de piscinas, Solário ou texto fixo de cliente", () => {
    const source = readFileSync(resolve(root, "worker/render-engine/src/scenes.ts"), "utf8");
    expect(source).not.toMatch(/piscin|sol[aá]rio|pool/i);
    // Com conteúdo vazio o modelo não escreve nada por conta própria.
    for (const scene of SCENE_LIST) {
      const { svg } = buildSceneOverlaySvgWithMeta({ width: W, height: H, scene, layout: scene.defaultLayout, content: { headline: null, supportingText: null, ctaText: null } });
      expect(svg).not.toContain("<text");
    }
  });

  it("usa os efeitos de publicidade: cor de destaque, degradê, contorno, sombra e tarjas", () => {
    const styles = SCENE_LIST.map((s) => s.text.title);
    expect(styles.filter((t) => t.accent).length).toBeGreaterThanOrEqual(5);
    expect(styles.filter((t) => t.gradient).length).toBeGreaterThanOrEqual(3);
    expect(styles.some((t) => t.outline)).toBe(true);
    expect(styles.some((t) => t.plate)).toBe(true);
    expect(styles.some((t) => t.shadow && t.shadow.blur === 0)).toBe(true);
    const kinds = new Set(SCENE_LIST.flatMap((s) => s.layers.map((l) => l.kind)));
    for (const kind of ["cutout", "burst", "stripes", "dots", "glow"]) expect(kinds.has(kind as never)).toBe(true);
    // Os efeitos chegam ao SVG (o mesmo da prévia e do vídeo).
    expect(compose("impacto").svg).toMatch(/<linearGradient id="titlet"/);
    expect(compose("neon").svg).toContain("feDropShadow");
    expect(compose("etiqueta").svg).toContain('transform="rotate(-3');
    expect(compose("moderno").svg).toMatch(/<tspan fill="#38BDF8">/);
  });

  it("todo modelo reserva uma área onde a imagem inteira cabe, longe dos painéis de texto", () => {
    for (const scene of SCENE_LIST) {
      const built = compose(scene.id);
      const area = built.imageAreas.contain;
      expect(area.width).toBeGreaterThan(W * 0.3);
      expect(area.height).toBeGreaterThan(H * 0.18);
      // Com o texto na posição padrão, o bloco de texto não invade a área da imagem.
      const block = built.blockBox!;
      const overlapY = Math.min(area.y + area.height, block.y + block.height) - Math.max(area.y, block.y);
      expect(overlapY).toBeLessThanOrEqual(H * 0.04);
    }
  });

  it("os modelos são visualmente distintos entre si (nenhum desenho repetido)", () => {
    const drawings = SCENE_LIST.map((s) => compose(s.id).svg);
    expect(new Set(drawings).size).toBe(SCENE_LIST.length);
  });

  it("ids antigos gravados no banco continuam abrindo uma cena", () => {
    for (const legacy of ["elegante", "minimalista", "black"]) expect(getSceneById(legacy)).toBeTruthy();
    expect(getScene("inexistente").id).toBe("moderno");
  });

  it("toda cor de toda cena é #RRGGBB (nada de CSS arbitrário no SVG)", () => {
    for (const scene of SCENE_LIST) {
      for (const value of Object.values(scene.palette)) expect(value).toMatch(/^#[0-9A-F]{6}$/);
      const fixed = JSON.stringify(scene.layers).match(/#[^"]*/g) ?? [];
      for (const value of fixed) expect(value).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

describe("compositor compartilhado (prévia = vídeo)", () => {
  it("o app e o worker usam o mesmo módulo de cenas", () => {
    const registry = readFileSync(resolve(root, "src/lib/marketing/video-editor/scenes/registry.ts"), "utf8");
    expect(registry).toContain("worker/render-engine/src/scenes");
    expect(registry).toContain("worker/render-engine/src/scene-composer");
    const renderer = readFileSync(resolve(root, "src/components/marketing/campaign/editor/SceneRenderer.tsx"), "utf8");
    expect(renderer).toContain("buildSceneOverlaySvgWithMeta");
  });

  it.each(SCENE_LIST.map((s) => s.id))("%s: texto longo nunca é cortado nem sai do quadro", (id) => {
    for (const anchor of getScene(id).anchors) {
      const scene = getScene(id);
      const layout = normalizeLayout({ ...scene.defaultLayout, title: { ...scene.defaultLayout.title, vAnchor: anchor, scale: 2 } }, scene);
      const built = compose(id, layout);
      expect(built.svg).not.toContain("NaN");
      const upper = built.svg.toUpperCase();
      for (const word of [...LONG.headline.split(" "), ...LONG.ctaText.split(" ")]) {
        expect(upper).toContain(word.toUpperCase());
      }
      for (const box of Object.values(built.textBoxes)) {
        expect(box.x).toBeGreaterThanOrEqual(-0.5);
        expect(box.x + box.width).toBeLessThanOrEqual(W + 0.5);
      }
    }
  });

  it("posição, fonte e deslocamento do editor mudam o desenho", () => {
    const scene = getScene("moderno");
    const base = compose("moderno").textBoxes.title!;
    const top = compose("moderno", { ...scene.defaultLayout, title: { ...scene.defaultLayout.title, vAnchor: "top" } }).textBoxes.title!;
    expect(top.y).toBeLessThan(base.y);
    const moved = compose("moderno", { ...scene.defaultLayout, offsetX: 4, offsetY: -10 }).textBoxes.title!;
    expect(moved.x - base.x).toBeCloseTo(0.04 * W, 0);
    expect(moved.y - base.y).toBeCloseTo(-0.1 * H, 0);
    const font = compose("moderno", { ...scene.defaultLayout, title: { ...scene.defaultLayout.title, font: "anton" } });
    expect(font.svg).toContain('font-family="Anton"');
  });

  it("layout inválido vindo do banco é normalizado, não desenhado", () => {
    const scene = getScene("split");
    const layout = normalizeLayout(
      { title: { scale: 99, vAnchor: "center", align: "torto", font: "comic" }, offsetY: "x", transition: "explode", colors: { accent: "red" } },
      scene,
    );
    expect(layout.title.scale).toBe(2.5);
    // "split" é um painel de borda: meio não é uma posição válida.
    expect(scene.anchors).not.toContain("center");
    expect(layout.title.vAnchor).toBe("bottom");
    expect(layout.title.align).toBe(scene.defaultLayout.title.align);
    expect(layout.title.font).toBeUndefined();
    expect(layout.offsetY).toBe(0);
    expect(layout.transition).toBe("fade");
    expect(layout.colors).toBeNull();
  });
});

describe("fontes", () => {
  it("cada fonte existe no worker e no app, com o mesmo arquivo", () => {
    const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
    for (const id of FONT_IDS) {
      const workerFile = resolve(root, "worker/render-engine/assets/fonts", FONTS[id].file);
      const appFile = resolve(root, "public/fonts/video", FONTS[id].file);
      expect(existsSync(workerFile)).toBe(true);
      expect(existsSync(appFile)).toBe(true);
      expect(sha(appFile)).toBe(sha(workerFile));
      expect(FONT_METRICS[id]).toBeTruthy();
    }
  });

  it("a prévia declara as mesmas famílias e pesos que o worker rasteriza", () => {
    const css = readFileSync(resolve(root, "src/components/marketing/campaign/editor/video-fonts.css"), "utf8");
    for (const id of FONT_IDS) {
      const f = FONTS[id];
      const face = css.split("@font-face").find((block) => block.includes(f.file));
      expect(face).toBeTruthy();
      expect(face).toContain(`font-family: "${f.family}"`);
      expect(face).toContain(`font-weight: ${f.weight}`);
    }
  });
});

describe("cores por empresa", () => {
  const brand = { primary: "#0B3D2E", secondary: "#F2E8CF", accent: "#C81E1E" };

  it("a paleta da marca vem das cores da empresa, sem valor fixo de cliente", () => {
    for (const scene of SCENE_LIST) {
      const p = brandPalette(brand, scene)!;
      expect(p.background).toBe("#0B3D2E");
      expect(p.cta).toBe("#C81E1E");
      const surface = scene.textSurface === "background" ? p.background : p.overlay;
      expect(contrastRatio(p.text, surface)).toBeGreaterThanOrEqual(3);
    }
    expect(brandPalette(null, SCENE_LIST[0])).toBeNull();
    expect(brandPalette({ primary: "verde", secondary: "", accent: "" }, SCENE_LIST[0])).toBeNull();
    const sources = ["worker/render-engine/src/scenes.ts", "src/components/marketing/campaign/editor/CampaignVideoEditor.tsx", "src/lib/marketing/video-editor/palette.ts"];
    for (const file of sources) expect(readFileSync(resolve(root, file), "utf8")).not.toMatch(/sol[aá]rio/i);
  });

  it("a cor que a prévia mostra é a que o worker aplica a partir do snapshot", () => {
    for (const scene of SCENE_LIST) {
      const chosen = fitPaletteToScene({ ...scene.palette, background: "#FFFFFF", overlay: "#101010", text: "#FAFAFA", accent: "#FF0066" }, scene);
      const preview = sceneWithPalette(scene, chosen).palette;
      const snapshot = sanitizeThemeSnapshot({
        id: "custom",
        accentColor: chosen.accent,
        backgroundColor: chosen.background,
        textColor: chosen.text,
        overlayColor: chosen.overlay,
        ctaColor: chosen.cta,
        ctaTextColor: chosen.ctaText,
      });
      expect(applyThemeToScene(scene, snapshot).palette).toEqual(preview);
    }
  });

  it("só viram controle as cores que a cena usa", () => {
    expect(usedColorRoles(getScene("editorial"))).not.toContain("overlay");
    expect(usedColorRoles(getScene("moderno"))).toEqual(expect.arrayContaining(["overlay", "text", "cta", "ctaText"]));
  });
});

describe("transições", () => {
  it("só nomes do registro chegam ao filtro do FFmpeg", () => {
    for (const id of Object.keys(TRANSITIONS)) expect(resolveXfadeTransition(id)).toBe(id);
    expect(resolveXfadeTransition("fade[v0];movie=/etc/passwd")).toBe("fade");
    expect(resolveXfadeTransition(undefined)).toBe("fade");
  });

  it("o servidor aceita duração e converte as cores do editor em tema para o worker", () => {
    const source = readFileSync(resolve(root, "src/lib/marketing/marketing-campaign.functions.ts"), "utf8");
    const approve = source.slice(source.indexOf("const ApproveInput"), source.indexOf("if (feedRow) {", source.indexOf("const ApproveInput")));
    expect(approve).toContain("duration_seconds_not_allowed");
    expect(approve).toContain("normalizeLayout(data.layout, approvedScene)");
    expect(approve).toContain("paletteToThemeInput(");
    expect(approve).toContain("assertPrimaryAudio(");
  });
});

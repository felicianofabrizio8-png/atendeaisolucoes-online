import { describe, expect, it } from "vitest";
import { buildFocalVideoFilter } from "../../../../worker/render-engine/src/ffmpeg";
import {
  FEED_FRAME,
  STORY_FRAME,
  computeFocalCrop,
  normalizeFocalPoint,
  panFocalPoint,
  type FrameSize,
  type ImageSize,
} from "../focal-geometry";

// Avalia o filtro real do worker (scale + crop) para uma imagem de entrada e
// devolve o corte em pixels do quadro. É a referência das prévias.
function evalFfmpeg(expr: string, vars: Record<string, number>): number {
  const js = expr.replace(/\\,/g, ",").replace(/\bclip\(/g, "clip(").replace(/\bmax\(/g, "Math.max(");
  const clip = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const names = Object.keys(vars);
  return new Function("clip", ...names, `return (${js});`)(clip, ...names.map((n) => vars[n])) as number;
}

function workerCrop(image: ImageSize, frame: FrameSize, focal: { x: number; y: number; zoom: number }) {
  const filter = buildFocalVideoFilter(frame.width, frame.height, focal);
  const scale = /scale=w=(.+?):h=(.+?):flags=/.exec(filter);
  const crop = /crop=(\d+):(\d+):(.+?):(clip\(.+?\)),setsar/.exec(filter);
  if (!scale || !crop) throw new Error(`filtro inesperado: ${filter}`);
  const input = { iw: image.width, ih: image.height };
  const scaledW = evalFfmpeg(scale[1], input);
  const scaledH = evalFfmpeg(scale[2], input);
  const w = Number(crop[1]);
  const h = Number(crop[2]);
  const scaled = { iw: scaledW, ih: scaledH, w, h, ow: w, oh: h };
  return { scaledW, scaledH, w, h, x: evalFfmpeg(crop[3], scaled), y: evalFfmpeg(crop[4], scaled) };
}

const IMAGES: Array<[string, ImageSize]> = [
  ["paisagem 4:3", { width: 4000, height: 3000 }],
  ["paisagem 16:9", { width: 1920, height: 1080 }],
  ["panorâmica 3:1", { width: 3000, height: 1000 }],
  ["quadrada", { width: 2000, height: 2000 }],
  ["retrato 3:4", { width: 3000, height: 4000 }],
  ["retrato 9:16", { width: 1080, height: 1920 }],
  ["retrato 4:5", { width: 1080, height: 1350 }],
  ["tira vertical 1:4", { width: 500, height: 2000 }],
  ["pequena 320x240", { width: 320, height: 240 }],
];
const FRAMES: Array<[string, FrameSize]> = [["Feed", FEED_FRAME], ["Story", STORY_FRAME]];
const POSITIONS = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];
const ZOOMS = [1, 1.5, 2, 3];

describe("computeFocalCrop reproduz o corte do worker", () => {
  for (const [imageName, image] of IMAGES) {
    for (const [frameName, frame] of FRAMES) {
      it(`${imageName} → ${frameName}`, () => {
        for (const zoom of ZOOMS) {
          for (const x of POSITIONS) {
            for (const y of POSITIONS) {
              const focal = { x, y, zoom };
              // O worker sempre renderiza o quadro 9:16; o Feed mostra uma janela dele.
              const ref = workerCrop(image, { width: frame.width, height: frame.height }, focal);
              const view = frame.window ?? { x: 0, y: 0, width: frame.width, height: frame.height };
              const crop = computeFocalCrop(image, frame, focal)!;
              const label = `x=${x} y=${y} zoom=${zoom}`;
              // tolerância de 0,01 px do vídeo final
              expect((-crop.leftPct / 100) * view.width, label).toBeCloseTo(ref.x + view.x, 2);
              expect((-crop.topPct / 100) * view.height, label).toBeCloseTo(ref.y + view.y, 2);
              expect((crop.widthPct / 100) * view.width, label).toBeCloseTo(ref.scaledW, 2);
              expect((crop.heightPct / 100) * view.height, label).toBeCloseTo(ref.scaledH, 2);
            }
          }
        }
      });
    }
  }
});

describe("computeFocalCrop — invariantes", () => {
  it("a imagem sempre cobre o quadro inteiro e mantém a proporção", () => {
    for (const [, image] of IMAGES) {
      for (const [, frame] of FRAMES) {
        for (const zoom of ZOOMS) {
          for (const x of POSITIONS) {
            for (const y of POSITIONS) {
              const c = computeFocalCrop(image, frame, { x, y, zoom })!;
              const view = frame.window ?? { x: 0, y: 0, width: frame.width, height: frame.height };
              expect(c.leftPct).toBeLessThanOrEqual(1e-9);
              expect(c.topPct).toBeLessThanOrEqual(1e-9);
              expect(c.leftPct + c.widthPct).toBeGreaterThanOrEqual(100 - 1e-9);
              expect(c.topPct + c.heightPct).toBeGreaterThanOrEqual(100 - 1e-9);
              const shownRatio = (c.widthPct * view.width) / (c.heightPct * view.height);
              expect(shownRatio).toBeCloseTo(image.width / image.height, 6);
              expect(c.markerXPct).toBeGreaterThanOrEqual(-1e-9);
              expect(c.markerXPct).toBeLessThanOrEqual(100 + 1e-9);
              if (!frame.window) {
                // No Story o foco sempre cai dentro do quadro; no Feed ele pode
                // ficar acima ou abaixo da área central exibida.
                expect(c.markerYPct).toBeGreaterThanOrEqual(-1e-9);
                expect(c.markerYPct).toBeLessThanOrEqual(100 + 1e-9);
              }
            }
          }
        }
      }
    }
  });

  it("foco no centro e sem zoom equivale ao corte centralizado", () => {
    const c = computeFocalCrop({ width: 1920, height: 1080 }, STORY_FRAME, { x: 0.5, y: 0.5, zoom: 1 })!;
    expect(c.heightPct).toBeCloseTo(100, 6);
    expect(c.topPct).toBeCloseTo(0, 6);
    expect(c.leftPct).toBeCloseTo(-(c.widthPct - 100) / 2, 6);
    expect(c.markerXPct).toBeCloseTo(50, 6);
    expect(c.markerYPct).toBeCloseTo(50, 6);
  });

  it("imagem na mesma proporção do quadro não tem sobra sem zoom", () => {
    const c = computeFocalCrop({ width: 1080, height: 1920 }, STORY_FRAME, { x: 0.1, y: 0.9, zoom: 1 })!;
    expect([c.leftPct, c.topPct, c.widthPct, c.heightPct].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 0, 100, 100]);
    expect(c.visibleX).toBe(1);
    expect(c.visibleY).toBe(1);
    // o foco fora do centro aparece onde realmente está na imagem
    expect(c.markerXPct).toBeCloseTo(10, 6);
    expect(c.markerYPct).toBeCloseTo(90, 6);
  });

  it("perto da borda o corte trava e o marcador sai do centro", () => {
    const image = { width: 1920, height: 1080 };
    const atEdge = computeFocalCrop(image, STORY_FRAME, { x: 0, y: 0.5, zoom: 1 })!;
    const nearEdge = computeFocalCrop(image, STORY_FRAME, { x: 0.1, y: 0.5, zoom: 1 })!;
    expect(atEdge.leftPct).toBeCloseTo(0, 6);
    expect(nearEdge.leftPct).toBeCloseTo(0, 6);
    expect(atEdge.markerXPct).toBeCloseTo(0, 6);
    expect(nearEdge.markerXPct).toBeGreaterThan(0);
    expect(nearEdge.markerXPct).toBeLessThan(50);
    const far = computeFocalCrop(image, STORY_FRAME, { x: 1, y: 0.5, zoom: 1 })!;
    expect(far.leftPct + far.widthPct).toBeCloseTo(100, 6);
    expect(far.markerXPct).toBeCloseTo(100, 6);
  });

  it("valores fora da faixa são limitados como no worker", () => {
    const image = { width: 2000, height: 2000 };
    expect(computeFocalCrop(image, FEED_FRAME, { x: -1, y: 4, zoom: 99 })).toEqual(
      computeFocalCrop(image, FEED_FRAME, { x: 0, y: 1, zoom: 3 }),
    );
    expect(normalizeFocalPoint(null)).toEqual({ x: 0.5, y: 0.5, zoom: 1 });
    expect(computeFocalCrop(image, FEED_FRAME, null)).toEqual(computeFocalCrop(image, FEED_FRAME, { x: 0.5, y: 0.5, zoom: 1 }));
  });

  it("sem dimensões válidas não calcula corte", () => {
    for (const bad of [null, undefined, { width: 0, height: 100 }, { width: 100, height: Number.NaN }, { width: -5, height: 5 }]) {
      expect(computeFocalCrop(bad as ImageSize | null, STORY_FRAME, { x: 0.3, y: 0.3, zoom: 1 })).toBeNull();
    }
  });
});

describe("panFocalPoint (arrastar a imagem)", () => {
  const landscape = { width: 1920, height: 1080 };

  it("arrastar para a direita mostra mais do lado esquerdo, na proporção do que está visível", () => {
    const start = { x: 0.5, y: 0.5, zoom: 1 };
    const visible = computeFocalCrop(landscape, STORY_FRAME, start)!.visibleX;
    const next = panFocalPoint(landscape, STORY_FRAME, start, 0.2, 0);
    expect(next.x).toBeCloseTo(0.5 - 0.2 * visible, 4);
    // a imagem acompanha o cursor: 20% do quadro
    const before = computeFocalCrop(landscape, STORY_FRAME, start)!;
    const after = computeFocalCrop(landscape, STORY_FRAME, next)!;
    expect(after.leftPct - before.leftPct).toBeCloseTo(20, 1);
  });

  it("eixo sem sobra mantém o valor salvo (o foco é compartilhado entre Feed e Story)", () => {
    const saved = { x: 0.5, y: 0.2, zoom: 1 };
    // paisagem em Story: não há sobra vertical
    expect(panFocalPoint(landscape, STORY_FRAME, saved, 0.1, 0.4).y).toBe(0.2);
    // retrato 9:16 preenche o master exatamente: nada a mover, em Feed ou Story
    const portrait = { width: 1080, height: 1920 };
    expect(panFocalPoint(portrait, FEED_FRAME, { x: 0.8, y: 0.3, zoom: 1 }, 0.3, -0.1)).toEqual({ x: 0.8, y: 0.3, zoom: 1 });
    // retrato mais alto que 9:16: sobra só na vertical
    const tall = { width: 1000, height: 3000 };
    const next = panFocalPoint(tall, STORY_FRAME, { x: 0.8, y: 0.5, zoom: 1 }, 0.3, -0.1);
    expect(next.x).toBe(0.8);
    expect(next.y).toBeGreaterThan(0.5);
  });

  it("Feed é a área central 4:5 do mesmo vídeo 9:16 do Story", () => {
    const image = { width: 1920, height: 1080 };
    const focal = { x: 0.3, y: 0.5, zoom: 1.5 };
    const story = computeFocalCrop(image, STORY_FRAME, focal)!;
    const feed = computeFocalCrop(image, FEED_FRAME, focal)!;
    // mesma largura e mesmo deslocamento horizontal
    expect(feed.widthPct).toBeCloseTo(story.widthPct, 6);
    expect(feed.leftPct).toBeCloseTo(story.leftPct, 6);
    // na vertical, o Feed mostra 1350 dos 1920 px, centralizados (285 px cortados em cima e embaixo)
    expect((feed.heightPct / 100) * 1350).toBeCloseTo((story.heightPct / 100) * 1920, 6);
    expect((-feed.topPct / 100) * 1350).toBeCloseTo((-story.topPct / 100) * 1920 + 285, 6);
    // arrastar 20% da área do Feed move a imagem os mesmos 20% dessa área
    const moved = panFocalPoint(image, FEED_FRAME, focal, 0.2, 0);
    expect(computeFocalCrop(image, FEED_FRAME, moved)!.leftPct - feed.leftPct).toBeCloseTo(20, 1);
  });

  it("não ultrapassa as bordas e sem movimento não altera nada", () => {
    const start = { x: 0.5, y: 0.5, zoom: 1.5 };
    const visible = computeFocalCrop(landscape, STORY_FRAME, start)!;
    const right = panFocalPoint(landscape, STORY_FRAME, start, 50, 50);
    expect(right.x).toBeCloseTo(visible.visibleX / 2, 4);
    expect(right.y).toBeCloseTo(visible.visibleY / 2, 4);
    const left = panFocalPoint(landscape, STORY_FRAME, start, -50, -50);
    expect(left.x).toBeCloseTo(1 - visible.visibleX / 2, 4);
    expect(computeFocalCrop(landscape, STORY_FRAME, left)!.leftPct + computeFocalCrop(landscape, STORY_FRAME, left)!.widthPct).toBeCloseTo(100, 1);
    const untouched = { x: 0.03, y: 0.97, zoom: 2 };
    expect(panFocalPoint(landscape, STORY_FRAME, untouched, 0, 0)).toEqual(untouched);
  });

  it("partindo de um foco travado na borda, o arraste começa da posição exibida", () => {
    const stuck = { x: 0, y: 0.5, zoom: 1 };
    const crop = computeFocalCrop(landscape, STORY_FRAME, stuck)!;
    const next = panFocalPoint(landscape, STORY_FRAME, stuck, -0.1, 0);
    expect(next.x).toBeCloseTo(crop.centerX + 0.1 * crop.visibleX, 4);
    expect(computeFocalCrop(landscape, STORY_FRAME, next)!.leftPct).toBeCloseTo(-10, 1);
  });

  it("preserva o zoom, mantém 4 casas decimais e ignora arraste sem dimensões", () => {
    const next = panFocalPoint(landscape, FEED_FRAME, { x: 0.5, y: 0.5, zoom: 2.35 }, 0.1234567, 0.0456789);
    expect(next.zoom).toBe(2.35);
    expect(Number(next.x.toFixed(4))).toBe(next.x);
    expect(Number(next.y.toFixed(4))).toBe(next.y);
    expect(panFocalPoint(null, FEED_FRAME, { x: 0.3, y: 0.6, zoom: 1.2 }, 0.5, 0.5)).toEqual({ x: 0.3, y: 0.6, zoom: 1.2 });
  });
});

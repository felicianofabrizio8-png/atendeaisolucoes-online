// Enquadramento seguro: o produto nunca é cortado no modo "conter", em nenhum
// modelo, e o quadro montado pelo FFmpeg bate com a conta usada na prévia.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { isFullyVisible, needsPreparedFrame, normalizeFraming, placeImage, type ImageFraming } from "../image-fit";
import { buildPreparedFrameArgs, prepareImageFrame } from "../image-prepare";
import { sceneImageAreas } from "../scene-composer";
import { SCENE_LIST } from "../scenes";

const W = 1080;
const H = 1920;
const FRAME = { width: W, height: H };
const FULL = { x: 0, y: 0, width: W, height: H };
const contain = (over: Partial<ImageFraming> = {}): ImageFraming => ({ x: 0.5, y: 0.5, zoom: 1, fit: "contain", fill: "blur", ...over });

// Proporções reais: celular em pé, carro de lado, panorâmica, quadrada, banner.
const PHOTOS = [
  { name: "celular 9:19", width: 900, height: 1900 },
  { name: "retrato 3:4", width: 1500, height: 2000 },
  { name: "quadrada", width: 1200, height: 1200 },
  { name: "carro 3:2", width: 3000, height: 2000 },
  { name: "panorâmica 21:9", width: 4200, height: 1800 },
  { name: "banner 5:1", width: 2500, height: 500 },
];

describe("padrão seguro", () => {
  it("sem enquadramento salvo vale o padrão do modelo; formato antigo (só x/y/zoom) continua 'cover'", () => {
    expect(normalizeFraming(null, { fit: "contain", fill: "color" })).toEqual({ x: 0.5, y: 0.5, zoom: 1, fit: "contain", fill: "color" });
    expect(normalizeFraming({ x: 0.2, y: 0.8, zoom: 1.5 }, { fit: "contain", fill: "blur" })).toEqual({ x: 0.2, y: 0.8, zoom: 1.5, fit: "cover", fill: "blur" });
    expect(normalizeFraming({ x: 9, y: -3, zoom: 99, fit: "esticar", fill: "x" }, { fit: "contain", fill: "blur" })).toEqual({ x: 1, y: 0, zoom: 3, fit: "cover", fill: "blur" });
  });

  it.each(SCENE_LIST.map((s) => s.id))("%s: qualquer foto aparece INTEIRA, dentro da área livre do modelo", (id) => {
    const scene = SCENE_LIST.find((s) => s.id === id)!;
    for (const anchor of scene.anchors) {
      const areas = sceneImageAreas(scene, anchor, W, H);
      // A área do modelo fica dentro do quadro.
      expect(isFullyVisible(areas.contain, FRAME)).toBe(true);
      for (const photo of PHOTOS) {
        for (const pos of [0, 0.5, 1]) {
          const r = placeImage(photo, areas, contain({ x: pos, y: pos }));
          expect(isFullyVisible(r, FRAME)).toBe(true);
          expect(r.x).toBeGreaterThanOrEqual(areas.contain.x - 0.5);
          expect(r.y).toBeGreaterThanOrEqual(areas.contain.y - 0.5);
          expect(r.x + r.width).toBeLessThanOrEqual(areas.contain.x + areas.contain.width + 0.5);
          expect(r.y + r.height).toBeLessThanOrEqual(areas.contain.y + areas.contain.height + 0.5);
          // Sem distorção.
          expect(r.width / r.height).toBeCloseTo(photo.width / photo.height, 3);
        }
      }
    }
  });

  it("'preencher' cobre a área toda (pode cortar) e respeita o ponto de foco", () => {
    const car = PHOTOS[3];
    const r = placeImage(car, { contain: FULL, cover: FULL }, { x: 0.5, y: 0.5, zoom: 1, fit: "cover", fill: "blur" });
    expect(r.width).toBeGreaterThanOrEqual(W);
    expect(r.height).toBeCloseTo(H, 3);
    expect(isFullyVisible(r, FRAME)).toBe(false);
    const left = placeImage(car, { contain: FULL, cover: FULL }, { x: 0, y: 0.5, zoom: 1, fit: "cover", fill: "blur" });
    expect(left.x).toBeCloseTo(0, 3);
  });

  it("só o caso histórico (cobrir o quadro inteiro) dispensa o quadro preparado", () => {
    const cover: ImageFraming = { x: 0.5, y: 0.5, zoom: 1, fit: "cover", fill: "blur" };
    expect(needsPreparedFrame(cover, { contain: FULL, cover: FULL }, FRAME)).toBe(false);
    expect(needsPreparedFrame(contain(), { contain: FULL, cover: FULL }, FRAME)).toBe(true);
    expect(needsPreparedFrame(cover, { contain: FULL, cover: { x: 60, y: 60, width: 900, height: 1200 } }, FRAME)).toBe(true);
  });
});

describe("quadro preparado (FFmpeg real)", () => {
  const run = (args: string[]) => spawnSync("ffmpeg", args, { maxBuffer: 16 * 1024 * 1024 });
  /** Cor (r,g,b) de um pixel do PNG. */
  function pixel(file: string, x: number, y: number): number[] {
    const r = run(["-v", "error", "-i", file, "-vf", `crop=1:1:${x}:${y}`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
    return Array.from(r.stdout.subarray(0, 3));
  }
  const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 12);

  it("argumentos só carregam números e a cor validada (nada do usuário vai cru para o filtro)", () => {
    const args = buildPreparedFrameArgs({
      inputPath: "in.jpg", outputPath: "out.png", width: W, height: H,
      areas: { contain: FULL, cover: FULL }, framing: contain({ fill: "color" }), fillColor: "red; movie=/etc/passwd",
    });
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("color=c=0x000000");
    expect(graph).not.toContain("passwd");
    expect(graph).toContain("min(1080.000/iw\\,1920.000/ih)*1.000");
  });

  it("'conter' coloca a foto inteira onde a conta da prévia diz, sobre a cor de fundo", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "prepare-test-"));
    try {
      const src = path.join(dir, "red.png");
      const out = path.join(dir, "out.png");
      expect(run(["-y", "-f", "lavfi", "-i", "color=c=red:s=400x200", "-frames:v", "1", src]).status).toBe(0);
      const areas = { contain: { x: 0, y: 0, width: W, height: 1152 }, cover: FULL };
      const framing = contain({ fill: "color" });
      await prepareImageFrame({ inputPath: src, outputPath: out, width: W, height: H, areas, framing, fillColor: "#00FF00" });

      const expected = placeImage({ width: 400, height: 200 }, areas, framing);
      expect(expected).toEqual({ x: 0, y: 306, width: 1080, height: 540 });
      const RED = [255, 0, 0];
      const GREEN = [0, 255, 0];
      // Dentro do retângulo previsto: a foto. Fora dele: o preenchimento.
      expect(near(pixel(out, 540, 576), RED)).toBe(true);
      expect(near(pixel(out, 20, 320), RED)).toBe(true);
      expect(near(pixel(out, 1060, 830), RED)).toBe(true);
      expect(near(pixel(out, 540, 290), GREEN)).toBe(true);
      expect(near(pixel(out, 540, 860), GREEN)).toBe(true);
      expect(near(pixel(out, 540, 1700), GREEN)).toBe(true);
      // O quadro sai no tamanho exato do vídeo.
      const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", out], { encoding: "utf8" });
      expect(probe.stdout.trim()).toBe(`${W},${H}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("alinhamento e zoom do 'conter' e o desfoque também geram quadro válido", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "prepare-test-"));
    try {
      const src = path.join(dir, "blue.png");
      const out = path.join(dir, "out.png");
      run(["-y", "-f", "lavfi", "-i", "color=c=blue:s=300x600", "-frames:v", "1", src]);
      const areas = { contain: { x: 100, y: 100, width: 880, height: 1000 }, cover: FULL };
      const framing = contain({ x: 0, y: 1, zoom: 1, fill: "blur" });
      await prepareImageFrame({ inputPath: src, outputPath: out, width: W, height: H, areas, framing, fillColor: "#000000" });
      const r = placeImage({ width: 300, height: 600 }, areas, framing);
      expect(r).toEqual({ x: 100, y: 100, width: 500, height: 1000 });
      expect(near(pixel(out, 350, 600), [0, 0, 255])).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// Tempo por cena e tela final configuráveis: contas puras (as mesmas da
// prévia) e um render real com FFmpeg conferindo qual imagem está na tela.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

vi.mock("@resvg/resvg-js", () => ({ Resvg: class {} }));

import { resolveOutroOptions } from "../brand-composer";
import { renderSlideshowWithAudio } from "../ffmpeg";
import { ffprobe } from "../ffprobe";
import { SCENES, normalizeLayout, outroSecondsOf, sceneDurations, transitionSeconds } from "../scenes";

const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);

describe("duração de cada cena", () => {
  it("sem pesos válidos, divide igualmente (comportamento original)", () => {
    expect(sceneDurations(15, 3)).toEqual([5, 5, 5]);
    for (const bad of [null, "x", [], [1, 2], [1, 2, 0], [1, -2, 3], [1, Number.NaN, 3], [1, "2", 3]]) {
      expect(sceneDurations(15, 3, bad)).toEqual([5, 5, 5]);
    }
    expect(sceneDurations(15, 0)).toEqual([]);
    expect(sceneDurations(0, 3)).toEqual([]);
  });

  it("os pesos são proporcionais e a soma é sempre a duração do vídeo", () => {
    expect(sceneDurations(12, 3, [1, 2, 3])).toEqual([2, 4, 6]);
    expect(sceneDurations(15, 3, [5, 5, 5])).toEqual([5, 5, 5]);
    for (const [total, weights] of [[15, [3, 9, 1]], [30, [1, 1, 20, 4]], [8, [2.5, 0.5, 7, 1, 1, 3, 2, 9]]] as const) {
      const d = sceneDurations(total, weights.length, [...weights]);
      expect(sum(d)).toBeCloseTo(total, 6);
      expect(Math.min(...d)).toBeGreaterThanOrEqual(Math.min(1, total / weights.length) - 1e-6);
    }
  });

  it("nenhuma cena fica com menos de 1 s; o excedente sai das outras", () => {
    const d = sceneDurations(10, 3, [0.5, 50, 50]);
    expect(d[0]).toBeCloseTo(1, 6);
    expect(d[1]).toBeCloseTo(4.5, 6);
    expect(d[2]).toBeCloseTo(4.5, 6);
    // 8 cenas em 8 s: 1 s cada, não há o que redistribuir.
    expect(sceneDurations(8, 8, [1, 2, 3, 4, 5, 6, 7, 8]).every((v) => Math.abs(v - 1) < 1e-6)).toBe(true);
  });

  it("a transição cabe na menor cena", () => {
    expect(transitionSeconds([5, 5, 5])).toBe(0.6);
    expect(transitionSeconds([1, 9])).toBeCloseTo(1 / 3, 6);
    expect(transitionSeconds([15])).toBe(0);
  });
});

describe("layout: tela final e tempos", () => {
  const scene = SCENES.moderno;

  it("layouts antigos continuam idênticos (as chaves novas só existem quando definidas)", () => {
    const layout = normalizeLayout(scene.defaultLayout, scene);
    expect("outro" in layout).toBe(false);
    expect("sceneSeconds" in layout).toBe(false);
    expect(outroSecondsOf(layout)).toBe(2);
    expect(outroSecondsOf(null)).toBe(2);
  });

  it("normaliza a tela final (1 a 4 s) e os tempos por cena", () => {
    const layout = normalizeLayout({ ...scene.defaultLayout, outro: { enabled: false, seconds: 99 }, sceneSeconds: [1.234, 80, 0.1] }, scene);
    expect(layout.outro).toEqual({ enabled: false, seconds: 4 });
    expect(layout.sceneSeconds).toEqual([1.2, 60, 0.5]);
    expect(outroSecondsOf(layout)).toBe(0);
    expect(outroSecondsOf(normalizeLayout({ ...scene.defaultLayout, outro: { enabled: true, seconds: 3 } }, scene))).toBe(3);
    // Lixo é descartado, não propagado.
    for (const bad of [[1, "a"], [1, 0], [], Array.from({ length: 9 }, () => 1), "1,2"]) {
      expect("sceneSeconds" in normalizeLayout({ ...scene.defaultLayout, sceneSeconds: bad }, scene)).toBe(false);
    }
    expect("outro" in normalizeLayout({ ...scene.defaultLayout, outro: "sim" }, scene)).toBe(false);
  });
});

describe("tela final no worker", () => {
  const brand = (overlayLayout: unknown, enabled = true) => ({ outro: { enabled, durationSeconds: 2 }, content: { overlayLayout } });

  it("sem escolhas do editor, vale o snapshot (como antes)", () => {
    expect(resolveOutroOptions(brand(null))).toEqual({ enabled: true, seconds: 2, showLogo: true });
    expect(resolveOutroOptions(brand(undefined, false))).toEqual({ enabled: false, seconds: 2, showLogo: true });
    expect(resolveOutroOptions({ outro: null })).toEqual({ enabled: false, seconds: 2, showLogo: true });
  });

  it("o editor pode desligar, mudar a duração (1 a 4 s) e ocultar a logo também aqui", () => {
    expect(resolveOutroOptions(brand({ outro: { enabled: false, seconds: 3 } })).enabled).toBe(false);
    expect(resolveOutroOptions(brand({ outro: { enabled: true, seconds: 3.5 } })).seconds).toBe(3.5);
    expect(resolveOutroOptions(brand({ outro: { enabled: true, seconds: 40 } })).seconds).toBe(4);
    expect(resolveOutroOptions(brand({ outro: { enabled: true, seconds: "x" } })).seconds).toBe(2);
    expect(resolveOutroOptions(brand({ logo: { visible: false } })).showLogo).toBe(false);
    // O editor não liga uma tela final que o snapshot não tem (sem marca).
    expect(resolveOutroOptions(brand({ outro: { enabled: true, seconds: 2 } }, false)).enabled).toBe(false);
  });
});

describe("tempos por cena no FFmpeg real", () => {
  function run(cmd: string, args: string[]): Buffer {
    const r = spawnSync(cmd, args, { maxBuffer: 1024 * 1024 * 5 });
    if (r.status !== 0) throw new Error(`${cmd} failed: ${String(r.stderr).slice(0, 400)}`);
    return r.stdout as Buffer;
  }
  /** Cor dominante (r, g ou b) do quadro em `t`. */
  function colorAt(file: string, t: number): "r" | "g" | "b" {
    const px = run("ffmpeg", ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
    const [r, g, b] = [px[0], px[1], px[2]];
    return r >= g && r >= b ? "r" : g >= b ? "g" : "b";
  }

  it("cada imagem fica na tela pelo tempo pedido; sem pedido, o tempo é igual", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "scene-timing-"));
    try {
      const images = ["red", "lime", "blue"].map((color, i) => {
        const file = path.join(dir, `${i}.png`);
        run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=${color}:s=128x128`, "-frames:v", "1", file]);
        return file;
      });
      const audio = path.join(dir, "a.wav");
      run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=660:duration=7:sample_rate=48000", "-ac", "2", audio]);
      const base = { imageFilePaths: images, focalPoints: [null, null, null], audioFilePath: audio, audioStartSecond: 0, durationSeconds: 6, width: 128, height: 128, timeoutMs: 60_000 };

      const equal = path.join(dir, "equal.mp4");
      await renderSlideshowWithAudio({ ...base, outputFilePath: equal });
      // 2 s por cena: aos 1,4 s ainda é a primeira.
      expect(colorAt(equal, 1.4)).toBe("r");
      expect(colorAt(equal, 3)).toBe("g");
      expect(colorAt(equal, 5.5)).toBe("b");

      const custom = path.join(dir, "custom.mp4");
      const durations = sceneDurations(6, 3, [1, 3, 2]);
      expect(durations).toEqual([1, 3, 2]);
      await renderSlideshowWithAudio({ ...base, outputFilePath: custom, sceneDurations: durations });
      // 1 s + 3 s + 2 s: aos 1,4 s já é a segunda; ela vai até os 4 s.
      expect(colorAt(custom, 0.3)).toBe("r");
      expect(colorAt(custom, 1.4)).toBe("g");
      expect(colorAt(custom, 3.4)).toBe("g");
      expect(colorAt(custom, 4.6)).toBe("b");
      expect(colorAt(custom, 5.7)).toBe("b");

      for (const file of [equal, custom]) {
        const probe = await ffprobe(file, 15_000);
        expect(probe.duration).toBeGreaterThan(5.8);
        expect(probe.duration).toBeLessThan(6.3);
      }
      // Tempos inválidos (tamanho errado) caem na divisão igual, sem falhar.
      const ignored = path.join(dir, "ignored.mp4");
      await renderSlideshowWithAudio({ ...base, outputFilePath: ignored, sceneDurations: [1, 5] });
      expect(colorAt(ignored, 1.4)).toBe("r");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

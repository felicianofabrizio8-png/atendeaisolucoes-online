// Testes de stress reais em resolução final 1080x1920, 15s.
// Validam que single-image e slideshow completam sem SIGKILL após o hotfix
// de otimização de memória (preset veryfast, -threads 2, framerate=2 nos
// stills, fps=30 pré-xfade, max_muxing_queue_size).
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  renderStaticImageVideo,
  renderSlideshowWithAudio,
  type FocalPoint,
} from "../ffmpeg";
import { analyzeVolume, ffprobe } from "../ffprobe";

function run(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 5 });
  if (r.status !== 0) {
    throw new Error(`${cmd} failed: ${r.stderr.slice(0, 500)}`);
  }
}

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "render-stress-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function makeHDImage(file: string, color: string): void {
  // Gera uma imagem 1920x1920 para simular carga próxima da real (o pipeline
  // fará scale para 1080x1920). Testar com 1080x1920 direto tornaria o crop
  // trivial; usar 1920x1920 exercita scale+crop.
  run("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=${color}:s=1920x1920`,
    "-frames:v", "1",
    file,
  ]);
}

function makeTone(file: string, seconds: number): void {
  run("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", `sine=frequency=880:duration=${seconds}:sample_rate=48000`,
    "-ac", "2",
    file,
  ]);
}

describe("stress · resolução final 1080x1920 · 15s", () => {
  it(
    "1 imagem + áudio · MP4 válido, sem SIGKILL, áudio audível",
    async () => {
      await withTmp(async (dir) => {
        const img = path.join(dir, "img.jpg");
        const audio = path.join(dir, "audio.wav");
        const out = path.join(dir, "stress-single.mp4");
        makeHDImage(img, "orange");
        makeTone(audio, 20);

        const focal: FocalPoint = { x: 0.5, y: 0.5, zoom: 1.2 };

        await renderStaticImageVideo({
          imageFilePath: img,
          audioFilePath: audio,
          audioStartSecond: 0,
          durationSeconds: 15,
          width: 1080,
          height: 1920,
          outputFilePath: out,
          timeoutMs: 180_000,
          focalPoint: focal,
        });

        const st = await stat(out);
        expect(st.size).toBeGreaterThan(50_000);

        const probe = await ffprobe(out, 20_000);
        expect(probe.videoCodec).toBe("h264");
        expect(probe.audioCodec).toBe("aac");
        expect(probe.width).toBe(1080);
        expect(probe.height).toBe(1920);
        expect(probe.duration).toBeGreaterThan(14);
        expect(probe.duration).toBeLessThan(16);

        const vol = await analyzeVolume(out, 20_000);
        expect(vol.meanVolumeDb).toBeGreaterThan(-40);
      });
    },
    240_000,
  );

  it(
    "slideshow 8 imagens + áudio · MP4 válido, sem SIGKILL, áudio audível",
    async () => {
      await withTmp(async (dir) => {
        const colors = ["red", "green", "blue", "yellow", "magenta", "cyan", "white", "orange"];
        const imgs: string[] = [];
        for (let i = 0; i < 8; i++) {
          const p = path.join(dir, `img${i}.jpg`);
          makeHDImage(p, colors[i]);
          imgs.push(p);
        }
        const audio = path.join(dir, "audio.wav");
        const out = path.join(dir, "stress-slideshow.mp4");
        makeTone(audio, 20);

        const focals: FocalPoint[] = imgs.map((_, i) => ({
          x: 0.2 + (i % 4) * 0.2,
          y: 0.2 + Math.floor(i / 4) * 0.4,
          zoom: 1 + (i % 3) * 0.2,
        }));

        await renderSlideshowWithAudio({
          imageFilePaths: imgs,
          focalPoints: focals,
          audioFilePath: audio,
          audioStartSecond: 0,
          durationSeconds: 15,
          width: 1080,
          height: 1920,
          outputFilePath: out,
          timeoutMs: 240_000,
        });

        const st = await stat(out);
        expect(st.size).toBeGreaterThan(50_000);

        const probe = await ffprobe(out, 20_000);
        expect(probe.videoCodec).toBe("h264");
        expect(probe.audioCodec).toBe("aac");
        expect(probe.width).toBe(1080);
        expect(probe.height).toBe(1920);
        expect(probe.duration).toBeGreaterThan(14);
        expect(probe.duration).toBeLessThan(16);

        const vol = await analyzeVolume(out, 20_000);
        expect(vol.meanVolumeDb).toBeGreaterThan(-40);
      });
    },
    360_000,
  );
});

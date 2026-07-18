// Testes reais de renderSlideshowWithAudio.
// Usam FFmpeg local para gerar imagens e áudio de curta duração e validam
// o MP4 final via ffprobe/volumedetect.
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { renderSlideshowWithAudio, type FocalPoint } from "../ffmpeg";
import { analyzeVolume, ffprobe } from "../ffprobe";

function run(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 5 });
  if (r.status !== 0) {
    throw new Error(`${cmd} failed: ${r.stderr.slice(0, 500)}`);
  }
}

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "render-slideshow-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function makeImage(file: string, color: string): void {
  run("ffmpeg", ["-y", "-f", "lavfi", "-i", `color=c=${color}:s=128x128`, "-frames:v", "1", file]);
}

function makeTone(file: string): void {
  run("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", "sine=frequency=880:duration=6:sample_rate=48000",
    "-ac", "2",
    file,
  ]);
}

const FOCALS: FocalPoint[] = [
  { x: 0.2, y: 0.2, zoom: 1 },
  { x: 0.8, y: 0.2, zoom: 1.2 },
  { x: 0.5, y: 0.5, zoom: 1 },
  { x: 0.2, y: 0.8, zoom: 1 },
  { x: 0.8, y: 0.8, zoom: 1.5 },
];

describe("renderSlideshowWithAudio (real FFmpeg)", () => {
  it("2 imagens · Feed 4:5 · MP4 válido com áudio audível", async () => {
    await withTmp(async (dir) => {
      const a = path.join(dir, "a.jpg");
      const b = path.join(dir, "b.jpg");
      const audio = path.join(dir, "audio.wav");
      const out = path.join(dir, "feed.mp4");
      makeImage(a, "red");
      makeImage(b, "green");
      makeTone(audio);

      await renderSlideshowWithAudio({
        imageFilePaths: [a, b],
        focalPoints: [FOCALS[0], FOCALS[1]],
        audioFilePath: audio,
        audioStartSecond: 0,
        durationSeconds: 2,
        width: 216,
        height: 270, // Feed 4:5 (ratio preservado)
        outputFilePath: out,
        timeoutMs: 60_000,
      });

      const st = await stat(out);
      expect(st.size).toBeGreaterThan(1024);

      const probe = await ffprobe(out, 15_000);
      expect(probe.videoCodec).toBe("h264");
      expect(probe.audioCodec).toBe("aac");
      expect(probe.width).toBe(216);
      expect(probe.height).toBe(270);
      expect(probe.duration).toBeGreaterThan(1.5);
      expect(probe.duration).toBeLessThan(3.5);
      expect(probe.audioDuration).toBeGreaterThan(1.5);

      const vol = await analyzeVolume(out, 15_000);
      expect(vol.maxVolumeDb).not.toBeNull();
      expect(vol.maxVolumeDb!).toBeGreaterThan(-50);
    });
  }, 90_000);

  it("5 imagens · Story 9:16 · focal points distintos · MP4 válido", async () => {
    await withTmp(async (dir) => {
      const files = ["red", "green", "blue", "yellow", "magenta"].map((c, i) => {
        const p = path.join(dir, `img${i}.jpg`);
        makeImage(p, c);
        return p;
      });
      const audio = path.join(dir, "audio.wav");
      const out = path.join(dir, "story.mp4");
      makeTone(audio);

      await renderSlideshowWithAudio({
        imageFilePaths: files,
        focalPoints: FOCALS.slice(0, 5),
        audioFilePath: audio,
        audioStartSecond: 0,
        durationSeconds: 5,
        width: 216,
        height: 384, // Story 9:16 (ratio preservado)
        outputFilePath: out,
        timeoutMs: 90_000,
      });

      const st = await stat(out);
      expect(st.size).toBeGreaterThan(1024);

      const probe = await ffprobe(out, 15_000);
      expect(probe.videoCodec).toBe("h264");
      expect(probe.audioCodec).toBe("aac");
      expect(probe.width).toBe(216);
      expect(probe.height).toBe(384);
      expect(probe.duration).toBeGreaterThan(4);
      expect(probe.duration).toBeLessThan(6.5);

      const vol = await analyzeVolume(out, 15_000);
      expect(vol.maxVolumeDb).not.toBeNull();
      expect(vol.maxVolumeDb!).toBeGreaterThan(-50);
    });
  }, 180_000);
});

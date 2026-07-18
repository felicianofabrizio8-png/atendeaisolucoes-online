import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { renderStaticImageVideo } from "../ffmpeg";
import { analyzeVolume, ffprobe } from "../ffprobe";
import { parseVolumedetectOutput, validateRenderedMedia } from "../media-validation";

function run(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 5 });
  if (r.status !== 0) {
    throw new Error(`${cmd} failed: ${r.stderr.slice(0, 500)}`);
  }
}

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "render-media-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function makeImage(file: string): void {
  run("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=red:s=64x64", "-frames:v", "1", file]);
}

function makeToneAudio(file: string): void {
  run("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=880:duration=4:sample_rate=48000", "-ac", "2", file]);
}

function makeSilentMp4(file: string): void {
  run("ffmpeg", [
    "-y",
    "-f", "lavfi", "-i", "color=c=blue:s=64x64:r=30:d=1",
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-t", "1",
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-ar", "48000",
    "-ac", "2",
    file,
  ]);
}

describe("render worker media validation", () => {
  it("áudio original com som produz MP4 com volume audível em Feed 4:5", async () => {
    await withTmp(async (dir) => {
      const image = path.join(dir, "image.jpg");
      const audio = path.join(dir, "audio.wav");
      const output = path.join(dir, "feed.mp4");
      makeImage(image);
      makeToneAudio(audio);

      await renderStaticImageVideo({
        imageFilePath: image,
        audioFilePath: audio,
        audioStartSecond: 0,
        durationSeconds: 1,
        width: 216,
        height: 270,
        outputFilePath: output,
        timeoutMs: 30_000,
      });

      const probe = await ffprobe(output, 10_000);
      const volume = await analyzeVolume(output, 10_000);
      expect(validateRenderedMedia({ probe, volume, expectedWidth: 216, expectedHeight: 270, expectedDurationSeconds: 1 })).toBeNull();
      expect(volume.maxVolumeDb).not.toBeNull();
      expect(volume.maxVolumeDb!).toBeGreaterThan(-50);
      expect(probe.audioDuration).toBeGreaterThan(0.8);
    });
  });

  it("Story 9:16 contém áudio AAC audível", async () => {
    await withTmp(async (dir) => {
      const image = path.join(dir, "image.jpg");
      const audio = path.join(dir, "audio.wav");
      const output = path.join(dir, "story.mp4");
      makeImage(image);
      makeToneAudio(audio);

      await renderStaticImageVideo({
        imageFilePath: image,
        audioFilePath: audio,
        audioStartSecond: 0,
        durationSeconds: 1,
        width: 216,
        height: 384,
        outputFilePath: output,
        timeoutMs: 30_000,
      });

      const probe = await ffprobe(output, 10_000);
      const volume = await analyzeVolume(output, 10_000);
      expect(validateRenderedMedia({ probe, volume, expectedWidth: 216, expectedHeight: 384, expectedDurationSeconds: 1 })).toBeNull();
      expect(probe.audioCodec).toBe("aac");
      expect(probe.sampleRate).toBe(48000);
      expect(probe.channels).toBe(2);
    });
  });

  it("audio_start_second em segundos é respeitado", async () => {
    await withTmp(async (dir) => {
      const image = path.join(dir, "image.jpg");
      const audio = path.join(dir, "audio.wav");
      const output = path.join(dir, "offset.mp4");
      makeImage(image);
      makeToneAudio(audio);

      await renderStaticImageVideo({
        imageFilePath: image,
        audioFilePath: audio,
        audioStartSecond: 2,
        durationSeconds: 1,
        width: 216,
        height: 270,
        outputFilePath: output,
        timeoutMs: 30_000,
      });

      const probe = await ffprobe(output, 10_000);
      const volume = await analyzeVolume(output, 10_000);
      expect(validateRenderedMedia({ probe, volume, expectedWidth: 216, expectedHeight: 270, expectedDurationSeconds: 1 })).toBeNull();
    });
  });

  it("stream AAC silenciosa não é considerada válida", async () => {
    await withTmp(async (dir) => {
      const output = path.join(dir, "silent.mp4");
      makeSilentMp4(output);
      const probe = await ffprobe(output, 10_000);
      const volume = await analyzeVolume(output, 10_000);
      expect(probe.audioCodec).toBe("aac");
      expect(validateRenderedMedia({ probe, volume, expectedWidth: 64, expectedHeight: 64, expectedDurationSeconds: 1 })).toBe("audio_stream_silent");
    });
  });

  it("offset fora da duração falha claramente na validação pós-render", async () => {
    await withTmp(async (dir) => {
      const image = path.join(dir, "image.jpg");
      const audio = path.join(dir, "audio.wav");
      const output = path.join(dir, "invalid-offset.mp4");
      makeImage(image);
      makeToneAudio(audio);

      await renderStaticImageVideo({
        imageFilePath: image,
        audioFilePath: audio,
        audioStartSecond: 99,
        durationSeconds: 1,
        width: 216,
        height: 270,
        outputFilePath: output,
        timeoutMs: 30_000,
      });
      const probe = await ffprobe(output, 10_000);
      const volume = await analyzeVolume(output, 10_000);
      expect(validateRenderedMedia({ probe, volume, expectedWidth: 216, expectedHeight: 270, expectedDurationSeconds: 1 })).not.toBeNull();
    });
  });

  it("parseia mean_volume e max_volume do volumedetect", () => {
    const parsed = parseVolumedetectOutput("mean_volume: -16.8 dB\nmax_volume: -2.5 dB");
    expect(parsed).toEqual({ meanVolumeDb: -16.8, maxVolumeDb: -2.5 });
  });
});
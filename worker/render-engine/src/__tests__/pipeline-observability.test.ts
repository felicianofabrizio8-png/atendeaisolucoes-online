// Testes de instrumentação / observabilidade — não alteram o pipeline.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { ffprobeInput } from "../ffprobe";
import {
  fingerprintFile,
  redactUrl,
  sniffFormat,
  truncateStream,
  validateAudioRange,
  memorySnapshot,
} from "../telemetry";
import { classifyFfmpegFailure } from "../ffmpeg";

function run(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 5 });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr.slice(0, 500)}`);
}

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "render-obs-"));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

describe("telemetry.redactUrl", () => {
  it("descarta query string e token", () => {
    const r = redactUrl(
      "https://storage.example.com/object/foo/bar.mp3?token=abc123&expires=999",
    );
    expect(r.host).toBe("storage.example.com");
    expect(r.pathname).toBe("/object/foo/bar.mp3");
    expect(r.hasQuery).toBe(true);
  });
  it("marca URL inválida", () => {
    expect(redactUrl("not-a-url").host).toBe("invalid");
  });
});

describe("telemetry.sniffFormat", () => {
  it("detecta MP3 (ID3)", () => {
    expect(sniffFormat(Buffer.from([0x49, 0x44, 0x33, 0x04]))).toBe("mp3");
  });
  it("detecta WAV (RIFF)", () => {
    expect(sniffFormat(Buffer.from([0x52, 0x49, 0x46, 0x46]))).toBe("wav");
  });
  it("detecta OGG", () => {
    expect(sniffFormat(Buffer.from([0x4f, 0x67, 0x67, 0x53]))).toBe("ogg");
  });
  it("desconhecido por padrão", () => {
    expect(sniffFormat(Buffer.from([0, 0, 0, 0]))).toBe("unknown");
  });
});

describe("telemetry.truncateStream", () => {
  it("não trunca quando dentro do limite", () => {
    const r = truncateStream("hello world");
    expect(r.truncated).toBe(false);
    expect(r.head).toBe("hello world");
    expect(r.tail).toBe("");
  });
  it("trunca preservando head e tail", () => {
    const big = "A".repeat(5000) + "B".repeat(9000);
    const r = truncateStream(big, 4096, 8192);
    expect(r.truncated).toBe(true);
    expect(r.head.length).toBeLessThanOrEqual(4096);
    expect(r.tail.length).toBeLessThanOrEqual(8192);
    expect(r.totalBytes).toBe(14000);
  });
});

describe("telemetry.validateAudioRange", () => {
  it("aceita janela dentro dos limites", () => {
    const r = validateAudioRange(2, 5, 10);
    expect(r.ok).toBe(true);
    expect(r.code).toBeNull();
    expect(r.marginSeconds).toBeCloseTo(3);
  });
  it("rejeita janela além da duração real", () => {
    const r = validateAudioRange(8, 5, 10);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("audio_range_out_of_bounds");
  });
  it("aceita tolerância pequena (0.25s)", () => {
    const r = validateAudioRange(0, 10.2, 10);
    expect(r.ok).toBe(true);
  });
  it("rejeita duração real inválida", () => {
    const r = validateAudioRange(0, 5, null);
    expect(r.code).toBe("audio_duration_invalid");
  });
});

describe("telemetry.memorySnapshot", () => {
  it("retorna campos numéricos válidos", () => {
    const s = memorySnapshot();
    expect(s.rss).toBeGreaterThan(0);
    expect(s.heapTotal).toBeGreaterThan(0);
    expect(s.systemTotalBytes).toBeGreaterThan(0);
    expect(s.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});

describe("classifyFfmpegFailure", () => {
  it("timeout tem prioridade sobre signal", () => {
    expect(classifyFfmpegFailure({ code: null, signal: "SIGKILL", timeoutTriggered: true }))
      .toBe("ffmpeg_timeout");
  });
  it("mapeia SIGKILL corretamente", () => {
    expect(classifyFfmpegFailure({ code: null, signal: "SIGKILL", timeoutTriggered: false }))
      .toBe("ffmpeg_signal_SIGKILL");
  });
  it("mapeia SIGTERM corretamente", () => {
    expect(classifyFfmpegFailure({ code: null, signal: "SIGTERM", timeoutTriggered: false }))
      .toBe("ffmpeg_signal_SIGTERM");
  });
  it("mapeia SIGSEGV corretamente", () => {
    expect(classifyFfmpegFailure({ code: null, signal: "SIGSEGV", timeoutTriggered: false }))
      .toBe("ffmpeg_signal_SIGSEGV");
  });
  it("exit code diferente de zero sem signal", () => {
    expect(classifyFfmpegFailure({ code: 1, signal: null, timeoutTriggered: false }))
      .toBe("ffmpeg_exit_1");
  });
  it("code=null e sem signal cai em ffmpeg_exit_null", () => {
    expect(classifyFfmpegFailure({ code: null, signal: null, timeoutTriggered: false }))
      .toBe("ffmpeg_exit_null");
  });
});

// ---- Testes reais dependentes de FFmpeg/FFprobe local ---------------

describe("ffprobeInput — arquivos reais", () => {
  it("probe de áudio WAV válido retorna 1 stream de áudio", async () => {
    await withTmp(async (dir) => {
      const audio = path.join(dir, "tone.wav");
      run("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=880:duration=2:sample_rate=48000", "-ac", "2", audio]);
      const report = await ffprobeInput(audio, 15_000);
      expect(report.audioStreams).toBe(1);
      expect(report.audio?.codecName).toBeTruthy();
      expect(report.audio?.sampleRate).toBe(48000);
      expect(report.audio?.channels).toBe(2);
      expect(report.duration).toBeGreaterThan(1.5);
    });
  });

  it("arquivo sem stream de áudio (imagem) retorna audioStreams=0", async () => {
    await withTmp(async (dir) => {
      const img = path.join(dir, "img.jpg");
      run("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=red:s=64x64", "-frames:v", "1", img]);
      const report = await ffprobeInput(img, 15_000);
      expect(report.audioStreams).toBe(0);
      expect(report.audio).toBeNull();
      expect(report.videoStreams).toBeGreaterThanOrEqual(1);
    });
  });

  it("arquivo corrompido lança ffprobe_input_failed", async () => {
    await withTmp(async (dir) => {
      const bad = path.join(dir, "bad.bin");
      await writeFile(bad, Buffer.from("not-a-media-file"));
      await expect(ffprobeInput(bad, 10_000)).rejects.toThrow(/ffprobe_input_(failed|parse_failed)/);
    });
  });

  it("fingerprintFile calcula SHA-256, tamanho e formato provável", async () => {
    await withTmp(async (dir) => {
      const audio = path.join(dir, "tone.wav");
      run("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1:sample_rate=48000", "-ac", "1", audio]);
      const fp = await fingerprintFile(audio);
      expect(fp.sizeBytes).toBeGreaterThan(0);
      expect(fp.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(fp.headHex).toMatch(/^[0-9a-f]+$/);
      expect(fp.likelyFormat).toBe("wav");
    });
  });
});

// ---- Guardrail: os argumentos do FFmpeg NÃO devem ter sido alterados ----
// Este teste faz snapshot dos flags críticos que definem o comportamento
// de render — qualquer alteração exigiria atualização explícita deste teste.
describe("guardrail: flags do FFmpeg não foram modificados", () => {
  it("renderStaticImageVideo continua usando libx264/aac/yuv420p com CRF=20", async () => {
    // Não invocamos o ffmpeg de fato — apenas asseguramos que o arquivo
    // ffmpeg.ts mantém os tokens críticos. Se algum destes for removido,
    // o teste falha e força auditoria.
    const src = await import("node:fs/promises").then((m) =>
      m.readFile(path.join(__dirname, "..", "ffmpeg.ts"), "utf8"),
    );
    for (const token of [
      '"-c:v", "libx264"',
      '"-pix_fmt", "yuv420p"',
      '"-c:a", "aac"',
      '"-crf", "20"',
      '"-ar", "48000"',
      '"-ac", "2"',
      '"-b:a", "192k"',
      '"-movflags", "+faststart"',
    ]) {
      expect(src, `flag missing: ${token}`).toContain(token);
    }
  });
});

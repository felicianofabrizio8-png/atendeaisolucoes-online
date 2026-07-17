import { describe, expect, it } from "vitest";
import {
  createRenderJobSchema,
  validateAudioRange,
  formatVideoTimeLabel,
  suggestStartSecond,
  isVideoFormat,
} from "../render.validation";

describe("render.validation — schema", () => {
  const valid = {
    image_id: "11111111-1111-1111-1111-111111111111",
    audio_id: "22222222-2222-2222-2222-222222222222",
    video_format: "story" as const,
    audio_start_second: 0,
    duration_seconds: 15,
  };

  it("aceita payload válido", () => {
    expect(() => createRenderJobSchema.parse(valid)).not.toThrow();
  });

  it("rejeita duração fora da lista permitida", () => {
    expect(() => createRenderJobSchema.parse({ ...valid, duration_seconds: 12 })).toThrow();
    expect(() => createRenderJobSchema.parse({ ...valid, duration_seconds: 0 })).toThrow();
    expect(() => createRenderJobSchema.parse({ ...valid, duration_seconds: 90 })).toThrow();
  });

  it("rejeita formato inválido", () => {
    expect(() =>
      createRenderJobSchema.parse({ ...valid, video_format: "square" as unknown as "story" }),
    ).toThrow();
  });

  it("rejeita audio_start_second negativo", () => {
    expect(() => createRenderJobSchema.parse({ ...valid, audio_start_second: -1 })).toThrow();
  });

  it("rejeita UUIDs inválidos", () => {
    expect(() => createRenderJobSchema.parse({ ...valid, image_id: "not-uuid" })).toThrow();
    expect(() => createRenderJobSchema.parse({ ...valid, audio_id: "abc" })).toThrow();
  });

  it("aceita todas as durações permitidas", () => {
    for (const d of [8, 10, 15, 30, 60]) {
      expect(() =>
        createRenderJobSchema.parse({ ...valid, duration_seconds: d }),
      ).not.toThrow();
    }
  });
});

describe("render.validation — validateAudioRange", () => {
  it("aceita range dentro da duração", () => {
    expect(
      validateAudioRange({
        audio_duration_seconds: 60,
        audio_start_second: 0,
        duration_seconds: 15,
      }),
    ).toBeNull();
    expect(
      validateAudioRange({
        audio_duration_seconds: 60,
        audio_start_second: 45,
        duration_seconds: 15,
      }),
    ).toBeNull();
  });

  it("rejeita quando trecho excede duração", () => {
    expect(
      validateAudioRange({
        audio_duration_seconds: 20,
        audio_start_second: 15,
        duration_seconds: 15,
      }),
    ).toBe("audio_slice_exceeds_duration");
  });

  it("rejeita duração de áudio inválida", () => {
    expect(
      validateAudioRange({
        audio_duration_seconds: 0,
        audio_start_second: 0,
        duration_seconds: 8,
      }),
    ).toBe("audio_duration_invalid");
  });

  it("rejeita start negativo", () => {
    expect(
      validateAudioRange({
        audio_duration_seconds: 60,
        audio_start_second: -1,
        duration_seconds: 8,
      }),
    ).toBe("audio_start_negative");
  });
});

describe("render.validation — helpers", () => {
  it("formatVideoTimeLabel formata mm:ss", () => {
    expect(formatVideoTimeLabel(0)).toBe("0:00");
    expect(formatVideoTimeLabel(65)).toBe("1:05");
    expect(formatVideoTimeLabel(3599)).toBe("59:59");
  });

  it("suggestStartSecond respeita preferido e limite", () => {
    expect(suggestStartSecond(10, 60, 15)).toBe(10);
    expect(suggestStartSecond(50, 60, 15)).toBe(45); // clamp ao máximo
    expect(suggestStartSecond(null, 60, 15)).toBe(0);
    expect(suggestStartSecond(undefined, 60, 15)).toBe(0);
  });

  it("isVideoFormat filtra strings inválidas", () => {
    expect(isVideoFormat("story")).toBe(true);
    expect(isVideoFormat("reels")).toBe(true);
    expect(isVideoFormat("feed_square")).toBe(true);
    expect(isVideoFormat("landscape")).toBe(false);
    expect(isVideoFormat(42)).toBe(false);
    expect(isVideoFormat(null)).toBe(false);
  });
});

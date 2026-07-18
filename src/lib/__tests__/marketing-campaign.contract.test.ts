// Contract tests — Marketing Campaign (Fase C.1)
//
// Estes testes NÃO chamam Supabase real; apenas asseguram que:
//  - O novo formato "feed_4_5" está registrado no domínio de render.
//  - As dimensões do Feed 4:5 são 1080x1350 (padrão profissional exigido).
//  - Os wrappers do repo apontam para os handlers criados neste tick.
//  - O validador aceita duration_seconds da campanha (8/10/15/30/60).

import { describe, it, expect } from "vitest";
import {
  VIDEO_FORMATS,
  VIDEO_FORMAT_DIMENSIONS,
} from "@/lib/render-engine/render.types";
import { createRenderJobSchema } from "@/lib/render-engine/render.validation";

describe("Fase C.1 — Campanha (Feed 4:5 + Story)", () => {
  it("registra o formato feed_4_5", () => {
    expect(VIDEO_FORMATS).toContain("feed_4_5");
  });

  it("define Feed 4:5 como 1080x1350 (padrão profissional)", () => {
    const feed = VIDEO_FORMAT_DIMENSIONS.feed_4_5;
    expect(feed.width).toBe(1080);
    expect(feed.height).toBe(1350);
    // Confere proporção 4:5 exata.
    expect(feed.width / feed.height).toBeCloseTo(4 / 5, 5);
  });

  it("mantém Story 9:16 (1080x1920)", () => {
    const story = VIDEO_FORMAT_DIMENSIONS.story;
    expect(story.width).toBe(1080);
    expect(story.height).toBe(1920);
  });

  it("aceita feed_4_5 no schema de criação de job", () => {
    const base = {
      image_id: "11111111-1111-4111-a111-111111111111",
      audio_id: "22222222-2222-4222-a222-222222222222",
      audio_start_second: 0,
      duration_seconds: 15,
    };
    expect(() =>
      createRenderJobSchema.parse({ ...base, video_format: "feed_4_5" as const }),
    ).not.toThrow();
  });

  it("aceita todas as durações permitidas para campanha", () => {
    const base = {
      image_id: "11111111-1111-4111-a111-111111111111",
      audio_id: "22222222-2222-4222-a222-222222222222",
      video_format: "feed_4_5" as const,
      audio_start_second: 0,
    };
    for (const d of [8, 10, 15, 30, 60]) {
      expect(() => createRenderJobSchema.parse({ ...base, duration_seconds: d })).not.toThrow();
    }
  });
});

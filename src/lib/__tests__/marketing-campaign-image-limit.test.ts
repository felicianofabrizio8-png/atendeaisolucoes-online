// Contract tests — Marketing Campaign (Fase C.2 · HOTFIX C.2.1)
//
// Garante que o schema de input do gerador de campanha respeita o limite
// de 8 imagens (MAX_CAMPAIGN_IMAGES) alinhado com backend/worker/UI,
// e rejeita entradas inválidas ANTES de qualquer chamada ao worker.
import { describe, it, expect } from "vitest";
import { GenerateCampaignInput } from "@/lib/marketing/marketing-campaign.functions";
import { MAX_CAMPAIGN_IMAGES } from "@/lib/render-engine/render.types";

const AUDIO_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

function media(i: number) {
  const hex = i.toString(16).padStart(2, "0");
  return {
    origin: "marketing" as const,
    media_id: `bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbb${hex}`,
  };
}

function baseInput(images: ReturnType<typeof media>[]) {
  return {
    images,
    primary_audio_id: AUDIO_ID,
    audio_start_second: 0,
    duration_seconds: 15,
    tone: "amigável" as const,
  };
}

describe("Fase C.2.1 — limite de imagens por campanha", () => {
  it("MAX_CAMPAIGN_IMAGES está fixado em 8", () => {
    expect(MAX_CAMPAIGN_IMAGES).toBe(8);
  });

  it("aceita 1 imagem", () => {
    expect(() =>
      GenerateCampaignInput.parse(baseInput([media(1)])),
    ).not.toThrow();
  });

  it("aceita exatamente 8 imagens", () => {
    const imgs = Array.from({ length: 8 }, (_, i) => media(i + 1));
    const parsed = GenerateCampaignInput.parse(baseInput(imgs));
    expect(parsed.images).toHaveLength(8);
    // Ordem preservada.
    expect(parsed.images!.map((x) => x.media_id)).toEqual(
      imgs.map((x) => x.media_id),
    );
  });

  it("rejeita 9 imagens", () => {
    const imgs = Array.from({ length: 9 }, (_, i) => media(i + 1));
    expect(() => GenerateCampaignInput.parse(baseInput(imgs))).toThrow();
  });

  it("rejeita array vazio (sem primary_image nem images)", () => {
    expect(() =>
      GenerateCampaignInput.parse({
        images: [],
        primary_audio_id: AUDIO_ID,
        audio_start_second: 0,
        duration_seconds: 15,
      }),
    ).toThrow();
  });

  it("aceita legado primary_image (1 imagem)", () => {
    expect(() =>
      GenerateCampaignInput.parse({
        primary_image: {
          origin: "marketing",
          media_id: "cccccccc-cccc-4ccc-cccc-cccccccccccc",
        },
        primary_audio_id: AUDIO_ID,
        audio_start_second: 0,
        duration_seconds: 15,
      }),
    ).not.toThrow();
  });
});

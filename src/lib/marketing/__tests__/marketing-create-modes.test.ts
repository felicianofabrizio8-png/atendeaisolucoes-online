import { describe, expect, it } from "vitest";
import { SimpleMarketingPostInputSchema } from "../marketing-ai.functions";

describe("Marketing IA simple media modes", () => {
  const mediaId = "11111111-1111-4111-8111-111111111111";

  it("accepts photo and uploaded video without audio or render fields", () => {
    expect(SimpleMarketingPostInputSchema.parse({
      media_mode: "photo",
      media_ids: [mediaId],
    })).toMatchObject({ media_mode: "photo", media_ids: [mediaId], campaign_formats: "feed_story" });
    expect(SimpleMarketingPostInputSchema.parse({
      media_mode: "uploaded_video",
      media_ids: [mediaId],
    })).toMatchObject({ media_mode: "uploaded_video", media_ids: [mediaId] });
  });

  it("rejects generated video from the simple contract", () => {
    expect(() => SimpleMarketingPostInputSchema.parse({
      media_mode: "generated_video",
      media_ids: [mediaId],
    })).toThrow();
  });

  it("requires exactly one selected asset", () => {
    expect(() => SimpleMarketingPostInputSchema.parse({
      media_mode: "photo",
      media_ids: [],
    })).toThrow();
    expect(() => SimpleMarketingPostInputSchema.parse({
      media_mode: "photo",
      media_ids: [mediaId, "22222222-2222-4222-8222-222222222222"],
    })).toThrow();
  });
});
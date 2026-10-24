import { describe, expect, it } from "vitest";
import { campaignCreativeOpenAiEnabled } from "@/routes/api.ai.campaign-creative";

describe("campaign creative text OpenAI rollout", () => {
  it("fica desligado por padrão e exige opt-in explícito", () => {
    expect(campaignCreativeOpenAiEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(campaignCreativeOpenAiEnabled({ CAMPAIGN_CREATIVE_OPENAI_RESPONSES: "enabled" } as NodeJS.ProcessEnv)).toBe(true);
  });
});

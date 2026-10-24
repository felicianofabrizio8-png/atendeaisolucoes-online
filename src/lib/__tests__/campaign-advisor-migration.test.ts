import { describe, expect, it } from "vitest";
import { campaignAdvisorOpenAiEnabled } from "@/routes/api.ai.campaign-advisor";

describe("campaign advisor OpenAI rollout", () => {
  it("fica desligado por padrão e só aceita o opt-in explícito", () => {
    expect(campaignAdvisorOpenAiEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(campaignAdvisorOpenAiEnabled({ CAMPAIGN_ADVISOR_OPENAI_RESPONSES: "enabled" } as NodeJS.ProcessEnv)).toBe(true);
  });
});

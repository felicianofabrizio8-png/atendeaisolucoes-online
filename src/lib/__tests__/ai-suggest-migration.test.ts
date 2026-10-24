import { describe, expect, it } from "vitest";
import { suggestOpenAiEnabled } from "@/routes/api.ai.suggest";

describe("AI suggest OpenAI rollout", () => {
  it("fica desligado por padrão e exige opt-in explícito", () => {
    expect(suggestOpenAiEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(suggestOpenAiEnabled({ SUGGEST_OPENAI_RESPONSES: "enabled" } as NodeJS.ProcessEnv)).toBe(true);
  });
});

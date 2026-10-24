import { describe, expect, it } from "vitest";
import { suggestProductOpenAiEnabled } from "@/routes/api.ai.suggest-product";

describe("suggest product OpenAI rollout", () => {
  it("fica desligado por padrão e exige opt-in explícito", () => {
    expect(suggestProductOpenAiEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(suggestProductOpenAiEnabled({ SUGGEST_PRODUCT_OPENAI_RESPONSES: "enabled" } as NodeJS.ProcessEnv)).toBe(true);
  });
});

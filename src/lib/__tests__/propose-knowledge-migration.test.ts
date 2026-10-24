import { describe, expect, it } from "vitest";
import { proposeKnowledgeOpenAiEnabled } from "@/routes/api.ai.propose-knowledge";

describe("propose knowledge OpenAI rollout", () => {
  it("exige opt-in explícito e permanece desligado por padrão", () => {
    expect(proposeKnowledgeOpenAiEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(proposeKnowledgeOpenAiEnabled({ PROPOSE_KNOWLEDGE_OPENAI_RESPONSES: "enabled" } as NodeJS.ProcessEnv)).toBe(true);
  });
});

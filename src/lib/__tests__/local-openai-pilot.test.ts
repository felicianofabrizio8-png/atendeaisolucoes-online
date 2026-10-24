import { describe, expect, it } from "vitest";
import { isLocalOpenAiPilotCompanyEnabled } from "@/lib/ai-platform/local-pilot.server";

describe("guard do piloto OpenAI local", () => {
  it("exige ativação explícita e empresa exata", () => {
    const env = { OPENAI_LOCAL_PILOT_ENABLED: "enabled", OPENAI_LOCAL_PILOT_COMPANY_ID: "pilot-company" } as NodeJS.ProcessEnv;
    expect(isLocalOpenAiPilotCompanyEnabled("pilot-company", env)).toBe(true);
    expect(isLocalOpenAiPilotCompanyEnabled("other-company", env)).toBe(false);
    expect(isLocalOpenAiPilotCompanyEnabled("pilot-company", {} as NodeJS.ProcessEnv)).toBe(false);
  });
});

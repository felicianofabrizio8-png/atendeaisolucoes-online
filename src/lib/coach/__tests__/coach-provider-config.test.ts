import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  fileURLToPath(new URL("../../../routes/api.coach.suggest.tsx", import.meta.url)),
  "utf8",
);

describe("Coach LLM provider configuration", () => {
  it("usa a integração OpenAI-compatible já configurada para o Sales Agent", () => {
    expect(routeSource).toContain("resolveSalesAgentLlmConfig()");
    expect(routeSource).toContain("fetch(endpoint");
    expect(routeSource).toContain("model,");
  });

  it("não depende do gateway, chave ou modelo Gemini/Lovable", () => {
    expect(routeSource).not.toMatch(/LOVABLE_API_KEY|ai\.gateway\.lovable\.dev|gemini/i);
  });

  it("não envia reasoning_effort no payload do Coach", () => {
    expect(routeSource).not.toContain("reasoning_effort");
  });
});

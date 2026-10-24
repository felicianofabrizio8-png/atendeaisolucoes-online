import { describe, expect, it } from "vitest";
import {
  creativeGeneratorOpenAiEnabled,
  findUnsupportedCommercialClaim,
} from "@/routes/api.ai.creative-generator";

const baseConfig = {
  goal: "gerar leads",
  style: "consultivo",
  audience: "famílias",
  preserve_product: true,
};

describe("creative generator text OpenAI rollout", () => {
  it("fica desligado por padrão e exige opt-in explícito", () => {
    expect(creativeGeneratorOpenAiEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(creativeGeneratorOpenAiEnabled({ CREATIVE_GENERATOR_OPENAI_RESPONSES: "enabled" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("bloqueia afirmações comerciais sem fato autorizado", () => {
    expect(findUnsupportedCommercialClaim("Aproveite as últimas unidades em estoque por R$ 99.", baseConfig)).toBeTruthy();
    expect(findUnsupportedCommercialClaim("Você gostaria de saber o preço e se há estoque?", baseConfig)).toBeNull();
    expect(findUnsupportedCommercialClaim("Produto por R$ 99.", { ...baseConfig, price: "R$ 99" })).toBeNull();
    expect(findUnsupportedCommercialClaim("Produto por R$ 89.", { ...baseConfig, price: "R$ 99" })).toBe("valor diferente do autorizado");
  });

  it("permite perguntas legítimas sobre promoção e disponibilidade", () => {
    expect(findUnsupportedCommercialClaim("Tem promoção vigente?", baseConfig)).toBeNull();
    expect(findUnsupportedCommercialClaim("O produto está disponível?", baseConfig)).toBeNull();
  });
});

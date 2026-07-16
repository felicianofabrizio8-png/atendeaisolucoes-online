// Guarda: agendamento para Instagram exige mídia associada.
// Testa a regra pura (sem IO), replicando a validação aplicada em
// scheduleMarketingContent (marketing.functions.ts).

import { describe, it, expect } from "vitest";

type Channel = "instagram" | "facebook" | "whatsapp";

function assertScheduleAllowed(channel: Channel, mediaIds: string[]): void {
  if (channel === "instagram" && mediaIds.length === 0) {
    throw new Error(
      "Selecione ao menos uma imagem ou vídeo antes de agendar para o Instagram.",
    );
  }
}

describe("scheduleMarketingContent — media guard", () => {
  it("bloqueia agendamento Instagram sem mídia", () => {
    expect(() => assertScheduleAllowed("instagram", [])).toThrow(
      /Selecione ao menos uma imagem ou vídeo/i,
    );
  });

  it("permite Instagram com ao menos uma mídia", () => {
    expect(() => assertScheduleAllowed("instagram", ["media-1"])).not.toThrow();
  });

  it("permite WhatsApp CTA sem mídia", () => {
    expect(() => assertScheduleAllowed("whatsapp", [])).not.toThrow();
  });

  it("permite Facebook sem mídia (fora do escopo desta regra)", () => {
    expect(() => assertScheduleAllowed("facebook", [])).not.toThrow();
  });
});

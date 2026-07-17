// Guarda: agendamento para Instagram exige mídia associada.
// Mídia válida = marketing_media (media_ids) OU imagem de produto reutilizada
// via ai_prompt.product_media_refs. Testa a regra pura (sem IO), replicando a
// validação aplicada em scheduleMarketingContent (marketing.functions.ts).

import { describe, it, expect } from "vitest";

type Channel = "instagram" | "facebook" | "whatsapp";

function assertScheduleAllowed(
  channel: Channel,
  mediaIds: string[],
  productRefs: Array<{ product_id: string; image_path: string }> = [],
): void {
  if (channel === "instagram" && mediaIds.length === 0 && productRefs.length === 0) {
    throw new Error(
      "Selecione ao menos uma imagem ou vídeo (biblioteca ou produto) antes de agendar para o Instagram.",
    );
  }
}

describe("scheduleMarketingContent — media guard", () => {
  it("bloqueia Instagram sem nenhuma mídia (marketing ou produto)", () => {
    expect(() => assertScheduleAllowed("instagram", [])).toThrow(
      /Selecione ao menos uma imagem ou vídeo/i,
    );
  });

  it("permite Instagram com marketing_media", () => {
    expect(() => assertScheduleAllowed("instagram", ["media-1"])).not.toThrow();
  });

  it("permite Instagram apenas com product_media_refs (sem duplicar arquivo)", () => {
    expect(() =>
      assertScheduleAllowed("instagram", [], [{ product_id: "p1", image_path: "c/p1/a.jpg" }]),
    ).not.toThrow();
  });

  it("permite WhatsApp CTA sem mídia", () => {
    expect(() => assertScheduleAllowed("whatsapp", [])).not.toThrow();
  });

  it("permite Facebook sem mídia (fora do escopo desta regra)", () => {
    expect(() => assertScheduleAllowed("facebook", [])).not.toThrow();
  });
});

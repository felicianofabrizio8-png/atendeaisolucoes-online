// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MarketingKnowledgeBase } from "@/components/marketing/MarketingKnowledgeBase";

const api = vi.hoisted(() => ({
  getMarketingKnowledgeBase: vi.fn(),
  upsertMarketingKnowledgeBase: vi.fn(),
}));
vi.mock("@/lib/marketing/knowledge-base.functions", () => api);
afterEach(cleanup);

describe("Brand notebook", () => {
  it("preserves values across sections and saves every field with the existing contract", async () => {
    api.getMarketingKnowledgeBase.mockResolvedValue({
      kb: {
        brand_identity: "Marca existente",
        commercial_terms: "Entrega local",
        updated_at: null,
      },
    });
    api.upsertMarketingKnowledgeBase.mockResolvedValue({
      kb: { updated_at: "2026-10-14T12:00:00Z" },
    });
    render(<MarketingKnowledgeBase companyId="test" />);
    const identity = await screen.findByLabelText("Identidade da marca");
    fireEvent.change(identity, { target: { value: "Nossa identidade" } });
    fireEvent.click(screen.getByRole("button", { name: /Voz/ }));
    fireEvent.change(screen.getByLabelText("Tom de comunicação"), {
      target: { value: "Acolhedor" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Negócio/ }));
    expect((screen.getByLabelText("Condições comerciais") as HTMLTextAreaElement).value).toBe(
      "Entrega local",
    );
    fireEvent.click(screen.getByRole("button", { name: /Essência/ }));
    expect((screen.getByLabelText("Identidade da marca") as HTMLTextAreaElement).value).toBe(
      "Nossa identidade",
    );
    expect(api.upsertMarketingKnowledgeBase).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Salvar base de conhecimento" }));
    await waitFor(() =>
      expect(api.upsertMarketingKnowledgeBase).toHaveBeenCalledWith({
        data: expect.objectContaining({
          brand_identity: "Nossa identidade",
          tone_of_voice: "Acolhedor",
          commercial_terms: "Entrega local",
          extra_notes: "",
        }),
      }),
    );
    expect(Object.keys(api.upsertMarketingKnowledgeBase.mock.calls[0][0].data)).toHaveLength(13);
  });
});

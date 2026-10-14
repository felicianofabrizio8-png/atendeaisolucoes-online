// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MarketingCampaignGenerator } from "@/components/marketing/campaign/MarketingCampaignGenerator";

const api = vi.hoisted(() => ({
  apiListPromotions: vi.fn(),
  apiGenerateCampaign: vi.fn(),
  apiGenerateManualCampaign: vi.fn(),
  apiRetryCampaignRender: vi.fn(),
  urlForMarketingPath: vi.fn(),
}));
vi.mock("@/data/marketingRepo", () => api);
vi.mock("@/lib/storage", () => ({ getSignedImageUrl: vi.fn() }));
vi.mock("@/lib/marketing/useCampaignRenderTracker", () => ({
  useCampaignRenderTracker: () => ({ trackCampaign: vi.fn() }),
  useTrackedCampaign: () => null,
}));
vi.mock("@/components/marketing/MarketingLibrary", () => ({
  MarketingLibrary: ({ onToggleSelect }: { onToggleSelect: (value: unknown) => void }) => (
    <button
      onClick={() => onToggleSelect({ origin: "marketing", id: "photo", storagePath: "photo.jpg" })}
    >
      Escolher foto de teste
    </button>
  ),
}));
vi.mock("@/components/marketing/campaign/CampaignAudioPicker", () => ({
  CampaignAudioPicker: ({ onSelect }: { onSelect: (value: unknown) => void }) => (
    <button onClick={() => onSelect({ id: "track", duration_seconds: 60 })}>
      Escolher trilha de teste
    </button>
  ),
}));
vi.mock("@/components/marketing/campaign/CampaignFramingPreview", () => ({
  CampaignFramingPreview: () => null,
}));
vi.mock("@/components/marketing/campaign/CampaignImageList", () => ({
  CampaignImageList: () => null,
}));
vi.mock("@/components/marketing/campaign/FocalPointEditor", () => ({
  FocalPointEditor: () => null,
}));
vi.mock("@/components/marketing/campaign/CampaignRenderProgress", () => ({
  CampaignRenderProgress: () => null,
}));
vi.mock("@/components/marketing/campaign/editor/CampaignVideoEditor", () => ({
  CampaignVideoEditor: () => <p>Revisar campanha</p>,
}));
vi.mock("@/components/marketing/campaign/CampaignManualForm", () => ({
  CampaignManualForm: () => <p>Textos manuais</p>,
}));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  api.apiListPromotions.mockResolvedValue([]);
  api.urlForMarketingPath.mockResolvedValue("https://example.test/photo.jpg");
  api.apiGenerateCampaign.mockResolvedValue({ campaign_id: "campaign", contents: [] });
});

describe("Guided marketing creation", () => {
  it("keeps message fields when moving back and prevents continuing without an image", () => {
    render(<MarketingCampaignGenerator companyId="test" />);
    fireEvent.change(screen.getByLabelText("Para quem é essa mensagem?"), {
      target: { value: "Famílias da região" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continuar →" }));
    expect(
      (screen.getByRole("button", { name: "Continuar →" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Gerar campanha" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "← Voltar" }));
    expect((screen.getByLabelText("Para quem é essa mensagem?") as HTMLInputElement).value).toBe(
      "Famílias da região",
    );
    expect(api.apiGenerateCampaign).not.toHaveBeenCalled();
  });

  it("keeps selected formats and sends the existing payload only after the final action", async () => {
    render(<MarketingCampaignGenerator companyId="test" />);
    fireEvent.change(screen.getByLabelText("Para quem é essa mensagem?"), {
      target: { value: "Novos clientes" },
    });
    fireEvent.change(screen.getByLabelText("Formato da campanha"), { target: { value: "story" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar →" }));
    fireEvent.click(screen.getByRole("button", { name: "Escolher foto de teste" }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar →" }));
    expect(
      (screen.getByRole("button", { name: "Gerar campanha" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Escolher trilha de teste" }));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Gerar campanha" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(api.apiGenerateCampaign).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Gerar campanha" }));
    await waitFor(() => expect(api.apiGenerateCampaign).toHaveBeenCalledTimes(1));
    expect(api.apiGenerateCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: "Novos clientes",
        formats: "story",
        primary_audio_id: "track",
        images: [{ origin: "marketing", media_id: "photo", focal_point: null }],
      }),
    );
  });
});

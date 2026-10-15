// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MarketingDashboard } from "@/components/marketing/MarketingDashboard";

const api = vi.hoisted(() => ({
  apiListMedia: vi.fn(),
  apiListPromotions: vi.fn(),
  apiListPublishContents: vi.fn(),
  apiListPublishSchedule: vi.fn(),
}));
vi.mock("@/data/marketingRepo", () => api);
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  api.apiListMedia.mockResolvedValue([]);
  api.apiListPromotions.mockResolvedValue([]);
  api.apiListPublishContents.mockResolvedValue([]);
  api.apiListPublishSchedule.mockResolvedValue([]);
});

describe("Marketing overview", () => {
  it("sends a new account to the media library and keeps creation accessible", async () => {
    const navigate = vi.fn();
    render(<MarketingDashboard companyId="test" onNavigate={navigate} />);
    fireEvent.click(await screen.findByRole("button", { name: "Adicionar mídias" }));
    expect(navigate).toHaveBeenLastCalledWith("library");
    fireEvent.click(screen.getByRole("button", { name: "Criar com Lume" }));
    expect(navigate).toHaveBeenLastCalledWith("generator");
  });

  it("prioritizes pending review and shows only future active schedule entries in order", async () => {
    const rows = ["late", "early", "past", "cancelled"].map((id) => ({
      id,
      title: `Campanha ${id}`,
      status: id === "early" ? "pending" : "approved",
      format: "feed",
    }));
    api.apiListPublishContents.mockResolvedValue(rows);
    api.apiListPublishSchedule.mockResolvedValue([
      {
        id: "1",
        content_id: "late",
        channel: "instagram",
        status: "planned",
        scheduled_at: "2099-11-20T12:00:00Z",
      },
      {
        id: "2",
        content_id: "early",
        channel: "facebook",
        status: "queued",
        scheduled_at: "2099-11-19T12:00:00Z",
      },
      {
        id: "3",
        content_id: "past",
        channel: "instagram",
        status: "planned",
        scheduled_at: "2000-01-01T12:00:00Z",
      },
      {
        id: "4",
        content_id: "cancelled",
        channel: "instagram",
        status: "cancelled",
        scheduled_at: "2099-11-18T12:00:00Z",
      },
    ]);
    const navigate = vi.fn();
    render(<MarketingDashboard companyId="test" onNavigate={navigate} />);
    fireEvent.click(await screen.findByRole("button", { name: "Revisar conteúdos" }));
    expect(navigate).toHaveBeenCalledWith("approvals");
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("Campanha early");
    expect(items[1].textContent).toContain("Campanha late");
    expect(screen.queryByText("Campanha past")).toBeNull();
    expect(screen.queryByText("Campanha cancelled")).toBeNull();
  });

  it("does not present failed requests as zero data and allows retry", async () => {
    api.apiListMedia.mockRejectedValueOnce(new Error("offline"));
    render(<MarketingDashboard companyId="test" onNavigate={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Nenhum valor foi estimado");
    expect(screen.getByRole("button", { name: /Seu acervo/ }).textContent).toContain("—");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await screen.findByRole("button", { name: "Adicionar mídias" });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

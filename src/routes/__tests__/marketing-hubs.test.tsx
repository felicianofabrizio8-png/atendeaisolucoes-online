// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/data/marketingRepo", () => ({
  apiListPublishContents: vi.fn(async () => [
    { id: "1", status: "draft" },
    { id: "2", status: "pending" },
    { id: "3", status: "rejected" },
    { id: "4", status: "approved" },
  ]),
  apiListPublishSchedule: vi.fn(async () => [{ id: "s1", status: "planned" }, { id: "s2", status: "published" }]),
  apiPreviewMarketingCleanup: vi.fn(async () => ({ eligibleCount: 2, protectedCount: 1, protectedByReason: { schedule: 0, publication: 0, alreadyHidden: 0 }, activeScheduleCount: 1, linkedCampaignCount: 1, campaignStatusCounts: { active: 1 }, campaignQueryError: null, ignoredStatusCount: 3, scannedCount: 6, truncated: false, ids: ["c1", "c2"] })),
  apiArchiveMarketingCleanup: vi.fn(async () => ({ archived: 2 })),
}));
vi.mock("@/lib/marketing-publisher/publisher.functions", () => ({
  getPublisherStats: vi.fn(async () => ({ published: 7, failed: 2 })),
}));
vi.mock("@/components/marketing/MarketingApprovals", () => ({
  MarketingApprovals: ({ forcedFilter }: { forcedFilter?: string }) => <div>tela:aprovacao:{forcedFilter}</div>,
}));
vi.mock("@/components/marketing/MarketingSchedule", () => ({ MarketingSchedule: () => <div>tela:agendadas</div> }));
vi.mock("@/components/marketing/MarketingPublisherDashboard", () => ({
  MarketingPublisherDashboard: ({ view }: { view?: string }) => <div>tela:publicador:{view}</div>,
}));
vi.mock("@/components/marketing/MarketingLibrary", () => ({
  MarketingLibrary: ({ mediaKind, onUse }: { mediaKind?: string; onUse?: (s: unknown) => void }) => (
    <>
      {`tela:midias:${mediaKind}`}
      <button onClick={() => onUse?.({ origin: "marketing", id: "m1" })}>usar mídia</button>
    </>
  ),
}));
vi.mock("@/components/marketing/AudioLibrary", () => ({ AudioLibrary: () => <div>tela:musicas</div> }));
vi.mock("@/components/marketing/video-render/VideoLibraryGrid", () => ({ VideoLibraryGrid: () => <div>tela:videos-criados</div> }));

import { MarketingPublishHub } from "@/components/marketing/MarketingPublishHub";
import { apiArchiveMarketingCleanup } from "@/data/marketingRepo";
import { MarketingLibraryHub } from "@/components/marketing/MarketingLibraryHub";

afterEach(cleanup);

async function screensByChip(groupName: string) {
  const user = userEvent.setup();
  const seen: Array<[string, string]> = [];
  const group = screen.getByRole("group", { name: groupName });
  for (const chip of within(group).getAllByRole("button")) {
    await user.click(chip);
    const active = screen.getAllByText(/^tela:/).find((node) => !node.closest("[hidden]"));
    seen.push([(chip.textContent ?? "").replace(/\d+$/, "").trim(), active?.textContent?.replace("usar mídia", "") ?? ""]);
  }
  return seen;
}

describe("hubs do Marketing IA", () => {
  it("Publicar: cada etapa abre a tela real correspondente", async () => {
    render(<MarketingPublishHub companyId="c1" />);
    expect(screen.getByText("tela:aprovacao:review")).toBeTruthy();
    expect(await screensByChip("Etapa da publicação")).toEqual([
      ["Para revisar", "tela:aprovacao:review"],
      ["Aprovadas", "tela:aprovacao:approved"],
      ["Agendadas", "tela:agendadas"],
      ["Publicadas", "tela:publicador:published"],
      ["Com problema", "tela:publicador:problems"],
    ]);
  });

  it("Publicar: os contadores vêm dos dados reais", async () => {
    render(<MarketingPublishHub companyId="c1" />);
    const group = screen.getByRole("group", { name: "Etapa da publicação" });
    const text = async (label: string) => (await within(group).findByRole("button", { name: new RegExp(`^${label}\\s*\\d+$`) })).textContent;
    expect(await text("Para revisar")).toBe("Para revisar3");
    expect(await text("Aprovadas")).toBe("Aprovadas1");
    expect(await text("Agendadas")).toBe("Agendadas1");
    expect(await text("Publicadas")).toBe("Publicadas7");
    expect(await text("Com problema")).toBe("Com problema2");
  });

  it("Publicar: prévia de limpeza não exclui antes da confirmação explícita", async () => {
    render(<MarketingPublishHub companyId="c1" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Ocultar publicações antigas" }));
    expect((await screen.findByRole("dialog")).textContent).toContain("Elegíveis: 2");
    expect(screen.getByRole("dialog").textContent).toContain("1 têm agendamento ativo");
    expect(vi.mocked(apiArchiveMarketingCleanup)).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Confirmar ocultação" }));
    await waitFor(() => expect(vi.mocked(apiArchiveMarketingCleanup)).toHaveBeenCalledTimes(1));
  });

  it("Publicar: abre na etapa pedida por quem chamou", () => {
    render(<MarketingPublishHub companyId="c1" view="problems" />);
    expect(screen.getByText("tela:publicador:problems")).toBeTruthy();
  });

  it("Acervo: fotos, vídeos, músicas e vídeos criados, cada um na sua tela", async () => {
    render(<MarketingLibraryHub companyId="c1" />);
    expect(screen.getByText("tela:midias:image")).toBeTruthy();
    const seen = await screensByChip("Tipo de mídia");
    expect(seen).toEqual([
      ["Fotos", "tela:midias:image"],
      ["Vídeos", "tela:midias:video"],
      ["Músicas", "tela:musicas"],
      ["Vídeos criados", "tela:videos-criados"],
    ]);
  });

  it("Acervo: trocar para Músicas não remove nós alterados por tradução automática", async () => {
    render(<MarketingLibraryHub companyId="c1" />);
    const root = screen.getByRole("group", { name: "Tipo de mídia" }).parentElement;
    if (!root) throw new Error("raiz do acervo ausente");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const original = Array.from({ length: 20 }, () => walker.nextNode()).find((node) => node?.textContent === "tela:midias:image");
    if (!(original instanceof Text) || !original.parentNode) throw new Error("texto de teste ausente");
    const translated = document.createElement("font");
    translated.textContent = original.textContent;
    original.parentNode.replaceChild(translated, original);

    await userEvent.setup().click(within(screen.getByRole("group", { name: "Tipo de mídia" })).getByRole("button", { name: "Músicas" }));
    expect(screen.getByText("tela:musicas")).toBeTruthy();
  });
  it("Acervo: tocar em uma mídia começa uma publicação com ela", async () => {
    const onUseMedia = vi.fn();
    render(<MarketingLibraryHub companyId="c1" onUseMedia={onUseMedia} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "usar mídia" }));
    expect(onUseMedia).toHaveBeenCalledWith({ origin: "marketing", id: "m1" });
  });
});

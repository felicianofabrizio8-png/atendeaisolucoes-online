// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/data/marketingRepo", () => ({
  apiListContents: vi.fn(async () => [
    { id: "1", status: "draft" },
    { id: "2", status: "pending" },
    { id: "3", status: "rejected" },
    { id: "4", status: "approved" },
  ]),
  apiListSchedule: vi.fn(async () => [{ id: "s1", status: "planned" }, { id: "s2", status: "published" }]),
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
    <div>
      <span>tela:midias:{mediaKind}</span>
      <button onClick={() => onUse?.({ origin: "marketing", id: "m1" })}>usar mídia</button>
    </div>
  ),
}));
vi.mock("@/components/marketing/AudioLibrary", () => ({ AudioLibrary: () => <div>tela:musicas</div> }));
vi.mock("@/components/marketing/video-render/VideoLibraryGrid", () => ({ VideoLibraryGrid: () => <div>tela:videos-criados</div> }));

import { MarketingPublishHub } from "@/components/marketing/MarketingPublishHub";
import { MarketingLibraryHub } from "@/components/marketing/MarketingLibraryHub";

afterEach(cleanup);

async function screensByChip(groupName: string) {
  const user = userEvent.setup();
  const seen: Array<[string, string]> = [];
  const group = screen.getByRole("group", { name: groupName });
  for (const chip of within(group).getAllByRole("button")) {
    await user.click(chip);
    seen.push([(chip.textContent ?? "").replace(/\d+$/, "").trim(), screen.getByText(/^tela:/).textContent ?? ""]);
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

  it("Acervo: tocar em uma mídia começa uma publicação com ela", async () => {
    const onUseMedia = vi.fn();
    render(<MarketingLibraryHub companyId="c1" onUseMedia={onUseMedia} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "usar mídia" }));
    expect(onUseMedia).toHaveBeenCalledWith({ origin: "marketing", id: "m1" });
  });
});

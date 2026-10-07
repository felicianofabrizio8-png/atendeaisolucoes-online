// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/components/marketing/MarketingApprovals", () => ({ MarketingApprovals: () => <div>tela:revisar</div> }));
vi.mock("@/components/marketing/MarketingSchedule", () => ({ MarketingSchedule: () => <div>tela:calendario</div> }));
vi.mock("@/components/marketing/MarketingPublisherDashboard", () => ({ MarketingPublisherDashboard: () => <div>tela:acompanhamento</div> }));
vi.mock("@/components/marketing/MarketingLibrary", () => ({ MarketingLibrary: () => <div>tela:midias</div> }));
vi.mock("@/components/marketing/AudioLibrary", () => ({ AudioLibrary: () => <div>tela:audios</div> }));
vi.mock("@/components/marketing/video-render/VideoLibraryGrid", () => ({ VideoLibraryGrid: () => <div>tela:gerados</div> }));

import { MarketingPublishHub } from "@/components/marketing/MarketingPublishHub";
import { MarketingLibraryHub } from "@/components/marketing/MarketingLibraryHub";

afterEach(cleanup);

async function screensByTab() {
  const user = userEvent.setup();
  const seen: Array<[string, string]> = [];
  for (const tab of screen.getAllByRole("tab")) {
    await user.click(tab);
    const shown = screen.getByText(/^tela:/).textContent ?? "";
    seen.push([tab.textContent?.trim() ?? "", shown]);
  }
  return seen;
}

describe("hubs do Marketing IA", () => {
  it("Publicar: cada aba abre uma tela diferente", async () => {
    render(<MarketingPublishHub companyId="c1" />);
    expect(screen.getByText("tela:revisar")).toBeTruthy();
    const seen = await screensByTab();
    expect(seen).toEqual([
      ["Para revisar", "tela:revisar"],
      ["Calendário", "tela:calendario"],
      ["Acompanhamento", "tela:acompanhamento"],
    ]);
  });

  it("Acervo: cada aba abre uma tela diferente", async () => {
    render(<MarketingLibraryHub companyId="c1" />);
    expect(screen.getByText("tela:midias")).toBeTruthy();
    const seen = await screensByTab();
    expect(seen).toEqual([
      ["Imagens e vídeos", "tela:midias"],
      ["Áudios", "tela:audios"],
      ["Vídeos gerados", "tela:gerados"],
    ]);
    expect(new Set(seen.map(([, shown]) => shown)).size).toBe(seen.length);
  });
});

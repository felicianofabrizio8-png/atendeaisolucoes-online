// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const kbFns = vi.hoisted(() => ({ getMarketingKnowledgeBase: vi.fn(), upsertMarketingKnowledgeBase: vi.fn() }));
vi.mock("@/lib/marketing/knowledge-base.functions", () => kbFns);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/marketing/MarketingDashboard", () => ({ MarketingDashboard: ({ onCreate }: { onCreate?: () => void }) => <div><span>tela:dashboard</span><button onClick={onCreate}>Criar conteúdo</button></div> }));
vi.mock("@/components/marketing/MarketingPromotions", () => ({ MarketingPromotions: () => <div>tela:promotions</div> }));
vi.mock("@/components/marketing/MarketingGenerator", () => ({ MarketingGenerator: ({ onGenerated }: { onGenerated?: () => void }) => <div><span>tela:generator</span><button onClick={onGenerated}>simular geração</button></div> }));
vi.mock("@/components/marketing/MarketingLibraryHub", () => ({ MarketingLibraryHub: () => <div>tela:acervo</div> }));
vi.mock("@/components/marketing/MarketingPublishHub", () => ({ MarketingPublishHub: () => <div>tela:publicar</div> }));

import { MarketingWorkspace } from "@/components/marketing/MarketingWorkspace";
import { MarketingKnowledgeBase } from "@/components/marketing/MarketingKnowledgeBase";
afterEach(cleanup);

describe("Marketing IA 2.0", () => {
  it("mostra as quatro áreas principais", () => {
    render(<MarketingWorkspace companyId="c1" />);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Início", "Criar", "Acervo", "Publicar"]);
    expect(screen.getByText("tela:dashboard")).toBeTruthy();
  });
  it("usa uma experiência composta para criar, acervo e publicar", async () => {
    const user = userEvent.setup();
    render(<MarketingWorkspace companyId="c1" />);
    await user.click(screen.getByRole("tab", { name: "Criar" }));
    expect(screen.getByText("tela:generator")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Acervo" }));
    expect(screen.getByText("tela:acervo")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Publicar" }));
    expect(screen.getByText("tela:publicar")).toBeTruthy();
  });
  it("após gerar, abre Publicar", async () => {
    const user = userEvent.setup();
    render(<MarketingWorkspace companyId="c1" />);
    await user.click(screen.getByRole("tab", { name: "Criar" }));
    await user.click(screen.getByRole("button", { name: "simular geração" }));
    expect(screen.getByText("tela:publicar")).toBeTruthy();
  });
});

describe("Base de Conhecimento", () => {
  const row = { id: "kb1", company_id: "c1", brand_identity: "Empresa", tone_of_voice: "", differentiators: "", products_services: "", guarantees: "", cities_served: "", gifts: "", commercial_terms: "", next_load_forecast: "", preferred_words: "", forbidden_words: "", copy_best_practices: "", extra_notes: "", updated_at: "2026-10-01T12:00:00Z", updated_by: null };
  beforeEach(() => { kbFns.getMarketingKnowledgeBase.mockReset().mockResolvedValue({ kb: row }); kbFns.upsertMarketingKnowledgeBase.mockReset().mockResolvedValue({ kb: row }); });
  it("continua usando a fonte compartilhada pelas IAs", async () => {
    render(<MarketingKnowledgeBase companyId="c1" />);
    expect(await screen.findByText("Base de conhecimento da empresa")).toBeTruthy();
    expect(screen.getByText("IAs de atendimento")).toBeTruthy();
    expect(screen.getByText("Marketing IA")).toBeTruthy();
    expect(kbFns.getMarketingKnowledgeBase).toHaveBeenCalledTimes(1);
  });
});
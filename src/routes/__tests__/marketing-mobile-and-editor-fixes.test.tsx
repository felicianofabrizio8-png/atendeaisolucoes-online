// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CampaignStickyActionBar } from "@/components/marketing/campaign/CampaignStickyActionBar";
import { LogoSlot } from "@/components/marketing/campaign/editor/LogoSlot";
import type { LogoLayout } from "@/lib/marketing/video-editor/layout.types";

const LOGO = { scale: 1, hAnchor: "left", vAnchor: "top", marginTop: 4, marginRight: 4, marginBottom: 4, marginLeft: 4 } as unknown as LogoLayout;

afterEach(cleanup);

describe("barra de ação da criação", () => {
  it("fica acima da navegação inferior no celular e no tablet, e volta ao canto no desktop", () => {
    render(
      <CampaignStickyActionBar>
        <button>Continuar</button>
      </CampaignStickyActionBar>,
    );
    const bar = screen.getByRole("region", { name: "Ações da campanha" });
    // Colada em bottom-0 ela ficaria sob a MobileBottomNav (fixa, mesma camada).
    expect(bar.className).not.toMatch(/(^|\s)bottom-0(\s|$)/);
    expect(bar.className).toContain("bottom-[calc(3.8125rem+env(safe-area-inset-bottom))]");
    expect(bar.className).toContain("md:bottom-[calc(4.8125rem+env(safe-area-inset-bottom))]");
    expect(bar.className).toContain("lg:bottom-6");
  });
});

describe("espaço da logo no editor", () => {
  it("sem ação de upload é só visual (miniaturas de template já são botões)", () => {
    const { container } = render(
      <button type="button">
        <LogoSlot logoUrl={null} layout={LOGO} />
      </button>,
    );
    expect(container.querySelectorAll("button button")).toHaveLength(0);
    expect(container.querySelector("input[type=file]")).toBeNull();
    expect(container.textContent).toContain("Logo");
  });

  it("com ação de upload continua clicável na prévia principal", () => {
    const { container } = render(<LogoSlot logoUrl={null} layout={LOGO} onUpload={vi.fn()} />);
    expect(screen.getByTitle("Sem logo cadastrada — clique para adicionar").tagName).toBe("BUTTON");
    expect(container.querySelector("input[type=file]")).not.toBeNull();
  });
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { closeSettings, openSettings, useSettingsDialog } from "@/lib/settings-dialog";
import { LazySettingsDialog } from "@/components/settings/LazySettingsDialog";

// O diálogo real puxa Supabase, integrações etc.; aqui só importa o contrato:
// o wrapper monta o diálogo quando abre e o mantém montado depois.
const renders = vi.fn();
vi.mock("@/components/settings/SettingsDialog", () => ({
  SettingsDialog: () => {
    renders();
    const { open, tab } = useSettingsDialog();
    return open ? <div role="dialog">Configurações · {tab}</div> : <span data-testid="closed" />;
  },
}));

describe("LazySettingsDialog", () => {
  it("só monta as configurações ao abrir e as mantém montadas ao fechar", async () => {
    render(<LazySettingsDialog />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(renders).not.toHaveBeenCalled();

    act(() => openSettings("conexoes"));
    expect(await screen.findByRole("dialog")).toHaveTextContent("conexoes");

    act(() => closeSettings());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("closed")).toBeInTheDocument();

    act(() => openSettings("perfil"));
    expect(await screen.findByRole("dialog")).toHaveTextContent("perfil");
  });
});

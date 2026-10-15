// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CampaignManualForm } from "@/components/marketing/campaign/CampaignManualForm";

afterEach(cleanup);
it("keeps optional contact details and the chosen format in the manual submission", () => {
  const submit = vi.fn();
  render(<CampaignManualForm onSubmit={submit} />);
  fireEvent.change(screen.getByLabelText("Título *"), { target: { value: "Oferta de verão" } });
  fireEvent.click(screen.getByText("Contatos e redes sociais (opcional)"));
  fireEvent.change(screen.getByLabelText("WhatsApp"), { target: { value: "11999999999" } });
  fireEvent.click(screen.getByText("Contatos e redes sociais (opcional)"));
  fireEvent.change(screen.getByLabelText("Formato da campanha"), { target: { value: "story" } });
  fireEvent.click(screen.getByRole("button", { name: "Criar campanha manualmente" }));
  expect(submit).toHaveBeenCalledWith(
    expect.objectContaining({
      formats: "story",
      fields: expect.objectContaining({ title: "Oferta de verão", whatsapp: "11999999999" }),
    }),
  );
});

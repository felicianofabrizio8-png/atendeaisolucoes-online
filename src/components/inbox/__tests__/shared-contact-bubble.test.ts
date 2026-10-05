// @vitest-environment jsdom

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Message } from "@/data/mock";
import { MessageBubble } from "@/components/inbox/message/MessageBubble";

afterEach(cleanup);

const anaContact = {
  name: { formatted_name: "Ana Souza", first_name: "Ana" },
  phones: [{ phone: "+55 11 98765-4321", type: "CELL", wa_id: "5511987654321" }],
};

function contactsMessage(text: string, raw: Record<string, unknown> | undefined): Message {
  return {
    id: "msg-1",
    conversationId: "conv-1",
    role: "lead",
    text,
    at: new Date().toISOString(),
    sourceSubtype: "contacts",
    sourceMetadata: raw ? { wa_id: "5511900000000", raw } : { wa_id: "5511900000000" },
  } as Message;
}

function renderBubble(m: Message) {
  return render(
    React.createElement(MessageBubble, { m, canManage: false, appearance: "atendimento" }),
  );
}

describe("MessageBubble — contato compartilhado (Atendimento 2.0)", () => {
  it.each([
    ["meta-webhook legado", "[contacts]"],
    ["rota do webhook", "👤 Contato"],
    ["texto novo", "👤 Contato: Ana Souza · +55 11 98765-4321"],
  ])("mostra nome, telefone e ações a partir de raw.contacts (%s)", (_label, text) => {
    renderBubble(contactsMessage(text, { type: "contacts", contacts: [anaContact] }));
    expect(screen.getByText("Ana Souza")).toBeTruthy();
    expect(screen.getByText("+55 11 98765-4321")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Copiar telefone/ })).toBeTruthy();
    const link = screen.getByRole("link", { name: /Abrir no WhatsApp/ });
    expect(link.getAttribute("href")).toBe("https://wa.me/5511987654321");
  });

  it("copia o telefone", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderBubble(contactsMessage("[contacts]", { type: "contacts", contacts: [anaContact] }));
    fireEvent.click(screen.getByRole("button", { name: /Copiar telefone/ }));
    expect(writeText).toHaveBeenCalledWith("+55 11 98765-4321");
  });

  it("não oferece link do WhatsApp para número sem DDI confiável", () => {
    renderBubble(
      contactsMessage("[contacts]", {
        type: "contacts",
        contacts: [{ name: { formatted_name: "Ana" }, phones: [{ phone: "(11) 98765-4321" }] }],
      }),
    );
    expect(screen.getByRole("button", { name: /Copiar telefone/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Abrir no WhatsApp/ })).toBeNull();
  });

  it("mantém o fallback 👤 Contato quando não há dados recuperáveis", () => {
    const { container } = renderBubble(contactsMessage("[contacts]", undefined));
    expect(container.querySelector("[data-shared-contact]")).toBeNull();
    expect(container.querySelector('[data-unsupported-type="contacts"]')).toBeTruthy();
  });
});

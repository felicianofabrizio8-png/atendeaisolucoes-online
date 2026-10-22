// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Conversation, Lead, Message } from "@/data/mock";
import type { AtendimentoContact } from "@/hooks/useAtendimentoData";
import { computeAttention } from "@/lib/atendimento/attention";

vi.mock("@/components/team/ConversationOwner", () => ({ OwnerBadge: () => null }));

import { ConversationRail } from "@/components/atendimento/ConversationRail";

afterEach(cleanup);

const now = Date.now();
const at = (h: number) => new Date(now - h * 3_600_000).toISOString();

function contact(id: string, name: string, conversation: Partial<Conversation>, inboundH: number) {
  const lead: Lead = {
    id: `l-${id}`,
    name,
    channel: "whatsapp",
    status: "morno",
    tags: [],
    createdAt: at(300),
  };
  const messages: Message[] = [
    { id: `m-${id}`, conversationId: id, role: "lead", text: `msg ${name}`, at: at(inboundH) },
  ];
  return {
    lead,
    conversation: {
      id,
      leadId: lead.id,
      channel: "whatsapp",
      lastMessageAt: at(inboundH),
      unread: 1,
      awaitingReply: false,
      slaBreached: false,
      ...conversation,
    },
    messages,
    history: { totalPurchases: 0, totalSpent: 0, firstPurchaseAt: null, lastPurchaseAt: null },
    hue: 280,
  } as unknown as AtendimentoContact;
}

describe("fila do Chat — sinais e ordenação", () => {
  it("mostra espera e janela na linha e troca a ordenação", () => {
    const contacts = [
      contact("a", "Ana Espera", { awaitingReply: true }, 22),
      contact("b", "Bruno Tranquilo", {}, 1),
    ];
    const attention = new Map(
      contacts.map((c) => [c.conversation.id, computeAttention(c, now)] as const),
    );
    const onSortChange = vi.fn();
    render(
      <ConversationRail
        contacts={contacts}
        selectedId="a"
        onSelect={() => undefined}
        query=""
        onQueryChange={() => undefined}
        activeFilterLabel={null}
        onClearFilter={() => undefined}
        attention={attention}
        sort="recentes"
        onSortChange={onSortChange}
      />,
    );

    expect(screen.getByText("aguarda 22h 0m")).toBeInTheDocument();
    expect(screen.getByText(/janela fecha em/)).toBeInTheDocument();
    // "fora da janela" não aparece na fila: valeria para quase toda conversa antiga.
    expect(screen.queryByText("fora da janela")).toBeNull();

    expect(screen.getByRole("radio", { name: "Recentes" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "Prioridade" }));
    expect(onSortChange).toHaveBeenCalledWith("prioridade");
  });
});

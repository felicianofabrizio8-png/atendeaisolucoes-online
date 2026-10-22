import { describe, expect, it } from "vitest";
import type { Conversation, Lead, Message } from "@/data/mock";
import type { FollowupCycleView } from "@/lib/atendimento/followup-view";
import {
  computeAttention,
  sortByAttention,
  type AttentionSubject,
} from "@/lib/atendimento/attention";

const NOW = Date.parse("2026-10-18T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

function subject(
  id: string,
  {
    lead = {},
    conversation = {},
    inboundHoursAgo = 1,
    followup,
  }: {
    lead?: Partial<Lead>;
    conversation?: Partial<Conversation>;
    inboundHoursAgo?: number | null;
    followup?: Partial<FollowupCycleView>;
  } = {},
): AttentionSubject {
  const messages: Message[] =
    inboundHoursAgo === null
      ? []
      : [
          {
            id: `m-${id}`,
            conversationId: id,
            role: "lead",
            text: "oi",
            at: hoursAgo(inboundHoursAgo),
          },
        ];
  return {
    lead: {
      id: `l-${id}`,
      name: id,
      channel: "whatsapp",
      status: "morno",
      tags: [],
      createdAt: hoursAgo(200),
      ...lead,
    },
    conversation: {
      id,
      leadId: `l-${id}`,
      channel: "whatsapp",
      lastMessageAt: hoursAgo(inboundHoursAgo ?? 30),
      unread: 0,
      awaitingReply: false,
      slaBreached: false,
      ...conversation,
    },
    messages,
    followup: followup as FollowupCycleView | undefined,
  };
}

describe("atenção da fila do Chat", () => {
  it("aponta espera, janela fechando e quente sem inventar sinais", () => {
    const waiting = computeAttention(
      subject("a", {
        inboundHoursAgo: 22,
        conversation: { awaitingReply: true, slaBreached: true, leadTemperature: "quente" },
      }),
      NOW,
    );
    expect(waiting.waitingMs).toBe(22 * 3_600_000);
    expect(waiting.window).toBe("closing_soon");
    expect(waiting.signals.map((s) => s.key)).toEqual(["waiting", "window", "hot"]);
    expect(waiting.signals[0]).toMatchObject({ label: "aguarda 22h 0m", tone: "urgent" });
    expect(waiting.signals[1].label).toBe("janela fecha em 2h 0m");

    const calm = computeAttention(subject("b", { inboundHoursAgo: 2 }), NOW);
    expect(calm.waitingMs).toBeNull();
    expect(calm.signals).toEqual([]);
  });

  it("conversa encerrada não pede atenção nem mostra espera", () => {
    const lost = computeAttention(
      subject("c", {
        inboundHoursAgo: 30,
        lead: { status: "perdido" },
        conversation: { awaitingReply: true, slaBreached: true },
      }),
      NOW,
    );
    expect(lost.waitingMs).toBeNull();
    expect(lost.signals).toEqual([]);
    expect(lost.score).toBeLessThan(1);
  });

  it("fora da janela vira aviso informativo, e outros canais não têm janela", () => {
    expect(computeAttention(subject("d", { inboundHoursAgo: 30 }), NOW).signals).toEqual([
      { key: "window", label: "fora da janela", tone: "info" },
    ]);
    const insta = computeAttention(
      subject("e", { lead: { channel: "instagram" }, conversation: { channel: "instagram" } }),
      NOW,
    );
    expect(insta.window).toBe("not_applicable");
    expect(insta.signals).toEqual([]);
  });

  it("ordena: SLA estourado > aguardando > follow-up vencido > quente > recente", () => {
    const list = [
      subject("recente", { inboundHoursAgo: 0.5 }),
      subject("quente", { inboundHoursAgo: 5, lead: { status: "quente" } }),
      subject("fup", { inboundHoursAgo: 6, followup: { bucket: "overdue" } }),
      subject("aguarda", { inboundHoursAgo: 1, conversation: { awaitingReply: true } }),
      subject("sla", {
        inboundHoursAgo: 0.2,
        conversation: { awaitingReply: true, slaBreached: true },
      }),
    ];
    expect(sortByAttention(list, NOW).map((s) => s.conversation.id)).toEqual([
      "sla",
      "aguarda",
      "fup",
      "quente",
      "recente",
    ]);
  });

  it("entre quem aguarda, quem espera há mais tempo vem primeiro", () => {
    const list = [
      subject("pouco", { inboundHoursAgo: 1, conversation: { awaitingReply: true } }),
      subject("muito", { inboundHoursAgo: 8, conversation: { awaitingReply: true } }),
    ];
    expect(sortByAttention(list, NOW).map((s) => s.conversation.id)).toEqual(["muito", "pouco"]);
  });
});

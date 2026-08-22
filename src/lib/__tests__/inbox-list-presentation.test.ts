import { describe, expect, it } from "vitest";
import {
  inboxMessagePreview,
  inboxPrimaryAction,
  matchesInboxSearch,
  sortInboxByRecentMessage,
} from "@/lib/inbox-list-presentation";

function item(id: string, lastMessageAt: string, role: "lead" | "agent" = "lead") {
  return {
    id,
    conv: { lastMessageAt, awaitingReply: role === "lead", unread: role === "lead" ? 2 : 0 },
    last: { role, text: `Mensagem ${id}` },
  };
}

describe("apresentação da lista da Caixa", () => {
  it("ordena pela mensagem mais recente, independentemente do score externo", () => {
    const older = item("antiga", "2026-08-22T12:00:00.000Z");
    const newer = item("nova", "2026-08-22T14:00:00.000Z");

    expect(sortInboxByRecentMessage([older, newer]).map((entry) => entry.id)).toEqual([
      "nova",
      "antiga",
    ]);
  });

  it("mantém preview do cliente sem prefixo e sinaliza resposta prioritária", () => {
    const message = { role: "lead", text: "Quero fechar hoje" };

    expect(inboxMessagePreview(message)).toBe("Quero fechar hoje");
    expect(inboxPrimaryAction(message, true, "Cobrar retorno do orçamento")).toBe(
      "Responder cliente",
    );
  });

  it("prefixa mensagem enviada pelo agente com Você:", () => {
    expect(inboxMessagePreview({ role: "agent", text: "Segue o orçamento" })).toBe(
      "Você: Segue o orçamento",
    );
  });

  it("preserva unread e awaitingReply no item ordenado", () => {
    const [result] = sortInboxByRecentMessage([item("cliente", "2026-08-22T14:00:00.000Z")]);

    expect(result.conv.unread).toBe(2);
    expect(result.conv.awaitingReply).toBe(true);
  });

  it("pesquisa nome, telefone, mensagem e ignora acentos", () => {
    const values = ["João da Silva", "+55 (11) 99999-0000", "Orçamento aprovado"];

    expect(matchesInboxSearch("joao", values)).toBe(true);
    expect(matchesInboxSearch("99990000", values)).toBe(true);
    expect(matchesInboxSearch("aprovado", values)).toBe(true);
    expect(matchesInboxSearch("inexistente", values)).toBe(false);
  });

  it("continua compondo pesquisa com filtros existentes", () => {
    const rows = [
      { channel: "whatsapp", values: ["Ana", "11999990000"] },
      { channel: "instagram", values: ["Ana Social", "direct"] },
      { channel: "facebook", values: ["Bruno", "messenger"] },
    ];

    const filtered = rows.filter(
      (row) => row.channel === "whatsapp" && matchesInboxSearch("ana", row.values),
    );

    expect(filtered).toEqual([rows[0]]);
  });
});

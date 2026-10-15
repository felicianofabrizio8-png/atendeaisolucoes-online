import { describe, expect, it } from "vitest";
import { STALLED_AFTER_MS, selectStalled } from "../publication-filters";
import type { PublicationRow, PublicationStatus } from "../types";

const NOW = new Date("2026-10-07T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

function row(id: string, status: PublicationStatus, extra: Partial<PublicationRow> = {}): PublicationRow {
  return {
    id,
    company_id: "c1",
    schedule_id: `s-${id}`,
    content_id: `ct-${id}`,
    channel: "instagram",
    format: "feed",
    status,
    platform_post_id: null,
    platform_response: null,
    error_code: null,
    error_message: null,
    retry_count: 0,
    attempt_log: [],
    locked_by: null,
    locked_at: null,
    available_at: minutesAgo(30),
    published_at: null,
    created_at: minutesAgo(30),
    updated_at: minutesAgo(30),
    ...extra,
  };
}

describe("selectStalled", () => {
  it("aponta só publicações na fila, liberadas há mais de 10 minutos e sem ninguém processando", () => {
    const rows = [
      row("parada", "queued", { available_at: minutesAgo(11) }),
      row("recente", "queued", { available_at: minutesAgo(3) }),
      row("em-andamento", "queued", { available_at: minutesAgo(40), locked_by: "tick-1" }),
      row("publicando", "publishing", { available_at: minutesAgo(40) }),
      row("falhou", "failed", { available_at: minutesAgo(40) }),
      row("publicada", "published", { available_at: minutesAgo(40) }),
    ];
    expect(selectStalled(rows, NOW).map((p) => p.id)).toEqual(["parada"]);
  });

  it("retry agendado para o futuro não conta como parado", () => {
    const future = new Date(NOW.getTime() + 5 * 60_000).toISOString();
    expect(selectStalled([row("retry", "queued", { available_at: future, retry_count: 1 })], NOW)).toEqual([]);
  });

  it("respeita o limite configurado e ignora datas inválidas", () => {
    const edge = new Date(NOW.getTime() - STALLED_AFTER_MS).toISOString();
    expect(selectStalled([row("limite", "queued", { available_at: edge })], NOW)).toHaveLength(1);
    expect(selectStalled([row("curto", "queued", { available_at: minutesAgo(2) })], NOW, 60_000)).toHaveLength(1);
    expect(selectStalled([row("invalida", "queued", { available_at: "não é data", created_at: "" })], NOW)).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import {
  isOperational,
  isHistorical,
  selectOperational,
  selectHistory,
} from "../publication-filters";
import type { PublicationRow, PublicationStatus } from "../types";

function row(
  id: string,
  status: PublicationStatus,
  extra: Partial<PublicationRow> = {},
): PublicationRow {
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
    available_at: "2026-07-01T00:00:00.000Z",
    published_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...extra,
  };
}

describe("publication-filters", () => {
  const rows: PublicationRow[] = [
    row("a", "published", { published_at: "2026-07-10T10:00:00Z" }),
    row("b", "failed", { created_at: "2026-07-11T10:00:00Z" }),
    row("c", "queued", { created_at: "2026-07-12T10:00:00Z" }),
    row("d", "publishing", { created_at: "2026-07-13T10:00:00Z" }),
    row("e", "cancelled", { created_at: "2026-07-14T10:00:00Z" }),
    row("f", "published", {
      channel: "facebook",
      format: "story",
      published_at: "2026-07-15T10:00:00Z",
    }),
  ];

  it("classifica operacional vs histórico", () => {
    expect(isOperational({ status: "queued" })).toBe(true);
    expect(isOperational({ status: "publishing" })).toBe(true);
    expect(isOperational({ status: "failed" })).toBe(true);
    expect(isOperational({ status: "cancelled" })).toBe(true);
    expect(isOperational({ status: "published" })).toBe(false);
    expect(isHistorical({ status: "published" })).toBe(true);
    expect(isHistorical({ status: "failed" })).toBe(false);
  });

  it("selectOperational: agendada, na fila, processando e falha aparecem; concluída não", () => {
    const out = selectOperational(rows);
    const ids = out.map((r) => r.id);
    expect(ids).toContain("b"); // failed
    expect(ids).toContain("c"); // queued
    expect(ids).toContain("d"); // publishing
    expect(ids).toContain("e"); // cancelled
    expect(ids).not.toContain("a"); // published
    expect(ids).not.toContain("f"); // published
  });

  it("selectOperational ordena por prioridade: failed > publishing > queued > cancelled", () => {
    const out = selectOperational(rows);
    expect(out.map((r) => r.status)).toEqual(["failed", "publishing", "queued", "cancelled"]);
  });

  it("selectHistory retorna somente concluídos por padrão", () => {
    const out = selectHistory(rows);
    expect(out.map((r) => r.id)).toEqual(["f", "a"]); // ordenados por published_at desc
    expect(out.every((r) => r.status === "published")).toBe(true);
  });

  it("selectHistory filtra por canal e formato", () => {
    const out = selectHistory(rows, { channel: "facebook", format: "story" });
    expect(out.map((r) => r.id)).toEqual(["f"]);
  });

  it("selectHistory filtra por período", () => {
    const out = selectHistory(rows, {
      from: "2026-07-12T00:00:00Z",
      to: "2026-07-20T00:00:00Z",
    });
    expect(out.map((r) => r.id)).toEqual(["f"]);
  });

  it("item some da operacional após virar published (simula refresh)", () => {
    const before = selectOperational(rows);
    expect(before.map((r) => r.id)).toContain("d");
    const after = selectOperational(
      rows.map((r) =>
        r.id === "d"
          ? { ...r, status: "published" as PublicationStatus, published_at: "2026-07-13T11:00:00Z" }
          : r,
      ),
    );
    expect(after.map((r) => r.id)).not.toContain("d");
  });

  it("cobertura total = operacional + histórico (mais qualquer outro)", () => {
    const op = selectOperational(rows).length;
    const hist = selectHistory(rows).length;
    expect(op + hist).toBe(rows.length);
  });
});

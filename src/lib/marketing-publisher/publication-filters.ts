// Pure helpers para separar publicações operacionais x histórico e
// ordenar a lista principal por prioridade de acompanhamento.
// Sem side-effects: usado tanto pelo dashboard quanto pelos testes.

import type { PublicationRow, PublicationStatus } from "./types";

/**
 * Status considerados operacionais: continuam aparecendo na tela principal
 * porque exigem acompanhamento humano ou estão em execução no worker.
 * "published" é o único status explicitamente terminal de sucesso e por isso
 * some da lista operacional.
 */
export const OPERATIONAL_STATUSES: ReadonlySet<PublicationStatus> = new Set<PublicationStatus>([
  "queued",
  "publishing",
  "failed",
  "cancelled",
]);

/**
 * Prioridade de exibição na lista operacional (menor = topo).
 * Falhas primeiro para chamar atenção; concluídos não aparecem.
 */
const PRIORITY: Record<PublicationStatus, number> = {
  failed: 0,
  publishing: 1,
  queued: 2,
  cancelled: 3,
  published: 99,
};

export function isOperational(p: Pick<PublicationRow, "status">): boolean {
  return OPERATIONAL_STATUSES.has(p.status);
}

export function isHistorical(p: Pick<PublicationRow, "status">): boolean {
  return p.status === "published";
}

/** Retorna apenas publicações que ainda precisam de acompanhamento, ordenadas por prioridade. */
export function selectOperational(rows: PublicationRow[]): PublicationRow[] {
  return rows
    .filter(isOperational)
    .slice()
    .sort((a, b) => {
      const pa = PRIORITY[a.status] ?? 50;
      const pb = PRIORITY[b.status] ?? 50;
      if (pa !== pb) return pa - pb;
      return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    });
}

export interface HistoryFilters {
  channel?: "instagram" | "facebook" | "all";
  format?: "feed" | "reel" | "story" | "all";
  status?: PublicationStatus | "all";
  /** ISO date lower bound (inclusive) por published_at ou created_at */
  from?: string;
  /** ISO date upper bound (inclusive) */
  to?: string;
}

/** Filtra o histórico (concluídos por padrão) aplicando filtros combináveis. */
export function selectHistory(
  rows: PublicationRow[],
  filters: HistoryFilters = {},
): PublicationRow[] {
  const targetStatus = filters.status && filters.status !== "all" ? filters.status : "published";
  return rows
    .filter((r) => r.status === targetStatus)
    .filter((r) => (filters.channel && filters.channel !== "all" ? r.channel === filters.channel : true))
    .filter((r) => (filters.format && filters.format !== "all" ? r.format === filters.format : true))
    .filter((r) => {
      const ref = r.published_at ?? r.created_at;
      if (filters.from && ref < filters.from) return false;
      if (filters.to && ref > filters.to) return false;
      return true;
    })
    .slice()
    .sort((a, b) => (b.published_at ?? b.created_at).localeCompare(a.published_at ?? a.created_at));
}

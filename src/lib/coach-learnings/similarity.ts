// Coach Learnings — Similarity thresholds & classification (client-safe).
// Camada pura. Os pesos ficam DENTRO da RPC SQL (find_similar_coach_learning)
// para evitar divergência entre estratégias. Aqui centralizamos apenas os
// limiares que o cliente usa para decidir o fluxo de UX.

/** Classificação retornada pela RPC — mantém paridade com o SQL. */
export type SimilarityClassification =
  | "exact"          // hash idêntico → bloqueio de duplicidade
  | "highly_similar" // score alto → oferecer comparação lado a lado
  | "related"        // score intermediário → usuário decide
  | "new";           // sem semelhança relevante

/**
 * Thresholds centralizados. Devem casar com os cutoffs da RPC
 * `find_similar_coach_learning`. Se ajustar aqui, ajuste a RPC também.
 */
export const SIMILARITY_THRESHOLDS = {
  /** Acima disso: highly_similar. */
  HIGH: 0.75,
  /** Acima disso: related. */
  RELATED: 0.45,
  /** Corte inferior: qualquer resultado abaixo não é retornado como candidato. */
  MIN_CANDIDATE: 0.35,
} as const;

/** Peso de cada sinal, apenas para documentação (SQL é source of truth). */
export const SIMILARITY_WEIGHTS_DOC = {
  rule_structured: 0.45,
  title: 0.30,
  description: 0.15,
  category_match: 0.05,
  product_match: 0.05,
} as const;

export interface SimilarCandidate {
  id: string;
  version: number;
  status: string;
  category: string;
  title: string;
  description: string;
  rule_structured: string;
  product_ref: string | null;
  priority: number;
  updated_at: string;
  content_hash: string;
  score: number;
  classification: SimilarityClassification;
}

/**
 * Reclassifica localmente a partir do score. Útil para testes e para o caso
 * do frontend receber score bruto e precisar recalcular após tweaks.
 */
export function classifyByScore(
  score: number,
  isExactHash: boolean,
): SimilarityClassification {
  if (isExactHash) return "exact";
  if (score >= SIMILARITY_THRESHOLDS.HIGH) return "highly_similar";
  if (score >= SIMILARITY_THRESHOLDS.RELATED) return "related";
  return "new";
}

/** Decide o gate de UX ao receber a lista de candidatos ordenada. */
export function decideSaveGate(candidates: SimilarCandidate[]): {
  gate: "block_exact" | "confirm_similar" | "proceed";
  exact: SimilarCandidate | null;
  similar: SimilarCandidate[];
} {
  const exact = candidates.find((c) => c.classification === "exact") ?? null;
  if (exact) return { gate: "block_exact", exact, similar: [] };
  const similar = candidates.filter(
    (c) => c.classification === "highly_similar" || c.classification === "related",
  );
  if (similar.length > 0) return { gate: "confirm_similar", exact: null, similar };
  return { gate: "proceed", exact: null, similar: [] };
}

/** Normalizador espelho do SQL (para previews client-side de content hash). */
export function normalizeForHashPreview(input: string | null | undefined): string {
  if (!input) return "";
  const noAccents = input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return noAccents
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

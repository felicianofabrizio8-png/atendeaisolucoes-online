// ============================================================================
// Scientific Memory — Types (Fase 4)
// Memória Científica Permanente do Professor AI.
// 100% READ-ONLY para consumidores externos. Nenhuma PII. Nenhum ID externo.
// Somente conhecimento consolidado e sanitizado a partir de agregados.
// ============================================================================

import type { SciencePeriod } from "@/lib/scientific-knowledge/ScientificKnowledgeTypes";

export const SCIENTIFIC_MEMORY_VERSION = "memory-v1.0.0" as const;

export type ScientificMemoryPeriod = SciencePeriod;

/** Teoria validada em forma persistível (sem IDs de origem, sem PII). */
export interface MemoryValidatedTheory {
  provenanceKey: string;
  category: string;
  title: string;
  summary: string;
  confidence: number;       // 0..1
  scientificScore: number;  // 0..1
  validatedSince: string | null; // ISO
}

/** Hipótese em fortalecimento (candidata a teoria). */
export interface MemoryStrengtheningHypothesis {
  provenanceKey: string;
  category: string;
  title: string;
  confidence: number;
  occurrences: number;
  distinctDays: number;
  status: string;
}

/** Padrão observado pelo Business Brain — apenas agregado. */
export interface MemoryObservedPattern {
  category: string;
  description: string;
  occurrences: number;
  confidence: number;
  trend: "rising" | "stable" | "falling";
}

/** Conclusão de negócio consolidada (Business Brain knowledge). */
export interface MemoryBusinessConclusion {
  category: string;
  title: string;
  summary: string;
  confidence: number;
  sampleSize: number;
}

/** Correlação: mesmo provenanceKey observado por múltiplas camadas. */
export interface MemoryCorrelation {
  provenanceKey: string;
  category: string;
  title: string;
  sources: string[];   // ex: ["business_brain:pattern","business_learning:hypothesis"]
  layerCount: number;
  confidence: number;
}

/** Limitação estrutural detectada no ciclo atual. */
export interface MemoryLimitation {
  code: string;   // ex: "insufficient_history_days"
  message: string;
}

/** Qualidade agregada do snapshot científico que gerou esta memória. */
export interface MemoryQuality {
  observationsCount: number;
  hypothesesCount: number;
  evidenceCount: number;
  theoriesCount: number;
  validatedKnowledgeCount: number;
  distinctSnapshotDays: number;
  brainPatterns: number;
  brainKnowledge: number;
  avgConfidence: number; // 0..1
}

/** Registro persistido em `public.scientific_memory`. */
export interface ScientificMemoryRecord {
  id: string;
  companyId: string;
  generatedAt: string; // ISO
  period: ScientificMemoryPeriod;
  knowledgeScore: number;   // 0..1
  scientificScore: number;  // 0..1
  validatedTheories: MemoryValidatedTheory[];
  strengtheningHypotheses: MemoryStrengtheningHypothesis[];
  observedPatterns: MemoryObservedPattern[];
  businessConclusions: MemoryBusinessConclusion[];
  correlations: MemoryCorrelation[];
  limitations: MemoryLimitation[];
  quality: MemoryQuality;
  version: string;
  createdAt: string; // ISO
}

/** Payload de gravação (companyId injetado pelo repositório; id/createdAt pelo banco). */
export type ScientificMemoryInsert = Omit<
  ScientificMemoryRecord,
  "id" | "createdAt" | "companyId"
>;

/** Evolução entre a memória atual e a imediatamente anterior. */
export interface ScientificMemoryEvolution {
  hasPrevious: boolean;
  previousGeneratedAt: string | null;
  knowledgeEvolution: number;   // delta knowledgeScore
  scientificEvolution: number;  // delta scientificScore
  businessEvolution: number;    // delta (# conclusões) + delta média de confiança
  confidenceEvolution: number;  // delta avgConfidence
  validatedTheoriesDelta: number;
  strengtheningHypothesesDelta: number;
  observedPatternsDelta: number;
}

/** Item da timeline (365 dias) — payload público (sanitizado). */
export interface ScientificMemoryTimelineItem {
  id: string;
  generatedAt: string;
  period: ScientificMemoryPeriod;
  knowledgeScore: number;
  scientificScore: number;
  quality: MemoryQuality;
  version: string;
}

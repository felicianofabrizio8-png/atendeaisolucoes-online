// ============================================================================
// Scientific Memory — Builder (Fase 4)
// Determinístico. Sem LLM. Sem PII. Extrai apenas conhecimento consolidado.
// ============================================================================

import type { BusinessBrainSnapshot } from "@/lib/business-brain/BusinessBrainTypes";
import type {
  ScientificKnowledgeSnapshot,
  ScientificObservation,
  ScientificHypothesis,
} from "@/lib/scientific-knowledge/ScientificKnowledgeTypes";
import {
  SCIENTIFIC_MEMORY_VERSION,
  type MemoryBusinessConclusion,
  type MemoryCorrelation,
  type MemoryLimitation,
  type MemoryObservedPattern,
  type MemoryQuality,
  type MemoryStrengtheningHypothesis,
  type MemoryValidatedTheory,
  type ScientificMemoryInsert,
  type ScientificMemoryPeriod,
} from "./ScientificMemoryTypes";

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

function avg(values: number[]): number {
  if (!values.length) return 0;
  const s = values.reduce((a, b) => a + b, 0);
  return s / values.length;
}

function computeKnowledgeScore(science: ScientificKnowledgeSnapshot): number {
  const vk = science.validatedKnowledge ?? [];
  if (!vk.length) return 0;
  const sum = vk.reduce(
    (acc, k) => acc + clamp01(k.scientificScore ?? 0) * clamp01(k.confidence ?? 0),
    0,
  );
  // Normaliza por um piso de 3 para não estourar em amostras minúsculas.
  return clamp01(sum / Math.max(3, vk.length));
}

function computeScientificScore(science: ScientificKnowledgeSnapshot): number {
  const validatedConfidences = (science.validatedKnowledge ?? []).map((k) =>
    clamp01(k.confidence ?? 0),
  );
  const strengthening = (science.hypotheses ?? []).filter((h) => h.status === "strengthening");
  const strengtheningConfidences = strengthening.map((h) => clamp01(h.confidence ?? 0));
  const validatedAvg = avg(validatedConfidences);
  const strengtheningAvg = avg(strengtheningConfidences);
  // Pesos: 0.7 para validado, 0.3 para em fortalecimento.
  return clamp01(validatedAvg * 0.7 + strengtheningAvg * 0.3);
}

function buildValidatedTheories(science: ScientificKnowledgeSnapshot): MemoryValidatedTheory[] {
  return (science.validatedKnowledge ?? []).map((k) => ({
    provenanceKey: k.provenanceKey,
    category: k.category,
    title: k.title,
    summary: k.summary,
    confidence: clamp01(k.confidence ?? 0),
    scientificScore: clamp01(k.scientificScore ?? 0),
    validatedSince: k.validatedSince ?? null,
  }));
}

function buildStrengtheningHypotheses(
  science: ScientificKnowledgeSnapshot,
): MemoryStrengtheningHypothesis[] {
  return (science.hypotheses ?? [])
    .filter((h: ScientificHypothesis) => h.status === "strengthening")
    .map((h) => ({
      provenanceKey: h.provenanceKey,
      category: h.category,
      title: h.title,
      confidence: clamp01(h.confidence ?? 0),
      occurrences: h.occurrences ?? 0,
      distinctDays: h.distinctDays ?? 0,
      status: h.status,
    }));
}

function buildObservedPatterns(brain: BusinessBrainSnapshot): MemoryObservedPattern[] {
  return (brain.patterns ?? []).map((p) => ({
    category: p.category,
    description: p.description,
    occurrences: p.occurrences ?? 0,
    confidence: clamp01(p.confidence ?? 0),
    trend: p.trend,
  }));
}

function buildBusinessConclusions(brain: BusinessBrainSnapshot): MemoryBusinessConclusion[] {
  return (brain.knowledge ?? []).map((k) => ({
    category: k.category,
    title: k.title,
    summary: k.summary,
    confidence: clamp01(k.confidence ?? 0),
    sampleSize: k.evidence?.sample ?? 0,
  }));
}

/** Correlações = mesmo provenanceKey observado por >= 2 camadas distintas. */
function buildCorrelations(science: ScientificKnowledgeSnapshot): MemoryCorrelation[] {
  const map = new Map<
    string,
    { sources: Set<string>; category: string; title: string; confidences: number[] }
  >();
  for (const obs of science.observations as ScientificObservation[]) {
    const entry = map.get(obs.provenanceKey) ?? {
      sources: new Set<string>(),
      category: obs.category,
      title: obs.title,
      confidences: [],
    };
    entry.sources.add(obs.source);
    entry.confidences.push(clamp01(obs.confidence ?? 0));
    if (!entry.title) entry.title = obs.title;
    map.set(obs.provenanceKey, entry);
  }
  const out: MemoryCorrelation[] = [];
  for (const [provenanceKey, entry] of map.entries()) {
    if (entry.sources.size >= 2) {
      out.push({
        provenanceKey,
        category: entry.category,
        title: entry.title,
        sources: Array.from(entry.sources).sort(),
        layerCount: entry.sources.size,
        confidence: clamp01(avg(entry.confidences)),
      });
    }
  }
  return out.sort((a, b) => b.layerCount - a.layerCount || b.confidence - a.confidence);
}

function buildLimitations(
  science: ScientificKnowledgeSnapshot,
  brain: BusinessBrainSnapshot,
): MemoryLimitation[] {
  const out: MemoryLimitation[] = [];
  if ((science.sample?.distinctSnapshotDays ?? 0) < 3) {
    out.push({
      code: "insufficient_history_days",
      message: "Histórico de snapshots insuficiente para validação temporal.",
    });
  }
  if (!science.sample?.productsReady) {
    out.push({
      code: "products_coverage_low",
      message: "Cobertura de produtos insuficiente para hipóteses de produto.",
    });
  }
  if ((brain.sample?.conversationFacts ?? 0) === 0) {
    out.push({
      code: "no_conversation_facts",
      message: "Sem fatos de conversação agregados no período.",
    });
  }
  if ((science.validatedKnowledge?.length ?? 0) === 0) {
    out.push({
      code: "no_validated_knowledge",
      message: "Nenhum conhecimento validado no ciclo atual.",
    });
  }
  return out;
}

function buildQuality(
  science: ScientificKnowledgeSnapshot,
  brain: BusinessBrainSnapshot,
): MemoryQuality {
  const confidences = [
    ...(science.validatedKnowledge ?? []).map((k) => clamp01(k.confidence ?? 0)),
    ...(science.hypotheses ?? []).map((h) => clamp01(h.confidence ?? 0)),
  ];
  return {
    observationsCount: science.sample?.observations ?? 0,
    hypothesesCount: science.sample?.hypotheses ?? 0,
    evidenceCount: science.sample?.evidence ?? 0,
    theoriesCount: science.sample?.theories ?? 0,
    validatedKnowledgeCount: science.sample?.validatedKnowledge ?? 0,
    distinctSnapshotDays: science.sample?.distinctSnapshotDays ?? 0,
    brainPatterns: brain.patterns?.length ?? 0,
    brainKnowledge: brain.knowledge?.length ?? 0,
    avgConfidence: clamp01(avg(confidences)),
  };
}

/** Hash SHA-256 hex (Web Crypto) — determinístico e sem PII. */
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Serializa determinísticamente (chaves ordenadas). */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function utcDate(iso: string): string {
  return iso.slice(0, 10); // ISO já é UTC
}

export class ScientificMemoryBuilder {
  static async build(input: {
    period: ScientificMemoryPeriod;
    science: ScientificKnowledgeSnapshot;
    brain: BusinessBrainSnapshot;
    now?: string;
  }): Promise<ScientificMemoryInsert> {
    const { period, science, brain } = input;
    const now = input.now ?? new Date().toISOString();
    const memoryDate = utcDate(now);
    const knowledgeScore = computeKnowledgeScore(science);
    const scientificScore = computeScientificScore(science);
    const validatedTheories = buildValidatedTheories(science);
    const strengtheningHypotheses = buildStrengtheningHypotheses(science);
    const observedPatterns = buildObservedPatterns(brain);
    const businessConclusions = buildBusinessConclusions(brain);
    const correlations = buildCorrelations(science);
    const limitations = buildLimitations(science, brain);
    const quality = buildQuality(science, brain);

    // Fingerprint: apenas dados sanitizados/agregados. Sem generatedAt/memoryDate/PII.
    const fingerprintSource = stableStringify({
      period,
      version: SCIENTIFIC_MEMORY_VERSION,
      knowledgeScore: Math.round(knowledgeScore * 1000) / 1000,
      scientificScore: Math.round(scientificScore * 1000) / 1000,
      validatedTheories,
      strengtheningHypotheses,
      observedPatterns,
      businessConclusions,
      correlations,
      limitations,
      quality,
    });
    const sourceFingerprint = (await sha256Hex(fingerprintSource)).slice(0, 32);

    return {
      generatedAt: now,
      memoryDate,
      sourceFingerprint,
      period,
      knowledgeScore,
      scientificScore,
      validatedTheories,
      strengtheningHypotheses,
      observedPatterns,
      businessConclusions,
      correlations,
      limitations,
      quality,
      version: SCIENTIFIC_MEMORY_VERSION,
    };
  }
}


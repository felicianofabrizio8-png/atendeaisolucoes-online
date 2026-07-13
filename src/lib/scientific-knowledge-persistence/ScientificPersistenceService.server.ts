// ============================================================================
// ScientificPersistenceService — Orquestra a persistência científica.
// Comportamento:
//   • dryRun=true  → gera snapshot, computa plano, NÃO escreve
//   • dryRun=false → grava snapshot imutável (idempotente por fingerprint/dia)
//                    e aplica upserts nos registries
// Nunca aceita companyId livre de request: parâmetro sempre derivado do JWT.
// Não expõe PII, não chama LLM, não consome nenhum agente operacional.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ScientificKnowledgeService } from "@/lib/scientific-knowledge/ScientificKnowledgeService.server";
import {
  opaqueHash,
  type SciencePeriod,
  type ScientificKnowledgeSnapshot,
} from "@/lib/scientific-knowledge/ScientificKnowledgeTypes";
import { ScientificSnapshotRepository } from "./ScientificSnapshotRepository.server";
import { ScientificHypothesisRepository } from "./ScientificHypothesisRepository.server";
import { ScientificKnowledgeRegistryRepository } from "./ScientificKnowledgeRegistryRepository.server";
import {
  SCIENTIFIC_ENGINE_VERSION,
  type ScientificPersistencePlan,
  type ScientificPersistenceResult,
  type ScientificQualityReport,
} from "./ScientificPersistenceTypes";

function buildQuality(
  snapshot: ScientificKnowledgeSnapshot,
): ScientificQualityReport {
  const insufficient = snapshot.hypotheses.filter(
    (h) => h.status === "insufficient_history",
  ).length;
  const contradictions = snapshot.hypotheses.filter(
    (h) => h.contradictionDetected,
  ).length;
  const uniquePk = new Set(snapshot.observations.map((o) => o.provenanceKey));
  const duplicateLineagesCollapsed = Math.max(
    0,
    snapshot.observations.length - uniquePk.size,
  );
  const warnings: string[] = [];
  if (!snapshot.sample.productsReady)
    warnings.push("products_json_not_ready");
  if (snapshot.sample.distinctSnapshotDays < 3)
    warnings.push("history_below_min_for_validation");
  return {
    totalObservations: snapshot.observations.length,
    totalHypotheses: snapshot.hypotheses.length,
    totalEvidence: snapshot.evidence.length,
    totalTheories: snapshot.theories.length,
    totalValidatedKnowledge: snapshot.validatedKnowledge.length,
    insufficientHistoryCount: insufficient,
    contradictionsCount: contradictions,
    duplicateLineagesCollapsed,
    productsReady: snapshot.sample.productsReady,
    distinctHistoryDays: snapshot.sample.distinctSnapshotDays,
    warnings,
    generatedAt: snapshot.generatedAt,
  };
}

function buildSourceFingerprint(
  snapshot: ScientificKnowledgeSnapshot,
): string {
  // Deterministic across identical scientific content.
  const payload = JSON.stringify({
    period: snapshot.period,
    engine: SCIENTIFIC_ENGINE_VERSION,
    hypotheses: snapshot.hypotheses
      .map((h) => ({
        pk: h.provenanceKey,
        s: h.status,
        c: Number(h.confidence.toFixed(3)),
        o: h.occurrences,
      }))
      .sort((a, b) => a.pk.localeCompare(b.pk)),
    evidence: snapshot.evidence
      .map((e) => ({
        pk: e.provenanceKey,
        sf: e.sourceFingerprint,
        n: e.sampleSize,
        d: e.distinctDays,
      }))
      .sort((a, b) => a.pk.localeCompare(b.pk)),
    theories: snapshot.theories
      .map((t) => ({ pk: t.provenanceKey, d: t.distinctDays }))
      .sort((a, b) => a.pk.localeCompare(b.pk)),
    validated: snapshot.validatedKnowledge
      .map((k) => ({ pk: k.provenanceKey, s: k.status }))
      .sort((a, b) => a.pk.localeCompare(b.pk)),
  });
  return `sfp-${opaqueHash(payload)}`;
}

export class ScientificPersistenceService {
  constructor(
    private readonly userClient: SupabaseClient<Database>,
    private readonly admin: SupabaseClient<Database>,
    private readonly companyId: string,
  ) {}

  async plan(
    period: SciencePeriod,
  ): Promise<ScientificPersistencePlan> {
    const snapshot = await ScientificKnowledgeService.build(
      this.userClient,
      this.companyId,
      period,
    );
    const quality = buildQuality(snapshot);
    const snapshotDate = snapshot.generatedAt.slice(0, 10);
    const sourceFingerprint = buildSourceFingerprint(snapshot);

    const snapshots = new ScientificSnapshotRepository(this.admin);
    const hyps = new ScientificHypothesisRepository(this.admin);
    const know = new ScientificKnowledgeRegistryRepository(this.admin);

    const existingSnapshot = await snapshots.findByFingerprint(
      this.companyId,
      period,
      SCIENTIFIC_ENGINE_VERSION,
      snapshotDate,
      sourceFingerprint,
    );

    const hypKeys = snapshot.hypotheses.map((h) => h.provenanceKey);
    const existingHyps = await hyps.listByKeys(this.companyId, hypKeys);
    const hypPlan = hyps.planApply(snapshot.hypotheses, existingHyps, snapshotDate);

    const entries = know.buildEntries(
      snapshot.theories,
      snapshot.validatedKnowledge,
    );
    const existingKnow = await know.listByKeys(
      this.companyId,
      entries.map((e) => e.key),
    );
    const knowPlan = know.planApply(entries, existingKnow);

    return {
      companyId: this.companyId,
      period,
      engineVersion: SCIENTIFIC_ENGINE_VERSION,
      snapshotDate,
      sourceFingerprint,
      snapshot,
      quality,
      changes: {
        snapshotWouldInsert: !existingSnapshot,
        snapshotAlreadyExists: Boolean(existingSnapshot),
        hypothesesInsert: hypPlan.toInsert,
        hypothesesUpdate: hypPlan.toUpdate,
        hypothesesSameDay: hypPlan.sameDay,
        knowledgeInsert: knowPlan.toInsert,
        knowledgeUpdate: knowPlan.toUpdate,
        knowledgeCandidates: knowPlan.candidates,
        knowledgeValidated: knowPlan.validated,
        knowledgeHistorical: knowPlan.historical,
        knowledgeDeprecated: knowPlan.deprecated,
        contradictionsIncrement:
          hypPlan.contradictionsIncrement + knowPlan.contradictionsIncrement,
      },
    };
  }

  async persist(period: SciencePeriod): Promise<ScientificPersistenceResult> {
    const plan = await this.plan(period);
    const snapshots = new ScientificSnapshotRepository(this.admin);
    const hyps = new ScientificHypothesisRepository(this.admin);
    const know = new ScientificKnowledgeRegistryRepository(this.admin);

    let snapshotId: string | null = null;
    if (plan.changes.snapshotAlreadyExists) {
      const existing = await snapshots.findByFingerprint(
        this.companyId,
        plan.period,
        plan.engineVersion,
        plan.snapshotDate,
        plan.sourceFingerprint,
      );
      snapshotId = existing?.id ?? null;
    } else {
      snapshotId = await snapshots.insert({
        companyId: this.companyId,
        period: plan.period,
        engineVersion: plan.engineVersion,
        snapshotDate: plan.snapshotDate,
        snapshotGeneratedAt: plan.snapshot.generatedAt,
        sourceFingerprint: plan.sourceFingerprint,
        observations: plan.snapshot.observations,
        hypotheses: plan.snapshot.hypotheses,
        evidence: plan.snapshot.evidence,
        theories: plan.snapshot.theories,
        validatedKnowledge: plan.snapshot.validatedKnowledge,
        quality: plan.quality as unknown as Record<string, unknown>,
      });
    }

    const hypKeys = plan.snapshot.hypotheses.map((h) => h.provenanceKey);
    const existingHyps = await hyps.listByKeys(this.companyId, hypKeys);
    const scoreMap = new Map<string, number>();
    for (const h of plan.snapshot.hypotheses) {
      const k = plan.snapshot.validatedKnowledge.find(
        (v) => v.provenanceKey === h.provenanceKey,
      );
      scoreMap.set(h.id, k?.scientificScore ?? Math.min(1, h.distinctDays / 5));
    }
    await hyps.apply(
      this.companyId,
      plan.snapshot.hypotheses,
      existingHyps,
      plan.snapshotDate,
      plan.snapshot.generatedAt,
      scoreMap,
      plan.sourceFingerprint,
    );

    const entries = know.buildEntries(
      plan.snapshot.theories,
      plan.snapshot.validatedKnowledge,
    );
    const existingKnow = await know.listByKeys(
      this.companyId,
      entries.map((e) => e.key),
    );
    await know.apply(
      this.companyId,
      entries,
      existingKnow,
      plan.snapshotDate,
      plan.snapshot.generatedAt,
    );

    return { ...plan, applied: true, snapshotId };
  }
}

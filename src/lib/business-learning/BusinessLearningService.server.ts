// ============================================================================
// BusinessLearningService — Orquestra Analyzer + Evolution + Hypothesis
// + Learning consolidation. READ-ONLY, determinístico, sem PII, sem LLM.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { BusinessLearningAnalyzer } from "./BusinessLearningAnalyzer.server";
import { BusinessLearningEvolution } from "./BusinessLearningEvolution.server";
import { BusinessHypothesisEngine } from "./BusinessHypothesisEngine.server";
import {
  LEARNING_VERSION,
  type BusinessLearning,
  type BusinessLearningSnapshot,
  type LearningPeriod,
} from "./BusinessLearningTypes";
import type { BusinessBrainSnapshot } from "@/lib/business-brain/BusinessBrainTypes";
import type { ExecutiveKnowledgeRecord } from "@/lib/executive-knowledge/ExecutiveKnowledgeTypes";

function buildLearning(
  brain: BusinessBrainSnapshot,
  knowledgeTimeline: ExecutiveKnowledgeRecord[],
  createdAt: string,
): BusinessLearning[] {
  const out: BusinessLearning[] = [];
  const sample = brain.metrics.totalConversationsAnalyzed;

  // Objeção persistente
  const objPattern = brain.patterns.find((p) => p.category === "objection");
  if (objPattern && objPattern.occurrences >= 5) {
    out.push({
      id: `learn-objection-persistent-${objPattern.id}`,
      category: "commercial",
      title: "Objeção principal permanece recorrente",
      summary: `A objeção "${objPattern.evidence.reference ? objPattern.description : "principal"}" segue como obstáculo consistente (${objPattern.evidence.percentage ?? 0}% das conversas).`,
      confidence: objPattern.confidence,
      supportingPatterns: [objPattern.id],
      supportingKnowledge: brain.knowledge
        .filter((k) => k.category === "commercial")
        .map((k) => k.id),
      createdAt,
    });
  }

  // Tempo de resposta em melhoria contínua
  if (knowledgeTimeline.length >= 3) {
    const series = knowledgeTimeline
      .slice(0, 8)
      .map((k) => k.facts.attendance.avgResponseMinutes);
    const declining = series.every((v, i, arr) => (i === 0 ? true : v <= arr[i - 1]));
    if (declining && series[0] < series[series.length - 1]) {
      out.push({
        id: "learn-response-time-improving",
        category: "operational",
        title: "Tempo médio de resposta em queda contínua",
        summary: `O tempo médio de resposta caiu de ${series[series.length - 1]} para ${series[0]} minutos nas últimas ${series.length} janelas comparadas.`,
        confidence: Math.min(1, series.length / 8),
        supportingPatterns: [],
        supportingKnowledge: brain.knowledge
          .filter((k) => k.category === "operational")
          .map((k) => k.id),
        createdAt,
      });
    }
  }

  // Canal dominante
  const bestChannel = [...brain.metrics.byChannel].sort((a, b) => b.sold - a.sold)[0];
  if (bestChannel && bestChannel.sold >= 3) {
    out.push({
      id: `learn-channel-dominant-${bestChannel.channel}`,
      category: "channel",
      title: `Canal ${bestChannel.channel} concentra fechamentos`,
      summary: `O canal ${bestChannel.channel} responde por ${bestChannel.sold} vendas em ${bestChannel.conversations} conversas analisadas.`,
      confidence: Math.min(1, bestChannel.conversations / 20),
      supportingPatterns: brain.patterns
        .filter((p) => p.category === "channel" && p.evidence.channel === bestChannel.channel)
        .map((p) => p.id),
      supportingKnowledge: brain.knowledge
        .filter((k) => k.category === "channel")
        .map((k) => k.id),
      createdAt,
    });
  }

  // Amostra insuficiente
  if (sample < 5) {
    out.push({
      id: "learn-quality-low-sample",
      category: "quality",
      title: "Base amostral ainda insuficiente para aprendizado estável",
      summary: `Apenas ${sample} conversas analisadas até agora. Learning permanece em modo observacional.`,
      confidence: 1,
      supportingPatterns: [],
      supportingKnowledge: brain.knowledge
        .filter((k) => k.category === "quality")
        .map((k) => k.id),
      createdAt,
    });
  }

  return out;
}

export class BusinessLearningService {
  static async build(
    supabase: SupabaseClient<Database>,
    companyId: string,
    period: LearningPeriod,
  ): Promise<BusinessLearningSnapshot> {
    const analyzer = new BusinessLearningAnalyzer(supabase, companyId);
    const raw = await analyzer.collect(period);
    const generatedAt = new Date().toISOString();

    const evolution = BusinessLearningEvolution.build(
      raw.brainSnapshot,
      raw.knowledgeTimeline,
      period,
      generatedAt,
    );
    const hypotheses = BusinessHypothesisEngine.build({
      brain: raw.brainSnapshot,
      evolutions: evolution,
      period,
      now: generatedAt,
    });
    const learning = buildLearning(raw.brainSnapshot, raw.knowledgeTimeline, generatedAt);

    return {
      generatedAt,
      learningVersion: LEARNING_VERSION,
      period,
      sample: {
        brainPatterns: raw.brainSnapshot.patterns.length,
        brainKnowledge: raw.brainSnapshot.knowledge.length,
        brainTrends: raw.brainSnapshot.trends.length,
        executiveKnowledgeSnapshots: raw.knowledgeTimeline.length,
        weeklyBuckets: raw.brainSnapshot.metrics.evolution.weekly.length,
        monthlyBuckets: raw.brainSnapshot.metrics.evolution.monthly.length,
      },
      evolution,
      hypotheses,
      learning,
    };
  }
}

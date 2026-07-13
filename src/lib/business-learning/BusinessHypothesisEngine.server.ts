// ============================================================================
// BusinessHypothesisEngine — Deriva hipóteses determinísticas a partir de
// patterns / knowledge / trends do Business Brain e da evolução observada.
// Sem LLM. Sem PII. Sem invenção — apenas quando há evidência mínima.
// ============================================================================

import type { BusinessBrainSnapshot } from "@/lib/business-brain/BusinessBrainTypes";
import type {
  BusinessEvolution,
  BusinessHypothesis,
  HypothesisCategory,
  HypothesisStatus,
  LearningPeriod,
} from "./BusinessLearningTypes";

const MIN_OCCURRENCES = 3;
const CONF_STRONG = 0.6;
const CONF_WEAK = 0.3;

function slug(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function statusFor(occurrences: number, direction: string | undefined): HypothesisStatus {
  if (occurrences < MIN_OCCURRENCES) return "observed";
  if (direction === "rising" || direction === "emerging") return "strengthening";
  if (direction === "falling" || direction === "disappearing") return "weakening";
  return "observed";
}

function confidenceFor(occurrences: number, share: number): number {
  const volume = Math.min(1, occurrences / 20);
  const density = Math.min(1, share);
  return Math.round(Math.min(1, volume * 0.5 + density * 0.5) * 100) / 100;
}

interface Ctx {
  brain: BusinessBrainSnapshot;
  evolutions: BusinessEvolution[];
  period: LearningPeriod;
  now: string;
}

function findEvo(evos: BusinessEvolution[], metric: string): BusinessEvolution | undefined {
  return evos.find((e) => e.metric === metric || e.metric.endsWith(metric));
}

export class BusinessHypothesisEngine {
  static build(ctx: Ctx): BusinessHypothesis[] {
    const list: BusinessHypothesis[] = [];
    const { brain, evolutions, now } = ctx;
    const sample = brain.metrics.totalConversationsAnalyzed;
    if (sample === 0) return list;

    // ---- Objeção crescente vs tempo de resposta subindo -------------------
    const objPattern = brain.patterns.find((p) => p.category === "objection");
    const respEvo = findEvo(evolutions, "executive.avgResponseMinutes");
    if (objPattern && respEvo && respEvo.direction === "rising" && objPattern.trend === "rising") {
      list.push({
        id: `hyp-objection-response-${ctx.period}`,
        category: "objection" as HypothesisCategory,
        title: "Objeções aumentam quando o tempo médio de resposta sobe",
        description: `A objeção "${objPattern.evidence.reference ? objPattern.description : ""}" cresce no mesmo intervalo em que o tempo médio de resposta aumenta (${respEvo.deltaPercent ?? 0}%).`,
        confidence: Math.min(1, (objPattern.confidence + respEvo.confidence) / 2),
        occurrences: objPattern.occurrences,
        firstObserved: objPattern.firstObserved,
        lastObserved: objPattern.lastObserved,
        status: statusFor(objPattern.occurrences, "rising"),
        evidence: {
          metrics: ["objection_frequency", "executive.avgResponseMinutes"],
          sample: objPattern.occurrences,
          correlation: 0.6,
          note: "coincidence-of-rising-signals",
        },
      });
    }

    // ---- Sinal de compra recorrente sugere fechamento mais rápido ---------
    const buyingPattern = brain.patterns.find((p) => p.category === "buying_signal");
    if (buyingPattern && buyingPattern.occurrences >= MIN_OCCURRENCES) {
      const share = (buyingPattern.evidence.percentage ?? 0) / 100;
      list.push({
        id: `hyp-buying-fastclose-${slug(buyingPattern.id)}-${ctx.period}`,
        category: "buying_signal",
        title: "Sinais de compra recorrentes indicam janela de fechamento",
        description: `${buyingPattern.description} Presença consistente do sinal sugere prioridade para follow-up curto.`,
        confidence: confidenceFor(buyingPattern.occurrences, share),
        occurrences: buyingPattern.occurrences,
        firstObserved: buyingPattern.firstObserved,
        lastObserved: buyingPattern.lastObserved,
        status: statusFor(buyingPattern.occurrences, buyingPattern.trend),
        evidence: {
          metrics: ["buying_signal_frequency"],
          sample: buyingPattern.occurrences,
          note: `share=${buyingPattern.evidence.percentage ?? 0}%`,
        },
      });
    }

    // ---- Canal com baixa conversão relativa -------------------------------
    for (const ch of brain.metrics.byChannel) {
      if (ch.conversations < MIN_OCCURRENCES) continue;
      const conv = ch.conversations;
      const rate = conv > 0 ? ch.sold / conv : 0;
      if (rate < 0.1 && conv >= 5) {
        list.push({
          id: `hyp-channel-slow-${slug(ch.channel)}-${ctx.period}`,
          category: "channel",
          title: `Canal ${ch.channel} converte abaixo da média`,
          description: `O canal ${ch.channel} apresenta ${ch.sold} vendas em ${conv} conversas analisadas (${Math.round(rate * 1000) / 10}%). Sugere ciclo de compra mais longo neste canal.`,
          confidence: confidenceFor(conv, Math.max(0, 0.5 - rate)),
          occurrences: conv,
          firstObserved: null,
          lastObserved: null,
          status: statusFor(conv, "stable"),
          evidence: {
            metrics: ["channel_conversion_rate"],
            sample: conv,
            note: `channel=${ch.channel}`,
          },
        });
      }
    }

    // ---- Abandono crescente em ausência de follow-up ---------------------
    const abandonPattern = brain.patterns.find((p) => p.category === "abandonment");
    const followupEvo = findEvo(evolutions, "executive.followups.pending");
    if (abandonPattern && abandonPattern.occurrences >= MIN_OCCURRENCES) {
      const risingFollowups = followupEvo?.direction === "rising";
      list.push({
        id: `hyp-abandon-followup-${ctx.period}`,
        category: "abandonment",
        title: "Abandono se sustenta enquanto follow-ups ficam pendentes",
        description: `${abandonPattern.description}${
          risingFollowups
            ? " Follow-ups pendentes crescem no mesmo intervalo."
            : ""
        }`,
        confidence: Math.min(1, abandonPattern.confidence * (risingFollowups ? 1 : 0.7)),
        occurrences: abandonPattern.occurrences,
        firstObserved: abandonPattern.firstObserved,
        lastObserved: abandonPattern.lastObserved,
        status: statusFor(abandonPattern.occurrences, risingFollowups ? "rising" : "stable"),
        evidence: {
          metrics: ["abandonment_rate", "executive.followups.pending"],
          sample: abandonPattern.occurrences,
          note: risingFollowups ? "aligned-rising" : "abandonment-only",
        },
      });
    }

    // ---- Timing: primeira resposta rápida vs conversão --------------------
    if (
      brain.metrics.timing.avgFirstResponseMinutes !== null &&
      brain.metrics.timing.avgFirstResponseMinutes <= 15 &&
      (brain.metrics.byLifecycle.sold ?? 0) >= MIN_OCCURRENCES
    ) {
      list.push({
        id: `hyp-timing-fast-${ctx.period}`,
        category: "timing",
        title: "Primeira resposta rápida se correlaciona com vendas",
        description: `Tempo médio de primeira resposta observado: ${brain.metrics.timing.avgFirstResponseMinutes} min. Amostra com vendas: ${brain.metrics.byLifecycle.sold}.`,
        confidence: CONF_STRONG,
        occurrences: brain.metrics.byLifecycle.sold ?? 0,
        firstObserved: null,
        lastObserved: null,
        status: "strengthening",
        evidence: {
          metrics: ["avg_first_response_minutes", "sold_count"],
          sample: brain.metrics.byLifecycle.sold ?? 0,
          correlation: 0.5,
        },
      });
    }

    // ---- Produto muito citado, pouca venda: hipótese de fricção -----------
    const topProd = brain.metrics.topProducts[0];
    const soldRate =
      sample > 0 ? (brain.metrics.byLifecycle.sold ?? 0) / sample : 0;
    if (topProd && topProd.count >= 5 && soldRate < 0.15) {
      list.push({
        id: `hyp-product-friction-${slug(topProd.key)}-${ctx.period}`,
        category: "product",
        title: `Produto ${topProd.key} citado sem conversão proporcional`,
        description: `O produto ${topProd.key} aparece em ${topProd.percentage}% das conversas, mas conversão global é de ${Math.round(soldRate * 1000) / 10}%. Sugere fricção no fechamento envolvendo este produto.`,
        confidence: confidenceFor(topProd.count, Math.max(0, 0.5 - soldRate)),
        occurrences: topProd.count,
        firstObserved: null,
        lastObserved: null,
        status: statusFor(topProd.count, "stable"),
        evidence: {
          metrics: ["product_mentions", "conversion_rate"],
          sample: topProd.count,
          note: `product=${topProd.key}`,
        },
      });
    }

    // ---- Hipóteses fracas viram "observed" ; nunca descartar aqui --------
    for (const h of list) {
      if (h.confidence < CONF_WEAK) h.status = "observed";
    }

    void now;
    return list;
  }
}

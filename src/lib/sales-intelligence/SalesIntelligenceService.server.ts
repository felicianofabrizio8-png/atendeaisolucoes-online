// ============================================================================
// SalesIntelligenceService — orquestra Analyzer + Scoring + Executive Snapshot
// + Executive Knowledge. Read-only. Cache in-memory por (company, period)
// para evitar recomputo em rajadas curtas (60s).
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ExecutiveDashboardBundle, ExecutivePeriod } from "@/lib/executive-ai/types";
import { ExecutiveAgent } from "@/lib/executive-ai/ExecutiveAgent.server";
import { ExecutiveKnowledgeService } from "@/lib/executive-knowledge/ExecutiveKnowledgeService.server";
import { SalesIntelligenceAnalyzer } from "./SalesIntelligenceAnalyzer.server";
import { buildOpportunity, PRIORITY_ORDER } from "./SalesIntelligenceScoring.server";
import type {
  SalesBottleneck,
  SalesConversionTrend,
  SalesIntelligenceBundle,
  SalesOpportunity,
} from "./SalesIntelligenceTypes";

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; bundle: SalesIntelligenceBundle }>();

const DAY = 86_400_000;
const periodDays: Record<ExecutivePeriod, number> = { today: 1, "7d": 7, "30d": 30, "90d": 90 };

export interface SalesIntelligenceInput {
  supabase: SupabaseClient<Database>;
  companyId: string;
  period: Extract<ExecutivePeriod, "7d" | "30d" | "90d">;
}

export class SalesIntelligenceService {
  static async generate(input: SalesIntelligenceInput): Promise<SalesIntelligenceBundle> {
    const key = `${input.companyId}:${input.period}`;
    const cached = cache.get(key);
    const now = Date.now();
    if (cached && now - cached.at < CACHE_TTL_MS) {
      return { ...cached.bundle, fromCache: true };
    }

    // 1) Reaproveita Executive Snapshot (cálculos já existentes).
    const agent = new ExecutiveAgent({ supabase: input.supabase, companyId: input.companyId });
    const bundle: ExecutiveDashboardBundle = await agent.snapshot(input.period);

    // 2) Coleta fatos de leads (CRM) — janela alinhada ao período do snapshot.
    const days = periodDays[input.period] ?? 30;
    // considera leads ativos nos últimos N*2 dias (evita perder oportunidades antigas)
    const activeSince = new Date(now - days * 2 * DAY);
    const facts = await SalesIntelligenceAnalyzer.collect(
      input.supabase,
      input.companyId,
      { activeSince },
    );

    // 3) Classifica cada lead.
    const opportunities: SalesOpportunity[] = [];
    for (const f of facts) {
      const opp = buildOpportunity(f, now);
      if (opp) opportunities.push(opp);
    }
    opportunities.sort((a, b) => {
      const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (p !== 0) return p;
      return b.score - a.score;
    });

    // 4) Gargalos derivados (reaproveita snapshot + contagens locais).
    const bottlenecks = buildBottlenecks(bundle, opportunities);

    // 5) Tendência de conversão via Executive Knowledge (leitura opcional).
    const conversionTrend = await computeConversionTrend(
      input.supabase,
      input.companyId,
      input.period,
      bundle,
    );

    const totals = {
      scanned: facts.length,
      opportunities: opportunities.length,
      high: opportunities.filter((o) => o.priority === "high").length,
      medium: opportunities.filter((o) => o.priority === "medium").length,
      low: opportunities.filter((o) => o.priority === "low").length,
    };

    const result: SalesIntelligenceBundle = {
      generatedAt: new Date(now).toISOString(),
      period: input.period,
      range: bundle.range,
      totals,
      opportunities: opportunities.slice(0, 50),
      bottlenecks,
      conversionTrend,
      fromCache: false,
      cachedUntil: new Date(now + CACHE_TTL_MS).toISOString(),
    };

    cache.set(key, { at: now, bundle: result });
    return result;
  }
}

function buildBottlenecks(
  bundle: ExecutiveDashboardBundle,
  opps: SalesOpportunity[],
): SalesBottleneck[] {
  const out: SalesBottleneck[] = [];
  const att = bundle.metrics.attendance;
  const sales = bundle.metrics.sales;

  if (att.unansweredLeads > 0) {
    out.push({
      key: "unanswered_leads",
      title: `${att.unansweredLeads} lead(s) sem atendimento`,
      detail: "Novos leads no período que ainda não receberam resposta da equipe.",
      severity: att.unansweredLeads >= 5 ? "critical" : "warn",
    });
  }
  if (att.avgResponseMinutes >= 60) {
    out.push({
      key: "slow_response",
      title: `Tempo médio de resposta: ${Math.round(att.avgResponseMinutes)}min`,
      detail: "Acima de 1h — leads esfriam rapidamente após esse tempo.",
      severity: att.avgResponseMinutes >= 180 ? "critical" : "warn",
    });
  }
  const pendingQuotes = opps.filter((o) => o.kind === "quote_pending" || o.kind === "quote_at_risk").length;
  if (pendingQuotes >= 3) {
    out.push({
      key: "quote_pipeline",
      title: `${pendingQuotes} orçamento(s) aguardando resposta`,
      detail: "Pipeline de propostas parado — priorize follow-ups.",
      severity: pendingQuotes >= 8 ? "critical" : "warn",
    });
  }
  if (sales.lostCount > sales.closedCount && sales.lostCount + sales.closedCount >= 3) {
    out.push({
      key: "loss_ratio",
      title: `Mais perdas (${sales.lostCount}) do que fechamentos (${sales.closedCount})`,
      detail: "Taxa de perda superando fechamentos no período.",
      severity: "critical",
    });
  }
  return out;
}

async function computeConversionTrend(
  supabase: SupabaseClient<Database>,
  companyId: string,
  period: Extract<ExecutivePeriod, "7d" | "30d" | "90d">,
  bundle: ExecutiveDashboardBundle,
): Promise<SalesConversionTrend> {
  const current = bundle.metrics.attendance.conversionRate;
  try {
    const timeline = await ExecutiveKnowledgeService.timeline(supabase, companyId, period, 5);
    // Ignora o registro do snapshot atual (mesmo generatedAt).
    const prev = timeline.find(
      (r) => r.snapshotGeneratedAt !== bundle.generatedAt,
    );
    if (!prev) {
      return {
        currentConversionRate: current,
        previousConversionRate: null,
        direction: "unknown",
        deltaPct: null,
        note: "Sem histórico suficiente para comparar. Base sendo construída.",
      };
    }
    const previous = prev.facts.attendance.conversionRate;
    const delta = current - previous;
    const deltaPct = previous > 0 ? (delta / previous) * 100 : null;
    const direction: SalesConversionTrend["direction"] =
      Math.abs(delta) < 0.5 ? "flat" : delta > 0 ? "up" : "down";
    return {
      currentConversionRate: current,
      previousConversionRate: previous,
      direction,
      deltaPct,
      note:
        direction === "flat"
          ? "Conversão estável em relação ao snapshot anterior."
          : direction === "up"
            ? "Conversão em alta — manter ritmo comercial."
            : "Conversão em queda — revisar abordagem e priorizar leads quentes.",
    };
  } catch {
    return {
      currentConversionRate: current,
      previousConversionRate: null,
      direction: "unknown",
      deltaPct: null,
      note: "Histórico indisponível no momento.",
    };
  }
}

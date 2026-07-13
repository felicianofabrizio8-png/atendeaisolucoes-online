// ============================================================================
// BusinessBrainAnalyzer — Coleta READ-ONLY das fontes permitidas.
// Fontes: conversation_facts (RLS), Executive Knowledge (RLS), Executive
// Snapshot (via ExecutiveAgent).
// NUNCA acessa: leads, messages, conversations, quotes, follow_ups, campaigns,
// whatsapp_messages, integrations, etc.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { BrainPeriod } from "./BusinessBrainTypes";
import type {
  ExecutiveDashboardBundle,
  ExecutivePeriod,
} from "@/lib/executive-ai/types";
import type { ExecutiveKnowledgeRecord } from "@/lib/executive-knowledge/ExecutiveKnowledgeTypes";
import { ExecutiveAgent } from "@/lib/executive-ai/ExecutiveAgent.server";
import { ExecutiveKnowledgeRepository } from "@/lib/executive-knowledge/ExecutiveKnowledgeRepository.server";

/** Linha bruta de conversation_facts consumida pelo Brain. Sem PII. */
export interface RawFactRow {
  analyzer_version: string;
  lifecycle_status: string | null;
  primary_intent: string | null;
  intents_json: string[] | null;
  objections_json: string[] | null;
  buying_signals_json: string[] | null;
  negative_signals_json: string[] | null;
  products_json: string[] | null;
  topics_json: string[] | null;
  quality_warnings_json: string[] | null;
  sentiment_label: string | null;
  sentiment_score: number | null;
  lead_source: string | null;
  channel: string | null;
  message_count: number | null;
  lead_message_count: number | null;
  agent_message_count: number | null;
  first_message_at: string | null;
  last_message_at: string | null;
  first_response_minutes: number | null;
  negotiation_duration_minutes: number | null;
  quote_detected: boolean | null;
  sale_detected: boolean | null;
  loss_detected: boolean | null;
  confidence: number | null;
  analyzed_at: string;
}

export interface BrainRawDataset {
  period: BrainPeriod;
  since: string; // ISO
  now: string; // ISO
  facts: RawFactRow[];
  knowledgeRecent: ExecutiveKnowledgeRecord[];
  executiveSnapshot: ExecutiveDashboardBundle | null;
}

function daysFor(period: BrainPeriod): number {
  return period === "7d" ? 7 : period === "90d" ? 90 : 30;
}

const FACT_COLUMNS = [
  "analyzer_version",
  "lifecycle_status",
  "primary_intent",
  "intents_json",
  "objections_json",
  "buying_signals_json",
  "negative_signals_json",
  "products_json",
  "topics_json",
  "quality_warnings_json",
  "sentiment_label",
  "sentiment_score",
  "lead_source",
  "channel",
  "message_count",
  "lead_message_count",
  "agent_message_count",
  "first_message_at",
  "last_message_at",
  "first_response_minutes",
  "negotiation_duration_minutes",
  "quote_detected",
  "sale_detected",
  "loss_detected",
  "confidence",
  "analyzed_at",
].join(", ");

export class BusinessBrainAnalyzer {
  constructor(
    private readonly supabase: SupabaseClient<Database>,
    private readonly companyId: string,
  ) {}

  async collect(period: BrainPeriod): Promise<BrainRawDataset> {
    const now = new Date();
    const since = new Date(now.getTime() - daysFor(period) * 86400_000);

    // conversation_facts — a tabela ainda não aparece nos types gerados; cast pontual.
    // RLS garante isolamento por company_id.
    const loose = this.supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (col: string, v: unknown) => {
            gte: (col: string, v: unknown) => {
              order: (
                col: string,
                opts: { ascending: boolean },
              ) => {
                limit: (n: number) => Promise<{
                  data: RawFactRow[] | null;
                  error: { code?: string; message?: string } | null;
                }>;
              };
            };
          };
        };
      };
    };

    const factsRes = await loose
      .from("conversation_facts")
      .select(FACT_COLUMNS)
      .eq("company_id", this.companyId)
      .gte("analyzed_at", since.toISOString())
      .order("analyzed_at", { ascending: false })
      .limit(5000);

    const facts = factsRes.data ?? [];

    // Executive Knowledge — timeline curta para trends.
    const knowledgeRepo = new ExecutiveKnowledgeRepository(this.supabase, this.companyId);
    let knowledgeRecent: ExecutiveKnowledgeRecord[] = [];
    try {
      knowledgeRecent = await knowledgeRepo.timeline(period as ExecutivePeriod, 12);
    } catch {
      knowledgeRecent = [];
    }

    // Executive Snapshot — reaproveita agente existente (mesma RLS, sem escrita).
    let executiveSnapshot: ExecutiveDashboardBundle | null = null;
    try {
      const agent = new ExecutiveAgent({ supabase: this.supabase, companyId: this.companyId });
      executiveSnapshot = await agent.snapshot(period as ExecutivePeriod);
    } catch {
      executiveSnapshot = null;
    }

    return {
      period,
      since: since.toISOString(),
      now: now.toISOString(),
      facts,
      knowledgeRecent,
      executiveSnapshot,
    };
  }
}

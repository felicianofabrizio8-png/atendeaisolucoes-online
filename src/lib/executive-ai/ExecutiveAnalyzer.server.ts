// ============================================================================
// ExecutiveAnalyzer — Leitura pura dos dados existentes.
// READ-ONLY: apenas SELECTs, executados com o cliente Supabase AUTENTICADO
// do usuário (RLS aplicada normalmente). NÃO usa service_role/supabaseAdmin.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ExecutivePeriod, ExecutiveRange } from "./types";

type ExecSupabase = SupabaseClient<Database>;


export function resolveRange(period: ExecutivePeriod): ExecutiveRange {
  const to = new Date();
  const from = new Date();
  let days = 1;
  let label = "Hoje";
  if (period === "today") {
    from.setHours(0, 0, 0, 0);
    days = 1;
  } else if (period === "7d") {
    from.setDate(from.getDate() - 7);
    days = 7;
    label = "Últimos 7 dias";
  } else if (period === "30d") {
    from.setDate(from.getDate() - 30);
    days = 30;
    label = "Últimos 30 dias";
  } else {
    from.setDate(from.getDate() - 90);
    days = 90;
    label = "Últimos 90 dias";
  }
  return { from: from.toISOString(), to: to.toISOString(), label, days };
}

export interface RawExecutiveDataset {
  leads: Array<Record<string, any>>;
  conversations: Array<Record<string, any>>;
  messages: Array<Record<string, any>>;
  followUps: Array<Record<string, any>>;
  quotes: Array<Record<string, any>>;
  products: Array<Record<string, any>>;
  campaigns: Array<Record<string, any>>;
  campaignMetrics: Array<Record<string, any>>;
  campaignAnalyses: Array<Record<string, any>>;
  coachAlerts: Array<Record<string, any>>;
  aiFlowEvents: Array<Record<string, any>>;
  auditLog: Array<Record<string, any>>;
  companySettings: Record<string, any> | null;
}

/**
 * Lê todas as fontes necessárias para análise executiva.
 * Nenhuma escrita é feita. Falhas são degradadas para arrays vazios.
 */
export class ExecutiveAnalyzer {
  constructor(
    private readonly supabase: ExecSupabase,
    private readonly companyId: string,
    private readonly range: ExecutiveRange,
  ) {}

  private async safe<T = any>(
    fn: () => PromiseLike<{ data: T[] | null; error: unknown }>,
  ): Promise<T[]> {
    try {
      const { data } = await fn();
      return (data ?? []) as T[];
    } catch {
      return [];
    }
  }

  async load(): Promise<RawExecutiveDataset> {
    const { companyId, range, supabase } = this;
    // Alias local para reduzir o diff — TODAS as queries usam o cliente
    // autenticado (RLS aplicada). NENHUM uso de service_role.
    const db = supabase;
    const [
      leads,
      conversations,
      messages,
      followUps,
      quotes,
      products,
      campaigns,
      campaignMetrics,
      campaignAnalyses,
      coachAlerts,
      aiFlowEvents,
      auditLog,
    ] = await Promise.all([
      this.safe(() =>
        supabaseAdmin
          .from("leads")
          .select(
            "id, status, source, channel, estimated_value, closed_value, closed_at, lost_at, loss_reason, created_at, updated_at, last_contact_at",
          )
          .eq("company_id", companyId)
          .gte("created_at", range.from)
          .lte("created_at", range.to)
          .limit(5000),
      ),
      this.safe(() =>
        supabaseAdmin
          .from("conversations")
          .select(
            "id, lead_id, ai_status, lead_temperature, lead_score, detected_objections, updated_at, created_at",
          )
          .eq("company_id", companyId)
          .gte("updated_at", range.from)
          .limit(5000),
      ),
      this.safe(() =>
        supabaseAdmin
          .from("messages")
          .select("id, conversation_id, role, at, created_at")
          .eq("company_id", companyId)
          .gte("at", range.from)
          .limit(10000),
      ),
      this.safe(() =>
        supabaseAdmin
          .from("follow_ups")
          .select("id, status, sent_at, responded_at, cancelled_at, created_at")
          .eq("company_id", companyId)
          .gte("created_at", range.from)
          .limit(5000),
      ),
      this.safe(() =>
        supabaseAdmin
          .from("quotes")
          .select("id, conversation_id, sent, total, created_at, sent_at")
          .eq("company_id", companyId)
          .gte("created_at", range.from)
          .limit(5000),
      ),
      this.safe(() =>
        supabaseAdmin
          .from("products")
          .select("id, name, price, active, created_at")
          .eq("company_id", companyId)
          .limit(1000),
      ),
      this.safe(() =>
        supabaseAdmin
          .from("campaigns")
          .select("id, name, status, objective, created_at, updated_at")
          .eq("company_id", companyId)
          .limit(500),
      ),
      this.safe(() =>
        supabaseAdmin
          .from("campaign_metrics")
          .select("*")
          .eq("company_id", companyId)
          .gte("created_at", range.from)
          .limit(5000),
      ),
      this.safe(() =>
        supabaseAdmin
          .from("campaign_ai_analyses")
          .select("*")
          .eq("company_id", companyId)
          .gte("created_at", range.from)
          .limit(500),
      ),
      this.safe(() =>
        supabaseAdmin
          .from("coach_alerts")
          .select("id, conversation_id, severity, status, alert_type, created_at")
          .eq("company_id", companyId)
          .limit(2000),
      ),
      this.safe(() =>
        supabaseAdmin
          .from("ai_flow_events")
          .select("id, event_type, conversation_id, lead_id, created_at")
          .eq("company_id", companyId)
          .gte("created_at", range.from)
          .limit(5000),
      ),
      this.safe(() =>
        supabaseAdmin
          .from("audit_log")
          .select("id, action, entity, entity_id, created_at")
          .eq("company_id", companyId)
          .gte("created_at", range.from)
          .limit(2000),
      ),
    ]);

    let companySettings: Record<string, any> | null = null;
    try {
      const { data } = await supabaseAdmin
        .from("company_settings")
        .select("*")
        .eq("company_id", companyId)
        .maybeSingle();
      companySettings = data ?? null;
    } catch {
      companySettings = null;
    }

    return {
      leads,
      conversations,
      messages,
      followUps,
      quotes,
      products,
      campaigns,
      campaignMetrics,
      campaignAnalyses,
      coachAlerts,
      aiFlowEvents,
      auditLog,
      companySettings,
    };
  }
}

// ============================================================================
// Sales Intelligence Agent — Tipos
// 100% READ-ONLY. Reutiliza Executive Snapshot + Executive Knowledge + CRM.
// Não persiste nada. Não envia mensagens. Apenas recomenda.
// ============================================================================

import type { ExecutivePeriod, ExecutiveRange } from "@/lib/executive-ai/types";

export type SalesPriority = "high" | "medium" | "low";
export type SalesConfidence = "high" | "medium" | "low";

export type SalesOpportunityKind =
  | "hot_lead"              // temperatura quente / pronto para fechar
  | "quote_pending"         // orçamento enviado sem resposta
  | "quote_at_risk"         // orçamento próximo do vencimento
  | "awaiting_followup"     // follow-up agendado / esquecido
  | "forgotten_lead"        // lead sem contato há muitos dias
  | "no_response"           // aguardando resposta interna há muito tempo
  | "reengagement";         // lead morno/frio que voltou a interagir

export interface SalesOpportunity {
  id: string;                // = lead_id (interno; admin já tem acesso via CRM)
  leadRef: string;           // primeiros caracteres do nome para exibição
  leadName: string;          // nome do lead (dado do próprio CRM do admin)
  kind: SalesOpportunityKind;
  priority: SalesPriority;
  score: number;             // 0-100
  confidence: SalesConfidence;
  reason: string;            // explicação determinística
  nextAction: string;        // UMA ação recomendada
  meta: {
    status: string;
    temperature: string | null;
    estimatedValue: number | null;
    daysSinceLastActivity: number | null;
    hasQuote: boolean;
    lastQuoteStatus: string | null;
    daysSinceQuote: number | null;
  };
}

export interface SalesBottleneck {
  key: string;
  title: string;
  detail: string;
  severity: "critical" | "warn" | "info";
}

export interface SalesConversionTrend {
  currentConversionRate: number;
  previousConversionRate: number | null;
  direction: "up" | "down" | "flat" | "unknown";
  deltaPct: number | null;
  note: string;
}

export interface SalesIntelligenceBundle {
  generatedAt: string;
  period: ExecutivePeriod;
  range: ExecutiveRange;
  totals: {
    scanned: number;
    opportunities: number;
    high: number;
    medium: number;
    low: number;
  };
  opportunities: SalesOpportunity[];
  bottlenecks: SalesBottleneck[];
  conversionTrend: SalesConversionTrend;
  fromCache: boolean;
  cachedUntil: string;
}

// ============================================================================
// Executive Knowledge — Tipos compartilhados.
// 100% agregados. Nunca contém PII (nomes, telefones, mensagens, IDs externos).
// ============================================================================

import type { ExecutivePeriod } from "@/lib/executive-ai/types";

export const KNOWLEDGE_VERSION = 1;

// -------- Facts: recorte determinístico do snapshot -----------------------
export interface KnowledgeFacts {
  period: ExecutivePeriod;
  rangeDays: number;
  attendance: {
    newLeads: number;
    attendedLeads: number;
    unansweredLeads: number;
    avgResponseMinutes: number;
    conversionRate: number;
  };
  sales: {
    quotesIssued: number;
    estimatedSales: number;
    averageTicket: number;
    closedCount: number;
    lostCount: number;
  };
  campaigns: {
    avgCostPerLead: number;
    avgCostPerConversation: number;
    bestCount: number;
    worstCount: number;
  };
  followups: {
    pending: number;
    completed: number;
    cancelled: number;
  };
  coach: {
    openAlerts: number;
    criticalAlerts: number;
  };
  aiUsage: {
    autoReplies: number;
    handoffs: number;
    qualifications: number;
    timeSavedMinutes: number;
  };
  dataQuality: {
    tablesEmpty: string[];
    unavailable: string[];
    estimated: string[];
    warnings: string[];
  };
}

// -------- Highlights: destaques determinísticos ---------------------------
export type HighlightLevel = "good" | "warn" | "critical" | "info";
export interface KnowledgeHighlight {
  key: string;
  level: HighlightLevel;
  title: string;
  detail: string;
}

// -------- Recommendations: derivadas de insights + heurísticas ------------
export interface KnowledgeRecommendation {
  key: string;
  priority: "high" | "medium" | "low";
  text: string;
}

// -------- Registro persistido --------------------------------------------
export interface ExecutiveKnowledgeRecord {
  id: string;
  companyId: string;
  snapshotGeneratedAt: string;
  period: ExecutivePeriod;
  knowledgeVersion: number;
  facts: KnowledgeFacts;
  highlights: KnowledgeHighlight[];
  recommendations: KnowledgeRecommendation[];
  createdAt: string;
}

// -------- Comparação entre dois registros --------------------------------
export interface KnowledgeDelta {
  metric: string;
  label: string;
  previous: number;
  current: number;
  absoluteDelta: number;
  percentDelta: number | null;
  direction: "up" | "down" | "flat";
  trend: "improved" | "worsened" | "neutral";
}

export interface KnowledgeComparison {
  previousSnapshotAt: string | null;
  currentSnapshotAt: string;
  daysBetween: number | null;
  deltas: KnowledgeDelta[];
  newFacts: string[];
  improvements: string[];
  regressions: string[];
  summary: string;
}

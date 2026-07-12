// ============================================================================
// Executive Intelligence — Tipos e modelos compartilhados
// 100% READ-ONLY. Nenhum destes tipos representa mutação de dados existentes.
// ============================================================================

export type ExecutivePeriod = "today" | "7d" | "30d" | "90d";

export interface ExecutiveRange {
  from: string; // ISO
  to: string; // ISO
  label: string;
  days: number;
}

// ---------------------------------------------------------------------------
// Métricas
// ---------------------------------------------------------------------------
export interface AttendanceMetrics {
  newLeads: number;
  attendedLeads: number;
  unansweredLeads: number;
  avgResponseMinutes: number;
  conversionRate: number; // %
  // Segmentação humano vs IA: null quando não puder ser inferida com segurança.
  humanAttendedLeads: number | null;
  aiAttendedLeads: number | null;
  mixedAttendedLeads: number | null;
}

export interface SalesMetrics {
  quotesIssued: number;
  estimatedSales: number; // R$
  averageTicket: number; // R$
  closedCount: number;
  lostCount: number;
}

export interface CampaignPerformance {
  id: string;
  name: string;
  spend: number;
  leads: number;
  costPerLead: number;
  costPerConversation: number;
  ctr: number;
  score: number;
}

export interface CampaignMetricsBundle {
  best: CampaignPerformance[];
  worst: CampaignPerformance[];
  avgCostPerLead: number;
  avgCostPerConversation: number;
}

export interface ProductPerformance {
  id: string;
  name: string;
  soldCount: number;
  revenue: number;
}

export interface LossReasonBreakdown {
  reason: string;
  count: number;
  value: number;
}

export interface FollowupMetrics {
  pending: number;
  completed: number;
  cancelled: number;
}

export interface CoachMetrics {
  openAlerts: number;
  criticalAlerts: number;
  bySeverity: Record<string, number>;
}

export interface AIUsageMetrics {
  autoReplies: number;
  handoffs: number;
  qualifications: number;
  timeSavedMinutes: number;
}

export interface EvolutionPoint {
  bucket: string; // YYYY-MM-DD ou YYYY-Www / YYYY-MM
  leads: number;
  conversations: number;
  sales: number;
}

export interface EvolutionSeries {
  daily: EvolutionPoint[];
  weekly: EvolutionPoint[];
  monthly: EvolutionPoint[];
}

export interface ExecutiveMetricsBundle {
  range: ExecutiveRange;
  attendance: AttendanceMetrics;
  sales: SalesMetrics;
  campaigns: CampaignMetricsBundle;
  topProducts: ProductPerformance[];
  worstProducts: ProductPerformance[];
  lossReasons: LossReasonBreakdown[];
  followups: FollowupMetrics;
  coach: CoachMetrics;
  aiUsage: AIUsageMetrics;
  evolution: EvolutionSeries;
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------
export type InsightLevel = "info" | "good" | "warn" | "critical";
export type InsightCategory =
  | "bottleneck"
  | "opportunity"
  | "campaign"
  | "forgotten_client"
  | "trending_product"
  | "low_product"
  | "commercial"
  | "operational";

export type InsightConfidence = "high" | "medium" | "low";

export interface InsightEvidence {
  metrics: string[];
  reason: string;
}

export interface ExecutiveInsight {
  id: string;
  category: InsightCategory;
  level: InsightLevel;
  title: string;
  description: string;
  metricRef?: string;
  recommendation?: string;
  confidence: InsightConfidence;
  evidence: InsightEvidence;
}

// ---------------------------------------------------------------------------
// Data quality diagnostics
// ---------------------------------------------------------------------------
export interface DataQualityReport {
  tablesQueried: string[];
  tablesEmpty: string[];
  tableRowCounts: Record<string, number>;
  unavailableMetrics: Array<{ metric: string; reason: string }>;
  estimatedMetrics: Array<{ metric: string; note: string }>;
  warnings: string[];
  period: ExecutivePeriod;
  range: ExecutiveRange;
  timezone: string;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Dashboard bundle
// ---------------------------------------------------------------------------
export interface ExecutiveDashboardBundle {
  range: ExecutiveRange;
  period: ExecutivePeriod;
  metrics: ExecutiveMetricsBundle;
  insights: ExecutiveInsight[];
  dataQuality: DataQualityReport;
  generatedAt: string;
}

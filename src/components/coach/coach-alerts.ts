// Alertas da conversa (coach_alerts): rótulos e estilos usados pelos dois painéis de IA.

export interface CoachAlert {
  id: string;
  alert_type: string;
  severity: "low" | "medium" | "high" | "critical";
  urgency_minutes: number | null;
  risk_score: number;
  payload: Record<string, unknown> | null;
  status: string;
  created_at: string;
}

export const ALERT_LABEL: Record<string, string> = {
  no_response: "Cliente sem resposta",
  followup_overdue: "Follow-up vencido",
  quote_no_reply: "Orçamento sem retorno",
  window_closing: "Janela 24h fechando",
  hot_lead_unattended: "Lead quente sem atendimento",
  awaiting_quote: "Aguardando orçamento",
  discount_requested: "Pediu desconto",
  will_research: "Disse que vai pesquisar",
  spouse_decision: "Decisão com cônjuge",
};

export const SEVERITY_STYLE: Record<string, string> = {
  low: "bg-muted text-muted-foreground border-border",
  medium: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  high: "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30",
  critical: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30",
};

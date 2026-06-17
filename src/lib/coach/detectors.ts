// Coach V1 — pure detection logic. No DB, no side effects.
// Each detector receives the conversation snapshot and returns 0..N alerts.

export type AlertType =
  | "no_response"
  | "followup_overdue"
  | "quote_no_reply"
  | "window_closing"
  | "hot_lead_unattended"
  | "awaiting_quote"
  | "discount_requested"
  | "will_research"
  | "spouse_decision";

export type Severity = "low" | "medium" | "high" | "critical";

export interface DetectedAlert {
  alert_type: AlertType;
  severity: Severity;
  urgency_minutes?: number;
  risk_score: number;
  payload: Record<string, unknown>;
}

export interface MessageLite {
  id: string;
  role: "lead" | "agent" | "system";
  text: string;
  at: string; // ISO
  source_subtype?: string | null;
}

export interface ConversationSnapshot {
  conversation_id: string;
  lead_id: string;
  lead_status?: string | null;
  lead_temperature?: string | null;
  awaiting_reply: boolean;
  ai_status?: string | null;
  human_takeover_at?: string | null;
  next_action_due_at?: string | null;
  last_quote_sent_at?: string | null;
  has_quote: boolean;
  messages: MessageLite[]; // last N, oldest→newest
}

const KW = {
  discount: /\b(desconto|abate|abaixa|melhor pre[çc]o|condi[çc][ãa]o especial)\b/i,
  price: /\b(pre[çc]o|valor|quanto custa|quanto fica|or[çc]amento)\b/i,
  spouse: /\b(esposo|esposa|marido|mulher|namorad[oa]|conversar com|falar com o meu|com a minha)\b/i,
  research: /\b(vou pesquisar|vou ver|vou pensar|te retorno|depois eu (retorno|falo)|preciso pensar)\b/i,
};

const MEDIA_SUBTYPES = new Set(["image", "audio", "video", "document", "sticker"]);

function minutesSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

function lastLeadMessage(msgs: MessageLite[]): MessageLite | null {
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === "lead") return msgs[i];
  return null;
}

function lastAgentMessage(msgs: MessageLite[]): MessageLite | null {
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === "agent") return msgs[i];
  return null;
}

export function detectAlerts(snap: ConversationSnapshot): DetectedAlert[] {
  const alerts: DetectedAlert[] = [];
  const lastLead = lastLeadMessage(snap.messages);
  const lastAgent = lastAgentMessage(snap.messages);
  const lastIsLead = snap.messages.length > 0 && snap.messages[snap.messages.length - 1].role === "lead";

  // 1) no_response — última msg é do cliente e ninguém respondeu
  if (lastIsLead && lastLead) {
    const mins = minutesSince(lastLead.at);
    if (mins >= 30) {
      const severity: Severity = mins >= 240 ? "critical" : mins >= 120 ? "high" : "medium";
      alerts.push({
        alert_type: "no_response",
        severity,
        urgency_minutes: mins,
        risk_score: Math.min(100, 30 + Math.floor(mins / 10)),
        payload: { last_message_at: lastLead.at, message_id: lastLead.id },
      });
    }
  }

  // 2) followup_overdue
  if (snap.next_action_due_at) {
    const due = new Date(snap.next_action_due_at).getTime();
    if (due < Date.now()) {
      const lateMin = Math.floor((Date.now() - due) / 60000);
      alerts.push({
        alert_type: "followup_overdue",
        severity: lateMin >= 1440 ? "high" : "medium",
        urgency_minutes: lateMin,
        risk_score: Math.min(100, 40 + Math.floor(lateMin / 60)),
        payload: { due_at: snap.next_action_due_at, late_minutes: lateMin },
      });
    }
  }

  // 3) quote_no_reply — orçamento enviado, sem msg do cliente depois
  if (snap.has_quote && snap.last_quote_sent_at) {
    const sentAt = new Date(snap.last_quote_sent_at).getTime();
    const hasLeadReplyAfter = snap.messages.some(
      (m) => m.role === "lead" && new Date(m.at).getTime() > sentAt,
    );
    const hoursSince = Math.floor((Date.now() - sentAt) / 3600000);
    if (!hasLeadReplyAfter && hoursSince >= 12) {
      alerts.push({
        alert_type: "quote_no_reply",
        severity: hoursSince >= 48 ? "high" : "medium",
        urgency_minutes: hoursSince * 60,
        risk_score: Math.min(100, 50 + hoursSince),
        payload: { quote_sent_at: snap.last_quote_sent_at, hours_since: hoursSince },
      });
    }
  }

  // 4) window_closing — janela 24h WhatsApp prestes a fechar
  if (lastLead) {
    const hoursSinceLeadMsg = (Date.now() - new Date(lastLead.at).getTime()) / 3600000;
    if (hoursSinceLeadMsg >= 20 && hoursSinceLeadMsg < 24) {
      alerts.push({
        alert_type: "window_closing",
        severity: hoursSinceLeadMsg >= 23 ? "critical" : "high",
        urgency_minutes: Math.floor((24 - hoursSinceLeadMsg) * 60),
        risk_score: 80,
        payload: { hours_remaining: Math.max(0, 24 - hoursSinceLeadMsg).toFixed(1) },
      });
    }
  }

  // 5) hot_lead_unattended
  if (
    snap.lead_temperature === "quente" &&
    (snap.awaiting_reply || (lastIsLead && lastLead && minutesSince(lastLead.at) >= 10))
  ) {
    alerts.push({
      alert_type: "hot_lead_unattended",
      severity: "high",
      urgency_minutes: lastLead ? minutesSince(lastLead.at) : undefined,
      risk_score: 85,
      payload: { temperature: snap.lead_temperature },
    });
  }

  // 6) awaiting_quote — cliente pediu preço/orçamento e ainda não tem quote
  if (lastLead && !snap.has_quote && KW.price.test(lastLead.text)) {
    // só dispara se o agente ainda não respondeu depois desse pedido
    const agentRepliedAfter =
      lastAgent && new Date(lastAgent.at).getTime() > new Date(lastLead.at).getTime();
    if (!agentRepliedAfter) {
      alerts.push({
        alert_type: "awaiting_quote",
        severity: "medium",
        urgency_minutes: minutesSince(lastLead.at),
        risk_score: 55,
        payload: { message_id: lastLead.id, snippet: lastLead.text.slice(0, 140) },
      });
    }
  }

  // 7-9) Objeções no texto do cliente recente
  if (lastLead) {
    const t = lastLead.text;
    if (KW.discount.test(t)) {
      alerts.push({
        alert_type: "discount_requested",
        severity: "medium",
        urgency_minutes: minutesSince(lastLead.at),
        risk_score: 60,
        payload: { message_id: lastLead.id, snippet: t.slice(0, 140) },
      });
    }
    if (KW.research.test(t)) {
      alerts.push({
        alert_type: "will_research",
        severity: "medium",
        urgency_minutes: minutesSince(lastLead.at),
        risk_score: 65,
        payload: { message_id: lastLead.id, snippet: t.slice(0, 140) },
      });
    }
    if (KW.spouse.test(t)) {
      alerts.push({
        alert_type: "spouse_decision",
        severity: "medium",
        urgency_minutes: minutesSince(lastLead.at),
        risk_score: 50,
        payload: { message_id: lastLead.id, snippet: t.slice(0, 140) },
      });
    }
  }

  // Bonus: mídia sem resposta (foto/áudio/vídeo do cliente sem reply do agente)
  if (lastLead && lastLead.source_subtype && MEDIA_SUBTYPES.has(lastLead.source_subtype)) {
    const agentRepliedAfter =
      lastAgent && new Date(lastAgent.at).getTime() > new Date(lastLead.at).getTime();
    if (!agentRepliedAfter && minutesSince(lastLead.at) >= 15) {
      // reaproveita no_response com payload destacando mídia (já dispara, então só enriquece)
      // Não duplicamos alerta, já temos no_response acima.
    }
  }

  return alerts;
}

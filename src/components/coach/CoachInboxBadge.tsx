import { cn } from "@/lib/utils";
import type { CoachAlertLite } from "@/hooks/useCoachAlerts";

interface AlertVisual {
  emoji: string;
  label: (a: CoachAlertLite) => string;
  tone: "urgent" | "warn" | "info";
}

const ALERT_MAP: Record<string, AlertVisual> = {
  no_response: {
    emoji: "⚠️",
    label: (a) => {
      const m = a.urgency_minutes ?? 0;
      if (m >= 60) {
        const h = Math.round(m / 60);
        return `Cliente sem resposta há ${h}h`;
      }
      return m > 0 ? `Cliente sem resposta há ${m}min` : "Cliente sem resposta";
    },
    tone: "urgent",
  },
  followup_overdue: { emoji: "⏰", label: () => "Follow-up atrasado", tone: "warn" },
  quote_no_reply: { emoji: "💰", label: () => "Orçamento aguardando retorno", tone: "warn" },
  awaiting_quote: { emoji: "💰", label: () => "Aguardando orçamento", tone: "warn" },
  window_closing: { emoji: "🪟", label: () => "Janela WhatsApp fechando", tone: "warn" },
  hot_lead_unattended: { emoji: "🔥", label: () => "Lead quente parado", tone: "urgent" },
  location_requested: { emoji: "📍", label: () => "Cliente pediu localização", tone: "info" },
  payment_requested: { emoji: "💳", label: () => "Cliente pediu pagamento/parcelamento", tone: "info" },
  discount_requested: { emoji: "💳", label: () => "Cliente pediu desconto", tone: "info" },
  will_research: { emoji: "🧊", label: () => "Cliente esfriando", tone: "info" },
  cooling_down: { emoji: "🧊", label: () => "Cliente esfriando", tone: "info" },
  spouse_decision: { emoji: "👥", label: () => "Decisão com cônjuge", tone: "info" },
  audio_unanalyzed: { emoji: "🎧", label: () => "Cliente enviou áudio não analisado", tone: "info" },
};

const TONE_CLASSES: Record<AlertVisual["tone"], string> = {
  urgent: "bg-[var(--status-urgent)]/15 text-[var(--status-urgent)] border-[var(--status-urgent)]/40",
  warn: "bg-amber-500/10 text-amber-500 border-amber-500/30",
  info: "bg-primary/10 text-primary border-primary/30",
};

export function CoachInboxBadge({ alert }: { alert: CoachAlertLite }) {
  const visual = ALERT_MAP[alert.alert_type] ?? {
    emoji: "🤖",
    label: () => "Coach IA: atenção",
    tone: "info" as const,
  };
  const text = visual.label(alert);
  return (
    <span
      className={cn(
        "mt-1 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold max-w-full",
        TONE_CLASSES[visual.tone],
      )}
      title={`Coach IA · ${text}`}
    >
      <span className="shrink-0" aria-hidden>{visual.emoji}</span>
      <span className="truncate">Coach: {text}</span>
    </span>
  );
}

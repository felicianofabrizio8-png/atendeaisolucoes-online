import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  MapPin,
  Ruler,
  Target,
  AlertTriangle,
  Flame,
  CheckCircle2,
  UserCheck,
  Bot,
  Clock,
  TriangleAlert,
  Send,
  XCircle,
  DollarSign,
  Calendar,
  User2,
  Activity,
} from "lucide-react";

type FlowEvent = {
  id: string;
  event_type: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

type Meta = { icon: typeof Flame; color: string; label: (p: Record<string, unknown>) => string };

const META: Record<string, Meta> = {
  detected_city:        { icon: MapPin,        color: "#60a5fa", label: (p) => `Cidade detectada: ${p.value ?? "—"}` },
  detected_state:       { icon: MapPin,        color: "#60a5fa", label: (p) => `Estado detectado: ${p.value ?? "—"}` },
  detected_size:        { icon: Ruler,         color: "#60a5fa", label: (p) => `Medida detectada: ${p.value ?? "—"}` },
  detected_interest:    { icon: Target,        color: "#60a5fa", label: (p) => `Interesse: ${p.value ?? "—"}` },
  detected_budget:      { icon: DollarSign,    color: "#60a5fa", label: (p) => `Orçamento: ${p.value ?? "—"}` },
  detected_timing:      { icon: Calendar,      color: "#60a5fa", label: (p) => `Prazo de compra: ${p.value ?? "—"}` },
  detected_stage:       { icon: User2,         color: "#60a5fa", label: (p) => `Estágio: ${p.value ?? "—"}` },
  detected_objection:   { icon: AlertTriangle, color: "#f59e0b", label: (p) => `Objeção: ${p.value ?? "—"}` },
  lead_temperature_changed: {
    icon: Flame, color: "#ef4444",
    label: (p) => `Temperatura: ${p.from ?? "—"} → ${p.to ?? "—"}${p.score ? ` (score ${p.score})` : ""}`,
  },
  ready_to_close_detected: { icon: CheckCircle2, color: "#10b981", label: () => "Lead pronto para fechar" },
  lead_bumped_to_hot:      { icon: Flame,        color: "#ef4444", label: () => "Lead promovido a quente" },
  handoff_human:           { icon: UserCheck,    color: "#f59e0b", label: (p) => `Handoff humano${p.reason ? `: ${p.reason}` : ""}` },
  handoff_requested:       { icon: UserCheck,    color: "#f59e0b", label: (p) => `Handoff solicitado${p.reason ? `: ${p.reason}` : ""}` },
  handoff_safety_block:    { icon: TriangleAlert,color: "#ef4444", label: (p) => `Bloqueio de segurança${p.reason ? `: ${p.reason}` : ""}` },
  handoff_timeout_alert:   { icon: Clock,        color: "#ef4444", label: () => "Humano não assumiu (timeout)" },
  auto_reply_sent:         { icon: Bot,          color: "#a78bfa", label: () => "IA respondeu automaticamente" },
  agent_error:             { icon: XCircle,      color: "#ef4444", label: (p) => `Erro do agente${p.error ? `: ${p.error}` : ""}` },
};

function metaFor(type: string): Meta {
  if (META[type]) return META[type];
  if (type.startsWith("skipped_")) {
    return { icon: Activity, color: "#64748b", label: () => `IA pulou (${type.replace("skipped_", "")})` };
  }
  return { icon: Activity, color: "#64748b", label: () => type };
}

function timeShort(iso: string) {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 60000;
  if (diff < 1) return "agora";
  if (diff < 60) return `${Math.round(diff)}m`;
  if (diff < 60 * 24) return `${Math.round(diff / 60)}h`;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export function AITimeline({ conversationId }: { conversationId: string }) {
  const [events, setEvents] = useState<FlowEvent[] | null>(null);

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("ai_flow_events")
        .select("id, event_type, payload, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(40);
      if (!cancelled) setEvents((data ?? []) as FlowEvent[]);
    };
    void load();
    const ch = supabase
      .channel(`flow-${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "ai_flow_events", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          setEvents((prev) => [(payload.new as FlowEvent), ...(prev ?? [])].slice(0, 40));
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(ch);
    };
  }, [conversationId]);

  return (
    <div className="p-4 border-b border-border">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground mb-2">
        <Activity className="h-3 w-3" /> Timeline IA
      </div>
      {events === null ? (
        <p className="text-xs text-muted-foreground">Carregando…</p>
      ) : events.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum evento ainda.</p>
      ) : (
        <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
          {events.map((e) => {
            const m = metaFor(e.event_type);
            const Icon = m.icon;
            return (
              <li key={e.id} className="flex items-start gap-2 text-[11px]">
                <Icon className="h-3 w-3 mt-0.5 shrink-0" style={{ color: m.color }} />
                <span className="flex-1 leading-snug text-foreground/90">
                  {m.label((e.payload ?? {}) as Record<string, unknown>)}
                </span>
                <span className="text-muted-foreground tabular-nums shrink-0">
                  {timeShort(e.created_at)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// silence unused
void Send;

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/auth/AuthContext";

export interface CoachAlertLite {
  id: string;
  conversation_id: string;
  alert_type: string;
  severity: "low" | "medium" | "high" | "critical";
  urgency_minutes: number | null;
  created_at: string;
}

const SEVERITY_RANK: Record<CoachAlertLite["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Lê coach_alerts (status='open') da empresa atual e devolve um Map por
 * conversation_id já ordenado por severidade (mais grave primeiro).
 * Atualiza via Realtime — não escreve nada no banco, não dispara IA.
 */
export function useCoachAlerts() {
  const { profile } = useAuth();
  const companyId = profile?.company_id ?? null;
  const [alerts, setAlerts] = useState<CoachAlertLite[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!companyId) {
      setAlerts([]);
      return;
    }
    const cid = companyId;
    let cancelled = false;

    async function load() {
      setLoading(true);
      const { data } = await supabase
        .from("coach_alerts")
        .select("id, conversation_id, alert_type, severity, urgency_minutes, created_at")
        .eq("company_id", cid)
        .eq("status", "open");
      if (!cancelled) {
        setAlerts((data ?? []) as CoachAlertLite[]);
        setLoading(false);
      }
    }
    load();

    // Unique channel per hook instance — multiple components (inbox.index +
    // OpsCockpit) montam este hook em paralelo. Reusar o mesmo nome faria o
    // Supabase devolver o channel já inscrito e o segundo .on() lançaria
    // "cannot add postgres_changes callbacks after subscribe()".
    const uid =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(`coach_alerts_inbox_${cid}_${uid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "coach_alerts", filter: `company_id=eq.${cid}` },
        () => {
          load();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [companyId]);

  const alertsByConv = useMemo(() => {
    const map = new Map<string, CoachAlertLite[]>();
    for (const a of alerts) {
      const arr = map.get(a.conversation_id) ?? [];
      arr.push(a);
      map.set(a.conversation_id, arr);
    }
    for (const arr of map.values()) {
      arr.sort((x, y) => SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity]);
    }
    return map;
  }, [alerts]);

  return { alertsByConv, loading, totalConversations: alertsByConv.size };
}

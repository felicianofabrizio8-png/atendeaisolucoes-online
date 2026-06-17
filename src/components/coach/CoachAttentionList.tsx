import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  AlertTriangle,
  RefreshCcw,
  Loader2,
  ChevronRight,
} from "lucide-react";

interface CoachAlertRow {
  id: string;
  conversation_id: string;
  lead_id: string | null;
  alert_type: string;
  severity: "low" | "medium" | "high" | "critical";
  urgency_minutes: number | null;
  risk_score: number;
  created_at: string;
  leads?: { name: string | null } | null;
}

const ALERT_LABEL: Record<string, string> = {
  no_response: "Sem resposta",
  followup_overdue: "Follow-up vencido",
  quote_no_reply: "Orçamento sem retorno",
  window_closing: "Janela 24h fechando",
  hot_lead_unattended: "Lead quente sem atendimento",
  awaiting_quote: "Aguardando orçamento",
  discount_requested: "Pediu desconto",
  will_research: "Vai pesquisar",
  spouse_decision: "Decisão com cônjuge",
};

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const SEVERITY_DOT: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-amber-500",
  low: "bg-muted-foreground",
};

export function CoachAttentionList() {
  const { profile } = useAuth();
  const companyId = profile?.company_id ?? null;
  const [alerts, setAlerts] = useState<CoachAlertRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<string | null>(null);

  async function loadAlerts() {
    if (!companyId) return;
    const { data } = await supabase
      .from("coach_alerts")
      .select("id, conversation_id, lead_id, alert_type, severity, urgency_minutes, risk_score, created_at, leads(name)")
      .eq("company_id", companyId)
      .eq("status", "open")
      .order("severity", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(20);
    const sorted = (data as unknown as CoachAlertRow[] ?? []).slice().sort(
      (a, b) =>
        (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9),
    );
    setAlerts(sorted);
  }

  useEffect(() => {
    void loadAlerts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  async function runCompanyScan() {
    setLoading(true);
    setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sessão expirada");
      const res = await fetch("/api/coach/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ scope: "company", limit: 80 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha");
      setLastRun(`${json.scanned ?? 0} conversas · ${json.created ?? 0} novos · ${json.resolved ?? 0} resolvidos`);
      await loadAlerts();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="h-4 w-4 text-primary shrink-0" />
          <h2 className="text-sm font-semibold truncate">Atenção do Coach</h2>
          {alerts.length > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              {alerts.length}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={runCompanyScan}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />}
          Atualizar Coach agora
        </button>
      </div>

      <div className="p-4 space-y-2">
        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
        {lastRun && <div className="text-[11px] text-muted-foreground">Última varredura: {lastRun}</div>}

        {alerts.length === 0 && !loading && (
          <div className="text-xs text-muted-foreground py-6 text-center">
            Nenhum alerta aberto. Clique em "Atualizar Coach agora" para varrer as conversas.
          </div>
        )}

        {alerts.map((a) => (
          <Link
            key={a.id}
            to="/inbox/$conversationId"
            params={{ conversationId: a.conversation_id }}
            className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 hover:bg-muted/50"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className={cn("h-2 w-2 rounded-full shrink-0", SEVERITY_DOT[a.severity] ?? "bg-muted-foreground")} />
              <div className="min-w-0">
                <div className="text-xs font-medium truncate">
                  {a.leads?.name ?? "Lead"} · {ALERT_LABEL[a.alert_type] ?? a.alert_type}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {a.urgency_minutes != null
                    ? a.urgency_minutes < 60
                      ? `há ${a.urgency_minutes} min`
                      : `há ${Math.floor(a.urgency_minutes / 60)}h`
                    : ""}
                  {a.risk_score > 0 && ` · risco ${a.risk_score}`}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

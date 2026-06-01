// ============================================================================
// AIAnalyticsDashboard
// Painel executivo da IA: métricas, conversão, timeline e insights.
// Consome /api/ai/analytics — não altera engine, meta-send, meta-webhook.
// ============================================================================

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  BarChart3,
  Bot,
  CheckCircle2,
  Clock,
  Flame,
  HandshakeIcon,
  Loader2,
  MessageSquare,
  RefreshCw,
  Target,
  TrendingUp,
  AlertTriangle,
  Sparkles,
  Trophy,
} from "lucide-react";

type Period = "today" | "7d" | "30d";

interface Metrics {
  leadsAttended: number;
  autoReplies: number;
  handoffs: number;
  qualifiedLeads: number;
  hotLeads: number;
  readyToClose: number;
  timeSavedMinutes: number;
  sendFailures: number;
  preAttended: number;
}
interface Conversion {
  aiToQuote: number;
  aiToVisit: number;
  aiToSale: number;
  aiToLost: number;
  conversionRate: number;
  influencedRevenue: number;
  recoveredLeads: number;
}
interface TimelineItem {
  id: string;
  type: string;
  label: string;
  conversation_id: string | null;
  created_at: string;
}
interface Insight {
  id: string;
  level: "info" | "good" | "warn";
  text: string;
}
interface Bundle {
  range: { from: string; to: string; label: string; days: number };
  metrics: Metrics;
  conversion: Conversion;
  hourly: Array<{ hour: number; autoReplies: number; handoffs: number }>;
  topObjections: Array<{ label: string; count: number }>;
  insights: Insight[];
  timeline: TimelineItem[];
}

function fmtBRL(n: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(n || 0);
}
function fmtMinutes(m: number) {
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}min` : `${h}h`;
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: typeof Bot;
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "good" | "warn" | "hot";
}) {
  const toneCls =
    tone === "good"
      ? "text-emerald-500"
      : tone === "warn"
        ? "text-amber-500"
        : tone === "hot"
          ? "text-orange-500"
          : "text-primary";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{label}</span>
          <Icon className={`h-4 w-4 ${toneCls}`} />
        </div>
        <div className="mt-2 text-2xl font-semibold">{value}</div>
        {hint ? (
          <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function AIAnalyticsDashboard() {
  const [period, setPeriod] = useState<Period>("7d");
  const [data, setData] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async (p: Period) => {
    setLoading(true);
    setErr(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? "";
      const res = await fetch(`/api/ai/analytics?period=${p}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Falha");
      setData(json as Bundle);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao carregar analytics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(period);
  }, [period]);

  const peakHour =
    data?.hourly && data.hourly.length
      ? [...data.hourly].sort((a, b) => b.autoReplies - a.autoReplies)[0]
      : null;
  const maxAuto = peakHour?.autoReplies ?? 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              Dashboard executivo da IA
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Impacto real da IA nas vendas — {data?.range.label ?? "..."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-border overflow-hidden">
              {(["today", "7d", "30d"] as Period[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 text-xs font-medium transition ${
                    period === p
                      ? "bg-primary text-primary-foreground"
                      : "bg-background hover:bg-muted text-muted-foreground"
                  }`}
                >
                  {p === "today" ? "Hoje" : p === "7d" ? "7 dias" : "30 dias"}
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => load(period)}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
        </CardHeader>
      </Card>

      {err ? (
        <Card className="border-destructive/40">
          <CardContent className="p-4 text-sm text-destructive">{err}</CardContent>
        </Card>
      ) : null}

      {!data && loading ? (
        <Card>
          <CardContent className="p-6 flex items-center justify-center text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando métricas...
          </CardContent>
        </Card>
      ) : null}

      {data ? (
        <>
          {/* Métricas da IA */}
          <div>
            <h3 className="text-sm font-medium mb-2 text-muted-foreground">
              Métricas da IA
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricCard
                icon={Bot}
                label="Leads atendidos pela IA"
                value={data.metrics.leadsAttended}
              />
              <MetricCard
                icon={MessageSquare}
                label="Respostas automáticas"
                value={data.metrics.autoReplies}
              />
              <MetricCard
                icon={HandshakeIcon}
                label="Transferidos para humano"
                value={data.metrics.handoffs}
              />
              <MetricCard
                icon={CheckCircle2}
                label="Leads qualificados"
                value={data.metrics.qualifiedLeads}
                tone="good"
              />
              <MetricCard
                icon={Flame}
                label="Leads quentes"
                value={data.metrics.hotLeads}
                tone="hot"
              />
              <MetricCard
                icon={Target}
                label="Prontos para fechar"
                value={data.metrics.readyToClose}
                tone="good"
              />
              <MetricCard
                icon={Clock}
                label="Tempo economizado"
                value={fmtMinutes(data.metrics.timeSavedMinutes)}
                hint="≈3 min por resposta automática"
              />
              <MetricCard
                icon={AlertTriangle}
                label="Falhas de envio"
                value={data.metrics.sendFailures}
                tone={data.metrics.sendFailures > 0 ? "warn" : "default"}
              />
            </div>
          </div>

          {/* Conversão */}
          <div>
            <h3 className="text-sm font-medium mb-2 text-muted-foreground">
              Conversão atribuída à IA
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricCard
                icon={Activity}
                label="IA → Orçamento"
                value={data.conversion.aiToQuote}
              />
              <MetricCard
                icon={Activity}
                label="IA → Visita"
                value={data.conversion.aiToVisit}
              />
              <MetricCard
                icon={Trophy}
                label="IA → Venda"
                value={data.conversion.aiToSale}
                tone="good"
              />
              <MetricCard
                icon={AlertTriangle}
                label="IA → Perdido"
                value={data.conversion.aiToLost}
                tone="warn"
              />
              <MetricCard
                icon={TrendingUp}
                label="Taxa de conversão IA"
                value={`${data.conversion.conversionRate.toFixed(1)}%`}
                tone="good"
              />
              <MetricCard
                icon={Trophy}
                label="Vendas influenciadas"
                value={fmtBRL(data.conversion.influencedRevenue)}
                tone="good"
              />
              <MetricCard
                icon={Sparkles}
                label="Leads recuperados"
                value={data.conversion.recoveredLeads}
                tone="good"
              />
              <MetricCard
                icon={Bot}
                label="Pré-atendidos"
                value={data.metrics.preAttended}
              />
            </div>
          </div>

          {/* Horários e objeções */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  Horários com mais automação
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end gap-0.5 h-32">
                  {data.hourly.map((h) => {
                    const pct =
                      maxAuto > 0
                        ? Math.max((h.autoReplies / maxAuto) * 100, 2)
                        : 2;
                    return (
                      <div
                        key={h.hour}
                        className="flex-1 flex flex-col items-center justify-end"
                        title={`${String(h.hour).padStart(2, "0")}h — ${h.autoReplies} respostas, ${h.handoffs} handoffs`}
                      >
                        <div
                          className="w-full bg-primary/70 rounded-t"
                          style={{ height: `${pct}%` }}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>00h</span>
                  <span>06h</span>
                  <span>12h</span>
                  <span>18h</span>
                  <span>23h</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Objeções mais comuns
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.topObjections.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nenhuma objeção detectada no período.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {data.topObjections.map((o) => (
                      <li
                        key={o.label}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="truncate">{o.label}</span>
                        <Badge variant="secondary">{o.count}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Insights e Timeline */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Insights automáticos
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.insights.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Sem insights ainda — a IA precisa de mais atividade no período.
                  </p>
                ) : (
                  data.insights.map((i) => (
                    <div
                      key={i.id}
                      className={`text-xs rounded-md border px-3 py-2 ${
                        i.level === "good"
                          ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
                          : i.level === "warn"
                            ? "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400"
                            : "border-border bg-muted/30 text-foreground"
                      }`}
                    >
                      {i.text}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  Timeline de conversão
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.timeline.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nenhum evento da IA no período.
                  </p>
                ) : (
                  <ol className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {data.timeline.map((t) => (
                      <li
                        key={t.id}
                        className="flex items-start gap-2 text-xs border-l-2 border-primary/40 pl-2"
                      >
                        <div className="flex-1">
                          <div className="font-medium">{t.label}</div>
                          <div className="text-muted-foreground">
                            {fmtTime(t.created_at)}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}

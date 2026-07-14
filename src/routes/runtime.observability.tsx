// Runtime Observability Center — READ-ONLY.
// Admin-only. Polls GET /api/runtime/status every 15s (manual refresh available).
// Não executa jobs, não altera Scheduler, banco, filas ou Knowledge Bus.

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/auth/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  AlertTriangle,
  Brain,
  CheckCircle2,
  Cpu,
  Database,
  Gauge,
  HardDrive,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Timer,
  Users,
  Workflow,
  XCircle,
  Zap,
} from "lucide-react";

export const Route = createFileRoute("/runtime/observability")({
  component: ObservabilityPage,
});

const POLL_MS = 15_000;

// ---------- helpers ----------
type Dict = Record<string, unknown>;
const asDict = (v: unknown): Dict =>
  v && typeof v === "object" ? (v as Dict) : {};
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown, d = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : d;
const str = (v: unknown, d = "—"): string =>
  typeof v === "string" && v.length ? v : d;
const bool = (v: unknown): boolean => v === true;

function mask(id: string | null | undefined): string {
  if (!id) return "—";
  if (id.length <= 10) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function fmtMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = Date.now() - t;
  if (diff < 0) return "agora";
  if (diff < 1000) return "agora";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s atrás`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m atrás`;
  return `${Math.floor(diff / 3_600_000)}h atrás`;
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

type HealthLevel = "excellent" | "good" | "attention" | "critical" | "unknown";

const HEALTH_LABEL: Record<HealthLevel, string> = {
  excellent: "Excelente",
  good: "Bom",
  attention: "Atenção",
  critical: "Crítico",
  unknown: "—",
};

function healthClass(level: HealthLevel): string {
  switch (level) {
    case "excellent":
      return "bg-emerald-500/15 text-emerald-600 border-emerald-500/30";
    case "good":
      return "bg-sky-500/15 text-sky-600 border-sky-500/30";
    case "attention":
      return "bg-amber-500/15 text-amber-600 border-amber-500/30";
    case "critical":
      return "bg-red-500/15 text-red-600 border-red-500/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

// ---------- data fetch ----------
async function bearer(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function fetchStatus(): Promise<Dict> {
  const token = await bearer();
  if (!token) throw new Error("unauthorized");
  const res = await fetch("/api/runtime/status", {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as Dict | null;
  if (!res.ok || !body) throw new Error(`http_${res.status}`);
  return body;
}

// ---------- sub components ----------
function SectionTitle({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div className="p-2 rounded-md bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle ? (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-lg font-semibold mt-1 tabular-nums">{value}</div>
      {hint ? (
        <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>
      ) : null}
    </div>
  );
}

function HealthPill({ level }: { level: HealthLevel }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-medium ${healthClass(
        level,
      )}`}
    >
      {HEALTH_LABEL[level]}
    </span>
  );
}

// ---------- page ----------
function ObservabilityPage() {
  const { profile } = useAuth();
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<Dict | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tenantMasked = mask(profile?.company_id ?? null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const body = await fetchStatus();
      const snap = asDict(body.snapshot ?? body);
      setSnapshot(snap);
      setError(null);
      setLastFetched(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (adminLoading) return;
    if (!isAdmin) return;
    void refresh();
    timerRef.current = setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [adminLoading, isAdmin, refresh]);

  if (adminLoading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="min-h-screen grid place-items-center p-6">
        <Card className="p-6 max-w-md">
          <div className="flex items-center gap-3 mb-2">
            <ShieldAlert className="h-5 w-5 text-red-500" />
            <h1 className="text-base font-semibold">Acesso restrito</h1>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Este painel é exclusivo para administradores.
          </p>
          <Button onClick={() => navigate({ to: "/" })} size="sm">
            Voltar
          </Button>
        </Card>
      </div>
    );
  }

  // -------- extract sub-sections --------
  const status = asDict(snapshot?.status);
  const heartbeat = asDict(snapshot?.heartbeat);
  const scheduler = asDict(snapshot?.scheduler);
  const autonomy = asDict(asDict(snapshot?.autonomy).systemHealth);
  const autonomyTenantEnabled = bool(asDict(snapshot?.autonomy).tenantEnabled);
  const worker = asDict(snapshot?.worker);
  const workers = asArr(snapshot?.workers);
  const execution = asDict(snapshot?.execution);
  const counters = asDict(snapshot?.counters);
  const adapters = asArr(snapshot?.adapters);
  const agents = asArr(snapshot?.agents);
  const recentJobs = asArr(snapshot?.recentJobs);
  const knowledgeBus = asDict(snapshot?.knowledgeBus);
  const producers = asDict(knowledgeBus.producers);
  const consumers = asDict(knowledgeBus.consumers);
  const cache = asDict(knowledgeBus.cache);
  const topics = asArr(knowledgeBus.topics);
  const intelligence = asDict(snapshot?.intelligence);

  // -------- learning loop --------
  const learning = asDict(snapshot?.learning);
  const learningHypotheses = asDict(learning.hypotheses);
  const learningStore = asDict(learning.store);
  const learningLastCycle = asDict(learning.lastCycle);
  const learningTenant = asDict(learning.tenant);
  const learningHistory = asArr(learningTenant.history);
  const learningPerAgent = asDict(learning.perAgent);
  const learningEvolution = asDict(learning.knowledgeEvolution);
  const learningCycles = num(learning.cycles);
  const learningCreated = num(learningHypotheses.created);
  const learningAccepted = num(learningHypotheses.accepted);
  const learningRejected = num(learningHypotheses.rejected);
  const learningConsolidated = num(learningHypotheses.consolidated);
  const learningAvgConfidence = num(learning.averageConfidence);
  const learningIgnored = num(learning.ignoredExecutions);
  const learningPublishError = str(learningLastCycle.publishError, "");
  const learningAgentRows = Object.entries(learningPerAgent).map(([id, v]) => {
    const d = asDict(v);
    return {
      id,
      cycles: num(d.cycles),
      created: num(d.created),
      accepted: num(d.accepted),
      rejected: num(d.rejected),
      consolidated: num(d.consolidated),
      lastAt: str(d.lastAt, ""),
    };
  }).sort((a, b) => b.cycles - a.cycles);


  const uptimeMs = num(status.uptimeMs);
  const runtimeOnline = bool(status.online);
  const schedulerEnabled =
    bool(scheduler.enabled) || bool(scheduler.running);

  // -------- execution stats --------
  const jobDurations: number[] = recentJobs
    .map((j) => {
      const jd = asDict(j);
      const d = num(jd.durationMs ?? jd.duration_ms, -1);
      return d;
    })
    .filter((d) => d >= 0)
    .sort((a, b) => a - b);

  const avg =
    jobDurations.length > 0
      ? jobDurations.reduce((a, b) => a + b, 0) / jobDurations.length
      : null;
  const min = jobDurations[0] ?? null;
  const max = jobDurations[jobDurations.length - 1] ?? null;
  const p95 = percentile(jobDurations, 95);
  const p99 = percentile(jobDurations, 99);

  // -------- agent table --------
  const agentRows = agents.map((a) => {
    const ad = asDict(a);
    const state = asDict(ad.state);
    const stats = asDict(state.stats);
    const last = asDict(state.lastExecution);
    const executions = num(stats.executions);
    const successes = num(stats.successes);
    const failures = num(stats.failures);
    const timeouts = num(stats.timeouts);
    const retries = num(stats.retries);
    const successRate =
      executions > 0 ? (successes / executions) * 100 : null;
    const adapterInfo = asDict(
      adapters.find((x) => asDict(x).id === ad.id || asDict(x).agentId === ad.id),
    );
    const isReal =
      bool(adapterInfo.real) ||
      str(adapterInfo.kind, "") !== "stub" ||
      bool(adapterInfo.connected);
    const level: HealthLevel = !bool(ad.enabled)
      ? "attention"
      : failures > successes && executions > 0
        ? "critical"
        : successRate != null && successRate < 80
          ? "attention"
          : successRate === 100
            ? "excellent"
            : successRate != null
              ? "good"
              : "unknown";
    return {
      id: str(ad.id),
      name: str(ad.name, str(ad.id)),
      enabled: bool(ad.enabled),
      adapter: str(adapterInfo.kind, isReal ? "real" : "stub"),
      real: isReal,
      lastAt: str(last.finishedAt ?? last.startedAt, ""),
      lastDurationMs: num(last.durationMs, -1),
      lastOutcome: str(last.outcome, "—"),
      lastError: str(state.lastError, ""),
      lastSuccessAt: str(stats.lastSuccessAt, ""),
      executions,
      successRate,
      failures,
      timeouts,
      retries,
      health: level,
    };
  });
  agentRows.sort((a, b) => {
    const rank: Record<HealthLevel, number> = {
      critical: 0,
      attention: 1,
      unknown: 2,
      good: 3,
      excellent: 4,
    };
    return rank[a.health] - rank[b.health];
  });

  // -------- topic rows --------
  const topicRows = topics.map((t) => {
    const td = asDict(t);
    const id = str(td.id ?? td.topic);
    const producer = asDict(producers[id]);
    const consumersForTopic = Object.values(consumers)
      .map((c) => asDict(c))
      .filter((c) => asArr(c.topics).includes(id) || str(c.topic) === id);
    const totalReads = consumersForTopic.reduce(
      (a, c) => a + num(c.totalReads),
      0,
    );
    const hits = consumersForTopic.reduce((a, c) => a + num(c.hits), 0);
    const misses = consumersForTopic.reduce((a, c) => a + num(c.misses), 0);
    const partial = consumersForTopic.reduce(
      (a, c) => a + num(c.partialHits),
      0,
    );
    const fallbacks = consumersForTopic.reduce(
      (a, c) => a + num(c.fallbacks),
      0,
    );
    const hitRate = totalReads > 0 ? (hits / totalReads) * 100 : null;
    return {
      id,
      producer: str(producer.agentId ?? td.ownerAgentId, "—"),
      consumers: consumersForTopic.length,
      envelope: bool(producer.currentEnvelopeAvailable),
      ttlMs: num(td.defaultTtlMs, 0),
      ageSec: num(producer.envelopeAgeSeconds, -1),
      publishCount: num(producer.publishCount),
      publishErrors: num(producer.publishErrors),
      totalReads,
      hits,
      misses,
      partial,
      fallbacks,
      hitRate,
    };
  });

  // -------- overall health --------
  const queuePending = num(counters.pending);
  const queueProcessing = num(counters.processing);
  const queueFailed = num(counters.failed);
  const queueDead = num(counters.dead_letter ?? counters.deadLetter);

  const runtimeHealth: HealthLevel = !runtimeOnline
    ? "critical"
    : uptimeMs > 60_000
      ? "excellent"
      : "good";
  const queueHealth: HealthLevel =
    queueDead > 0
      ? "critical"
      : queuePending > 100
        ? "attention"
        : queueFailed > 5
          ? "attention"
          : "excellent";
  const workerHealth: HealthLevel = workers.length ? "excellent" : "attention";
  const schedulerHealth: HealthLevel = "good"; // desativado intencionalmente
  const kbHealth: HealthLevel = (() => {
    const errs = Object.values(producers).reduce<number>(
      (a, p) => a + num(asDict(p).publishErrors),
      0,
    );
    if (errs > 0) return "attention";
    return topicRows.some((t) => t.envelope) ? "good" : "unknown";
  })();
  const overall: HealthLevel = [
    runtimeHealth,
    queueHealth,
    workerHealth,
    kbHealth,
  ].some((h) => h === "critical")
    ? "critical"
    : [runtimeHealth, queueHealth, workerHealth, kbHealth].some(
          (h) => h === "attention",
        )
      ? "attention"
      : "good";

  // -------- alerts --------
  const alerts: { level: HealthLevel; message: string }[] = [];
  if (!workers.length) alerts.push({ level: "critical", message: "Worker parado" });
  if (queuePending > 100)
    alerts.push({ level: "attention", message: `Fila crescendo (${queuePending} pending)` });
  if (queueDead > 0)
    alerts.push({ level: "critical", message: `Dead-letter com ${queueDead} jobs` });
  if (schedulerEnabled)
    alerts.push({ level: "attention", message: "Scheduler ativado" });
  for (const t of topicRows) {
    if (t.hitRate != null && t.totalReads >= 5 && t.hitRate < 30) {
      alerts.push({
        level: "attention",
        message: `Hit rate baixo em ${t.id} (${t.hitRate.toFixed(0)}%)`,
      });
    }
    if (t.publishErrors > 0) {
      alerts.push({
        level: "attention",
        message: `Publisher falhando em ${t.id} (${t.publishErrors} erros)`,
      });
    }
    if (t.ageSec > 0 && t.ttlMs > 0 && t.ageSec * 1000 > t.ttlMs * 0.9) {
      alerts.push({
        level: "attention",
        message: `Envelope de ${t.id} próximo de expirar`,
      });
    }
  }

  // Learning-specific alerts (só disparam com amostra mínima).
  if (learningCycles >= 10 && learningCreated > 0) {
    const rejectRate = learningRejected / learningCreated;
    if (rejectRate > 0.8) {
      alerts.push({
        level: "attention",
        message: `Muitas hipóteses rejeitadas (${(rejectRate * 100).toFixed(0)}%)`,
      });
    }
  }
  if (learningCycles >= 10 && learningAvgConfidence > 0 && learningAvgConfidence < 0.4) {
    alerts.push({
      level: "attention",
      message: `Confiança média baixa no Learning Loop (${learningAvgConfidence.toFixed(2)})`,
    });
  }
  if (learningCycles >= 20 && learningConsolidated === 0) {
    alerts.push({
      level: "attention",
      message: "Nenhuma consolidação após várias execuções",
    });
  }
  if (learningPublishError) {
    alerts.push({
      level: "attention",
      message: `Erro ao publicar hipótese: ${learningPublishError}`,
    });
  }
  {
    const totalHistory = num(learningStore.totalHistory);
    if (totalHistory >= 450) {
      alerts.push({
        level: "attention",
        message: `Learning store próximo do limite (${totalHistory} registros)`,
      });
    }
  }


  // ============ derived visual helpers (READ-ONLY, no state mutations) ============
  const lastJob = asDict(recentJobs[0]);
  const totalExecutions = num(execution.totalExecutions ?? execution.total);
  const totalPublishes = Object.values(producers).reduce<number>(
    (a, p) => a + num(asDict(p).publishCount),
    0,
  );
  const totalReads = Object.values(consumers).reduce<number>(
    (a, c) => a + num(asDict(c).totalReads),
    0,
  );
  const timelineJobs = recentJobs.slice(0, 12);

  const workerPrimary = asDict(workers[0] ?? worker);
  const workerJobs = num(workerPrimary.processedJobs ?? workerPrimary.jobs);
  const workerAvg = num(workerPrimary.avgDurationMs, null as unknown as number) || null;
  const workerLast = str(workerPrimary.lastExecutionAt ?? workerPrimary.lastAt, "");

  const healthDotClass = (level: HealthLevel): string => {
    switch (level) {
      case "excellent": return "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.6)]";
      case "good":      return "bg-sky-500 shadow-[0_0_10px_rgba(14,165,233,0.6)]";
      case "attention": return "bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.6)]";
      case "critical":  return "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.6)]";
      default:          return "bg-muted-foreground/40";
    }
  };
  const outcomeDot = (outcome: string): string => {
    if (outcome === "success" || outcome === "completed") return "bg-emerald-500";
    if (outcome === "failure" || outcome === "failed" || outcome === "timeout") return "bg-red-500";
    if (outcome === "processing" || outcome === "running") return "bg-sky-500";
    return "bg-muted-foreground/40";
  };
  const overallLabel = HEALTH_LABEL[overall];

  // ============ render ============
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl p-4 md:p-8 space-y-6">
        {/* Executive header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-4">
            <div className={`h-11 w-11 rounded-xl grid place-items-center border ${healthClass(overall)} shrink-0`}>
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">Runtime</h1>
                <Badge variant="outline" className="text-[10px]">READ-ONLY</Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                Sistema {runtimeOnline ? "operacional" : "offline"} · {overallLabel.toLowerCase()} · tenant {tenantMasked}
              </p>
              <p className="text-xs text-muted-foreground/70 mt-0.5">
                Atualiza a cada {POLL_MS / 1000}s ·{" "}
                {lastFetched ? `sincronizado ${fmtAgo(lastFetched)}` : "aguardando…"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <HealthPill level={overall} />
            <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={refreshing}>
              {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
              Atualizar
            </Button>
          </div>
        </div>

        {loading && !snapshot ? (
          <Card className="p-12 grid place-items-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </Card>
        ) : error && !snapshot ? (
          <Card className="p-6 border-red-500/40">
            <div className="flex items-center gap-2 text-red-500">
              <XCircle className="h-4 w-4" />
              <span className="text-sm">Falha ao ler status: {error}</span>
            </div>
          </Card>
        ) : (
          <>
            {/* ---------- 5 signature panels ---------- */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <SignaturePanel
                icon={Zap}
                title="Runtime"
                health={runtimeHealth}
                primary={runtimeOnline ? "Online" : "Offline"}
                secondary={`Uptime ${fmtUptime(uptimeMs)}`}
                rows={[
                  { label: "Versão", value: `v${str(status.version, "?")}` },
                  { label: "Heartbeat", value: fmtAgo(str(heartbeat.at ?? status.lastHeartbeat, "")) },
                  { label: "Autonomia", value: autonomyTenantEnabled ? "Ativa" : "Pausada" },
                ]}
              />
              <SignaturePanel
                icon={Cpu}
                title="Worker"
                health={workerHealth}
                primary={workers.length ? `${workers.length} ativo${workers.length > 1 ? "s" : ""}` : "Parado"}
                secondary={workerLast ? `Última exec. ${fmtAgo(workerLast)}` : "Sem execução"}
                rows={[
                  { label: "Jobs processados", value: String(workerJobs) },
                  { label: "Tempo médio", value: fmtMs(workerAvg) },
                  { label: "Execuções", value: String(totalExecutions) },
                ]}
              />
              <SignaturePanel
                icon={HardDrive}
                title="Queue"
                health={queueHealth}
                primary={String(queuePending + queueProcessing)}
                secondary={`pending ${queuePending} · processing ${queueProcessing}`}
                rows={[
                  { label: "Completed", value: String(num(counters.completed)) },
                  { label: "Failed", value: String(queueFailed) },
                  { label: "Dead-letter", value: String(queueDead) },
                ]}
              />
              <SignaturePanel
                icon={Brain}
                title="Learning"
                health={
                  learningCycles === 0
                    ? "unknown"
                    : learningAvgConfidence > 0 && learningAvgConfidence < 0.4
                      ? "attention"
                      : learningConsolidated > 0
                        ? "excellent"
                        : "good"
                }
                primary={`${learningCycles} ciclos`}
                secondary={
                  learningAvgConfidence > 0
                    ? `Confiança média ${(learningAvgConfidence * 100).toFixed(0)}%`
                    : "Sem confiança medida"
                }
                rows={[
                  { label: "Hipóteses", value: `${learningAccepted}✓ / ${learningRejected}✗` },
                  { label: "Consolidadas", value: String(learningConsolidated) },
                  { label: "Última", value: fmtAgo(str(learning.lastLearning, "")) },
                ]}
              />
              <SignaturePanel
                icon={Database}
                title="Knowledge Bus"
                health={kbHealth}
                primary={String(num(cache.totalEnvelopes))}
                secondary={`${topicRows.length} tópicos · ${totalPublishes} publicações`}
                rows={[
                  { label: "Reads", value: String(totalReads) },
                  { label: "Producers", value: String(Object.values(producers).length) },
                  { label: "Consumers", value: String(Object.values(consumers).length) },
                ]}
              />
            </div>

            {/* ---------- Alertas ---------- */}
            <Card className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">Alertas</h2>
                </div>
                <span className="text-xs text-muted-foreground">
                  {alerts.length === 0 ? "Tudo saudável" : `${alerts.length} sinal${alerts.length > 1 ? "is" : ""}`}
                </span>
              </div>
              {alerts.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" />
                  Nenhum alerta ativo. Runtime, Worker, Queue, Learning e Knowledge Bus operacionais.
                </div>
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  {alerts.map((a, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
                      <span className={`h-2 w-2 rounded-full ${healthDotClass(a.level)}`} />
                      <span className="text-sm flex-1">{a.message}</span>
                      <HealthPill level={a.level} />
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* ---------- Timeline + Learning highlights ---------- */}
            <div className="grid gap-4 md:grid-cols-3">
              {/* Activity timeline */}
              <Card className="p-5 md:col-span-2">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                    <h2 className="text-sm font-semibold">Atividade recente</h2>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {recentJobs.length} execuções · {lastJob.finishedAt ? fmtAgo(str(lastJob.finishedAt, "")) : "—"}
                  </span>
                </div>
                {timelineJobs.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-8 text-center rounded-lg border border-dashed border-border">
                    Sem execuções registradas ainda.
                  </div>
                ) : (
                  <ol className="relative border-l border-border ml-2 space-y-3">
                    {timelineJobs.map((j, i) => {
                      const jd = asDict(j);
                      const kb = asDict(jd.knowledgeBus ?? jd.knowledge_bus);
                      const status = str(jd.status);
                      const outcome = str(jd.outcome ?? jd.result, status);
                      const finishedAt = str(jd.finishedAt ?? jd.finished_at ?? jd.updatedAt ?? jd.updated_at, "");
                      const duration = num(jd.durationMs ?? jd.duration_ms, -1);
                      const agentId = str(jd.agentId ?? jd.agent_id);
                      const hit = bool(kb.knowledgeBusHit);
                      const miss = bool(kb.knowledgeBusMiss);
                      const topic = (asArr(kb.publishedTopics)[0] as string | undefined) ?? str(kb.knowledgeTopic, "");
                      return (
                        <li key={i} className="pl-4 relative">
                          <span
                            className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-background ${outcomeDot(outcome)}`}
                            aria-hidden
                          />
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">{agentId || "runtime"}</span>
                            <Badge variant="outline" className="text-[10px] capitalize">{outcome}</Badge>
                            {duration >= 0 ? (
                              <span className="text-[11px] text-muted-foreground tabular-nums">{fmtMs(duration)}</span>
                            ) : null}
                            {topic ? (
                              <span className="text-[11px] text-muted-foreground font-mono truncate max-w-[220px]">
                                → {topic}
                              </span>
                            ) : null}
                            {hit ? <Badge className="text-[10px] bg-emerald-500/15 text-emerald-600 border border-emerald-500/30">KB hit</Badge> : null}
                            {miss ? <Badge variant="outline" className="text-[10px]">KB miss</Badge> : null}
                            <span className="ml-auto text-[11px] text-muted-foreground">{fmtAgo(finishedAt)}</span>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </Card>

              {/* Learning highlights */}
              <Card className="p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">Aprendizado do sistema</h2>
                </div>
                {learningCycles === 0 && learningIgnored === 0 ? (
                  <div className="text-sm text-muted-foreground py-6 text-center rounded-lg border border-dashed border-border">
                    Aguardando primeira execução válida.
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <div className="text-3xl font-semibold tabular-nums">{learningCycles}</div>
                      <div className="text-xs text-muted-foreground">ciclos de aprendizado</div>
                    </div>
                    {learningCreated > 0 ? (
                      <div>
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className="text-muted-foreground">Aceitas vs rejeitadas</span>
                          <span className="tabular-nums">
                            {learningAccepted} / {learningRejected}
                          </span>
                        </div>
                        <div className="flex h-2 rounded-full overflow-hidden bg-muted">
                          <div
                            className="bg-emerald-500"
                            style={{ width: `${(learningAccepted / Math.max(1, learningCreated)) * 100}%` }}
                          />
                          <div
                            className="bg-red-500"
                            style={{ width: `${(learningRejected / Math.max(1, learningCreated)) * 100}%` }}
                          />
                        </div>
                      </div>
                    ) : null}
                    <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
                      <div>
                        <div className="text-xs text-muted-foreground">Consolidadas</div>
                        <div className="text-lg font-semibold tabular-nums">{learningConsolidated}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Confiança</div>
                        <div className="text-lg font-semibold tabular-nums">
                          {learningAvgConfidence > 0 ? `${(learningAvgConfidence * 100).toFixed(0)}%` : "—"}
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground pt-2 border-t border-border">
                      Último aprendizado {fmtAgo(str(learning.lastLearning, ""))} por{" "}
                      <span className="font-mono">{str(learning.lastAgent, "—")}</span>
                    </div>
                  </div>
                )}
              </Card>
            </div>

            {/* ---------- Detalhes técnicos (colapsáveis) ---------- */}
            <div className="space-y-3">
              <TechDetails title="Agentes registrados" hint={`${agentRows.length} agentes`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b border-border">
                        <th className="py-2 pr-3">Agent</th>
                        <th className="py-2 pr-3">Status</th>
                        <th className="py-2 pr-3">Adapter</th>
                        <th className="py-2 pr-3">Última exec.</th>
                        <th className="py-2 pr-3">Duração</th>
                        <th className="py-2 pr-3">Outcome</th>
                        <th className="py-2 pr-3">Exec.</th>
                        <th className="py-2 pr-3">Success %</th>
                        <th className="py-2 pr-3">Falhas</th>
                        <th className="py-2 pr-3">Timeouts</th>
                        <th className="py-2 pr-3">Retries</th>
                        <th className="py-2 pr-3">Health</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agentRows.map((r) => (
                        <tr key={r.id} className="border-b border-border/50">
                          <td className="py-2 pr-3 font-mono">{r.id}</td>
                          <td className="py-2 pr-3">
                            {r.enabled ? (
                              <Badge variant="outline" className="text-[10px]">enabled</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[10px]">disabled</Badge>
                            )}
                          </td>
                          <td className="py-2 pr-3">
                            {r.real ? (
                              <Badge className="text-[10px]">real</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[10px]">stub</Badge>
                            )}
                          </td>
                          <td className="py-2 pr-3">{fmtAgo(r.lastAt)}</td>
                          <td className="py-2 pr-3 tabular-nums">
                            {r.lastDurationMs >= 0 ? fmtMs(r.lastDurationMs) : "—"}
                          </td>
                          <td className="py-2 pr-3">{r.lastOutcome}</td>
                          <td className="py-2 pr-3 tabular-nums">{r.executions}</td>
                          <td className="py-2 pr-3 tabular-nums">
                            {r.successRate == null ? "—" : `${r.successRate.toFixed(0)}%`}
                          </td>
                          <td className="py-2 pr-3 tabular-nums">{r.failures}</td>
                          <td className="py-2 pr-3 tabular-nums">{r.timeouts}</td>
                          <td className="py-2 pr-3 tabular-nums">{r.retries}</td>
                          <td className="py-2 pr-3"><HealthPill level={r.health} /></td>
                        </tr>
                      ))}
                      {agentRows.length === 0 ? (
                        <tr>
                          <td colSpan={12} className="py-4 text-center text-muted-foreground">
                            Nenhum agente registrado.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </TechDetails>

              <TechDetails title="Knowledge Bus — tópicos e envelopes" hint={`${topicRows.length} tópicos`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b border-border">
                        <th className="py-2 pr-3">Topic</th>
                        <th className="py-2 pr-3">Producer</th>
                        <th className="py-2 pr-3">Consumers</th>
                        <th className="py-2 pr-3">Envelope</th>
                        <th className="py-2 pr-3">Age</th>
                        <th className="py-2 pr-3">TTL</th>
                        <th className="py-2 pr-3">Publish</th>
                        <th className="py-2 pr-3">Pub Err</th>
                        <th className="py-2 pr-3">Reads</th>
                        <th className="py-2 pr-3">Hits</th>
                        <th className="py-2 pr-3">Miss</th>
                        <th className="py-2 pr-3">Partial</th>
                        <th className="py-2 pr-3">Fallback</th>
                        <th className="py-2 pr-3">Hit Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topicRows.map((t) => (
                        <tr key={t.id} className="border-b border-border/50">
                          <td className="py-2 pr-3 font-mono">{t.id}</td>
                          <td className="py-2 pr-3 font-mono">{t.producer}</td>
                          <td className="py-2 pr-3 tabular-nums">{t.consumers}</td>
                          <td className="py-2 pr-3">
                            {t.envelope ? (
                              <Badge className="text-[10px]">disponível</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[10px]">vazio</Badge>
                            )}
                          </td>
                          <td className="py-2 pr-3 tabular-nums">{t.ageSec >= 0 ? `${t.ageSec}s` : "—"}</td>
                          <td className="py-2 pr-3 tabular-nums">{t.ttlMs ? fmtMs(t.ttlMs) : "—"}</td>
                          <td className="py-2 pr-3 tabular-nums">{t.publishCount}</td>
                          <td className="py-2 pr-3 tabular-nums">{t.publishErrors}</td>
                          <td className="py-2 pr-3 tabular-nums">{t.totalReads}</td>
                          <td className="py-2 pr-3 tabular-nums">{t.hits}</td>
                          <td className="py-2 pr-3 tabular-nums">{t.misses}</td>
                          <td className="py-2 pr-3 tabular-nums">{t.partial}</td>
                          <td className="py-2 pr-3 tabular-nums">{t.fallbacks}</td>
                          <td className="py-2 pr-3 tabular-nums">
                            {t.hitRate == null ? "—" : `${t.hitRate.toFixed(0)}%`}
                          </td>
                        </tr>
                      ))}
                      {topicRows.length === 0 ? (
                        <tr>
                          <td colSpan={14} className="py-4 text-center text-muted-foreground">
                            Nenhum tópico registrado.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </TechDetails>

              <TechDetails title="Learning Loop — por agente e histórico" hint={`${learningAgentRows.length} agentes`}>
                <div className="grid gap-3 md:grid-cols-5 mb-4">
                  <Metric label="Ciclos" value={learningCycles} hint={`ignorados=${learningIgnored}`} />
                  <Metric label="Hipóteses" value={learningCreated} hint={`aceitas=${learningAccepted} · rejeitadas=${learningRejected}`} />
                  <Metric label="Consolidadas" value={learningConsolidated} hint={`tenants=${num(learningEvolution.consolidatedTenants)}`} />
                  <Metric label="Confiança" value={learningAvgConfidence > 0 ? learningAvgConfidence.toFixed(3) : "—"} />
                  <Metric label="Store" value={`${num(learningStore.tenants)} tenants`} hint={`TTL ${Math.round(num(learningStore.ttlMs) / 60000)}min · histórico ${num(learningStore.totalHistory)}`} />
                </div>
                {learningPublishError ? (
                  <div className="mb-3">
                    <Badge variant="destructive" className="text-[10px]">
                      Publisher: {learningPublishError}
                    </Badge>
                  </div>
                ) : null}
                {learningAgentRows.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-muted-foreground border-b border-border">
                          <th className="py-2 pr-3">Agente</th>
                          <th className="py-2 pr-3">Ciclos</th>
                          <th className="py-2 pr-3">Hipóteses</th>
                          <th className="py-2 pr-3">Aceitas</th>
                          <th className="py-2 pr-3">Rejeitadas</th>
                          <th className="py-2 pr-3">Consolidadas</th>
                          <th className="py-2 pr-3">Última</th>
                        </tr>
                      </thead>
                      <tbody>
                        {learningAgentRows.map((r) => (
                          <tr key={r.id} className="border-b border-border/50">
                            <td className="py-2 pr-3 font-mono">{r.id}</td>
                            <td className="py-2 pr-3 tabular-nums">{r.cycles}</td>
                            <td className="py-2 pr-3 tabular-nums">{r.created}</td>
                            <td className="py-2 pr-3 tabular-nums">{r.accepted}</td>
                            <td className="py-2 pr-3 tabular-nums">{r.rejected}</td>
                            <td className="py-2 pr-3 tabular-nums">{r.consolidated}</td>
                            <td className="py-2 pr-3">{fmtAgo(r.lastAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {learningHistory.length > 0 ? (
                  <div className="mt-5">
                    <div className="text-[11px] font-medium text-muted-foreground mb-2 flex items-center gap-1">
                      <Timer className="h-3 w-3" /> Timeline recente (tenant atual)
                    </div>
                    <ul className="space-y-1.5">
                      {learningHistory.slice(0, 15).map((h, i) => {
                        const rec = asDict(h);
                        const hyp = asDict(rec.hypothesis);
                        const decision = str(rec.decision, "—");
                        const level: HealthLevel =
                          decision === "consolidated" ? "excellent"
                          : decision === "accepted" ? "good"
                          : decision === "rejected" ? "attention"
                          : "unknown";
                        const sig = str(hyp.signature, "");
                        const sigShort = sig.length > 40 ? `${sig.slice(0, 40)}…` : sig;
                        return (
                          <li key={str(hyp.hypothesisId, String(i))} className="flex items-center gap-2 text-xs rounded border border-border p-2">
                            <HealthPill level={level} />
                            <span className="font-mono">{str(hyp.sourceAgent, "—")}</span>
                            <span className="text-muted-foreground">{decision}</span>
                            <span className="tabular-nums text-muted-foreground">conf={num(hyp.confidence).toFixed(2)}</span>
                            <span className="ml-auto text-muted-foreground">{fmtAgo(str(rec.decidedAt, ""))}</span>
                            {sigShort ? (
                              <span className="hidden md:inline font-mono text-[10px] text-muted-foreground truncate max-w-[240px]">{sigShort}</span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </TechDetails>

              <TechDetails title="Execution & Performance" hint={`P95 ${fmtMs(p95)}`}>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Últimas execuções</div>
                    <div className="grid grid-cols-2 gap-3">
                      <Metric label="Média" value={fmtMs(avg)} />
                      <Metric label="Mínimo" value={fmtMs(min ?? null)} />
                      <Metric label="Máximo" value={fmtMs(max ?? null)} />
                      <Metric label="P95" value={fmtMs(p95)} />
                      <Metric label="P99" value={fmtMs(p99)} />
                      <Metric label="Total" value={totalExecutions} />
                    </div>
                    {jobDurations.length > 0 ? (
                      <div className="mt-3 flex items-end gap-0.5 h-16">
                        {jobDurations.slice(-40).map((d, i) => {
                          const h = max && max > 0 ? Math.max(4, (d / max) * 64) : 4;
                          return (
                            <div key={i} className="flex-1 bg-primary/60 rounded-sm" style={{ height: `${h}px` }} title={fmtMs(d)} />
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Tempos médios do stack</div>
                    <div className="grid grid-cols-2 gap-3">
                      <Metric label="Runtime" value={fmtMs(avg)} />
                      <Metric label="Queue" value={fmtMs(num(counters.avgWaitMs, null as unknown as number) || null)} />
                      <Metric label="Worker" value={fmtMs(num(asDict(worker).avgDurationMs, null as unknown as number) || null)} />
                      <Metric label="Adapter" value={fmtMs(num(execution.avgAdapterMs, null as unknown as number) || null)} />
                      <Metric label="Agent" value={fmtMs(avg)} />
                      <Metric label="Publish" value={totalPublishes > 0 ? `${totalPublishes} totais` : "—"} />
                    </div>
                  </div>
                </div>
              </TechDetails>

              <TechDetails title="Workers, Queue & Scheduler" hint={`${workers.length} workers · ${queuePending + queueProcessing} na fila`}>
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Queue</div>
                    <div className="grid grid-cols-2 gap-3">
                      <Metric label="Pending" value={queuePending} />
                      <Metric label="Processing" value={queueProcessing} />
                      <Metric label="Completed" value={num(counters.completed)} />
                      <Metric label="Failed" value={queueFailed} />
                      <Metric label="Dead Letter" value={queueDead} />
                      <Metric label="Cancelled" value={num(counters.cancelled)} />
                      <Metric label="Blocked" value={num(counters.blocked)} />
                      <Metric label="Retry" value={num(counters.retry)} />
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Workers</div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-muted-foreground border-b border-border">
                            <th className="py-2 pr-3">Worker</th>
                            <th className="py-2 pr-3">Status</th>
                            <th className="py-2 pr-3">Última exec.</th>
                            <th className="py-2 pr-3">Jobs</th>
                            <th className="py-2 pr-3">Médio</th>
                          </tr>
                        </thead>
                        <tbody>
                          {workers.map((w, i) => {
                            const wd = asDict(w);
                            return (
                              <tr key={i} className="border-b border-border/50">
                                <td className="py-2 pr-3 font-mono">{str(wd.workerId ?? wd.id)}</td>
                                <td className="py-2 pr-3">
                                  <Badge variant="outline" className="text-[10px]">{str(wd.status, "idle")}</Badge>
                                </td>
                                <td className="py-2 pr-3">{fmtAgo(str(wd.lastExecutionAt ?? wd.lastAt, ""))}</td>
                                <td className="py-2 pr-3 tabular-nums">{num(wd.processedJobs ?? wd.jobs)}</td>
                                <td className="py-2 pr-3 tabular-nums">
                                  {fmtMs(num(wd.avgDurationMs, null as unknown as number) || null)}
                                </td>
                              </tr>
                            );
                          })}
                          {workers.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="py-4 text-center text-muted-foreground">
                                Nenhum worker ativo.
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Scheduler (desativado por design)</div>
                    <div className="grid grid-cols-2 gap-3">
                      <Metric label="Schedules" value={asArr(scheduler.schedules).length} />
                      <Metric label="Enabled" value={num(scheduler.enabledCount)} />
                      <Metric label="Disabled" value={num(scheduler.disabledCount)} />
                      <Metric label="Próxima" value={str(scheduler.nextRunAt, "—")} />
                      <Metric label="Última avaliação" value={fmtAgo(str(scheduler.lastEvaluatedAt, ""))} />
                      <Metric label="Duplicates" value={num(scheduler.duplicatesPrevented)} />
                      <Metric label="Cooldown" value={num(scheduler.cooldownMs)} hint="ms" />
                      <Metric label="Window" value={num(scheduler.windowMs)} hint="ms" />
                    </div>
                  </div>
                </div>
              </TechDetails>

              <TechDetails title="Autonomia · System Health" hint={autonomyTenantEnabled ? "Ligada" : "Desligada"}>
                <div className="grid gap-3 md:grid-cols-4">
                  <Metric label="Tenant atual" value={autonomyTenantEnabled ? "Autonomia ligada" : "Autonomia desligada"} />
                  <Metric label="Tenants habilitados" value={num(autonomy.enabledTenantCount)} />
                  <Metric label="Intervalo" value={`${num(autonomy.intervalSeconds)}s`} />
                  <Metric label="Segredo do tick" value={bool(autonomy.secretConfigured) ? "Configurado" : "Ausente"} />
                  <Metric label="Ticks recebidos" value={num(autonomy.ticksReceived)} />
                  <Metric label="Ticks rejeitados" value={num(autonomy.ticksRejected)} />
                  <Metric label="Jobs criados" value={num(autonomy.jobsCreated)} />
                  <Metric label="Jobs concluídos" value={num(autonomy.jobsCompleted)} />
                  <Metric label="Jobs falhos" value={num(autonomy.jobsFailed)} />
                  <Metric label="Duplicidades evitadas" value={num(autonomy.duplicatesPrevented)} />
                  <Metric label="Último tick" value={fmtAgo(str(autonomy.lastTickAt, ""))} />
                  <Metric label="Próxima janela" value={str(autonomy.nextBucketAt, "—")} />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Kill switch: <code>POST /api/runtime/autonomy</code> com{" "}
                  <code>{`{ "enabled": false }`}</code> desativa a autonomia imediatamente para o tenant.
                  Endpoint público: <code>/api/public/hooks/runtime-tick</code> exige header{" "}
                  <code>x-runtime-secret</code>.
                </p>
              </TechDetails>

              <TechDetails title="Memory & Tenant" hint={`${num(cache.totalEnvelopes)} envelopes · tenant ${tenantMasked}`}>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Memory (Knowledge Bus in-memory)</div>
                    <div className="grid grid-cols-2 gap-3">
                      <Metric label="Envelopes" value={num(cache.totalEnvelopes)} />
                      <Metric label="Topics" value={asArr(cache.perTopic).length} />
                      <Metric label="Cache" value="in-memory" />
                      <Metric label="Evictions" value={num(cache.evictions)} />
                      <Metric label="Expired" value={num(cache.expired)} />
                      <Metric label="Memory Only" value={bool(cache.memoryOnly) ? "Sim" : "—"} />
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Tenant (escopo isolado)</div>
                    <div className="grid grid-cols-2 gap-3">
                      <Metric label="Tenant" value={tenantMasked} />
                      <Metric label="Workers" value={workers.length || (worker ? 1 : 0)} />
                      <Metric label="Agentes" value={agentRows.length} />
                      <Metric label="Topics" value={topicRows.length} />
                      <Metric label="Queue" value={queuePending + queueProcessing} />
                      <Metric label="Cadeia" value={asArr(intelligence.connectedAgents).length} />
                    </div>
                  </div>
                </div>
              </TechDetails>

              <TechDetails title="Health Timeline — execuções completas" hint={`${Math.min(recentJobs.length, 100)} registros`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b border-border">
                        <th className="py-2 pr-3">Timestamp</th>
                        <th className="py-2 pr-3">Agent</th>
                        <th className="py-2 pr-3">Status</th>
                        <th className="py-2 pr-3">Duração</th>
                        <th className="py-2 pr-3">Outcome</th>
                        <th className="py-2 pr-3">Topic</th>
                        <th className="py-2 pr-3">KB</th>
                        <th className="py-2 pr-3">Fallback</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentJobs.slice(0, 100).map((j, i) => {
                        const jd = asDict(j);
                        const kb = asDict(jd.knowledgeBus ?? jd.knowledge_bus);
                        const status = str(jd.status);
                        const outcome = str(jd.outcome ?? jd.result, "—");
                        const finishedAt = str(jd.finishedAt ?? jd.finished_at ?? jd.updatedAt ?? jd.updated_at, "");
                        const topic = (asArr(kb.publishedTopics)[0] as string | undefined) ?? str(kb.knowledgeTopic, "—");
                        const hit = bool(kb.knowledgeBusHit) ? "HIT" : bool(kb.knowledgeBusMiss) ? "MISS" : "—";
                        return (
                          <tr key={i} className="border-b border-border/50">
                            <td className="py-2 pr-3">{fmtAgo(finishedAt)}</td>
                            <td className="py-2 pr-3 font-mono">{str(jd.agentId ?? jd.agent_id)}</td>
                            <td className="py-2 pr-3">
                              <Badge variant="outline" className="text-[10px]">{status}</Badge>
                            </td>
                            <td className="py-2 pr-3 tabular-nums">
                              {fmtMs(num(jd.durationMs ?? jd.duration_ms, null as unknown as number) || null)}
                            </td>
                            <td className="py-2 pr-3">{outcome}</td>
                            <td className="py-2 pr-3 font-mono">{topic}</td>
                            <td className="py-2 pr-3">{hit}</td>
                            <td className="py-2 pr-3">{bool(kb.knowledgeBusFallback) ? "sim" : "—"}</td>
                          </tr>
                        );
                      })}
                      {recentJobs.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-4 text-center text-muted-foreground">
                            Sem execuções registradas.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </TechDetails>
            </div>

            <p className="text-[11px] text-muted-foreground text-center pb-6">
              Página exclusivamente de leitura. Não executa jobs, não altera fila, Scheduler, banco ou Knowledge Bus.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- SignaturePanel: painel executivo para Runtime/Worker/Queue/Learning/KB ---------- */

function SignaturePanel({
  icon: Icon,
  title,
  health,
  primary,
  secondary,
  rows,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  health: HealthLevel;
  primary: string;
  secondary: string;
  rows: { label: string; value: string }[];
}) {
  return (
    <Card className="p-5 relative overflow-hidden">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-muted text-muted-foreground">
            <Icon className="h-3.5 w-3.5" />
          </div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</div>
        </div>
        <HealthPill level={health} />
      </div>
      <div className="text-2xl font-semibold tracking-tight tabular-nums">{primary}</div>
      <div className="text-xs text-muted-foreground mt-1">{secondary}</div>
      <div className="mt-4 pt-4 border-t border-border space-y-1.5">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{r.label}</span>
            <span className="tabular-nums font-medium">{r.value}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------- TechDetails: seção colapsável para diagnóstico técnico ---------- */

function TechDetails({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-lg border border-border bg-card">
      <summary className="cursor-pointer list-none flex items-center justify-between px-5 py-3 select-none hover:bg-muted/40 transition-colors rounded-lg">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs group-open:rotate-90 transition-transform inline-block w-3">▶</span>
          <span className="text-sm font-medium">Detalhes técnicos · {title}</span>
        </div>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </summary>
      <div className="px-5 pb-5 pt-1 border-t border-border">{children}</div>
    </details>
  );
}


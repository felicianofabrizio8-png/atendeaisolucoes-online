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
  CheckCircle2,
  Cpu,
  Database,
  Gauge,
  HardDrive,
  Loader2,
  RefreshCw,
  ShieldAlert,
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

  // ============ render ============
  return (
    <div className="min-h-screen bg-background p-4 md:p-6 space-y-6">
      {/* header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Activity className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">Runtime Observability</h1>
            <Badge variant="outline" className="text-[10px]">READ-ONLY</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Tenant {tenantMasked} · atualiza a cada {POLL_MS / 1000}s ·{" "}
            {lastFetched ? `sincronizado ${fmtAgo(lastFetched)}` : "aguardando…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <HealthPill level={overall} />
          <Button
            size="sm"
            variant="outline"
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
            )}
            Atualizar
          </Button>
        </div>
      </div>

      {loading && !snapshot ? (
        <Card className="p-8 grid place-items-center">
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
          {/* 1. Runtime */}
          <Card className="p-4">
            <SectionTitle icon={Zap} title="Runtime" subtitle="Estado geral do motor autônomo" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Metric
                label="Runtime"
                value={runtimeOnline ? "Online" : "Offline"}
                hint={`v${str(status.version, "?")}`}
              />
              <Metric label="Uptime" value={fmtUptime(uptimeMs)} />
              <Metric
                label="Heartbeat"
                value={fmtAgo(str(heartbeat.at ?? status.lastHeartbeat, ""))}
              />
              <Metric
                label="Scheduler"
                value={schedulerEnabled ? "Ativo" : "Desativado"}
              />
              <Metric
                label="Workers"
                value={workers.length || (worker ? 1 : 0)}
              />
              <Metric
                label="Queue Pending"
                value={queuePending}
                hint={`processing=${queueProcessing}`}
              />
              <Metric
                label="Knowledge Bus"
                value={num(cache.totalEnvelopes)}
                hint="envelopes"
              />
              <Metric
                label="Execution Engine"
                value={num(execution.totalExecutions ?? execution.total)}
                hint="execuções"
              />
            </div>
          </Card>

          {/* 12. Qualidade */}
          <Card className="p-4">
            <SectionTitle icon={Gauge} title="Qualidade" subtitle="Indicadores agregados" />
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <div className="rounded-md border border-border p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Runtime</div>
                <HealthPill level={runtimeHealth} />
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Knowledge</div>
                <HealthPill level={kbHealth} />
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Queue</div>
                <HealthPill level={queueHealth} />
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Worker</div>
                <HealthPill level={workerHealth} />
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Scheduler</div>
                <HealthPill level={schedulerHealth} />
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Overall</div>
                <HealthPill level={overall} />
              </div>
            </div>
          </Card>

          {/* 13. Alertas */}
          <Card className="p-4">
            <SectionTitle icon={AlertTriangle} title="Alertas" subtitle="Sinais detectados automaticamente" />
            {alerts.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-emerald-600">
                <CheckCircle2 className="h-4 w-4" />
                Nenhum alerta ativo.
              </div>
            ) : (
              <ul className="space-y-2">
                {alerts.map((a, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 text-sm rounded border border-border p-2"
                  >
                    <HealthPill level={a.level} />
                    <span>{a.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* 2. Agents */}
          <Card className="p-4">
            <SectionTitle icon={Workflow} title="Agents" subtitle="Ordenado pela pior saúde" />
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
          </Card>

          {/* 3. Knowledge Bus */}
          <Card className="p-4">
            <SectionTitle icon={Database} title="Knowledge Bus" subtitle="Producers, consumers e envelopes" />
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
                      <td className="py-2 pr-3 tabular-nums">
                        {t.ageSec >= 0 ? `${t.ageSec}s` : "—"}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {t.ttlMs ? fmtMs(t.ttlMs) : "—"}
                      </td>
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
          </Card>

          {/* 4. Execution + 9. Performance */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="p-4">
              <SectionTitle icon={Timer} title="Execution" subtitle={`Últimas ${jobDurations.length} execuções`} />
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Média" value={fmtMs(avg)} />
                <Metric label="Mínimo" value={fmtMs(min ?? null)} />
                <Metric label="Máximo" value={fmtMs(max ?? null)} />
                <Metric label="P95" value={fmtMs(p95)} />
                <Metric label="P99" value={fmtMs(p99)} />
                <Metric
                  label="Total"
                  value={num(execution.totalExecutions ?? execution.total)}
                />
              </div>
              {jobDurations.length > 0 ? (
                <div className="mt-3 flex items-end gap-0.5 h-16">
                  {jobDurations.slice(-40).map((d, i) => {
                    const h = max && max > 0 ? Math.max(4, (d / max) * 64) : 4;
                    return (
                      <div
                        key={i}
                        className="flex-1 bg-primary/60 rounded-sm"
                        style={{ height: `${h}px` }}
                        title={fmtMs(d)}
                      />
                    );
                  })}
                </div>
              ) : null}
            </Card>

            <Card className="p-4">
              <SectionTitle icon={Cpu} title="Performance" subtitle="Tempos médios do stack" />
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Runtime" value={fmtMs(avg)} />
                <Metric
                  label="Queue"
                  value={fmtMs(num(counters.avgWaitMs, null as unknown as number) || null)}
                />
                <Metric
                  label="Worker"
                  value={fmtMs(num(asDict(worker).avgDurationMs, null as unknown as number) || null)}
                />
                <Metric
                  label="Adapter"
                  value={fmtMs(num(execution.avgAdapterMs, null as unknown as number) || null)}
                />
                <Metric label="Agent" value={fmtMs(avg)} />
                <Metric
                  label="Publish"
                  value={
                    Object.values(producers).length
                      ? `${Object.values(producers).reduce<number>(
                          (a, p) => a + num(asDict(p).publishCount),
                          0,
                        )} totais`
                      : "—"
                  }
                />
              </div>
            </Card>
          </div>

          {/* 5. Queue + 6. Workers */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="p-4">
              <SectionTitle icon={HardDrive} title="Queue" subtitle="Estado da fila" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Metric label="Pending" value={queuePending} />
                <Metric label="Processing" value={queueProcessing} />
                <Metric label="Completed" value={num(counters.completed)} />
                <Metric label="Failed" value={queueFailed} />
                <Metric label="Dead Letter" value={queueDead} />
                <Metric label="Cancelled" value={num(counters.cancelled)} />
                <Metric label="Blocked" value={num(counters.blocked)} />
                <Metric label="Retry" value={num(counters.retry)} />
              </div>
            </Card>

            <Card className="p-4">
              <SectionTitle icon={Users} title="Workers" subtitle="Executores do Runtime" />
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-border">
                      <th className="py-2 pr-3">Worker</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">Última exec.</th>
                      <th className="py-2 pr-3">Jobs</th>
                      <th className="py-2 pr-3">Tempo médio</th>
                      <th className="py-2 pr-3">Health</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workers.map((w, i) => {
                      const wd = asDict(w);
                      return (
                        <tr key={i} className="border-b border-border/50">
                          <td className="py-2 pr-3 font-mono">{str(wd.workerId ?? wd.id)}</td>
                          <td className="py-2 pr-3">
                            <Badge variant="outline" className="text-[10px]">
                              {str(wd.status, "idle")}
                            </Badge>
                          </td>
                          <td className="py-2 pr-3">
                            {fmtAgo(str(wd.lastExecutionAt ?? wd.lastAt, ""))}
                          </td>
                          <td className="py-2 pr-3 tabular-nums">{num(wd.processedJobs ?? wd.jobs)}</td>
                          <td className="py-2 pr-3 tabular-nums">
                            {fmtMs(num(wd.avgDurationMs, null as unknown as number) || null)}
                          </td>
                          <td className="py-2 pr-3">
                            <HealthPill level="excellent" />
                          </td>
                        </tr>
                      );
                    })}
                    {workers.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-4 text-center text-muted-foreground">
                          Nenhum worker ativo.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          {/* 7. Scheduler + 10. Memory + 11. Tenant */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="p-4">
              <SectionTitle icon={Timer} title="Scheduler" subtitle="Desativado por design" />
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Schedules" value={asArr(scheduler.schedules).length} />
                <Metric label="Enabled" value={num(scheduler.enabledCount)} />
                <Metric label="Disabled" value={num(scheduler.disabledCount)} />
                <Metric
                  label="Próxima exec."
                  value={str(scheduler.nextRunAt, "—")}
                />
                <Metric
                  label="Última avaliação"
                  value={fmtAgo(str(scheduler.lastEvaluatedAt, ""))}
                />
                <Metric label="Duplicates" value={num(scheduler.duplicatesPrevented)} />
                <Metric label="Cooldown" value={num(scheduler.cooldownMs)} hint="ms" />
                <Metric label="Window" value={num(scheduler.windowMs)} hint="ms" />
              </div>
            </Card>

            <Card className="p-4">
              <SectionTitle icon={Database} title="Memory" subtitle="Knowledge Bus (in-memory)" />
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Envelopes" value={num(cache.totalEnvelopes)} />
                <Metric label="Topics" value={asArr(cache.perTopic).length} />
                <Metric label="Cache" value="in-memory" />
                <Metric label="Evictions" value={num(cache.evictions)} />
                <Metric label="Expired" value={num(cache.expired)} />
                <Metric label="Memory Only" value={bool(cache.memoryOnly) ? "Sim" : "—"} />
              </div>
            </Card>

            <Card className="p-4">
              <SectionTitle icon={Users} title="Tenant" subtitle="Escopo isolado" />
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Tenant" value={tenantMasked} />
                <Metric label="Workers" value={workers.length || (worker ? 1 : 0)} />
                <Metric label="Agentes" value={agentRows.length} />
                <Metric label="Topics" value={topicRows.length} />
                <Metric label="Queue" value={queuePending + queueProcessing} />
                <Metric
                  label="Cadeia"
                  value={asArr(intelligence.connectedAgents).length}
                />
              </div>
            </Card>
          </div>

          {/* 8. Health Timeline */}
          <Card className="p-4">
            <SectionTitle
              icon={Activity}
              title="Health Timeline"
              subtitle={`Últimas ${Math.min(recentJobs.length, 100)} execuções`}
            />
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
                    const finishedAt = str(
                      jd.finishedAt ?? jd.finished_at ?? jd.updatedAt ?? jd.updated_at,
                      "",
                    );
                    const topic =
                      (asArr(kb.publishedTopics)[0] as string | undefined) ??
                      str(kb.knowledgeTopic, "—");
                    const hit = bool(kb.knowledgeBusHit)
                      ? "HIT"
                      : bool(kb.knowledgeBusMiss)
                        ? "MISS"
                        : "—";
                    return (
                      <tr key={i} className="border-b border-border/50">
                        <td className="py-2 pr-3">{fmtAgo(finishedAt)}</td>
                        <td className="py-2 pr-3 font-mono">
                          {str(jd.agentId ?? jd.agent_id)}
                        </td>
                        <td className="py-2 pr-3">
                          <Badge variant="outline" className="text-[10px]">{status}</Badge>
                        </td>
                        <td className="py-2 pr-3 tabular-nums">
                          {fmtMs(num(jd.durationMs ?? jd.duration_ms, null as unknown as number) || null)}
                        </td>
                        <td className="py-2 pr-3">{outcome}</td>
                        <td className="py-2 pr-3 font-mono">{topic}</td>
                        <td className="py-2 pr-3">{hit}</td>
                        <td className="py-2 pr-3">
                          {bool(kb.knowledgeBusFallback) ? "sim" : "—"}
                        </td>
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
          </Card>

          <p className="text-[11px] text-muted-foreground text-center pb-6">
            Página exclusivamente de leitura. Não executa jobs, não altera fila,
            Scheduler, banco ou Knowledge Bus.
          </p>
        </>
      )}
    </div>
  );
}

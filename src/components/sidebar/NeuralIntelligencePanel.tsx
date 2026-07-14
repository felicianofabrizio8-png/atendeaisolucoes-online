// Central de Inteligência Viva — v6 (Runtime real).
// 100% READ-ONLY. Consome EXCLUSIVAMENTE GET /api/runtime/status.
// Nenhum outro endpoint, nenhum mock, nenhum valor simulado.
// Animações só ocorrem quando há atividade real (running, learning,
// consolidating, error). Agentes desativados ou ociosos permanecem estáticos.

import { motion, AnimatePresence, MotionConfig, useReducedMotion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Brain } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useAuth } from "@/auth/AuthContext";

/* -------------------- Buckets visuais -------------------- */

type Bucket =
  | "running"
  | "queued"
  | "learning"
  | "consolidating"
  | "completed"
  | "error"
  | "disabled"
  | "idle";

const BUCKET_META: Record<Bucket, { glow: string; label: string; hex: string; animate: boolean }> = {
  running:       { glow: "rgba(52,211,153,0.85)",  label: "Executando",   hex: "rgb(52,211,153)",  animate: true  },
  queued:        { glow: "rgba(251,191,36,0.85)",  label: "Na fila",      hex: "rgb(251,191,36)",  animate: true  },
  learning:      { glow: "rgba(56,189,248,0.85)",  label: "Aprendendo",   hex: "rgb(56,189,248)",  animate: true  },
  consolidating: { glow: "rgba(167,139,250,0.85)", label: "Consolidando", hex: "rgb(167,139,250)", animate: true  },
  completed:     { glow: "rgba(45,212,191,0.75)",  label: "Concluído",    hex: "rgb(45,212,191)",  animate: false },
  error:         { glow: "rgba(248,113,113,0.9)",  label: "Erro",         hex: "rgb(248,113,113)", animate: true  },
  disabled:      { glow: "rgba(148,163,184,0.5)",  label: "Desativado",   hex: "rgb(148,163,184)", animate: false },
  idle:          { glow: "rgba(148,163,184,0.55)", label: "Ocioso",       hex: "rgb(148,163,184)", animate: false },
};

/* -------------------- Tipos do snapshot -------------------- */

type AgentStatus = "idle" | "running" | "success" | "failure" | "unknown" | "disabled";
type AgentHealth = "healthy" | "degraded" | "unknown" | "down";

interface AgentEntry {
  id: string;
  name: string;
  enabled: boolean;
  state: {
    status: AgentStatus;
    health: AgentHealth;
    lastExecution: string | null;
    lastSuccess: string | null;
    lastFailure: string | null;
    lastError: string | null;
  };
}

interface RecentJob {
  id: string;
  agentId: string;
  status: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
}

interface LearningPerAgent {
  cycles: number;
  created: number;
  accepted: number;
  rejected: number;
  consolidated: number;
  lastAt: string | null;
}

interface LastRealExecution {
  agentId: string;
  outcome: string;
  reason: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number;
  error: string | null;
}

interface ConnectedAgentEntry {
  agentId: string;
  adapterHealth: unknown;
  lastExecution: LastRealExecution | null;
}

interface RuntimeSnapshot {
  status: {
    online: boolean;
    version: string;
    uptimeMs: number;
    registeredAgents: number;
    healthyAgents: number;
    disabledAgents: number;
    lastHeartbeat: { ts: string } | null;
  };
  agents: AgentEntry[];
  recentJobs: RecentJob[];
  learning: {
    cycles: number;
    hypotheses: { created: number; accepted: number; rejected: number; consolidated: number };
    knowledgeConsolidated: number;
    averageConfidence: number;
    lastLearning: string | null;
    lastAgent: string | null;
    perAgent?: Record<string, LearningPerAgent> | LearningPerAgent[];
  };
  execution?: {
    state?: string;
    lastRealExecutions?: LastRealExecution[];
  } | null;
  intelligence?: {
    connectedAgents?: ConnectedAgentEntry[];
  } | null;
  worker?: {
    workerId?: string;
    health?: { state?: string; inFlight?: number; jobsProcessed?: number; lastJobAt?: string | null; lastError?: string | null };
  } | null;
  workers?: Array<{
    workerId?: string;
    health?: { state?: string; inFlight?: number; jobsProcessed?: number; lastJobAt?: string | null };
  }>;
  scheduler?: {
    registered?: number;
    enabled?: number;
    disabled?: number;
    nextExecutionAt?: string | null;
    totalEnqueued?: number;
  } | null;
  knowledgeBus?: {
    health?: { level?: string; publishCount?: number; readCount?: number; lastActivityAt?: string | null; errors?: number };
    cache?: { totalEnvelopes?: number };
    topics?: Array<{ id?: string }> | Record<string, unknown>;
  } | null;
  counters?: {
    queued?: number;
    scheduled?: number;
    processing?: number;
    completed?: number;
    failed?: number;
    retry?: number;
    deadLetter?: number;
  } | null;
  autonomy?: {
    tenantEnabled?: {
      autonomyEnabled?: boolean;
      systemHealthEnabled?: boolean;
      killSwitch?: boolean;
    } | null;
  };
}

/* -------------------- Fetch -------------------- */

async function fetchRuntimeStatus(): Promise<RuntimeSnapshot | null> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) return null;
  const res = await fetch("/api/runtime/status", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { ok?: boolean; snapshot?: RuntimeSnapshot };
  if (!body?.ok || !body.snapshot) return null;
  return body.snapshot;
}

function useRuntimeStatus(enabled: boolean) {
  return useQuery<RuntimeSnapshot | null>({
    queryKey: ["neural-intelligence-panel", "runtime-status", "v6"],
    enabled,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    staleTime: 8_000,
    retry: false,
    queryFn: fetchRuntimeStatus,
  });
}

/* -------------------- Utilidades -------------------- */

function iso(ts?: string | null): number | undefined {
  if (!ts) return undefined;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : undefined;
}

function formatTime(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatRelative(ts: number | undefined) {
  if (!ts) return "—";
  const diff = Math.max(0, Date.now() - ts);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m}min`;
  const h = Math.floor(m / 60);
  return `há ${h}h`;
}

/* -------------------- Resolução de estado real -------------------- */

interface Resolved {
  bucket: Bucket;
  stateLabel: string;
  updatedAt?: number;
  detail?: string;
}

interface AgentJobHint {
  latestStatus: string | null;
  latestTs: number | undefined;
  hasProcessing: boolean;
  hasQueued: boolean;
  lastCompletedTs?: number;
  lastFailedTs?: number;
  lastError?: string | null;
}

function resolveAgent(
  a: AgentEntry,
  learningMap: Map<string, LearningPerAgent>,
  lastRealExecMap: Map<string, LastRealExecution>,
  jobHintMap: Map<string, AgentJobHint>,
  connectedSet: Set<string>,
): Resolved {
  const learn = learningMap.get(a.id);
  const realExec = lastRealExecMap.get(a.id);
  const jobHint = jobHintMap.get(a.id);
  const lastExec = iso(a.state.lastExecution);
  const lastSuccess = iso(a.state.lastSuccess);
  const lastFail = iso(a.state.lastFailure);
  const lastLearning = iso(learn?.lastAt ?? null);
  const lastRealFinished = iso(realExec?.finishedAt ?? realExec?.startedAt ?? null);
  const now = Date.now();

  if (!a.enabled || a.state.status === "disabled") {
    return { bucket: "disabled", stateLabel: "desativado", updatedAt: lastExec };
  }

  // Running: agent.state, execution.lastRealExecutions ou fila em processamento
  if (a.state.status === "running" || jobHint?.hasProcessing) {
    return {
      bucket: "running",
      stateLabel: "executando",
      updatedAt: jobHint?.latestTs ?? lastRealFinished ?? lastExec,
    };
  }

  // Erro real: failure recente do agente ou última execução real com falha
  const realFailed = realExec?.outcome === "failure" || realExec?.outcome === "timeout";
  if (
    a.state.status === "failure" ||
    realFailed ||
    (a.state.lastError && lastFail && lastSuccess && lastFail > lastSuccess) ||
    (a.state.lastError && lastFail && !lastSuccess)
  ) {
    return {
      bucket: "error",
      stateLabel: "erro",
      updatedAt: lastFail ?? lastRealFinished ?? lastExec,
      detail: realExec?.error ?? a.state.lastError ?? undefined,
    };
  }

  // Queued: fila com jobs aguardando dispatch
  if (jobHint?.hasQueued) {
    return { bucket: "queued", stateLabel: "na fila", updatedAt: jobHint.latestTs };
  }

  // Learning: perAgent do Learning Loop com atividade recente
  if (learn && (learn.cycles > 0 || learn.consolidated > 0) && lastLearning && now - lastLearning < 5 * 60_000) {
    if (learn.consolidated > 0 && now - lastLearning < 2 * 60_000) {
      return { bucket: "consolidating", stateLabel: "consolidando", updatedAt: lastLearning };
    }
    return { bucket: "learning", stateLabel: "aprendendo", updatedAt: lastLearning };
  }

  // Completed: execução real bem-sucedida recente
  if (realExec?.outcome === "success" && lastRealFinished && now - lastRealFinished < 5 * 60_000) {
    return { bucket: "completed", stateLabel: "concluído", updatedAt: lastRealFinished };
  }
  if (lastSuccess && now - lastSuccess < 5 * 60_000) {
    return { bucket: "completed", stateLabel: "concluído", updatedAt: lastSuccess };
  }

  if (a.state.health === "degraded") {
    return { bucket: "consolidating", stateLabel: "degradado", updatedAt: lastExec };
  }
  if (a.state.health === "down") {
    return { bucket: "error", stateLabel: "indisponível", updatedAt: lastExec };
  }

  // Sem sinal recente: conectado ao Runtime = idle, caso contrário disabled visual
  if (!connectedSet.has(a.id)) {
    return { bucket: "idle", stateLabel: "ocioso", updatedAt: lastExec };
  }
  return { bucket: "idle", stateLabel: "aguardando trabalho", updatedAt: lastExec };
}

function resolveProfessor(snap: RuntimeSnapshot | null): Resolved {
  if (!snap) return { bucket: "idle", stateLabel: "conectando" };
  if (snap.autonomy?.tenantEnabled?.killSwitch) {
    return { bucket: "error", stateLabel: "kill switch ativo" };
  }
  if (!snap.status?.online) return { bucket: "error", stateLabel: "offline" };
  const hbTs = iso(snap.status?.lastHeartbeat?.ts);
  const agentsArr = Array.isArray(snap.agents) ? snap.agents : [];
  const anyRunning = agentsArr.some((a) => a?.state?.status === "running");
  if (anyRunning) return { bucket: "running", stateLabel: "coordenando", updatedAt: hbTs };
  if ((snap.status?.healthyAgents ?? 0) > 0) {
    return { bucket: "completed", stateLabel: "online", updatedAt: hbTs };
  }
  return { bucket: "idle", stateLabel: "aguardando agentes", updatedAt: hbTs };
}

/* -------------------- Componente principal -------------------- */

interface DisplayAgent {
  id: string;
  label: string;
  short: string;
  resolved: Resolved;
  surge?: boolean;
}

const AGENT_LABEL: Record<string, { label: string; short: string }> = {
  "system-health": { label: "System Health", short: "Health" },
  "business-brain": { label: "Business Brain", short: "Brain" },
  "business-learning": { label: "Business Learning", short: "Learning" },
  "scientific-knowledge": { label: "Scientific Knowledge", short: "Scientific" },
  "scientific-memory": { label: "Scientific Memory", short: "Memory" },
  "executive-intelligence": { label: "Executive Intelligence", short: "Executive" },
  "executive-knowledge": { label: "Executive Knowledge", short: "Exec. KB" },
  "executive-narrative": { label: "Executive Narrative", short: "Narrative" },
  "professor": { label: "Professor", short: "Professor" },
  "sales-intelligence": { label: "Sales Intelligence", short: "Sales" },
  "coach": { label: "Coach", short: "Coach" },
  "follow-up": { label: "Follow-up", short: "Followup" },
};

const ORBIT_PRIORITY = [
  "business-brain",
  "business-learning",
  "scientific-knowledge",
  "scientific-memory",
  "executive-intelligence",
  "system-health",
  "executive-knowledge",
  "executive-narrative",
];

const BREATH = 3.8;

export function NeuralIntelligencePanel() {
  const { user } = useAuth();
  const reducedMotion = useReducedMotion();
  const { data: snap, isLoading, isError } = useRuntimeStatus(!!user);

  const learningMap = useMemo(() => {
    const m = new Map<string, LearningPerAgent>();
    const raw = snap?.learning?.perAgent;
    if (!raw) return m;
    if (Array.isArray(raw)) {
      // Fallback defensivo caso o formato mude para array com agentId embutido
      for (const p of raw as Array<LearningPerAgent & { agentId?: string }>) {
        if (p && typeof p === "object" && typeof p.agentId === "string") {
          m.set(p.agentId, p);
        }
      }
    } else if (typeof raw === "object") {
      for (const [agentId, entry] of Object.entries(raw as Record<string, LearningPerAgent>)) {
        if (entry && typeof entry === "object") m.set(agentId, entry);
      }
    }
    return m;
  }, [snap]);

  const lastRealExecMap = useMemo(() => {
    const m = new Map<string, LastRealExecution>();
    const raw = snap?.execution?.lastRealExecutions;
    const list: LastRealExecution[] = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object"
      ? (Object.values(raw as Record<string, LastRealExecution>) ?? [])
      : [];
    for (const e of list) {
      if (e && typeof e === "object" && typeof e.agentId === "string") m.set(e.agentId, e);
    }
    return m;
  }, [snap]);

  const connectedSet = useMemo(() => {
    const s = new Set<string>();
    const raw = snap?.intelligence?.connectedAgents;
    const list: ConnectedAgentEntry[] = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object"
      ? (Object.values(raw as Record<string, ConnectedAgentEntry>) ?? [])
      : [];
    for (const c of list) {
      if (c && typeof c === "object" && typeof c.agentId === "string") s.add(c.agentId);
    }
    return s;
  }, [snap]);

  const jobHintMap = useMemo(() => {
    const m = new Map<string, AgentJobHint>();
    const raw = snap?.recentJobs;
    const jobs: RecentJob[] = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object"
      ? (Object.values(raw as Record<string, RecentJob>) ?? [])
      : [];
    for (const j of jobs) {
      if (!j || typeof j !== "object" || typeof j.agentId !== "string") continue;
      const ts = iso(j.finishedAt) ?? iso(j.startedAt) ?? iso(j.createdAt);
      let hint = m.get(j.agentId);
      if (!hint) {
        hint = { latestStatus: null, latestTs: undefined, hasProcessing: false, hasQueued: false };
        m.set(j.agentId, hint);
      }
      if (ts && (!hint.latestTs || ts > hint.latestTs)) {
        hint.latestTs = ts;
        hint.latestStatus = typeof j.status === "string" ? j.status : null;
        hint.lastError = j.lastError ?? null;
      }
      if (j.status === "processing") hint.hasProcessing = true;
      if (j.status === "queued" || j.status === "scheduled" || j.status === "retry") hint.hasQueued = true;
      if (j.status === "completed") hint.lastCompletedTs = Math.max(hint.lastCompletedTs ?? 0, ts ?? 0);
      if (j.status === "failed" || j.status === "dead_letter" || j.status === "timeout") {
        hint.lastFailedTs = Math.max(hint.lastFailedTs ?? 0, ts ?? 0);
      }
    }
    return m;
  }, [snap]);

  const professor = resolveProfessor(snap ?? null);

  const agents: DisplayAgent[] = useMemo(() => {
    if (!snap) return [];
    const rawAgents = snap.agents;
    const agentList: AgentEntry[] = Array.isArray(rawAgents)
      ? rawAgents
      : rawAgents && typeof rawAgents === "object"
      ? (Object.values(rawAgents as Record<string, AgentEntry>) ?? [])
      : [];
    const safeAgents = agentList.filter(
      (a): a is AgentEntry => !!a && typeof a === "object" && typeof a.id === "string" && !!a.state,
    );
    const byId = new Map(safeAgents.map((a) => [a.id, a]));
    const ordered: AgentEntry[] = [];
    for (const id of ORBIT_PRIORITY) {
      const a = byId.get(id);
      if (a && a.id !== "professor") ordered.push(a);
    }
    for (const a of safeAgents) {
      if (a.id === "professor") continue;
      if (!ordered.find((x) => x.id === a.id)) ordered.push(a);
    }
    return ordered.slice(0, 6).map((a) => {
      const meta = AGENT_LABEL[a.id] ?? { label: a.name ?? a.id, short: a.name ?? a.id };
      return {
        id: a.id,
        label: meta.label,
        short: meta.short,
        resolved: resolveAgent(a, learningMap, lastRealExecMap, jobHintMap, connectedSet),
      };
    });
  }, [snap, learningMap, lastRealExecMap, jobHintMap, connectedSet]);

  // Surge: detecta mudança de lastExecution/lastSuccess/lastLearning por agente.
  const prevRef = useRef<Record<string, number | undefined>>({});
  const [surge, setSurge] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const map: Record<string, number | undefined> = {};
    for (const a of agents) map[a.id] = a.resolved.updatedAt;
    map.professor = professor.updatedAt;
    const changed: string[] = [];
    for (const k of Object.keys(map)) {
      const prev = prevRef.current[k];
      const now = map[k];
      if (now && prev && now > prev) changed.push(k);
    }
    prevRef.current = map;
    if (changed.length > 0) {
      setSurge((s) => {
        const next = { ...s };
        for (const k of changed) next[k] = true;
        return next;
      });
      const to = window.setTimeout(() => {
        setSurge((s) => {
          const next = { ...s };
          for (const k of changed) delete next[k];
          return next;
        });
      }, 4200);
      return () => window.clearTimeout(to);
    }
  }, [agents, professor.updatedAt]);

  const agentsWithSurge = agents.map((a) => ({ ...a, surge: surge[a.id] }));

  const networkOnline =
    !!user &&
    !isError &&
    !!snap?.status?.online &&
    !snap?.autonomy?.tenantEnabled?.killSwitch;

  // Feed real: últimos jobs do Runtime.
  const feed = useMemo(() => {
    const raw = snap?.recentJobs;
    const jobs: RecentJob[] = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object"
      ? (Object.values(raw as Record<string, RecentJob>) ?? [])
      : [];
    if (jobs.length === 0) return [] as Array<{ label: string; msg: string; ts: number; ok: boolean }>;
    return jobs
      .filter((j): j is RecentJob => !!j && typeof j === "object" && typeof j.agentId === "string")
      .map((j) => {
        const ts =
          iso(j.finishedAt) ??
          iso(j.startedAt) ??
          iso(j.createdAt) ??
          0;
        const meta = AGENT_LABEL[j.agentId];
        const statusStr = typeof j.status === "string" ? j.status : "—";
        return {
          label: meta?.label ?? j.agentId,
          msg: j.lastError ? `${statusStr} · ${String(j.lastError).slice(0, 40)}` : statusStr,
          ts,
          ok: !j.lastError && (statusStr === "completed" || statusStr === "processing"),
        };
      })
      .filter((e) => e.ts > 0)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 5);
  }, [snap]);

  const [legendFocused, setLegendFocused] = useState(false);

  const learning = snap?.learning;
  const worker = snap?.worker ?? snap?.workers?.[0] ?? null;
  const workerHealth = worker?.health ?? null;
  const workerState = workerHealth?.state ?? null;
  const workerInFlight = workerHealth?.inFlight ?? 0;
  const workerJobs = workerHealth?.jobsProcessed ?? 0;
  const busHealth = snap?.knowledgeBus?.health;
  const busLevel = busHealth?.level ?? null;
  const busPublishes = busHealth?.publishCount ?? 0;
  const busReads = busHealth?.readCount ?? 0;
  const busErrors = busHealth?.errors ?? 0;
  const busLastActivity = iso(busHealth?.lastActivityAt ?? null);
  const busEnvelopes = snap?.knowledgeBus?.cache?.totalEnvelopes ?? 0;
  const busTopicsRaw = snap?.knowledgeBus?.topics;
  const busTopicsCount = Array.isArray(busTopicsRaw)
    ? busTopicsRaw.length
    : busTopicsRaw && typeof busTopicsRaw === "object"
    ? Object.keys(busTopicsRaw).length
    : 0;
  const scheduler = snap?.scheduler;
  const schedulerEnabled = scheduler?.enabled ?? 0;
  const schedulerRegistered = scheduler?.registered ?? 0;
  const schedulerNextTs = iso(scheduler?.nextExecutionAt ?? null);
  const counters = snap?.counters ?? null;

  const statusLabel = !user
    ? "Aguardando sessão"
    : isLoading && !snap
    ? "Conectando ao Runtime"
    : isError
    ? "Runtime indisponível"
    : snap?.autonomy?.tenantEnabled?.killSwitch
    ? "Kill switch ativo"
    : networkOnline
    ? "Runtime Online"
    : "Runtime offline";

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-2 my-2 rounded-xl border border-sidebar-border/60 bg-gradient-to-b from-[hsl(220_35%_11%/0.85)] via-sidebar/50 to-sidebar/20 backdrop-blur-sm p-2.5 overflow-hidden relative">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(125,211,252,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(125,211,252,0.6) 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
        />
        {!reducedMotion && networkOnline && <BackgroundParticles />}

        {/* Header */}
        <div className="relative flex items-start justify-between gap-2 mb-1.5">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold tracking-[0.14em] uppercase text-sidebar-foreground/95 leading-none">
              Inteligência Viva
            </div>
            <div className="text-[9px] text-muted-foreground/80 mt-0.5 leading-none truncate">
              {snap?.status?.version ? `Runtime ${snap.status.version}` : "Runtime"}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0 mt-0.5">
            <motion.span
              animate={
                networkOnline
                  ? { opacity: [0.55, 1, 0.55] }
                  : { opacity: 0.55 }
              }
              transition={{ duration: 1.8, repeat: networkOnline ? Infinity : 0 }}
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                networkOnline
                  ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]"
                  : isError || snap?.autonomy?.tenantEnabled?.killSwitch
                  ? "bg-red-400"
                  : "bg-amber-400",
              )}
            />
            <span className="text-[8.5px] text-muted-foreground/85 tracking-wide">
              {statusLabel}
            </span>
          </div>
        </div>

        <NeuralGraph professor={professor} agents={agentsWithSurge} professorSurge={surge.professor} />

        {/* Legenda */}
        <div
          className={cn(
            "mt-1 flex items-center justify-between gap-1 px-0.5 transition-opacity duration-500",
            legendFocused ? "opacity-100" : "opacity-40",
          )}
          onMouseEnter={() => setLegendFocused(true)}
          onMouseLeave={() => setLegendFocused(false)}
        >
          {(["running", "queued", "learning", "consolidating", "completed", "error", "disabled", "idle"] as Bucket[]).map((s) => (
            <div
              key={s}
              className="flex items-center gap-1 rounded-full border border-sidebar-border/40 bg-black/25 px-1.5 py-[2px]"
            >
              <span
                className="h-1 w-1 rounded-full"
                style={{ backgroundColor: BUCKET_META[s].hex, boxShadow: `0 0 4px ${BUCKET_META[s].glow}` }}
              />
              <span className="text-[7.5px] text-sidebar-foreground/80 tracking-wide">
                {BUCKET_META[s].label}
              </span>
            </div>
          ))}
        </div>

        {/* Feed real do Runtime */}
        <div className="mt-1.5 rounded-md border border-sidebar-border/40 bg-black/40 px-2 py-1.5 font-mono text-[8.5px] leading-[1.45] text-sidebar-foreground/90 h-[74px] overflow-hidden relative">
          {feed.length === 0 ? (
            <div className="text-muted-foreground/60 italic truncate">
              <span className="text-emerald-400">$</span> aguardando jobs do Runtime
              <BlinkingCursor />
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {feed.map((e, i) => (
                <motion.div
                  key={`${e.label}-${e.ts}-${i}`}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ delay: i * 0.06, duration: 0.35 }}
                  className="flex items-baseline gap-1.5 truncate"
                >
                  <span className="text-sky-300/70 shrink-0">{formatTime(e.ts)}</span>
                  <span className={cn("shrink-0", e.ok ? "text-emerald-400" : "text-red-400")}>
                    {e.ok ? "✓" : "!"}
                  </span>
                  <span className="text-sidebar-foreground/95 shrink-0">{e.label}</span>
                  <span className="text-muted-foreground/75 truncate">· {e.msg}</span>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>

        {/* Infra: Worker, Scheduler, Knowledge Bus, Learning, Fila */}
        <div className="mt-1.5 grid grid-cols-2 gap-1 px-0.5">
          <InfraStat
            label="Worker"
            value={workerState ?? "—"}
            detail={
              workerHealth
                ? `${workerInFlight} em voo · ${workerJobs} jobs${
                    workerHealth.lastJobAt ? ` · ${formatRelative(iso(workerHealth.lastJobAt))}` : ""
                  }`
                : "—"
            }
            active={workerState === "busy" || workerInFlight > 0}
          />
          <InfraStat
            label="Scheduler"
            value={
              scheduler
                ? `${schedulerEnabled}/${schedulerRegistered} ativos`
                : "—"
            }
            detail={
              schedulerNextTs
                ? `próx. ${formatRelative(schedulerNextTs)}`
                : scheduler
                ? "sem próximo tick"
                : "—"
            }
            active={schedulerEnabled > 0}
          />
          <InfraStat
            label="Knowledge Bus"
            value={busLevel ?? "—"}
            detail={
              busHealth
                ? `${busPublishes} pub · ${busReads} rd${
                    busLastActivity ? ` · ${formatRelative(busLastActivity)}` : ""
                  }`
                : "—"
            }
            active={busLevel === "healthy" && busPublishes > 0}
          />
          <InfraStat
            label="Learning Loop"
            value={learning ? `${learning.cycles ?? 0} ciclos` : "—"}
            detail={
              learning?.lastLearning
                ? `${formatRelative(iso(learning.lastLearning))}${
                    learning.lastAgent ? ` · ${learning.lastAgent}` : ""
                  }`
                : "sem ciclos"
            }
            active={
              !!learning?.lastLearning &&
              Date.now() - (iso(learning.lastLearning) ?? 0) < 15 * 60_000
            }
          />
        </div>

        {/* Fila do Runtime */}
        <div className="mt-1.5 px-0.5">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[8.5px] uppercase tracking-[0.14em] text-muted-foreground/75">
              Fila
            </span>
            {snap?.status?.lastHeartbeat?.ts && (
              <span className="text-[8px] text-muted-foreground/70">
                heartbeat {formatRelative(iso(snap.status.lastHeartbeat.ts))}
              </span>
            )}
          </div>
          {counters ? (
            <div className="text-[9px] text-sidebar-foreground/85 flex flex-wrap gap-x-2 gap-y-0.5">
              <span>
                <span className="text-amber-300">{counters.queued ?? 0}</span>{" "}
                <span className="text-muted-foreground/70">queued</span>
              </span>
              <span>
                <span className="text-sky-300">{counters.processing ?? 0}</span>{" "}
                <span className="text-muted-foreground/70">running</span>
              </span>
              <span>
                <span className="text-emerald-300">{counters.completed ?? 0}</span>{" "}
                <span className="text-muted-foreground/70">done</span>
              </span>
              <span>
                <span className="text-red-300">{counters.failed ?? 0}</span>{" "}
                <span className="text-muted-foreground/70">failed</span>
              </span>
            </div>
          ) : (
            <div className="text-[9px] text-sidebar-foreground/70 italic">—</div>
          )}
        </div>


        {/* Conhecimento acumulado — apenas dados reais do Learning Loop */}
        <div className="mt-1.5 px-0.5">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[8.5px] uppercase tracking-[0.14em] text-muted-foreground/75">
              Conhecimento acumulado
            </span>
          </div>
          {(() => {
            const consolidated = learning?.knowledgeConsolidated ?? 0;
            const accepted = learning?.hypotheses?.accepted ?? 0;
            const conf = learning?.averageConfidence;
            if (!learning || (consolidated === 0 && accepted === 0)) {
              return (
                <div className="text-[9px] text-sidebar-foreground/70 italic">
                  Aguardando ciclos de aprendizado
                </div>
              );
            }
            return (
              <div className="text-[9px] text-sidebar-foreground/85">
                <span className="text-emerald-300">{consolidated}</span> consolidados
                <span className="text-muted-foreground/60"> · </span>
                <span className="text-sky-300">{accepted}</span> hipóteses aceitas
                <span className="text-muted-foreground/60"> · </span>
                <span className="text-violet-300">
                  {typeof conf === "number" ? `${Math.round(conf * 100)}%` : "—"}
                </span>{" "}
                confiança
              </div>
            );
          })()}
        </div>
      </div>
    </MotionConfig>
  );
}

/* -------------------- InfraStat -------------------- */

function InfraStat({
  label,
  value,
  detail,
  active,
}: {
  label: string;
  value: string;
  detail: string;
  active: boolean;
}) {
  return (
    <div className="rounded-md border border-sidebar-border/40 bg-black/25 px-1.5 py-1">
      <div className="flex items-center gap-1">
        <span
          className={cn(
            "h-1 w-1 rounded-full",
            active ? "bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.8)]" : "bg-muted-foreground/40",
          )}
        />
        <span className="text-[7.5px] uppercase tracking-[0.12em] text-muted-foreground/80">
          {label}
        </span>
      </div>
      <div className="text-[9px] text-sidebar-foreground/95 mt-0.5 truncate">{value}</div>
      <div className="text-[8px] text-muted-foreground/70 truncate">{detail}</div>
    </div>
  );
}

/* -------------------- Blinking cursor -------------------- */

function BlinkingCursor() {
  return (
    <motion.span
      animate={{ opacity: [1, 0, 1] }}
      transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
      className="inline-block text-emerald-400 font-mono"
      style={{ marginLeft: 1 }}
    >
      █
    </motion.span>
  );
}

/* -------------------- Background particles -------------------- */

function BackgroundParticles() {
  const parts = useMemo(
    () =>
      Array.from({ length: 10 }, (_, i) => ({
        left: (i * 37 + 11) % 100,
        top: (i * 53 + 7) % 100,
        dur: 14 + (i % 5) * 3,
        delay: i * 0.7,
      })),
    [],
  );
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {parts.map((p, i) => (
        <motion.span
          key={i}
          className="absolute h-[2px] w-[2px] rounded-full bg-sky-300/40"
          style={{ left: `${p.left}%`, top: `${p.top}%` }}
          animate={{ y: [-6, 6, -6], opacity: [0.15, 0.5, 0.15] }}
          transition={{ duration: p.dur, delay: p.delay, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

/* -------------------- Neural graph -------------------- */

function NeuralGraph({
  professor,
  agents,
  professorSurge,
}: {
  professor: Resolved;
  agents: DisplayAgent[];
  professorSurge?: boolean;
}) {
  const W = 260;
  const H = 240;
  const prof = { x: W / 2, y: H / 2 - 4 };
  const [hovered, setHovered] = useState<string | null>(null);

  const orbits: Array<{ r: number; angle: number }> = [
    { r: 74, angle: 168 },
    { r: 68, angle: -150 },
    { r: 92, angle: 108 },
    { r: 96, angle: -78 },
    { r: 84, angle: -18 },
    { r: 88, angle: 52 },
  ];

  const positions = orbits.map(({ r, angle }) => {
    const rad = (angle * Math.PI) / 180;
    return { x: prof.x + Math.cos(rad) * r, y: prof.y + Math.sin(rad) * r };
  });

  const profMeta = BUCKET_META[professor.bucket];
  const profColor = profMeta.hex;
  const profAnimate = profMeta.animate;

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="profGlowOuter" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={profColor} stopOpacity="0.55" />
            <stop offset="55%" stopColor={profColor} stopOpacity="0.12" />
            <stop offset="100%" stopColor={profColor} stopOpacity="0" />
          </radialGradient>
          <radialGradient id="profGlowInner" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={profColor} stopOpacity="0.85" />
            <stop offset="100%" stopColor={profColor} stopOpacity="0" />
          </radialGradient>
          <radialGradient id="profCore" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="hsl(220 35% 18%)" stopOpacity="1" />
            <stop offset="100%" stopColor="hsl(220 35% 8%)" stopOpacity="1" />
          </radialGradient>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgba(148,163,184,0.06)" />
            <stop offset="50%" stopColor="rgba(148,163,184,0.38)" />
            <stop offset="100%" stopColor="rgba(148,163,184,0.06)" />
          </linearGradient>
          <linearGradient id="lineGradActive" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgba(56,189,248,0.1)" />
            <stop offset="50%" stopColor="rgba(56,189,248,0.75)" />
            <stop offset="100%" stopColor="rgba(56,189,248,0.1)" />
          </linearGradient>
          <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {positions.map((p, i) => {
          const a = agents[i];
          const meta = a ? BUCKET_META[a.resolved.bucket] : null;
          const isAnimated = !!meta?.animate;
          const particleColor = meta?.hex ?? "rgb(125,211,252)";
          const propDelay = 0.25 + i * 0.28;
          const surging = a?.surge;
          return (
            <g key={`line-${i}`}>
              <line
                x1={prof.x}
                y1={prof.y}
                x2={p.x}
                y2={p.y}
                stroke={isAnimated ? "url(#lineGradActive)" : "url(#lineGrad)"}
                strokeWidth={surging ? 1.4 : isAnimated ? 0.9 : 0.55}
              />
              {(isAnimated || surging) && (
                <>
                  <motion.line
                    x1={prof.x}
                    y1={prof.y}
                    x2={p.x}
                    y2={p.y}
                    stroke={particleColor}
                    strokeLinecap="round"
                    strokeWidth={surging ? 1.6 : 1.1}
                    initial={{ opacity: 0 }}
                    animate={{
                      opacity: surging ? [0, 1, 0, 1, 0] : [0, 0.65, 0],
                    }}
                    transition={{
                      duration: surging ? 1.4 : BREATH,
                      repeat: Infinity,
                      ease: "easeInOut",
                      delay: propDelay,
                    }}
                  />
                  <motion.circle
                    r={surging ? 2.4 : 1.6}
                    fill={particleColor}
                    filter="url(#softGlow)"
                    initial={{ cx: prof.x, cy: prof.y, opacity: 0 }}
                    animate={{
                      cx: [prof.x, p.x],
                      cy: [prof.y, p.y],
                      opacity: [0, 1, 0],
                    }}
                    transition={{
                      duration: surging ? 1.2 : BREATH,
                      repeat: Infinity,
                      delay: propDelay,
                      ease: "easeInOut",
                    }}
                  />
                </>
              )}
            </g>
          );
        })}

        <motion.circle
          cx={prof.x}
          cy={prof.y}
          r={62}
          fill="url(#profGlowOuter)"
          animate={
            profAnimate
              ? {
                  opacity: professorSurge ? [0.7, 1, 0.7] : [0.5, 0.95, 0.5],
                  scale: professorSurge ? [1, 1.15, 1] : [0.94, 1.08, 0.94],
                }
              : { opacity: 0.35, scale: 1 }
          }
          transition={{ duration: BREATH, repeat: profAnimate ? Infinity : 0, ease: "easeInOut" }}
          style={{ transformOrigin: `${prof.x}px ${prof.y}px` }}
        />
        <motion.circle
          cx={prof.x}
          cy={prof.y}
          r={40}
          fill="url(#profGlowInner)"
          animate={profAnimate ? { opacity: [0.35, 0.7, 0.35] } : { opacity: 0.25 }}
          transition={{ duration: BREATH, repeat: profAnimate ? Infinity : 0, ease: "easeInOut" }}
        />

        {profAnimate && (
          <>
            <motion.g
              animate={{ rotate: 360 }}
              transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
              style={{ transformOrigin: `${prof.x}px ${prof.y}px` }}
            >
              <circle
                cx={prof.x}
                cy={prof.y}
                r={44}
                fill="none"
                stroke={profColor}
                strokeOpacity={0.38}
                strokeWidth={0.55}
                strokeDasharray="2 5"
              />
            </motion.g>
            <motion.g
              animate={{ rotate: -360 }}
              transition={{ duration: 85, repeat: Infinity, ease: "linear" }}
              style={{ transformOrigin: `${prof.x}px ${prof.y}px` }}
            >
              <circle
                cx={prof.x}
                cy={prof.y}
                r={52}
                fill="none"
                stroke={profColor}
                strokeOpacity={0.22}
                strokeWidth={0.45}
                strokeDasharray="1 8"
              />
            </motion.g>
          </>
        )}

        <motion.g
          animate={profAnimate ? { scale: [1, 1.06, 1] } : { scale: 1 }}
          transition={{ duration: BREATH, repeat: profAnimate ? Infinity : 0, ease: "easeInOut" }}
          style={{ transformOrigin: `${prof.x}px ${prof.y}px` }}
          onMouseEnter={() => setHovered("professor")}
          onMouseLeave={() => setHovered(null)}
        >
          <circle
            cx={prof.x}
            cy={prof.y}
            r={32}
            fill="url(#profCore)"
            stroke={profColor}
            strokeWidth={1.8}
            filter="url(#softGlow)"
          />
          <text x={prof.x} y={prof.y + 9} textAnchor="middle" fontSize="26" className="fill-sidebar-foreground">
            🧠
          </text>
        </motion.g>

        {positions.map((p, i) => {
          const a = agents[i];
          if (!a) {
            return (
              <g key={`empty-${i}`}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={5}
                  fill="hsl(220 35% 10%)"
                  stroke={BUCKET_META.idle.hex}
                  strokeOpacity={0.35}
                  strokeWidth={0.8}
                />
              </g>
            );
          }
          const meta = BUCKET_META[a.resolved.bucket];
          const dotColor = meta.hex;
          const isAnimated = meta.animate;
          const isHover = hovered === a.id;
          const propDelay = 0.25 + i * 0.28;
          const surging = a.surge;
          return (
            <g
              key={a.id}
              onMouseEnter={() => setHovered(a.id)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: "pointer" }}
            >
              <motion.circle
                cx={p.x}
                cy={p.y}
                r={surging ? 16 : 13}
                fill={dotColor}
                animate={
                  isAnimated || surging
                    ? {
                        opacity: surging ? [0.15, 0.5, 0.15] : [0.06, 0.28, 0.06],
                        scale: surging ? [1, 1.4, 1] : [1, 1.22, 1],
                      }
                    : { opacity: 0.05, scale: 1 }
                }
                transition={{
                  duration: surging ? 1.6 : BREATH,
                  repeat: isAnimated || surging ? Infinity : 0,
                  ease: "easeInOut",
                  delay: propDelay,
                }}
                style={{ transformOrigin: `${p.x}px ${p.y}px`, filter: "blur(3px)" }}
              />
              <motion.g
                animate={isAnimated ? { scale: [1, 1.03, 1] } : { scale: 1 }}
                transition={{ duration: BREATH, repeat: isAnimated ? Infinity : 0, ease: "easeInOut", delay: propDelay }}
                style={{ transformOrigin: `${p.x}px ${p.y}px` }}
              >
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={6}
                  fill="hsl(220 35% 10%)"
                  stroke={dotColor}
                  strokeWidth={isHover || surging ? 1.6 : 1.1}
                  filter="url(#softGlow)"
                />
                <motion.circle
                  cx={p.x}
                  cy={p.y}
                  r={2.6}
                  fill={dotColor}
                  animate={isAnimated ? { opacity: [0.55, 1, 0.55] } : { opacity: 0.4 }}
                  transition={{
                    duration: BREATH,
                    repeat: isAnimated ? Infinity : 0,
                    delay: propDelay,
                    ease: "easeInOut",
                  }}
                />
              </motion.g>
              <text
                x={p.x}
                y={p.y + 16}
                textAnchor="middle"
                fontSize="6.5"
                className="fill-sidebar-foreground/60"
                style={{ letterSpacing: "0.04em" }}
              >
                {a.short}
              </text>
            </g>
          );
        })}
      </svg>

      <AnimatePresence>
        {hovered && (() => {
          if (hovered === "professor") {
            return (
              <TooltipCard
                title="Professor / Runtime"
                subtitle="Coordena o Runtime autônomo do Atende AI."
                stateLabel={professor.stateLabel}
                stateHex={profMeta.hex}
                stateGlow={profMeta.glow}
                lastAt={professor.updatedAt}
              />
            );
          }
          const a = agents.find((x) => x.id === hovered);
          if (!a) return null;
          const meta = BUCKET_META[a.resolved.bucket];
          return (
            <TooltipCard
              title={a.label}
              subtitle={a.resolved.detail ?? "Agente registrado no Runtime."}
              stateLabel={a.resolved.stateLabel}
              stateHex={meta.hex}
              stateGlow={meta.glow}
              lastAt={a.resolved.updatedAt}
            />
          );
        })()}
      </AnimatePresence>
    </div>
  );
}

function TooltipCard({
  title,
  subtitle,
  stateLabel,
  stateHex,
  stateGlow,
  lastAt,
}: {
  title: string;
  subtitle: string;
  stateLabel: string;
  stateHex: string;
  stateGlow: string;
  lastAt?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-0 z-10 rounded-md border border-sidebar-border/70 bg-popover/95 backdrop-blur px-2 py-1.5 shadow-lg text-[9px] leading-tight min-w-[160px] max-w-[240px]"
    >
      <div className="font-semibold text-sidebar-foreground">{title}</div>
      <div className="text-muted-foreground/85 mt-0.5 line-clamp-2">{subtitle}</div>
      <div className="flex items-center gap-1 mt-1">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: stateHex, boxShadow: `0 0 6px ${stateGlow}` }}
        />
        <span className="text-muted-foreground">{stateLabel}</span>
        <span className="text-muted-foreground/60 ml-auto">{formatRelative(lastAt)}</span>
      </div>
    </motion.div>
  );
}

/* Compact/collapsed variant */
export function NeuralIntelligencePulse() {
  useEffect(() => undefined, []);
  return (
    <div className="mx-auto my-2 flex items-center justify-center">
      <motion.div
        animate={{ scale: [1, 1.18, 1], opacity: [0.75, 1, 0.75] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center shadow-[0_0_16px_rgba(56,189,248,0.65)]"
        title="Inteligência Viva"
      >
        <Brain className="h-4 w-4 text-primary" />
      </motion.div>
    </div>
  );
}

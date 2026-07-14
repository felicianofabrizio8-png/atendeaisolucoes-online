// Central de Inteligência AI — Premium neon redesign (UI-only).
// 100% READ-ONLY. Consome EXCLUSIVAMENTE GET /api/runtime/status.
// Nenhuma métrica fictícia. Nenhuma alteração de backend / runtime / dados.

import { motion, AnimatePresence, MotionConfig, useReducedMotion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Brain, Activity, ArrowRight } from "lucide-react";
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
  | "idle"
  | "unavailable";

const BUCKET_META: Record<Bucket, { glow: string; label: string; hex: string; animate: boolean }> = {
  running:       { glow: "rgba(52,211,153,0.85)",  label: "Executando",   hex: "rgb(52,211,153)",  animate: true  },
  queued:        { glow: "rgba(251,191,36,0.85)",  label: "Na fila",      hex: "rgb(251,191,36)",  animate: true  },
  learning:      { glow: "rgba(56,189,248,0.85)",  label: "Aprendendo",   hex: "rgb(56,189,248)",  animate: true  },
  consolidating: { glow: "rgba(167,139,250,0.85)", label: "Consolidando", hex: "rgb(167,139,250)", animate: true  },
  completed:     { glow: "rgba(45,212,191,0.75)",  label: "Concluído",    hex: "rgb(45,212,191)",  animate: false },
  error:         { glow: "rgba(248,113,113,0.9)",  label: "Erro",         hex: "rgb(248,113,113)", animate: true  },
  disabled:      { glow: "rgba(148,163,184,0.5)",  label: "Desativado",   hex: "rgb(148,163,184)", animate: false },
  idle:          { glow: "rgba(148,163,184,0.55)", label: "Ocioso",       hex: "rgb(148,163,184)", animate: false },
  unavailable:   { glow: "rgba(100,116,139,0.4)",  label: "Indisponível", hex: "rgb(100,116,139)", animate: false },
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
    queryKey: ["neural-intelligence-panel", "runtime-status", "v7"],
    enabled,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    staleTime: 8_000,
    retry: false,
    queryFn: fetchRuntimeStatus,
  });
}

/* -------------------- Utils -------------------- */

function iso(ts?: string | null): number | undefined {
  if (!ts) return undefined;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : undefined;
}

function formatRelative(ts: number | undefined) {
  if (!ts) return "—";
  const diff = Math.max(0, Date.now() - ts);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

const COMPLETED_WINDOW_MS = 15 * 60_000;

/* -------------------- Resolução de estado -------------------- */

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

  if (a.state.status === "running" || jobHint?.hasProcessing) {
    return {
      bucket: "running",
      stateLabel: "executando",
      updatedAt: jobHint?.latestTs ?? lastRealFinished ?? lastExec,
    };
  }

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

  if (jobHint?.hasQueued) {
    return { bucket: "queued", stateLabel: "na fila", updatedAt: jobHint.latestTs };
  }

  if (learn && (learn.cycles > 0 || learn.consolidated > 0) && lastLearning && now - lastLearning < 5 * 60_000) {
    if (learn.consolidated > 0 && now - lastLearning < 2 * 60_000) {
      return { bucket: "consolidating", stateLabel: "consolidando", updatedAt: lastLearning };
    }
    return { bucket: "learning", stateLabel: "aprendendo", updatedAt: lastLearning };
  }

  if (realExec?.outcome === "success" && lastRealFinished && now - lastRealFinished < COMPLETED_WINDOW_MS) {
    return { bucket: "completed", stateLabel: "concluído", updatedAt: lastRealFinished };
  }
  if (lastSuccess && now - lastSuccess < COMPLETED_WINDOW_MS) {
    return { bucket: "completed", stateLabel: "concluído", updatedAt: lastSuccess };
  }

  if (a.state.health === "degraded") {
    return { bucket: "consolidating", stateLabel: "degradado", updatedAt: lastExec };
  }
  if (a.state.health === "down") {
    return { bucket: "error", stateLabel: "indisponível", updatedAt: lastExec };
  }

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

/* -------------------- Layout agentes -------------------- */

interface AgentSlot {
  id: string;
  label: string;
  short: string;
}

// Slots fixos ao redor do cérebro. Se um agente não existir no snapshot,
// permanece como "Indisponível" sem inventar métricas.
const AGENT_SLOTS: AgentSlot[] = [
  { id: "business-brain",          label: "Business Brain",         short: "Brain" },
  { id: "business-learning",       label: "Business Learning",      short: "Learning" },
  { id: "scientific-knowledge",    label: "Scientific Knowledge",   short: "Scientific" },
  { id: "executive-intelligence",  label: "Executive Intelligence", short: "Executive" },
  { id: "ai-attendant",            label: "Atendimento IA",         short: "IA Atend." },
  { id: "campaign-intelligence",   label: "Marketing / Campanhas",  short: "Marketing" },
];

interface DisplayAgent {
  id: string;
  label: string;
  short: string;
  resolved: Resolved;
  surge?: boolean;
  metricPrimary: string;
  metricSecondary: string;
  present: boolean;
}

function buildDisplayAgent(
  slot: AgentSlot,
  agent: AgentEntry | undefined,
  learningMap: Map<string, LearningPerAgent>,
  lastRealExecMap: Map<string, LastRealExecution>,
  jobHintMap: Map<string, AgentJobHint>,
  connectedSet: Set<string>,
  learningSummary: RuntimeSnapshot["learning"] | undefined,
  busPublishes: number,
): DisplayAgent {
  if (!agent) {
    return {
      id: slot.id,
      label: slot.label,
      short: slot.short,
      resolved: { bucket: "unavailable", stateLabel: "indisponível" },
      metricPrimary: "—",
      metricSecondary: "sem métrica real",
      present: false,
    };
  }
  const resolved = resolveAgent(agent, learningMap, lastRealExecMap, jobHintMap, connectedSet);
  const learn = learningMap.get(agent.id);
  const jobHint = jobHintMap.get(agent.id);
  const completedCount = jobHint?.lastCompletedTs ? 1 : 0;
  let metricPrimary = "—";
  let metricSecondary = formatRelative(resolved.updatedAt) ?? "—";

  switch (slot.id) {
    case "business-brain": {
      const patterns = busPublishes;
      metricPrimary = `${patterns} publicações`;
      metricSecondary = resolved.updatedAt ? `última ${formatRelative(resolved.updatedAt)}` : "sem execução recente";
      break;
    }
    case "business-learning": {
      const cycles = learn?.cycles ?? learningSummary?.cycles ?? 0;
      const acc = learn?.accepted ?? learningSummary?.hypotheses?.accepted ?? 0;
      const rej = learn?.rejected ?? learningSummary?.hypotheses?.rejected ?? 0;
      const conf = learningSummary?.averageConfidence;
      metricPrimary = `${cycles} ciclos`;
      metricSecondary =
        typeof conf === "number" && conf > 0
          ? `${Math.round(conf * 100)}% conf · ${acc}✓/${rej}✗`
          : `${acc}✓ / ${rej}✗`;
      break;
    }
    case "scientific-knowledge": {
      const cycles = learn?.cycles ?? 0;
      const consolidated = learn?.consolidated ?? 0;
      metricPrimary = `${cycles} hipóteses`;
      metricSecondary = `${consolidated} consolidadas · ${formatRelative(resolved.updatedAt)}`;
      break;
    }
    case "executive-intelligence": {
      metricPrimary = resolved.updatedAt ? formatRelative(resolved.updatedAt) : "sem análise";
      metricSecondary = jobHint ? `${completedCount} concluída` : "aguardando";
      break;
    }
    default: {
      metricPrimary = resolved.updatedAt ? formatRelative(resolved.updatedAt) : "—";
      metricSecondary = agent.enabled ? resolved.stateLabel : "desativado";
    }
  }

  return {
    id: slot.id,
    label: slot.label,
    short: slot.short,
    resolved,
    metricPrimary,
    metricSecondary,
    present: true,
  };
}

/* -------------------- Feed filtragem -------------------- */

const FEED_NOISE = [
  "orphan_legacy",
  "runtime_execution_reconciled",
  "duplicate_prevented",
  "dedup_hit",
  "cancelled",
  "cancel",
];

const AGENT_LABEL_LOOKUP: Record<string, string> = {
  "business-brain": "Business Brain",
  "business-learning": "Business Learning",
  "scientific-knowledge": "Scientific Knowledge",
  "scientific-memory": "Scientific Memory",
  "executive-intelligence": "Executive",
  "executive-knowledge": "Executive Knowledge",
  "executive-narrative": "Executive Narrative",
  "professor": "Professor",
  "sales-intelligence": "Sales",
  "coach": "Coach",
  "follow-up": "Follow-up",
  "system-health": "System Health",
};

function friendlyFeedMessage(j: RecentJob): string {
  const label = AGENT_LABEL_LOOKUP[j.agentId] ?? j.agentId;
  if (j.status === "completed") {
    if (j.agentId === "business-brain") return `${label} concluiu análise.`;
    if (j.agentId === "business-learning") return `${label} consolidou novo ciclo.`;
    if (j.agentId === "scientific-knowledge") return `${label} atualizou hipótese.`;
    if (j.agentId === "executive-intelligence") return `${label} finalizou análise.`;
    return `${label} concluiu tarefa.`;
  }
  if (j.status === "failed" || j.status === "dead_letter" || j.status === "timeout") {
    return `${label} falhou.`;
  }
  if (j.status === "processing") return `${label} em execução.`;
  if (j.status === "queued" || j.status === "scheduled") return `${label} na fila.`;
  return `${label}: ${j.status}`;
}

/* -------------------- Componente principal -------------------- */

export function NeuralIntelligencePanel() {
  const { user } = useAuth();
  const reducedMotion = useReducedMotion();
  const { data: snap, isLoading, isError } = useRuntimeStatus(!!user);

  const learningMap = useMemo(() => {
    const m = new Map<string, LearningPerAgent>();
    const raw = snap?.learning?.perAgent;
    if (!raw) return m;
    if (Array.isArray(raw)) {
      for (const p of raw as Array<LearningPerAgent & { agentId?: string }>) {
        if (p && typeof p === "object" && typeof p.agentId === "string") m.set(p.agentId, p);
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

  const busPublishes = snap?.knowledgeBus?.health?.publishCount ?? 0;

  const agents = useMemo<DisplayAgent[]>(() => {
    if (!snap) {
      return AGENT_SLOTS.map((s) => ({
        id: s.id,
        label: s.label,
        short: s.short,
        resolved: { bucket: "idle" as Bucket, stateLabel: "conectando" },
        metricPrimary: "—",
        metricSecondary: "aguardando runtime",
        present: false,
      }));
    }
    const rawAgents = snap.agents;
    const list: AgentEntry[] = Array.isArray(rawAgents)
      ? rawAgents
      : rawAgents && typeof rawAgents === "object"
      ? (Object.values(rawAgents as Record<string, AgentEntry>) ?? [])
      : [];
    const byId = new Map(list.filter((a): a is AgentEntry => !!a && typeof a?.id === "string").map((a) => [a.id, a]));
    return AGENT_SLOTS.map((slot) =>
      buildDisplayAgent(
        slot,
        byId.get(slot.id),
        learningMap,
        lastRealExecMap,
        jobHintMap,
        connectedSet,
        snap.learning,
        busPublishes,
      ),
    );
  }, [snap, learningMap, lastRealExecMap, jobHintMap, connectedSet, busPublishes]);

  // Detecta surge (nova atividade) por agente.
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
    !!user && !isError && !!snap?.status?.online && !snap?.autonomy?.tenantEnabled?.killSwitch;

  // Feed: até 3 eventos reais, filtrando ruído.
  const feed = useMemo(() => {
    const raw = snap?.recentJobs;
    const jobs: RecentJob[] = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object"
      ? (Object.values(raw as Record<string, RecentJob>) ?? [])
      : [];
    return jobs
      .filter((j): j is RecentJob => !!j && typeof j === "object" && typeof j.agentId === "string")
      .filter((j) => {
        const noise = FEED_NOISE.some((n) => j.agentId.includes(n) || (j.lastError ?? "").toLowerCase().includes(n) || j.status.toLowerCase().includes(n));
        return !noise;
      })
      .map((j) => {
        const ts = iso(j.finishedAt) ?? iso(j.startedAt) ?? iso(j.createdAt) ?? 0;
        const ok = j.status === "completed" || j.status === "processing";
        return { ts, ok, msg: friendlyFeedMessage(j) };
      })
      .filter((e) => e.ts > 0)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 3);
  }, [snap]);

  const anyActive =
    professor.bucket === "running" ||
    agents.some((a) => a.resolved.bucket === "running" || a.resolved.bucket === "queued" || a.resolved.bucket === "learning" || a.resolved.bucket === "consolidating");

  const statusLabel = !user
    ? "Aguardando sessão"
    : isLoading && !snap
    ? "Conectando"
    : isError
    ? "Runtime indisponível"
    : snap?.autonomy?.tenantEnabled?.killSwitch
    ? "Kill switch"
    : networkOnline
    ? "Online"
    : "Offline";

  return (
    <MotionConfig reducedMotion="user">
      <div
        role="region"
        aria-label="Central de Inteligência AI"
        className="mx-2 my-2 rounded-2xl border border-cyan-400/20 bg-[radial-gradient(ellipse_at_top,_hsl(220_60%_12%)_0%,_hsl(224_50%_6%)_65%,_hsl(230_60%_4%)_100%)] p-3 overflow-hidden relative shadow-[0_0_24px_rgba(56,189,248,0.08),inset_0_1px_0_rgba(148,163,184,0.06)]"
      >
        {/* grid neon de fundo */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(125,211,252,0.7) 1px, transparent 1px), linear-gradient(90deg, rgba(125,211,252,0.7) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        />
        {!reducedMotion && networkOnline && <BackgroundParticles />}

        {/* Header */}
        <div className="relative flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold tracking-[0.08em] text-cyan-100 leading-tight">
              Central de Inteligência AI
            </div>
            <div className="text-[9px] text-cyan-200/60 mt-0.5 leading-tight truncate">
              Seu sistema está aprendendo 24/7
            </div>
          </div>
          <LiveBadge online={networkOnline} label={statusLabel} />
        </div>

        <NeuralGraph
          professor={professor}
          agents={agentsWithSurge}
          professorSurge={surge.professor}
          snap={snap ?? null}
        />

        {/* Atividades em tempo real */}
        <div className="relative mt-2">
          <div className="flex items-center justify-between mb-1 px-0.5">
            <div className="flex items-center gap-1 text-[8.5px] uppercase tracking-[0.16em] text-cyan-200/70">
              <Activity className="h-2.5 w-2.5" />
              Atividades em tempo real
            </div>
            <Link
              to="/runtime/observability"
              className="text-[8.5px] text-cyan-300/80 hover:text-cyan-200 inline-flex items-center gap-0.5"
            >
              Ver todos
              <ArrowRight className="h-2.5 w-2.5" />
            </Link>
          </div>
          <div className="rounded-lg border border-cyan-400/15 bg-black/40 backdrop-blur-sm px-2 py-1.5 min-h-[68px]">
            {feed.length === 0 ? (
              <div className="text-[9px] text-cyan-100/40 italic py-1.5">
                Sistema em espera · nenhuma atividade recente
              </div>
            ) : (
              <ul className="space-y-1" aria-live="polite">
                <AnimatePresence initial={false}>
                  {feed.map((e, i) => (
                    <motion.li
                      key={`${e.msg}-${e.ts}`}
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ delay: i * 0.05, duration: 0.3 }}
                      className="flex items-center gap-1.5 text-[9.5px] leading-tight"
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full shrink-0",
                          e.ok
                            ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]"
                            : "bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.9)]",
                        )}
                        aria-hidden
                      />
                      <span className="text-cyan-50/90 truncate flex-1">{e.msg}</span>
                      <span className="text-cyan-200/50 text-[8.5px] shrink-0">
                        {formatRelative(e.ts)}
                      </span>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </div>
        </div>

        {/* Status inferior */}
        <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-cyan-400/15 bg-black/30 px-2 py-1.5">
          <motion.span
            className={cn(
              "h-1.5 w-1.5 rounded-full shrink-0",
              anyActive
                ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]"
                : "bg-slate-500",
            )}
            animate={anyActive ? { opacity: [0.55, 1, 0.55] } : { opacity: 0.6 }}
            transition={{ duration: 1.6, repeat: anyActive ? Infinity : 0 }}
            aria-hidden
          />
          <span className="text-[9.5px] text-cyan-50/90 font-medium">
            {anyActive ? "Processando agora" : "Sistema em espera"}
          </span>
          {snap?.status?.lastHeartbeat?.ts && (
            <span className="ml-auto text-[8.5px] text-cyan-200/50">
              {formatRelative(iso(snap.status.lastHeartbeat.ts))}
            </span>
          )}
        </div>
      </div>
    </MotionConfig>
  );
}

/* -------------------- Live badge -------------------- */

function LiveBadge({ online, label }: { online: boolean; label: string }) {
  return (
    <div
      className={cn(
        "shrink-0 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[8.5px] font-bold tracking-[0.1em]",
        online
          ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
          : "border-amber-400/40 bg-amber-400/10 text-amber-300",
      )}
      title={label}
    >
      <motion.span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          online
            ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]"
            : "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.9)]",
        )}
        animate={online ? { opacity: [0.55, 1, 0.55] } : { opacity: 0.6 }}
        transition={{ duration: 1.6, repeat: online ? Infinity : 0 }}
      />
      {online ? "AO VIVO" : label.toUpperCase()}
    </div>
  );
}

/* -------------------- Background particles -------------------- */

function BackgroundParticles() {
  const parts = useMemo(
    () =>
      Array.from({ length: 8 }, (_, i) => ({
        left: (i * 41 + 13) % 100,
        top: (i * 59 + 9) % 100,
        dur: 16 + (i % 4) * 3,
        delay: i * 0.8,
      })),
    [],
  );
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {parts.map((p, i) => (
        <motion.span
          key={i}
          className="absolute h-[2px] w-[2px] rounded-full bg-cyan-300/40"
          style={{ left: `${p.left}%`, top: `${p.top}%` }}
          animate={{ y: [-6, 6, -6], opacity: [0.1, 0.5, 0.1] }}
          transition={{ duration: p.dur, delay: p.delay, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

/* -------------------- Neural graph -------------------- */

const BREATH = 3.8;

function NeuralGraph({
  professor,
  agents,
  professorSurge,
  snap,
}: {
  professor: Resolved;
  agents: DisplayAgent[];
  professorSurge?: boolean;
  snap: RuntimeSnapshot | null;
}) {
  const W = 260;
  const H = 236;
  const prof = { x: W / 2, y: H / 2 };
  const [hovered, setHovered] = useState<string | null>(null);

  // 6 nós distribuídos em anel — visual referência: círculos grandes ao redor.
  const positions = useMemo(() => {
    const R = 92;
    return AGENT_SLOTS.map((_, i) => {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / AGENT_SLOTS.length;
      return { x: prof.x + Math.cos(angle) * R, y: prof.y + Math.sin(angle) * R };
    });
  }, [prof.x, prof.y]);

  const profMeta = BUCKET_META[professor.bucket];
  const profColor = profMeta.hex;
  const profAnimate = profMeta.animate;

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Rede neural viva dos agentes de inteligência"
      >
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
            <stop offset="0%" stopColor="hsl(220 55% 14%)" stopOpacity="1" />
            <stop offset="100%" stopColor="hsl(224 60% 6%)" stopOpacity="1" />
          </radialGradient>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgba(125,211,252,0.05)" />
            <stop offset="50%" stopColor="rgba(125,211,252,0.28)" />
            <stop offset="100%" stopColor="rgba(125,211,252,0.05)" />
          </linearGradient>
          <linearGradient id="lineGradActive" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgba(56,189,248,0.15)" />
            <stop offset="50%" stopColor="rgba(56,189,248,0.85)" />
            <stop offset="100%" stopColor="rgba(56,189,248,0.15)" />
          </linearGradient>
          <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Anel orbital decorativo */}
        <circle
          cx={prof.x}
          cy={prof.y}
          r={92}
          fill="none"
          stroke="rgba(125,211,252,0.08)"
          strokeWidth={0.5}
          strokeDasharray="1 4"
        />

        {/* Conexões */}
        {positions.map((p, i) => {
          const a = agents[i];
          const meta = a ? BUCKET_META[a.resolved.bucket] : null;
          const isAnimated = !!meta?.animate && !!a?.present;
          const particleColor = meta?.hex ?? "rgb(125,211,252)";
          const propDelay = 0.2 + i * 0.24;
          const surging = a?.surge;
          return (
            <g key={`line-${i}`}>
              <line
                x1={prof.x}
                y1={prof.y}
                x2={p.x}
                y2={p.y}
                stroke={isAnimated ? "url(#lineGradActive)" : "url(#lineGrad)"}
                strokeWidth={surging ? 1.4 : isAnimated ? 0.95 : 0.55}
              />
              {(isAnimated || surging) && (
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
              )}
            </g>
          );
        })}

        {/* Cérebro central: glow + core */}
        <motion.circle
          cx={prof.x}
          cy={prof.y}
          r={54}
          fill="url(#profGlowOuter)"
          animate={
            profAnimate
              ? {
                  opacity: professorSurge ? [0.7, 1, 0.7] : [0.5, 0.95, 0.5],
                  scale: professorSurge ? [1, 1.12, 1] : [0.95, 1.08, 0.95],
                }
              : { opacity: 0.35, scale: 1 }
          }
          transition={{ duration: BREATH, repeat: profAnimate ? Infinity : 0, ease: "easeInOut" }}
          style={{ transformOrigin: `${prof.x}px ${prof.y}px` }}
        />
        <motion.circle
          cx={prof.x}
          cy={prof.y}
          r={36}
          fill="url(#profGlowInner)"
          animate={profAnimate ? { opacity: [0.35, 0.7, 0.35] } : { opacity: 0.25 }}
          transition={{ duration: BREATH, repeat: profAnimate ? Infinity : 0, ease: "easeInOut" }}
        />

        <motion.g
          animate={profAnimate ? { scale: [1, 1.06, 1] } : { scale: 1 }}
          transition={{ duration: BREATH, repeat: profAnimate ? Infinity : 0, ease: "easeInOut" }}
          style={{ transformOrigin: `${prof.x}px ${prof.y}px`, cursor: "pointer" }}
          onMouseEnter={() => setHovered("professor")}
          onMouseLeave={() => setHovered(null)}
        >
          <circle
            cx={prof.x}
            cy={prof.y}
            r={28}
            fill="url(#profCore)"
            stroke={profColor}
            strokeWidth={1.6}
            filter="url(#softGlow)"
          />
          <text x={prof.x} y={prof.y + 8} textAnchor="middle" fontSize="22">
            🧠
          </text>
        </motion.g>

        {/* Nós dos agentes */}
        {positions.map((p, i) => {
          const a = agents[i];
          if (!a) return null;
          const meta = BUCKET_META[a.resolved.bucket];
          const dotColor = meta.hex;
          const isAnimated = meta.animate && a.present;
          const isHover = hovered === a.id;
          const propDelay = 0.2 + i * 0.24;
          const surging = a.surge;
          const opacity = a.present ? 1 : 0.55;
          return (
            <g
              key={a.id}
              onMouseEnter={() => setHovered(a.id)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: "pointer", opacity }}
            >
              <motion.circle
                cx={p.x}
                cy={p.y}
                r={surging ? 18 : 15}
                fill={dotColor}
                animate={
                  isAnimated || surging
                    ? {
                        opacity: surging ? [0.15, 0.5, 0.15] : [0.08, 0.3, 0.08],
                        scale: surging ? [1, 1.35, 1] : [1, 1.2, 1],
                      }
                    : { opacity: 0.06, scale: 1 }
                }
                transition={{
                  duration: surging ? 1.6 : BREATH,
                  repeat: isAnimated || surging ? Infinity : 0,
                  ease: "easeInOut",
                  delay: propDelay,
                }}
                style={{ transformOrigin: `${p.x}px ${p.y}px`, filter: "blur(3px)" }}
              />
              <circle
                cx={p.x}
                cy={p.y}
                r={9}
                fill="hsl(224 55% 8%)"
                stroke={dotColor}
                strokeWidth={isHover || surging ? 1.8 : 1.2}
                filter="url(#softGlow)"
              />
              <motion.circle
                cx={p.x}
                cy={p.y}
                r={3.2}
                fill={dotColor}
                animate={isAnimated ? { opacity: [0.55, 1, 0.55] } : { opacity: a.present ? 0.5 : 0.3 }}
                transition={{
                  duration: BREATH,
                  repeat: isAnimated ? Infinity : 0,
                  delay: propDelay,
                  ease: "easeInOut",
                }}
              />
              <text
                x={p.x}
                y={p.y + 20}
                textAnchor="middle"
                fontSize="6.8"
                className="fill-cyan-100/75"
                style={{ letterSpacing: "0.04em", fontWeight: 500 }}
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
            const worker = snap?.worker ?? snap?.workers?.[0] ?? null;
            const bus = snap?.knowledgeBus?.health?.level ?? "—";
            const sched = snap?.scheduler;
            const learn = snap?.learning;
            const lines = [
              `Runtime ${snap?.status?.online ? "online" : "offline"}`,
              `Worker ${worker?.health?.state ?? "—"}`,
              `Scheduler ${sched ? `${sched.enabled ?? 0}/${sched.registered ?? 0}` : "—"}`,
              `Knowledge Bus ${bus}`,
              `Learning ${learn?.cycles ?? 0} ciclos`,
            ];
            return (
              <TooltipCard
                title="Runtime Core"
                subtitle="Professor · coordena todo o sistema"
                stateLabel={professor.stateLabel}
                stateHex={profMeta.hex}
                stateGlow={profMeta.glow}
                lastAt={professor.updatedAt}
                lines={lines}
              />
            );
          }
          const a = agents.find((x) => x.id === hovered);
          if (!a) return null;
          const meta = BUCKET_META[a.resolved.bucket];
          return (
            <TooltipCard
              title={a.label}
              subtitle={a.present ? (a.resolved.detail ?? "Agente registrado no Runtime.") : "Nenhum dado real disponível ainda."}
              stateLabel={a.resolved.stateLabel}
              stateHex={meta.hex}
              stateGlow={meta.glow}
              lastAt={a.resolved.updatedAt}
              lines={[a.metricPrimary, a.metricSecondary]}
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
  lines,
}: {
  title: string;
  subtitle: string;
  stateLabel: string;
  stateHex: string;
  stateGlow: string;
  lastAt?: number;
  lines?: string[];
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-0 z-10 rounded-lg border border-cyan-400/30 bg-[hsl(224_55%_6%/0.96)] backdrop-blur px-2.5 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.5),0_0_16px_rgba(56,189,248,0.15)] text-[9.5px] leading-tight min-w-[180px] max-w-[240px]"
    >
      <div className="font-semibold text-cyan-50">{title}</div>
      <div className="text-cyan-200/70 mt-0.5 line-clamp-2">{subtitle}</div>
      <div className="flex items-center gap-1 mt-1.5">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: stateHex, boxShadow: `0 0 6px ${stateGlow}` }}
          aria-hidden
        />
        <span className="text-cyan-100/85">{stateLabel}</span>
        <span className="text-cyan-200/50 ml-auto">{formatRelative(lastAt)}</span>
      </div>
      {lines && lines.length > 0 && (
        <div className="mt-1.5 pt-1.5 border-t border-cyan-400/10 space-y-0.5">
          {lines.map((l, i) => (
            <div key={i} className="text-cyan-100/80 text-[9px] truncate">
              {l}
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

/* Compact/collapsed variant — mostra apenas o cérebro pulsante. */
export function NeuralIntelligencePulse() {
  return (
    <div className="mx-auto my-2 flex items-center justify-center" title="Central de Inteligência AI">
      <motion.div
        animate={{ scale: [1, 1.18, 1], opacity: [0.75, 1, 0.75] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        className="h-8 w-8 rounded-full bg-cyan-400/15 flex items-center justify-center shadow-[0_0_16px_rgba(56,189,248,0.65)]"
        aria-label="Central de Inteligência AI"
      >
        <Brain className="h-4 w-4 text-cyan-300" />
      </motion.div>
    </div>
  );
}

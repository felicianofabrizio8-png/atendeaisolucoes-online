// Central de Inteligência AI — Premium neon redesign (UI-only).
// 100% READ-ONLY. Consome EXCLUSIVAMENTE GET /api/runtime/status.
// Nenhuma métrica fictícia. Nenhuma alteração de backend / runtime / dados.

import { motion, AnimatePresence, MotionConfig, useReducedMotion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  Activity,
  ArrowRight,
  Cpu,
  GraduationCap,
  FlaskConical,
  Crown,
  MessageCircle,
  Megaphone,
  type LucideIcon,
} from "lucide-react";
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
  busEnvelopes: number,
): DisplayAgent {
  if (!agent) {
    return {
      id: slot.id,
      label: slot.label,
      short: slot.short,
      resolved: { bucket: "unavailable", stateLabel: "indisponível" },
      metricPrimary: "sem dados",
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
      const envelopes = busEnvelopes;
      const primaryCount = cycles > 0 ? cycles : envelopes;
      metricPrimary = cycles > 0 ? `${cycles} hipóteses` : envelopes > 0 ? `${envelopes} envelopes` : "sem dados";
      metricSecondary =
        primaryCount > 0
          ? `${consolidated} consolidadas · ${formatRelative(resolved.updatedAt)}`
          : "aguardando publicação";
      break;
    }
    case "executive-intelligence": {
      metricPrimary = resolved.updatedAt ? formatRelative(resolved.updatedAt) : "sem análise";
      metricSecondary = jobHint ? `${completedCount} concluída` : "aguardando";
      break;
    }
    default: {
      metricPrimary = resolved.updatedAt ? formatRelative(resolved.updatedAt) : "aguardando";
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

  const busPublishes =
    (snap?.knowledgeBus?.health?.publishCount ?? 0) ||
    (snap?.knowledgeBus?.cache?.totalEnvelopes ?? 0);
  const busEnvelopes = snap?.knowledgeBus?.cache?.totalEnvelopes ?? 0;

  const agents = useMemo<DisplayAgent[]>(() => {
    if (!snap) {
      return AGENT_SLOTS.map((s) => ({
        id: s.id,
        label: s.label,
        short: s.short,
        resolved: { bucket: "idle" as Bucket, stateLabel: "conectando" },
        metricPrimary: "conectando",
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
        busEnvelopes,
      ),
    );
  }, [snap, learningMap, lastRealExecMap, jobHintMap, connectedSet, busPublishes, busEnvelopes]);

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
        className="relative mx-1.5 my-2 overflow-hidden rounded-2xl border border-cyan-400/25 bg-[radial-gradient(ellipse_at_top,_hsl(224_70%_14%)_0%,_hsl(226_65%_7%)_60%,_hsl(230_75%_4%)_100%)] p-2.5 shadow-[0_0_28px_rgba(56,189,248,0.10),inset_0_1px_0_rgba(148,163,184,0.06)]"
      >
        {/* Neural background layers */}
        <NeuralBackdrop reducedMotion={!!reducedMotion} active={networkOnline} />

        {/* Header */}
        <div className="relative flex items-center justify-between gap-2 mb-2 pb-2 border-b border-cyan-400/10">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold tracking-[0.08em] text-cyan-50 leading-tight">
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
          reducedMotion={!!reducedMotion}
        />

        {/* Processando agora */}
        <div className="relative mt-2 flex items-center gap-1.5 rounded-lg border border-cyan-400/20 bg-black/40 px-2 py-1.5 backdrop-blur-sm">
          <motion.span
            className={cn(
              "h-1.5 w-1.5 rounded-full shrink-0",
              anyActive
                ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.95)]"
                : "bg-slate-500",
            )}
            animate={anyActive ? { opacity: [0.55, 1, 0.55] } : { opacity: 0.6 }}
            transition={{ duration: 1.6, repeat: anyActive ? Infinity : 0 }}
            aria-hidden
          />
          <span className="text-[9.5px] text-cyan-50/95 font-medium">
            {anyActive ? "Processando agora" : "Sistema em espera"}
          </span>
          {snap?.status?.lastHeartbeat?.ts && (
            <span className="ml-auto text-[8.5px] text-cyan-200/50">
              {formatRelative(iso(snap.status.lastHeartbeat.ts))}
            </span>
          )}
        </div>

        {/* Terminal futurista */}
        <div className="relative mt-2">
          <div className="flex items-center justify-between mb-1 px-0.5">
            <div className="flex items-center gap-1 text-[8.5px] uppercase tracking-[0.18em] text-cyan-200/75 font-mono">
              <Activity className="h-2.5 w-2.5" />
              runtime.log
            </div>
            <Link
              to="/runtime/observability"
              className="text-[8.5px] text-cyan-300/80 hover:text-cyan-200 inline-flex items-center gap-0.5 font-mono"
            >
              ver todos
              <ArrowRight className="h-2.5 w-2.5" />
            </Link>
          </div>
          <div
            className="relative overflow-hidden rounded-lg border border-cyan-400/30 bg-[linear-gradient(180deg,rgba(2,6,23,0.92),rgba(2,6,23,0.85))] backdrop-blur-sm px-2 py-1.5 min-h-[68px] shadow-[inset_0_0_20px_rgba(56,189,248,0.08),0_0_14px_rgba(56,189,248,0.10)]"
          >
            {/* scanlines */}
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.08]"
              style={{
                backgroundImage: "repeating-linear-gradient(0deg, transparent 0 2px, rgba(125,211,252,0.6) 2px 3px)",
              }}
              aria-hidden
            />
            {/* topbar mini */}
            <div className="pointer-events-none absolute top-1 right-1.5 flex items-center gap-1 opacity-70" aria-hidden>
              <span className="h-1 w-1 rounded-full bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.9)]" />
              <span className="h-1 w-1 rounded-full bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.9)]" />
              <span className="h-1 w-1 rounded-full bg-rose-400 shadow-[0_0_4px_rgba(248,113,113,0.9)]" />
            </div>
            {feed.length === 0 ? (
              <div className="relative font-mono text-[9px] text-cyan-100/50 py-1.5">
                <span className="text-emerald-300/80">$</span>{" "}
                <span>runtime --status</span>
                <div className="text-cyan-100/40 italic mt-0.5">// sistema em espera · nenhuma atividade recente</div>
              </div>
            ) : (
              <ul className="relative space-y-0.5 font-mono" aria-live="polite">
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
                      <span className="text-emerald-300/90 shrink-0">›</span>
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full shrink-0",
                          e.ok
                            ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]"
                            : "bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.9)]",
                        )}
                        aria-hidden
                      />
                      <span className="text-cyan-50/95 truncate flex-1">{e.msg}</span>
                      <span className="text-cyan-200/60 text-[8.5px] shrink-0">{formatRelative(e.ts)}</span>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </div>
        </div>
      </div>
    </MotionConfig>
  );
}

/* -------------------- Live badge -------------------- */

function LiveBadge({ online, label }: { online: boolean; label: string }) {
  return (
    <motion.div
      className={cn(
        "relative shrink-0 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[8.5px] font-bold tracking-[0.12em] backdrop-blur-sm",
        online
          ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-200"
          : "border-amber-400/40 bg-amber-400/10 text-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.2)]",
      )}
      title={label}
      animate={online ? { boxShadow: [
        "0 0 10px rgba(52,211,153,0.35), inset 0 0 8px rgba(52,211,153,0.2)",
        "0 0 18px rgba(52,211,153,0.65), inset 0 0 10px rgba(52,211,153,0.35)",
        "0 0 10px rgba(52,211,153,0.35), inset 0 0 8px rgba(52,211,153,0.2)",
      ] } : undefined}
      transition={online ? { duration: 2.4, repeat: Infinity, ease: "easeInOut" } : undefined}
    >
      <motion.span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          online
            ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.95)]"
            : "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.9)]",
        )}
        animate={online ? { opacity: [0.55, 1, 0.55], scale: [1, 1.15, 1] } : { opacity: 0.6 }}
        transition={{ duration: 1.6, repeat: online ? Infinity : 0 }}
      />
      {online ? "AO VIVO" : label.toUpperCase()}
    </motion.div>
  );
}

/* -------------------- Neural backdrop -------------------- */

function NeuralBackdrop({ reducedMotion, active }: { reducedMotion: boolean; active: boolean }) {
  const parts = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => ({
        left: (i * 41 + 13) % 100,
        top: (i * 59 + 9) % 100,
        dur: 10 + (i % 6) * 2.5,
        delay: i * 0.4,
        size: 1 + (i % 3) * 0.6,
      })),
    [],
  );
  const fibers = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => {
        const a1 = (i * 47) % 360;
        const a2 = (a1 + 120 + (i % 5) * 20) % 360;
        const r1 = 12 + (i % 4) * 8;
        const r2 = 30 + (i % 5) * 6;
        const rad = (deg: number, r: number) => ({
          x: 50 + Math.cos((deg * Math.PI) / 180) * r,
          y: 50 + Math.sin((deg * Math.PI) / 180) * r,
        });
        const p1 = rad(a1, r1);
        const p2 = rad(a2, r2);
        const cx = (p1.x + p2.x) / 2 + Math.sin(i) * 6;
        const cy = (p1.y + p2.y) / 2 + Math.cos(i) * 6;
        return { d: `M${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}`, dur: 8 + (i % 4) * 3, delay: i * 0.3 };
      }),
    [],
  );
  return (
    <>
      {/* Aurora glows */}
      <div
        className="pointer-events-none absolute -top-20 -left-16 h-52 w-52 rounded-full opacity-50 blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(56,189,248,0.55), transparent 70%)" }}
      />
      <div
        className="pointer-events-none absolute -bottom-20 -right-14 h-56 w-56 rounded-full opacity-45 blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(168,85,247,0.55), transparent 70%)" }}
      />
      <div
        className="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 h-40 w-40 rounded-full opacity-30 blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(45,212,191,0.45), transparent 70%)" }}
      />
      {/* Neon grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(125,211,252,0.7) 1px, transparent 1px), linear-gradient(90deg, rgba(125,211,252,0.7) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
          maskImage: "radial-gradient(circle at 50% 50%, black 40%, transparent 85%)",
          WebkitMaskImage: "radial-gradient(circle at 50% 50%, black 40%, transparent 85%)",
        }}
      />
      {/* Diagonal light beams */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.10] mix-blend-screen"
        style={{
          background:
            "repeating-linear-gradient(115deg, transparent 0 22px, rgba(125,211,252,0.35) 22px 23px, transparent 23px 46px)",
          maskImage: "radial-gradient(ellipse at 50% 50%, black 30%, transparent 80%)",
          WebkitMaskImage: "radial-gradient(ellipse at 50% 50%, black 30%, transparent 80%)",
        }}
      />
      {/* Neural fibers */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <defs>
          <linearGradient id="fiberGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(56,189,248,0.55)" />
            <stop offset="50%" stopColor="rgba(168,85,247,0.45)" />
            <stop offset="100%" stopColor="rgba(45,212,191,0.5)" />
          </linearGradient>
          <filter id="fiberBlur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="0.35" />
          </filter>
        </defs>
        {fibers.map((f, i) => (
          <motion.path
            key={i}
            d={f.d}
            fill="none"
            stroke="url(#fiberGrad)"
            strokeWidth={0.18}
            strokeLinecap="round"
            filter="url(#fiberBlur)"
            initial={{ opacity: 0.08, pathLength: 0.4 }}
            animate={
              !reducedMotion && active
                ? { opacity: [0.05, 0.28, 0.05], pathLength: [0.35, 1, 0.35] }
                : { opacity: 0.12 }
            }
            transition={{ duration: f.dur, delay: f.delay, repeat: Infinity, ease: "easeInOut" }}
          />
        ))}
      </svg>
      {/* Particles */}
      {!reducedMotion && active && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {parts.map((p, i) => (
            <motion.span
              key={i}
              className="absolute rounded-full bg-cyan-300/60"
              style={{
                left: `${p.left}%`,
                top: `${p.top}%`,
                width: `${p.size}px`,
                height: `${p.size}px`,
                boxShadow: "0 0 6px rgba(125,211,252,0.85)",
              }}
              animate={{ y: [-10, 10, -10], opacity: [0.1, 0.75, 0.1] }}
              transition={{ duration: p.dur, delay: p.delay, repeat: Infinity, ease: "easeInOut" }}
            />
          ))}
        </div>
      )}
    </>
  );
}

/* -------------------- Slot styles (per-agent color/icon/angle) -------------------- */

interface SlotStyle {
  angle: number; // 0 = right, 90 = bottom, 180 = left, 270 = top (SVG y-down)
  color: string;
  glow: string;
  icon: LucideIcon;
}

const SLOT_STYLE: Record<string, SlotStyle> = {
  "business-brain":         { angle: 225, color: "#22d3ee", glow: "rgba(34,211,238,0.60)",  icon: Cpu },
  "business-learning":      { angle: 315, color: "#34d399", glow: "rgba(52,211,153,0.60)",  icon: GraduationCap },
  "scientific-knowledge":   { angle: 180, color: "#f59e0b", glow: "rgba(245,158,11,0.60)",  icon: FlaskConical },
  "campaign-intelligence":  { angle: 0,   color: "#ec4899", glow: "rgba(236,72,153,0.60)",  icon: Megaphone },
  "ai-attendant":           { angle: 135, color: "#60a5fa", glow: "rgba(96,165,250,0.60)",  icon: MessageCircle },
  "executive-intelligence": { angle: 45,  color: "#2dd4bf", glow: "rgba(45,212,191,0.60)",  icon: Crown },
};

const PROFESSOR_COLOR = "#a855f7";
const PROFESSOR_GLOW = "rgba(168,85,247,0.65)";
const ORBIT_PCT = 40; // % of container radius

function polar(angleDeg: number, r: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: 50 + Math.cos(a) * r, y: 50 + Math.sin(a) * r };
}

/* -------------------- Neural graph (large radial) -------------------- */

const BREATH = 3.8;

function NeuralGraph({
  professor,
  agents,
  professorSurge,
  snap,
  reducedMotion,
}: {
  professor: Resolved;
  agents: DisplayAgent[];
  professorSurge?: boolean;
  snap: RuntimeSnapshot | null;
  reducedMotion: boolean;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  const profMeta = BUCKET_META[professor.bucket];
  const profStateHex = profMeta.hex;
  const profActive = profMeta.animate && !reducedMotion;

  return (
    <div className="relative w-full aspect-square mx-auto max-w-[100%] my-0.5">
      {/* Sutil vinheta radial para dar profundidade à rede */}
      <div
        className="pointer-events-none absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, rgba(56,189,248,0.08) 0%, rgba(168,85,247,0.06) 45%, transparent 75%)",
        }}
        aria-hidden
      />
      {/* SVG layer: background rings, connections, particles, professor halo */}
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label="Rede neural viva dos agentes de inteligência"
      >
        <defs>
          <radialGradient id="profGlowOuter" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={PROFESSOR_COLOR} stopOpacity="0.55" />
            <stop offset="55%" stopColor={PROFESSOR_COLOR} stopOpacity="0.12" />
            <stop offset="100%" stopColor={PROFESSOR_COLOR} stopOpacity="0" />
          </radialGradient>
          <radialGradient id="profGlowInner" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={PROFESSOR_COLOR} stopOpacity="0.85" />
            <stop offset="100%" stopColor={PROFESSOR_COLOR} stopOpacity="0" />
          </radialGradient>
          <filter id="softGlow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="1.4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="strongGlow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="2.4" result="b1" />
            <feMerge>
              <feMergeNode in="b1" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {Object.entries(SLOT_STYLE).map(([id, s]) => (
            <linearGradient key={id} id={`line-${id}`} x1="50%" y1="50%" x2={`${polar(s.angle, ORBIT_PCT).x}%`} y2={`${polar(s.angle, ORBIT_PCT).y}%`} gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor={PROFESSOR_COLOR} stopOpacity="0.9" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0.9" />
            </linearGradient>
          ))}
        </defs>

        {/* orbital rings */}
        <circle cx={50} cy={50} r={ORBIT_PCT} fill="none" stroke="rgba(125,211,252,0.14)" strokeWidth={0.2} strokeDasharray="0.6 1.2" />
        <circle cx={50} cy={50} r={ORBIT_PCT - 8} fill="none" stroke="rgba(168,85,247,0.10)" strokeWidth={0.2} strokeDasharray="0.4 1.6" />

        {/* Connections */}
        {agents.map((a) => {
          const s = SLOT_STYLE[a.id];
          if (!s) return null;
          const p = polar(s.angle, ORBIT_PCT);
          const meta = BUCKET_META[a.resolved.bucket];
          const isAnimated = !!meta.animate && a.present && !reducedMotion;
          const surging = a.surge && !reducedMotion;
          return (
            <g key={`line-${a.id}`}>
              <line
                x1={50}
                y1={50}
                x2={p.x}
                y2={p.y}
                stroke={`url(#line-${a.id})`}
                strokeWidth={surging ? 1.35 : isAnimated ? 1.05 : 0.75}
                opacity={a.present ? 0.9 : 0.35}
                filter="url(#softGlow)"
              />
              {(isAnimated || surging) && (
                <motion.circle
                  r={surging ? 0.9 : 0.7}
                  fill={s.color}
                  filter="url(#softGlow)"
                  initial={{ cx: 50, cy: 50, opacity: 0 }}
                  animate={{ cx: [50, p.x], cy: [50, p.y], opacity: [0, 1, 0] }}
                  transition={{
                    duration: surging ? 1.2 : BREATH,
                    repeat: Infinity,
                    delay: 0.2 + (SLOT_STYLE[a.id]?.angle ?? 0) / 720,
                    ease: "easeInOut",
                  }}
                />
              )}
            </g>
          );
        })}

        {/* Professor halo — 3 camadas */}
        <motion.circle
          cx={50}
          cy={50}
          r={32}
          fill="url(#profGlowOuter)"
          animate={profActive ? { opacity: [0.25, 0.55, 0.25], scale: [0.95, 1.08, 0.95] } : { opacity: 0.3, scale: 1 }}
          transition={{ duration: BREATH * 1.4, repeat: profActive ? Infinity : 0, ease: "easeInOut" }}
          style={{ transformOrigin: "50px 50px", filter: "blur(1.2px)" }}
        />
        <motion.circle
          cx={50}
          cy={50}
          r={24}
          fill="url(#profGlowOuter)"
          animate={
            profActive
              ? { opacity: professorSurge ? [0.7, 1, 0.7] : [0.55, 0.95, 0.55], scale: professorSurge ? [1, 1.12, 1] : [0.96, 1.08, 0.96] }
              : { opacity: 0.45, scale: 1 }
          }
          transition={{ duration: BREATH, repeat: profActive ? Infinity : 0, ease: "easeInOut" }}
          style={{ transformOrigin: "50px 50px" }}
        />
        <motion.circle
          cx={50}
          cy={50}
          r={16}
          fill="url(#profGlowInner)"
          animate={profActive ? { opacity: [0.45, 0.85, 0.45] } : { opacity: 0.35 }}
          transition={{ duration: BREATH, repeat: profActive ? Infinity : 0, ease: "easeInOut" }}
        />

        {/* Agent halos — 2 camadas por nó */}
        {agents.map((a) => {
          const s = SLOT_STYLE[a.id];
          if (!s) return null;
          const p = polar(s.angle, ORBIT_PCT);
          const meta = BUCKET_META[a.resolved.bucket];
          const isAnimated = !!meta.animate && a.present && !reducedMotion;
          const surging = a.surge && !reducedMotion;
          return (
            <g key={`halo-${a.id}`}>
              <motion.circle
                cx={p.x}
                cy={p.y}
                r={surging ? 18 : 15}
                fill={s.color}
                opacity={a.present ? 0.14 : 0.06}
                animate={
                  isAnimated || surging
                    ? { opacity: surging ? [0.1, 0.28, 0.1] : [0.08, 0.18, 0.08], scale: surging ? [1, 1.18, 1] : [1, 1.08, 1] }
                    : { opacity: a.present ? 0.1 : 0.05, scale: 1 }
                }
                transition={{ duration: surging ? 1.8 : BREATH * 1.3, repeat: isAnimated || surging ? Infinity : 0, ease: "easeInOut" }}
                style={{ transformOrigin: `${p.x}px ${p.y}px`, filter: "blur(2.6px)" }}
              />
              <motion.circle
                cx={p.x}
                cy={p.y}
                r={surging ? 13 : 11}
                fill={s.color}
                opacity={a.present ? 0.32 : 0.14}
                animate={
                  isAnimated || surging
                    ? { opacity: surging ? [0.28, 0.6, 0.28] : [0.2, 0.42, 0.2], scale: surging ? [1, 1.25, 1] : [1, 1.12, 1] }
                    : { opacity: a.present ? 0.22 : 0.1, scale: 1 }
                }
                transition={{ duration: surging ? 1.6 : BREATH, repeat: isAnimated || surging ? Infinity : 0, ease: "easeInOut" }}
                style={{ transformOrigin: `${p.x}px ${p.y}px`, filter: "blur(1.2px)" }}
              />
            </g>
          );
        })}
      </svg>

      {/* HTML overlay: Professor + agent cards */}
      <button
        type="button"
        aria-label={`Professor ${professor.stateLabel}`}
        onMouseEnter={() => setHovered("professor")}
        onMouseLeave={() => setHovered(null)}
        onFocus={() => setHovered("professor")}
        onBlur={() => setHovered(null)}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
        style={{ width: "53%", height: "53%" }}
      >
        <div
          className="relative flex h-full w-full items-center justify-center rounded-full border-2"
          style={{
            borderColor: PROFESSOR_COLOR,
            background:
              "radial-gradient(circle at 30% 25%, hsl(260 60% 22%) 0%, hsl(255 55% 12%) 55%, hsl(230 65% 5%) 100%)",
            boxShadow: `0 0 32px ${PROFESSOR_GLOW}, 0 0 60px rgba(168,85,247,0.35), inset 0 0 26px rgba(168,85,247,0.4)`,
          }}
        >
          <Brain className="h-[42%] w-[42%] text-violet-100 drop-shadow-[0_0_6px_rgba(168,85,247,0.9)]" />
          {/* state indicator dot on professor */}
          <span
            className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[hsl(226_65%_7%)]"
            style={{ backgroundColor: profStateHex, boxShadow: `0 0 8px ${profMeta.glow}` }}
            aria-hidden
          />
        </div>
        <div className="mt-1 text-[8.5px] font-semibold tracking-wide text-violet-100/95 leading-none">
          Professor
        </div>
      </button>

      {agents.map((a) => {
        const s = SLOT_STYLE[a.id];
        if (!s) return null;
        const p = polar(s.angle, ORBIT_PCT);
        const meta = BUCKET_META[a.resolved.bucket];
        const Icon = s.icon;
        const surging = a.surge && !reducedMotion;
        return (
          <button
            key={a.id}
            type="button"
            aria-label={`${a.label} ${a.resolved.stateLabel}`}
            onMouseEnter={() => setHovered(a.id)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(a.id)}
            onBlur={() => setHovered(null)}
            className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-0.5 outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 rounded-lg"
            style={{ left: `${p.x}%`, top: `${p.y}%`, width: "41%" }}
          >
            <motion.div
              className="relative flex items-center justify-center rounded-full border-2"
              style={{
                width: "100%",
                aspectRatio: "1 / 1",
                borderColor: s.color,
                background:
                  "radial-gradient(circle at 30% 25%, hsl(224 55% 20%) 0%, hsl(226 65% 9%) 55%, hsl(230 70% 5%) 100%)",
                boxShadow: `0 0 22px ${s.glow}, 0 0 44px ${s.glow}, inset 0 0 14px ${s.glow}`,
                opacity: a.present ? 1 : 0.55,
              }}
              animate={surging ? { scale: [1, 1.12, 1] } : undefined}
              transition={surging ? { duration: 1.4, repeat: Infinity, ease: "easeInOut" } : undefined}
            >
              <Icon
                className="h-[52%] w-[52%]"
                style={{ color: s.color, filter: `drop-shadow(0 0 4px ${s.glow})` }}
              />
              <span
                className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border border-[hsl(226_65%_7%)]"
                style={{ backgroundColor: meta.hex, boxShadow: `0 0 6px ${meta.glow}` }}
                aria-hidden
              />
            </motion.div>
            <div className="mt-0.5 text-[8.5px] font-semibold leading-tight tracking-tight text-cyan-50/95 text-center max-w-full truncate drop-shadow-[0_0_4px_rgba(0,0,0,0.9)]">
              {a.short}
            </div>
          </button>
        );
      })}

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

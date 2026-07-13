// Central de Inteligência Viva — v5 (estados reais).
// Continua 100% READ-ONLY. Consome APENAS endpoints já existentes:
//   - GET /api/business-brain/snapshot
//   - GET /api/business-learning/snapshot
//   - GET /api/scientific-knowledge/snapshot
//   - GET /api/executive/snapshot
//   - GET /api/executive/sales-intelligence
// Nenhum polling adicional, nenhuma escrita, nenhum LLM, nenhum agente
// operacional modificado. Nenhuma alteração visual além da sincronização
// dos estados reais dos snapshots já existentes.

import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Brain } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useAuth } from "@/auth/AuthContext";

/* -------------------- Tipos & estados -------------------- */

type Bucket = "active" | "learning" | "consolidating" | "waiting" | "idle";

interface AgentNode {
  id: string;
  label: string;
  short: string;
  tooltip: string;
  bucket: Bucket;
  stateLabel: string;   // rótulo real específico do agente
  updatedAt?: number;   // ms
  surge?: boolean;      // acabou de atualizar
}

const BUCKET_META: Record<
  Bucket,
  { glow: string; label: string; hex: string }
> = {
  active:        { glow: "rgba(52,211,153,0.85)",  label: "Ativo",        hex: "rgb(52,211,153)" },
  learning:      { glow: "rgba(56,189,248,0.85)",  label: "Aprendendo",   hex: "rgb(56,189,248)" },
  consolidating: { glow: "rgba(167,139,250,0.85)", label: "Consolidando", hex: "rgb(167,139,250)" },
  waiting:       { glow: "rgba(251,191,36,0.85)",  label: "Aguardando",   hex: "rgb(251,191,36)" },
  idle:          { glow: "rgba(148,163,184,0.5)",  label: "Ocioso",       hex: "rgb(148,163,184)" },
};

/* -------------------- Fetch utilities (READ-ONLY) -------------------- */

async function fetchSnapshot<T>(path: string): Promise<T | null> {
  try {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) return null;
    const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const body = (await res.json()) as { ok?: boolean; data?: T };
    if (!body?.ok || !body.data) return null;
    return body.data;
  } catch {
    return null;
  }
}

function iso(ts?: string | null): number | undefined {
  if (!ts) return undefined;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : undefined;
}

/* -------------------- Shapes mínimos dos snapshots -------------------- */

interface ScienceSnap {
  generatedAt?: string;
  sample?: {
    observations?: number;
    hypotheses?: number;
    evidence?: number;
    validatedKnowledge?: number;
    distinctSnapshotDays?: number;
  };
  hypotheses?: Array<{ status?: string }>;
}
interface BrainSnap {
  generatedAt?: string;
  sample?: { conversationFacts?: number; knowledgeSnapshots?: number };
  patterns?: unknown[];
}
interface LearningSnap {
  generatedAt?: string;
  sample?: { brainPatterns?: number; brainKnowledge?: number; weeklyBuckets?: number };
  hypotheses?: unknown[];
  evolution?: unknown[];
}
interface ExecSnap {
  generatedAt?: string;
  insights?: unknown[];
}
interface SalesSnap {
  generatedAt?: string;
  fromCache?: boolean;
  totals?: { opportunities?: number; scanned?: number };
}

interface RawBundle {
  science: ScienceSnap | null;
  brain: BrainSnap | null;
  learning: LearningSnap | null;
  executive: ExecSnap | null;
  sales: SalesSnap | null;
  at: number;
}

function useIntelligenceStates(enabled: boolean) {
  return useQuery<RawBundle>({
    queryKey: ["neural-intelligence-panel", "v5"],
    enabled,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    staleTime: 8_000,
    retry: false,
    queryFn: async () => {
      const [science, brain, learning, executive, sales] = await Promise.all([
        fetchSnapshot<ScienceSnap>("/api/scientific-knowledge/snapshot?period=30d"),
        fetchSnapshot<BrainSnap>("/api/business-brain/snapshot?period=30d"),
        fetchSnapshot<LearningSnap>("/api/business-learning/snapshot?period=30d"),
        fetchSnapshot<ExecSnap>("/api/executive/snapshot?period=30d"),
        fetchSnapshot<SalesSnap>("/api/executive/sales-intelligence?period=30d"),
      ]);
      return { science, brain, learning, executive, sales, at: Date.now() };
    },
  });
}

/* -------------------- Resolução determinística de estados reais -------------------- */

interface Resolved {
  bucket: Bucket;
  stateLabel: string;
  updatedAt?: number;
}

function resolveScience(s: ScienceSnap | null, hasUser: boolean, loading: boolean): Resolved {
  if (!hasUser || loading || !s) return { bucket: "waiting", stateLabel: "aguardando" };
  const hyp = s.hypotheses ?? [];
  const validated = s.sample?.validatedKnowledge ?? 0;
  const strengthening = hyp.some((h) => h?.status === "strengthening" || h?.status === "candidate");
  if (validated > 0) return { bucket: "active", stateLabel: "hipótese validada", updatedAt: iso(s.generatedAt) };
  if (strengthening) return { bucket: "consolidating", stateLabel: "fortalecendo hipótese", updatedAt: iso(s.generatedAt) };
  if ((s.sample?.hypotheses ?? 0) > 0) return { bucket: "learning", stateLabel: "observando", updatedAt: iso(s.generatedAt) };
  return { bucket: "waiting", stateLabel: "histórico insuficiente", updatedAt: iso(s.generatedAt) };
}

function resolveBrain(b: BrainSnap | null, hasUser: boolean, loading: boolean): Resolved {
  if (!hasUser || loading || !b) return { bucket: "waiting", stateLabel: "aguardando dados" };
  const facts = b.sample?.conversationFacts ?? 0;
  const patterns = b.patterns?.length ?? 0;
  if (facts === 0) return { bucket: "waiting", stateLabel: "aguardando dados", updatedAt: iso(b.generatedAt) };
  if (patterns > 0) return { bucket: "active", stateLabel: "atualizado", updatedAt: iso(b.generatedAt) };
  return { bucket: "consolidating", stateLabel: "consolidando padrões", updatedAt: iso(b.generatedAt) };
}

function resolveLearning(l: LearningSnap | null, hasUser: boolean, loading: boolean): Resolved {
  if (!hasUser || loading || !l) return { bucket: "waiting", stateLabel: "aguardando histórico" };
  const brainPatterns = l.sample?.brainPatterns ?? 0;
  const hyp = l.hypotheses?.length ?? 0;
  if (brainPatterns === 0) return { bucket: "waiting", stateLabel: "aguardando histórico", updatedAt: iso(l.generatedAt) };
  if (hyp > 0) return { bucket: "active", stateLabel: "atualizado", updatedAt: iso(l.generatedAt) };
  return { bucket: "learning", stateLabel: "aprendendo", updatedAt: iso(l.generatedAt) };
}

function resolveExecutive(e: ExecSnap | null, hasUser: boolean, loading: boolean): Resolved {
  if (!hasUser || loading || !e) return { bucket: "waiting", stateLabel: "aguardando atualização" };
  const ts = iso(e.generatedAt);
  if (!ts) return { bucket: "learning", stateLabel: "analisando", updatedAt: ts };
  const ageMin = (Date.now() - ts) / 60_000;
  if (ageMin < 15) return { bucket: "active", stateLabel: "snapshot atualizado", updatedAt: ts };
  return { bucket: "learning", stateLabel: "analisando", updatedAt: ts };
}

function resolveSales(s: SalesSnap | null, hasUser: boolean, loading: boolean): Resolved {
  if (!hasUser || loading || !s) return { bucket: "waiting", stateLabel: "aguardando" };
  if (s.fromCache === false) return { bucket: "consolidating", stateLabel: "calculando prioridades", updatedAt: iso(s.generatedAt) };
  return { bucket: "active", stateLabel: "atualizado", updatedAt: iso(s.generatedAt) };
}

function resolveConversation(b: BrainSnap | null, hasUser: boolean, loading: boolean): Resolved {
  // Derivado dos fatos de conversação já consumidos pelo Business Brain
  // (mesma origem, sem novo endpoint).
  if (!hasUser || loading || !b) return { bucket: "waiting", stateLabel: "aguardando" };
  const facts = b.sample?.conversationFacts ?? 0;
  if (facts === 0) return { bucket: "waiting", stateLabel: "sem novas conversas", updatedAt: iso(b.generatedAt) };
  return { bucket: "active", stateLabel: "atualizado", updatedAt: iso(b.generatedAt) };
}

function resolveProfessor(s: ScienceSnap | null, hasUser: boolean, loading: boolean): Resolved {
  if (!hasUser || loading || !s) return { bucket: "waiting", stateLabel: "aguardando" };
  const validated = s.sample?.validatedKnowledge ?? 0;
  const hyp = s.hypotheses ?? [];
  if (validated > 0) return { bucket: "active", stateLabel: "sincronizado", updatedAt: iso(s.generatedAt) };
  if (hyp.length > 0) return { bucket: "consolidating", stateLabel: "consolidando", updatedAt: iso(s.generatedAt) };
  if ((s.sample?.observations ?? 0) > 0) return { bucket: "learning", stateLabel: "analisando", updatedAt: iso(s.generatedAt) };
  return { bucket: "waiting", stateLabel: "aguardando", updatedAt: iso(s.generatedAt) };
}

/* -------------------- Utils -------------------- */

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

const BREATH = 3.8;

/* -------------------- Componente principal -------------------- */

export function NeuralIntelligencePanel() {
  const { user } = useAuth();
  const { data, isLoading } = useIntelligenceStates(!!user);

  const professor = resolveProfessor(data?.science ?? null, !!user, isLoading);
  const conversation = resolveConversation(data?.brain ?? null, !!user, isLoading);
  const brain = resolveBrain(data?.brain ?? null, !!user, isLoading);
  const learning = resolveLearning(data?.learning ?? null, !!user, isLoading);
  const science = resolveScience(data?.science ?? null, !!user, isLoading);
  const executive = resolveExecutive(data?.executive ?? null, !!user, isLoading);
  const sales = resolveSales(data?.sales ?? null, !!user, isLoading);

  // Detecção de mudança: mantém último generatedAt visto por agente.
  // Quando um snapshot muda, marca surge (glow temporário) por 4s.
  const prevRef = useRef<Record<string, number | undefined>>({});
  const [surge, setSurge] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const map: Record<string, number | undefined> = {
      professor: professor.updatedAt,
      conversation: conversation.updatedAt,
      brain: brain.updatedAt,
      learning: learning.updatedAt,
      science: science.updatedAt,
      executive: executive.updatedAt,
      sales: sales.updatedAt,
    };
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
  }, [
    professor.updatedAt,
    conversation.updatedAt,
    brain.updatedAt,
    learning.updatedAt,
    science.updatedAt,
    executive.updatedAt,
    sales.updatedAt,
  ]);

  const agents: AgentNode[] = [
    { id: "conversation", label: "Conversation Intelligence", short: "Conversation", tooltip: "Analisa e estrutura conhecimento das conversas.", bucket: conversation.bucket, stateLabel: conversation.stateLabel, updatedAt: conversation.updatedAt, surge: surge.conversation },
    { id: "brain",        label: "Business Brain",            short: "Brain",        tooltip: "Consolida padrões de negócio.",                    bucket: brain.bucket,        stateLabel: brain.stateLabel,        updatedAt: brain.updatedAt,        surge: surge.brain },
    { id: "learning",     label: "Business Learning",         short: "Learning",     tooltip: "Aprende continuamente com a evolução da empresa.", bucket: learning.bucket,     stateLabel: learning.stateLabel,     updatedAt: learning.updatedAt,     surge: surge.learning },
    { id: "science",      label: "Scientific Knowledge",      short: "Scientific",   tooltip: "Valida hipóteses utilizando evidências.",           bucket: science.bucket,      stateLabel: science.stateLabel,      updatedAt: science.updatedAt,      surge: surge.science },
    { id: "executive",    label: "Executive Intelligence",    short: "Executive",    tooltip: "Constrói inteligência estratégica.",                bucket: executive.bucket,    stateLabel: executive.stateLabel,    updatedAt: executive.updatedAt,    surge: surge.executive },
    { id: "sales",        label: "Sales Intelligence",        short: "Sales",        tooltip: "Prioriza oportunidades comerciais.",                bucket: sales.bucket,        stateLabel: sales.stateLabel,        updatedAt: sales.updatedAt,        surge: surge.sales },
  ];

  const activeCount = agents.filter((a) => a.bucket !== "waiting" && a.bucket !== "idle").length;
  const networkOnline = !!user && !isLoading && activeCount > 0;

  // Feed real: gerado a partir dos timestamps de cada snapshot disponível.
  const feed = useMemo(() => {
    if (!user || !data) return [];
    const items: { label: string; msg: string; ts: number }[] = [];
    const push = (label: string, msg: string, ts?: number) => {
      if (ts) items.push({ label, msg, ts });
    };
    push("Scientific Knowledge", science.stateLabel, science.updatedAt);
    push("Business Brain",       brain.stateLabel,   brain.updatedAt);
    push("Business Learning",    learning.stateLabel, learning.updatedAt);
    push("Executive Intelligence", executive.stateLabel, executive.updatedAt);
    push("Sales Intelligence",   sales.stateLabel,   sales.updatedAt);
    push("Conversation Intelligence", conversation.stateLabel, conversation.updatedAt);
    return items.sort((a, b) => b.ts - a.ts).slice(0, 5);
  }, [data, user, science, brain, learning, executive, sales, conversation]);

  const [legendFocused, setLegendFocused] = useState(false);

  // "Conhecimento acumulado" — apenas métrica real (validatedKnowledge).
  const validatedCount = data?.science?.sample?.validatedKnowledge ?? 0;
  const hypothesesCount = data?.science?.sample?.hypotheses ?? 0;

  return (
    <div className="mx-2 my-2 rounded-xl border border-sidebar-border/60 bg-gradient-to-b from-[hsl(220_35%_11%/0.85)] via-sidebar/50 to-sidebar/20 backdrop-blur-sm p-2.5 overflow-hidden relative">
      {/* Background grid — 2% opacity */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(125,211,252,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(125,211,252,0.6) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      />
      <BackgroundParticles />

      {/* Header */}
      <div className="relative flex items-start justify-between gap-2 mb-1.5">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold tracking-[0.14em] uppercase text-sidebar-foreground/95 leading-none">
            Inteligência Viva
          </div>
          <div className="text-[9px] text-muted-foreground/80 mt-0.5 leading-none">
            Aprendendo continuamente
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0 mt-0.5">
          <motion.span
            animate={{ opacity: networkOnline ? [0.55, 1, 0.55] : [0.3, 0.7, 0.3] }}
            transition={{ duration: 1.8, repeat: Infinity }}
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              networkOnline ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" : "bg-amber-400",
            )}
          />
          <span className="text-[8.5px] text-muted-foreground/85 tracking-wide">
            {networkOnline ? "Rede Neural Online" : "Aguardando"}
          </span>
        </div>
      </div>

      <NeuralGraph professor={professor} agents={agents} professorSurge={surge.professor} />

      {/* Legend chips */}
      <div
        className={cn(
          "mt-1 flex items-center justify-between gap-1 px-0.5 transition-opacity duration-500",
          legendFocused ? "opacity-100" : "opacity-40",
        )}
        onMouseEnter={() => setLegendFocused(true)}
        onMouseLeave={() => setLegendFocused(false)}
      >
        {(["active", "learning", "consolidating", "waiting"] as Bucket[]).map((s) => (
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

      {/* Feed real (últimos 5 eventos de snapshots) */}
      <div className="mt-1.5 rounded-md border border-sidebar-border/40 bg-black/40 px-2 py-1.5 font-mono text-[8.5px] leading-[1.45] text-sidebar-foreground/90 h-[74px] overflow-hidden relative">
        {feed.length === 0 ? (
          <div className="text-muted-foreground/60 italic truncate">
            <span className="text-emerald-400">$</span> aguardando novos eventos<BlinkingCursor />
          </div>
        ) : (
          <>
            <AnimatePresence initial={false}>
              {feed.map((e, i) => (
                <motion.div
                  key={`${e.label}-${e.ts}`}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ delay: i * 0.06, duration: 0.35 }}
                  className="flex items-baseline gap-1.5 truncate"
                >
                  <span className="text-sky-300/70 shrink-0">{formatTime(e.ts)}</span>
                  <span className="text-emerald-400 shrink-0">✓</span>
                  <span className="text-sidebar-foreground/95 shrink-0">{e.label}</span>
                  <span className="text-muted-foreground/75 truncate">· {e.msg}</span>
                </motion.div>
              ))}
            </AnimatePresence>
          </>
        )}
      </div>

      {/* Conhecimento acumulado — apenas métrica real */}
      <div className="mt-1.5 px-0.5">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[8.5px] uppercase tracking-[0.14em] text-muted-foreground/75">
            Conhecimento acumulado
          </span>
        </div>
        {validatedCount > 0 || hypothesesCount > 0 ? (
          <div className="text-[9px] text-sidebar-foreground/85">
            <span className="text-emerald-300">{validatedCount}</span> conhecimentos validados
            <span className="text-muted-foreground/60"> · </span>
            <span className="text-sky-300">{hypothesesCount}</span> hipóteses ativas
          </div>
        ) : (
          <div className="text-[9px] text-sidebar-foreground/70 italic">
            Aguardando histórico suficiente
          </div>
        )}
      </div>
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
  agents: AgentNode[];
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
          const isActive = a && a.bucket !== "waiting" && a.bucket !== "idle";
          const particleColor = a ? BUCKET_META[a.bucket].hex : "rgb(125,211,252)";
          const propDelay = 0.25 + i * 0.28;
          const surging = a?.surge;
          return (
            <g key={`line-${i}`}>
              <line
                x1={prof.x}
                y1={prof.y}
                x2={p.x}
                y2={p.y}
                stroke={isActive ? "url(#lineGradActive)" : "url(#lineGrad)"}
                strokeWidth={surging ? 1.4 : isActive ? 0.9 : 0.55}
              />
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
                  opacity: surging ? [0, 1, 0, 1, 0] : isActive ? [0, 0.65, 0] : [0, 0.22, 0],
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
            </g>
          );
        })}

        <motion.circle
          cx={prof.x}
          cy={prof.y}
          r={62}
          fill="url(#profGlowOuter)"
          animate={{
            opacity: professorSurge ? [0.7, 1, 0.7] : [0.5, 0.95, 0.5],
            scale: professorSurge ? [1, 1.15, 1] : [0.94, 1.08, 0.94],
          }}
          transition={{ duration: BREATH, repeat: Infinity, ease: "easeInOut" }}
          style={{ transformOrigin: `${prof.x}px ${prof.y}px` }}
        />
        <motion.circle
          cx={prof.x}
          cy={prof.y}
          r={40}
          fill="url(#profGlowInner)"
          animate={{ opacity: [0.35, 0.7, 0.35] }}
          transition={{ duration: BREATH, repeat: Infinity, ease: "easeInOut" }}
        />

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

        <motion.g
          animate={{ scale: [1, 1.06, 1] }}
          transition={{ duration: BREATH, repeat: Infinity, ease: "easeInOut" }}
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
          <text
            x={prof.x}
            y={prof.y + 9}
            textAnchor="middle"
            fontSize="26"
            className="fill-sidebar-foreground"
          >
            🧠
          </text>
        </motion.g>

        {positions.map((p, i) => {
          const a = agents[i];
          if (!a) return null;
          const meta = BUCKET_META[a.bucket];
          const dotColor = meta.hex;
          const isHover = hovered === a.id;
          const isActive = a.bucket !== "waiting" && a.bucket !== "idle";
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
                animate={{
                  opacity: surging ? [0.15, 0.5, 0.15] : isActive ? [0.06, 0.28, 0.06] : [0.04, 0.12, 0.04],
                  scale: surging ? [1, 1.4, 1] : [1, 1.22, 1],
                }}
                transition={{
                  duration: surging ? 1.6 : BREATH,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: propDelay,
                }}
                style={{ transformOrigin: `${p.x}px ${p.y}px`, filter: "blur(3px)" }}
              />
              <motion.g
                animate={{ scale: [1, 1.03, 1] }}
                transition={{ duration: BREATH, repeat: Infinity, ease: "easeInOut", delay: propDelay }}
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
                  animate={{ opacity: [0.55, 1, 0.55] }}
                  transition={{
                    duration: BREATH,
                    repeat: Infinity,
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
                title="Professor"
                subtitle="Coordena toda a inteligência do Atende AI."
                stateLabel={professor.stateLabel}
                stateHex={profMeta.hex}
                stateGlow={profMeta.glow}
                lastAt={professor.updatedAt}
              />
            );
          }
          const a = agents.find((x) => x.id === hovered);
          if (!a) return null;
          const meta = BUCKET_META[a.bucket];
          return (
            <TooltipCard
              title={a.label}
              subtitle={a.tooltip}
              stateLabel={a.stateLabel}
              stateHex={meta.hex}
              stateGlow={meta.glow}
              lastAt={a.updatedAt}
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
      className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-0 z-10 rounded-md border border-sidebar-border/70 bg-popover/95 backdrop-blur px-2 py-1.5 shadow-lg text-[9px] leading-tight min-w-[160px] max-w-[210px]"
    >
      <div className="font-semibold text-sidebar-foreground">{title}</div>
      <div className="text-muted-foreground/85 mt-0.5">{subtitle}</div>
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

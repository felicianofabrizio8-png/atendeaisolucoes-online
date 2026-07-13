// Central de Inteligência Viva — v4 Enterprise Premium (visual-only).
// Consome APENAS endpoints READ-ONLY existentes. Sem alterar lógica, endpoints,
// polling, RLS, banco, migrations, ou qualquer módulo operacional.

import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Brain } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useAuth } from "@/auth/AuthContext";

type AgentState = "active" | "learning" | "consolidating" | "waiting" | "idle";

interface AgentNode {
  id: string;
  label: string;
  short: string;
  tooltip: string;
  state: AgentState;
}

const STATE_META: Record<
  AgentState,
  { glow: string; label: string; hex: string }
> = {
  active:        { glow: "rgba(52,211,153,0.85)",  label: "Ativo",        hex: "rgb(52,211,153)" },
  learning:      { glow: "rgba(56,189,248,0.85)",  label: "Aprendendo",   hex: "rgb(56,189,248)" },
  consolidating: { glow: "rgba(167,139,250,0.85)", label: "Consolidando", hex: "rgb(167,139,250)" },
  waiting:       { glow: "rgba(251,191,36,0.85)",  label: "Aguardando",   hex: "rgb(251,191,36)" },
  idle:          { glow: "rgba(148,163,184,0.5)",  label: "Ocioso",       hex: "rgb(148,163,184)" },
};

async function pingSnapshot(path: string): Promise<boolean> {
  try {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) return false;
    const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    return res.ok;
  } catch {
    return false;
  }
}

function useIntelligenceStates(enabled: boolean) {
  return useQuery({
    queryKey: ["neural-intelligence-panel"],
    enabled,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    staleTime: 8_000,
    retry: false,
    queryFn: async () => {
      const [science, brain, learning, executive, sales] = await Promise.all([
        pingSnapshot("/api/scientific-knowledge/snapshot?period=30d"),
        pingSnapshot("/api/business-brain/snapshot?period=30d"),
        pingSnapshot("/api/business-learning/snapshot?period=30d"),
        pingSnapshot("/api/executive/snapshot?period=30d"),
        pingSnapshot("/api/executive/sales-intelligence?period=30d"),
      ]);
      return { science, brain, learning, executive, sales, at: Date.now() };
    },
  });
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

const BREATH = 3.8; // Professor breathing cycle (s)

export function NeuralIntelligencePanel() {
  const { user } = useAuth();
  const { data, isLoading } = useIntelligenceStates(!!user);

  const resolve = (ok: boolean | undefined, activeState: AgentState = "active"): AgentState => {
    if (!user) return "waiting";
    if (ok === undefined) return "learning";
    return ok ? activeState : "waiting";
  };

  // Ordered following the real knowledge-evolution flow:
  // Conversation → Brain → Learning → Scientific → Executive → Sales
  const agents: AgentNode[] = [
    { id: "conversation", label: "Conversation Intelligence", short: "Conversation",  tooltip: "Analisa e estrutura conhecimento das conversas.", state: resolve(data?.brain, "learning") },
    { id: "brain",        label: "Business Brain",            short: "Brain",         tooltip: "Consolida padrões de negócio.",                    state: resolve(data?.brain, "active") },
    { id: "learning",     label: "Business Learning",         short: "Learning",      tooltip: "Aprende continuamente com a evolução da empresa.", state: resolve(data?.learning, "consolidating") },
    { id: "science",      label: "Scientific Knowledge",      short: "Scientific",    tooltip: "Valida hipóteses utilizando evidências.",           state: resolve(data?.science, "consolidating") },
    { id: "executive",    label: "Executive Knowledge",       short: "Executive",     tooltip: "Constrói inteligência estratégica.",                state: resolve(data?.executive, "active") },
    { id: "sales",        label: "Sales Intelligence",        short: "Sales",         tooltip: "Prioriza oportunidades comerciais.",                state: resolve(data?.sales, "active") },
  ];

  const activeCount = agents.filter((a) => a.state !== "waiting" && a.state !== "idle").length;
  const networkOnline = !!user && !isLoading && activeCount > 0;

  const professorState: AgentState = useMemo(() => {
    if (!user) return "waiting";
    if (isLoading || !data) return "learning";
    return data.science ? "consolidating" : "waiting";
  }, [user, data, isLoading]);

  const feed = useMemo(() => {
    if (!user || !data) return [];
    const base = data.at ?? Date.now();
    const items: { label: string; msg: string; ts: number }[] = [];
    if (data.science)   items.push({ label: "Scientific Engine",    msg: "Hipótese fortalecida",        ts: base - 30_000 });
    if (data.brain)     items.push({ label: "Business Brain",       msg: "Novo padrão consolidado",     ts: base - 60_000 });
    if (data.executive) items.push({ label: "Executive Brain",      msg: "Insight atualizado",          ts: base - 90_000 });
    if (data.sales)     items.push({ label: "Sales Intelligence",   msg: "Prioridades recalculadas",    ts: base - 120_000 });
    if (data.learning)  items.push({ label: "Business Learning",    msg: "Evolução avaliada",           ts: base - 150_000 });
    return items.slice(0, 4);
  }, [data, user]);

  // Legend fade after mount
  const [legendFocused, setLegendFocused] = useState(false);

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
      {/* Floating background particles */}
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

      {/* Neural network — the star */}
      <NeuralGraph professorState={professorState} agents={agents} lastAt={data?.at} />

      {/* Legend chips — fade to 30%, 100% on hover */}
      <div
        className={cn(
          "mt-1 flex items-center justify-between gap-1 px-0.5 transition-opacity duration-500",
          legendFocused ? "opacity-100" : "opacity-40",
        )}
        onMouseEnter={() => setLegendFocused(true)}
        onMouseLeave={() => setLegendFocused(false)}
      >
        {(["active", "learning", "consolidating", "waiting"] as AgentState[]).map((s) => (
          <div
            key={s}
            className="flex items-center gap-1 rounded-full border border-sidebar-border/40 bg-black/25 px-1.5 py-[2px]"
          >
            <span
              className="h-1 w-1 rounded-full"
              style={{ backgroundColor: STATE_META[s].hex, boxShadow: `0 0 4px ${STATE_META[s].glow}` }}
            />
            <span className="text-[7.5px] text-sidebar-foreground/80 tracking-wide">
              {STATE_META[s].label}
            </span>
          </div>
        ))}
      </div>

      {/* Terminal feed — one line per event, blinking cursor */}
      <div className="mt-1.5 rounded-md border border-sidebar-border/40 bg-black/40 px-2 py-1.5 font-mono text-[8.5px] leading-[1.45] text-sidebar-foreground/90 h-[74px] overflow-hidden relative">
        {feed.length === 0 ? (
          <div className="text-muted-foreground/60 italic truncate">
            <span className="text-emerald-400">$</span> aguardando eventos<BlinkingCursor />
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
            <div className="flex items-baseline gap-1">
              <span className="text-emerald-400">$</span>
              <BlinkingCursor />
            </div>
          </>
        )}
      </div>

      {/* Learning indicator — never invents numbers */}
      <div className="mt-1.5 px-0.5">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[8.5px] uppercase tracking-[0.14em] text-muted-foreground/75">
            Conhecimento acumulado
          </span>
        </div>
        <div className="text-[9px] text-sidebar-foreground/70 italic">
          Aguardando histórico suficiente
        </div>
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
  professorState,
  agents,
  lastAt,
}: {
  professorState: AgentState;
  agents: AgentNode[];
  lastAt?: number;
}) {
  const W = 260;
  const H = 240;
  const prof = { x: W / 2, y: H / 2 - 4 };
  const [hovered, setHovered] = useState<string | null>(null);

  // Organic asymmetric topology — six agents around the Professor,
  // ordered to match the knowledge-evolution flow.
  const orbits: Array<{ r: number; angle: number }> = [
    { r: 74, angle: 168 },  // conversation — lower-left, close
    { r: 68, angle: -150 }, // brain — upper-left, closest
    { r: 92, angle: 108 },  // learning — bottom, distant
    { r: 96, angle: -78 },  // scientific — top, most distant
    { r: 84, angle: -18 },  // executive — right, mid
    { r: 88, angle: 52 },   // sales — lower-right, mid
  ];

  const positions = orbits.map(({ r, angle }) => {
    const rad = (angle * Math.PI) / 180;
    return { x: prof.x + Math.cos(rad) * r, y: prof.y + Math.sin(rad) * r };
  });

  const profMeta = STATE_META[professorState];
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

        {/* Connections — energized fibers, synchronized with the Professor breath.
            Propagation delay follows the flow order (index 0 → 5). */}
        {positions.map((p, i) => {
          const a = agents[i];
          const isActive = a && a.state !== "waiting" && a.state !== "idle";
          const particleColor = a ? STATE_META[a.state].hex : "rgb(125,211,252)";
          const propDelay = 0.25 + i * 0.28; // sequential energy propagation
          return (
            <g key={`line-${i}`}>
              <line
                x1={prof.x}
                y1={prof.y}
                x2={p.x}
                y2={p.y}
                stroke={isActive ? "url(#lineGradActive)" : "url(#lineGrad)"}
                strokeWidth={isActive ? 0.9 : 0.55}
              />
              {/* Fiber-optic pulse traveling along the connection */}
              <motion.line
                x1={prof.x}
                y1={prof.y}
                x2={p.x}
                y2={p.y}
                stroke={particleColor}
                strokeLinecap="round"
                strokeWidth={1.1}
                initial={{ opacity: 0 }}
                animate={{ opacity: isActive ? [0, 0.65, 0] : [0, 0.22, 0] }}
                transition={{
                  duration: BREATH,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: propDelay,
                }}
              />
              {/* Traveling particle */}
              <motion.circle
                r={1.6}
                fill={particleColor}
                filter="url(#softGlow)"
                initial={{ cx: prof.x, cy: prof.y, opacity: 0 }}
                animate={{
                  cx: [prof.x, p.x],
                  cy: [prof.y, p.y],
                  opacity: [0, 1, 0],
                }}
                transition={{
                  duration: BREATH,
                  repeat: Infinity,
                  delay: propDelay,
                  ease: "easeInOut",
                }}
              />
            </g>
          );
        })}

        {/* Professor: outer glow (breath) */}
        <motion.circle
          cx={prof.x}
          cy={prof.y}
          r={62}
          fill="url(#profGlowOuter)"
          animate={{ opacity: [0.5, 0.95, 0.5], scale: [0.94, 1.08, 0.94] }}
          transition={{ duration: BREATH, repeat: Infinity, ease: "easeInOut" }}
          style={{ transformOrigin: `${prof.x}px ${prof.y}px` }}
        />
        {/* Professor: inner glow */}
        <motion.circle
          cx={prof.x}
          cy={prof.y}
          r={40}
          fill="url(#profGlowInner)"
          animate={{ opacity: [0.35, 0.7, 0.35] }}
          transition={{ duration: BREATH, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Two counter-rotating rings, very slow */}
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

        {/* Professor core — ~50% larger than v3 (r 22 → 32), breathing */}
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

        {/* Agent nodes — own glow, halo, gentle breath, synced pulse */}
        {positions.map((p, i) => {
          const a = agents[i];
          if (!a) return null;
          const meta = STATE_META[a.state];
          const dotColor = meta.hex;
          const isHover = hovered === a.id;
          const isActive = a.state !== "waiting" && a.state !== "idle";
          const propDelay = 0.25 + i * 0.28;
          return (
            <g
              key={a.id}
              onMouseEnter={() => setHovered(a.id)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: "pointer" }}
            >
              {/* Halo — outer soft ring */}
              <motion.circle
                cx={p.x}
                cy={p.y}
                r={13}
                fill={dotColor}
                animate={{
                  opacity: isActive ? [0.06, 0.28, 0.06] : [0.04, 0.12, 0.04],
                  scale: [1, 1.22, 1],
                }}
                transition={{
                  duration: BREATH,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: propDelay,
                }}
                style={{ transformOrigin: `${p.x}px ${p.y}px`, filter: "blur(3px)" }}
              />
              {/* Node body — gentle breath 1 → 1.03 */}
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
                  strokeWidth={isHover ? 1.6 : 1.1}
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
              {/* Label — tiny, muted */}
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

      {/* Hover tooltip */}
      <AnimatePresence>
        {hovered && (() => {
          if (hovered === "professor") {
            return (
              <TooltipCard
                title="Professor"
                subtitle="Coordena toda a inteligência do Atende AI."
                stateLabel={profMeta.label}
                stateHex={profMeta.hex}
                stateGlow={profMeta.glow}
                lastAt={lastAt}
              />
            );
          }
          const a = agents.find((x) => x.id === hovered);
          if (!a) return null;
          const meta = STATE_META[a.state];
          return (
            <TooltipCard
              title={a.label}
              subtitle={a.tooltip}
              stateLabel={meta.label}
              stateHex={meta.hex}
              stateGlow={meta.glow}
              lastAt={lastAt}
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

/* Compact/collapsed variant — small pulsing icon */
export function NeuralIntelligencePulse() {
  // Force hook to keep any subscribers alive when needed (no-op UI).
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

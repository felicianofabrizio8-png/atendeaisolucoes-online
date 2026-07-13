// Central de Inteligência Viva — v3 Enterprise Premium (visual-only).
// Consome apenas endpoints READ-ONLY existentes. Sem impactar módulos operacionais.

import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Brain } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useAuth } from "@/auth/AuthContext";

type AgentState = "active" | "learning" | "consolidating" | "waiting" | "idle";

interface AgentNode {
  id: string;
  label: string;
  state: AgentState;
  source: string;
}

const STATE_META: Record<
  AgentState,
  { color: string; glow: string; label: string; hex: string }
> = {
  active:        { color: "bg-emerald-400", glow: "rgba(52,211,153,0.85)",  label: "Ativo",        hex: "rgb(52,211,153)" },
  learning:      { color: "bg-sky-400",     glow: "rgba(56,189,248,0.85)",  label: "Aprendendo",   hex: "rgb(56,189,248)" },
  consolidating: { color: "bg-violet-400",  glow: "rgba(167,139,250,0.85)", label: "Consolidando", hex: "rgb(167,139,250)" },
  waiting:       { color: "bg-amber-400",   glow: "rgba(251,191,36,0.85)",  label: "Aguardando",   hex: "rgb(251,191,36)" },
  idle:          { color: "bg-slate-500",   glow: "rgba(148,163,184,0.5)",  label: "Ocioso",       hex: "rgb(148,163,184)" },
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

export function NeuralIntelligencePanel() {
  const { user } = useAuth();
  const { data, isLoading } = useIntelligenceStates(!!user);

  const professorState: AgentState = useMemo(() => {
    if (!user) return "waiting";
    if (isLoading || !data) return "learning";
    return data.science ? "consolidating" : "waiting";
  }, [user, data, isLoading]);

  const resolve = (ok: boolean | undefined, activeState: AgentState = "active"): AgentState => {
    if (!user) return "waiting";
    if (ok === undefined) return "learning";
    return ok ? activeState : "waiting";
  };

  const agents: AgentNode[] = [
    { id: "brain",        label: "Business Brain",     state: resolve(data?.brain, "active"),           source: "business-brain/snapshot" },
    { id: "executive",    label: "Executive Brain",    state: resolve(data?.executive, "active"),       source: "executive/snapshot" },
    { id: "conversation", label: "Conversation",       state: resolve(data?.brain, "learning"),         source: "business-brain/snapshot" },
    { id: "sales",        label: "Sales Intelligence", state: resolve(data?.sales, "active"),           source: "executive/sales-intelligence" },
    { id: "learning",     label: "Business Learning",  state: resolve(data?.learning, "consolidating"), source: "business-learning/snapshot" },
    { id: "science",      label: "Scientific Engine",  state: resolve(data?.science, "consolidating"), source: "scientific-knowledge/snapshot" },
  ];

  const activeCount = agents.filter((a) => a.state !== "waiting" && a.state !== "idle").length;

  const feed = useMemo(() => {
    if (!user || !data) return [];
    const base = data.at ?? Date.now();
    const items: { label: string; msg: string; ok: boolean; ts: number }[] = [];
    if (data.science)   items.push({ label: "Scientific",  msg: "hipótese fortalecida",   ok: true, ts: base - 30_000 });
    if (data.brain)     items.push({ label: "Brain",       msg: "padrão consolidado",     ok: true, ts: base - 60_000 });
    if (data.executive) items.push({ label: "Executive",   msg: "insight atualizado",     ok: true, ts: base - 90_000 });
    if (data.sales)     items.push({ label: "Sales",       msg: "prioridades recalc.",    ok: true, ts: base - 120_000 });
    if (data.learning)  items.push({ label: "Learning",    msg: "evolução avaliada",      ok: true, ts: base - 150_000 });
    return items.slice(0, 4);
  }, [data, user]);

  const networkOnline = !!user && !isLoading && activeCount > 0;

  return (
    <div className="mx-2 my-2 rounded-xl border border-sidebar-border/60 bg-gradient-to-b from-[hsl(220_35%_12%/0.7)] via-sidebar/40 to-sidebar/10 backdrop-blur-sm p-2.5 overflow-hidden relative">
      {/* Subtle animated grid backdrop — very low opacity */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(125,211,252,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(125,211,252,0.5) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
      />

      {/* Header — minimal */}
      <div className="relative flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <motion.span
            animate={{ opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
            className="text-[11px]"
          >
            🧠
          </motion.span>
          <span className="text-[10px] font-semibold tracking-wider uppercase text-sidebar-foreground/90">
            Inteligência Viva
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <motion.span
            animate={{ opacity: networkOnline ? [0.5, 1, 0.5] : [0.3, 0.7, 0.3] }}
            transition={{ duration: 1.8, repeat: Infinity }}
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              networkOnline ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" : "bg-amber-400",
            )}
          />
        </div>
      </div>

      {/* Neural network — the star */}
      <NeuralGraph professorState={professorState} agents={agents} lastAt={data?.at} />

      {/* Compact terminal feed — single line per event */}
      <div className="mt-1.5 rounded-md border border-sidebar-border/40 bg-black/35 px-2 py-1.5 font-mono text-[8.5px] leading-[1.4] text-sidebar-foreground/85 max-h-[80px] overflow-hidden">
        {feed.length === 0 ? (
          <div className="text-muted-foreground/60 italic truncate">
            <span className="text-emerald-400">$</span> aguardando eventos…
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {feed.map((e, i) => (
              <motion.div
                key={`${e.label}-${e.ts}`}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex items-baseline gap-1.5 truncate"
              >
                <span className="text-sky-300/70 shrink-0">{formatTime(e.ts)}</span>
                <span className="text-emerald-400 shrink-0">✔</span>
                <span className="text-sidebar-foreground/95 shrink-0">{e.label}</span>
                <span className="text-muted-foreground/70 truncate">· {e.msg}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
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
  const H = 230;
  const prof = { x: W / 2, y: H / 2 - 8 };
  const [hovered, setHovered] = useState<string | null>(null);

  // Organic topology — irregular orbit around Professor
  // Radii and angles chosen to feel natural, not symmetric
  const orbits: Array<{ r: number; angle: number }> = [
    { r: 78, angle: -155 }, // brain — upper left
    { r: 82, angle: -25 },  // executive — upper right
    { r: 72, angle: 155 },  // conversation — lower left
    { r: 76, angle: 35 },   // sales — right
    { r: 88, angle: 100 },  // learning — bottom
    { r: 70, angle: -95 },  // science — top
  ];

  const positions = orbits.map(({ r, angle }) => {
    const rad = (angle * Math.PI) / 180;
    return { x: prof.x + Math.cos(rad) * r, y: prof.y + Math.sin(rad) * r };
  });

  const profMeta = STATE_META[professorState];
  const profColor = profMeta.hex;

  // Professor breathing period — synchronize propagation
  const BREATH = 3.6;

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="profGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={profColor} stopOpacity="0.6" />
            <stop offset="55%" stopColor={profColor} stopOpacity="0.14" />
            <stop offset="100%" stopColor={profColor} stopOpacity="0" />
          </radialGradient>
          <radialGradient id="profCore" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="hsl(220 35% 16%)" stopOpacity="1" />
            <stop offset="100%" stopColor="hsl(220 35% 8%)" stopOpacity="1" />
          </radialGradient>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgba(148,163,184,0.08)" />
            <stop offset="50%" stopColor="rgba(148,163,184,0.4)" />
            <stop offset="100%" stopColor="rgba(148,163,184,0.08)" />
          </linearGradient>
          <linearGradient id="lineGradActive" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgba(56,189,248,0.12)" />
            <stop offset="50%" stopColor="rgba(56,189,248,0.7)" />
            <stop offset="100%" stopColor="rgba(56,189,248,0.12)" />
          </linearGradient>
          <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Connections — synchronized brightness pulse with Professor breath */}
        {positions.map((p, i) => {
          const a = agents[i];
          const isActive = a && a.state !== "waiting" && a.state !== "idle";
          const particleColor = a ? STATE_META[a.state].hex : "rgb(125,211,252)";
          const reverse = i % 2 === 1;
          const from = reverse ? p : prof;
          const to = reverse ? prof : p;
          return (
            <g key={`line-${i}`}>
              <line
                x1={prof.x}
                y1={prof.y}
                x2={p.x}
                y2={p.y}
                stroke={isActive ? "url(#lineGradActive)" : "url(#lineGrad)"}
                strokeWidth={isActive ? 0.85 : 0.55}
              />
              {/* Propagation glow — synced with Professor breath */}
              <motion.line
                x1={prof.x}
                y1={prof.y}
                x2={p.x}
                y2={p.y}
                stroke={particleColor}
                strokeLinecap="round"
                strokeWidth={0.9}
                initial={{ opacity: 0 }}
                animate={{ opacity: isActive ? [0, 0.55, 0] : [0, 0.2, 0] }}
                transition={{
                  duration: BREATH,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: 0.15 + i * 0.05,
                }}
              />
              {/* Particle traveling */}
              <motion.circle
                r={1.5}
                fill={particleColor}
                filter="url(#softGlow)"
                initial={{ cx: from.x, cy: from.y, opacity: 0 }}
                animate={{
                  cx: [from.x, to.x],
                  cy: [from.y, to.y],
                  opacity: [0, 1, 0],
                }}
                transition={{
                  duration: 3.2 + (i % 3) * 0.5,
                  repeat: Infinity,
                  delay: i * 0.6,
                  ease: "easeInOut",
                }}
              />
            </g>
          );
        })}

        {/* Professor rotating halos */}
        <motion.g
          animate={{ rotate: 360 }}
          transition={{ duration: 50, repeat: Infinity, ease: "linear" }}
          style={{ transformOrigin: `${prof.x}px ${prof.y}px` }}
        >
          <circle
            cx={prof.x}
            cy={prof.y}
            r={38}
            fill="none"
            stroke={profColor}
            strokeOpacity={0.35}
            strokeWidth={0.55}
            strokeDasharray="2 5"
          />
        </motion.g>
        <motion.g
          animate={{ rotate: -360 }}
          transition={{ duration: 70, repeat: Infinity, ease: "linear" }}
          style={{ transformOrigin: `${prof.x}px ${prof.y}px` }}
        >
          <circle
            cx={prof.x}
            cy={prof.y}
            r={44}
            fill="none"
            stroke={profColor}
            strokeOpacity={0.18}
            strokeWidth={0.4}
            strokeDasharray="1 8"
          />
        </motion.g>

        {/* Professor outer glow — the breath source */}
        <motion.circle
          cx={prof.x}
          cy={prof.y}
          r={50}
          fill="url(#profGlow)"
          animate={{ opacity: [0.5, 0.95, 0.5], scale: [0.95, 1.08, 0.95] }}
          transition={{ duration: BREATH, repeat: Infinity, ease: "easeInOut" }}
          style={{ transformOrigin: `${prof.x}px ${prof.y}px` }}
        />

        {/* Professor node — ~40% bigger (r 16 → 22) */}
        <motion.g
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: BREATH, repeat: Infinity, ease: "easeInOut" }}
          style={{ transformOrigin: `${prof.x}px ${prof.y}px` }}
          onMouseEnter={() => setHovered("professor")}
          onMouseLeave={() => setHovered(null)}
        >
          <circle
            cx={prof.x}
            cy={prof.y}
            r={22}
            fill="url(#profCore)"
            stroke={profColor}
            strokeWidth={1.6}
            filter="url(#softGlow)"
          />
          <text
            x={prof.x}
            y={prof.y + 6}
            textAnchor="middle"
            fontSize="17"
            className="fill-sidebar-foreground"
          >
            🧠
          </text>
        </motion.g>

        {/* Agent nodes — pulse synced with Professor */}
        {positions.map((p, i) => {
          const a = agents[i];
          if (!a) return null;
          const meta = STATE_META[a.state];
          const dotColor = meta.hex;
          const isHover = hovered === a.id;
          const isActive = a.state !== "waiting" && a.state !== "idle";
          // Delay proportional to distance-ish (index-based approximation)
          const propDelay = 0.35 + i * 0.06;
          return (
            <g
              key={a.id}
              onMouseEnter={() => setHovered(a.id)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: "pointer" }}
            >
              {/* Outer sync glow — reacts to Professor breath */}
              <motion.circle
                cx={p.x}
                cy={p.y}
                r={10}
                fill={dotColor}
                animate={{
                  opacity: isActive ? [0.08, 0.32, 0.08] : [0.05, 0.15, 0.05],
                  scale: [1, 1.2, 1],
                }}
                transition={{
                  duration: BREATH,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: propDelay,
                }}
                style={{ transformOrigin: `${p.x}px ${p.y}px` }}
              />
              <circle
                cx={p.x}
                cy={p.y}
                r={5.2}
                fill="hsl(220 35% 10%)"
                stroke={dotColor}
                strokeWidth={isHover ? 1.5 : 1}
                filter="url(#softGlow)"
              />
              <motion.circle
                cx={p.x}
                cy={p.y}
                r={2.3}
                fill={dotColor}
                animate={{ opacity: [0.55, 1, 0.55] }}
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
      </svg>

      {/* Hover tooltip */}
      <AnimatePresence>
        {hovered && hovered !== "professor" && (() => {
          const a = agents.find((x) => x.id === hovered);
          if (!a) return null;
          const meta = STATE_META[a.state];
          return (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-0 z-10 rounded-md border border-sidebar-border/70 bg-popover/95 backdrop-blur px-2 py-1.5 shadow-lg text-[9px] leading-tight min-w-[130px]"
            >
              <div className="font-semibold text-sidebar-foreground">{a.label}</div>
              <div className="flex items-center gap-1 mt-0.5">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: meta.hex, boxShadow: `0 0 6px ${meta.glow}` }}
                />
                <span className="text-muted-foreground">{meta.label}</span>
              </div>
              <div className="text-muted-foreground/80 mt-0.5">
                Atualizado {formatRelative(lastAt)}
              </div>
            </motion.div>
          );
        })()}
        {hovered === "professor" && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-0 z-10 rounded-md border border-sidebar-border/70 bg-popover/95 backdrop-blur px-2 py-1.5 shadow-lg text-[9px] leading-tight min-w-[130px]"
          >
            <div className="font-semibold text-sidebar-foreground">Professor</div>
            <div className="flex items-center gap-1 mt-0.5">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: profMeta.hex, boxShadow: `0 0 6px ${profMeta.glow}` }}
              />
              <span className="text-muted-foreground">{profMeta.label}</span>
            </div>
            <div className="text-muted-foreground/80 mt-0.5">
              Atualizado {formatRelative(lastAt)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* Compact/collapsed variant — small pulsing icon */
export function NeuralIntelligencePulse() {
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

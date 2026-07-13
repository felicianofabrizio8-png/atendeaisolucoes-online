// Central de Inteligência Viva — visual-only.
// Consome apenas endpoints READ-ONLY existentes. Sem impactar módulos operacionais.

import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Brain } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useAuth } from "@/auth/AuthContext";

type AgentState = "active" | "learning" | "consolidating" | "waiting" | "idle";

interface AgentNode {
  id: string;
  label: string;
  state: AgentState;
}

const STATE_META: Record<AgentState, { color: string; ring: string; label: string }> = {
  active:        { color: "bg-emerald-400",  ring: "shadow-[0_0_8px_rgba(52,211,153,0.9)]", label: "Ativo" },
  learning:      { color: "bg-sky-400",      ring: "shadow-[0_0_8px_rgba(56,189,248,0.9)]", label: "Aprendendo" },
  consolidating: { color: "bg-violet-400",   ring: "shadow-[0_0_8px_rgba(167,139,250,0.9)]", label: "Consolidando" },
  waiting:       { color: "bg-amber-400",    ring: "shadow-[0_0_8px_rgba(251,191,36,0.8)]", label: "Aguardando dados" },
  idle:          { color: "bg-muted-foreground/60", ring: "", label: "Ocioso" },
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
      return { science, brain, learning, executive, sales };
    },
  });
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
    { id: "brain",        label: "Business Brain",       state: resolve(data?.brain, "active") },
    { id: "executive",    label: "Executive Brain",      state: resolve(data?.executive, "active") },
    { id: "conversation", label: "Conversation",         state: resolve(data?.brain, "learning") },
    { id: "sales",        label: "Sales Intelligence",   state: resolve(data?.sales, "active") },
    { id: "learning",     label: "Business Learning",    state: resolve(data?.learning, "consolidating") },
  ];

  const activities = useMemo(() => {
    if (!user) return [];
    const items: string[] = [];
    if (data?.brain) items.push("Business Brain consolidou padrões");
    if (data?.science) items.push("Scientific Engine fortaleceu hipóteses");
    if (data?.executive) items.push("Executive Brain gerou novos insights");
    if (data?.sales) items.push("Sales Intelligence atualizou prioridades");
    if (data?.learning) items.push("Business Learning avaliou evolução");
    return items.slice(0, 5);
  }, [data, user]);

  return (
    <div className="mx-2 my-2 rounded-lg border border-sidebar-border/60 bg-gradient-to-b from-sidebar-accent/40 to-sidebar/20 p-3 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-0.5">
        <motion.span
          animate={{ opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          className="text-[13px]"
        >
          🧠
        </motion.span>
        <span className="text-[11px] font-semibold tracking-wide text-sidebar-foreground/90">
          Inteligência Viva
        </span>
      </div>
      <p className="text-[9.5px] leading-tight text-muted-foreground mb-2">
        A IA continua aprendendo enquanto você trabalha.
      </p>

      {/* Neural network */}
      <NeuralGraph professorState={professorState} agents={agents} />

      {/* Feed */}
      <div className="mt-2 space-y-1">
        {activities.length === 0 ? (
          <div className="text-[9.5px] text-muted-foreground/80 italic">
            Aguardando eventos da inteligência
          </div>
        ) : (
          activities.map((a, i) => (
            <motion.div
              key={a}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.08 }}
              className="flex items-start gap-1.5 text-[9.5px] text-sidebar-foreground/80"
            >
              <span className="text-emerald-400 mt-[1px]">✔</span>
              <span className="truncate">{a}</span>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}

/* -------------------- Neural graph -------------------- */

function NeuralGraph({ professorState, agents }: { professorState: AgentState; agents: AgentNode[] }) {
  // Positions in a 220x160 viewBox. Professor is centered at top.
  const W = 220;
  const H = 160;
  const prof = { x: W / 2, y: 28 };

  const positions = [
    { x: 22,  y: 88 },   // brain
    { x: 198, y: 88 },   // executive
    { x: 60,  y: 138 },  // conversation
    { x: 160, y: 138 },  // sales
    { x: W/2, y: 148 },  // learning
  ];

  const profMeta = STATE_META[professorState];

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="profGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%"  stopColor="hsl(var(--primary, 190 90% 55%))" stopOpacity="0.55" />
            <stop offset="100%" stopColor="hsl(var(--primary, 190 90% 55%))" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgba(148,163,184,0.15)" />
            <stop offset="50%" stopColor="rgba(148,163,184,0.55)" />
            <stop offset="100%" stopColor="rgba(148,163,184,0.15)" />
          </linearGradient>
        </defs>

        {/* Connections */}
        {positions.map((p, i) => {
          const key = `line-${i}`;
          return (
            <g key={key}>
              <line
                x1={prof.x} y1={prof.y} x2={p.x} y2={p.y}
                stroke="url(#lineGrad)"
                strokeWidth={0.6}
              />
              {/* Pulsing overlay */}
              <motion.line
                x1={prof.x} y1={prof.y} x2={p.x} y2={p.y}
                stroke="rgba(56,189,248,0.6)"
                strokeWidth={0.8}
                strokeLinecap="round"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0.6, 0] }}
                transition={{ duration: 3.2, repeat: Infinity, delay: i * 0.4, ease: "easeInOut" }}
              />
              {/* Particle traveling along the connection */}
              <motion.circle
                r={1.4}
                fill={agents[i]?.state === "waiting" ? "rgb(251,191,36)" : "rgb(125,211,252)"}
                initial={{ cx: prof.x, cy: prof.y, opacity: 0 }}
                animate={{
                  cx: [prof.x, p.x],
                  cy: [prof.y, p.y],
                  opacity: [0, 1, 0],
                }}
                transition={{
                  duration: 2.6,
                  repeat: Infinity,
                  delay: i * 0.5,
                  ease: "easeInOut",
                }}
              />
            </g>
          );
        })}

        {/* Professor glow */}
        <circle cx={prof.x} cy={prof.y} r={22} fill="url(#profGlow)" />
        {/* Professor node — breathing */}
        <motion.g
          animate={{ scale: [1, 1.03, 1] }}
          transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
          style={{ transformOrigin: `${prof.x}px ${prof.y}px` }}
        >
          <circle cx={prof.x} cy={prof.y} r={11} fill="hsl(var(--background))" stroke={profMeta === STATE_META.waiting ? "rgb(251,191,36)" : "rgb(125,211,252)"} strokeWidth={1.2} />
          <text x={prof.x} y={prof.y + 3.2} textAnchor="middle" fontSize="8" fill="currentColor" className="text-sidebar-foreground">🧠</text>
        </motion.g>

        {/* Agent nodes */}
        {positions.map((p, i) => {
          const a = agents[i];
          if (!a) return null;
          const meta = STATE_META[a.state];
          const dotColor =
            a.state === "active" ? "rgb(52,211,153)" :
            a.state === "learning" ? "rgb(56,189,248)" :
            a.state === "consolidating" ? "rgb(167,139,250)" :
            a.state === "waiting" ? "rgb(251,191,36)" :
            "rgb(148,163,184)";
          return (
            <g key={a.id}>
              <circle cx={p.x} cy={p.y} r={4.5} fill="hsl(var(--sidebar-background, 222 47% 11%))" stroke={dotColor} strokeWidth={0.9} />
              <motion.circle
                cx={p.x} cy={p.y} r={2}
                fill={dotColor}
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 2, repeat: Infinity, delay: i * 0.3 }}
              />
              <text
                x={p.x}
                y={p.y + (p.y > prof.y + 40 ? 12 : -7)}
                textAnchor="middle"
                fontSize="5.4"
                className="fill-sidebar-foreground/85"
                style={{ fontWeight: 500 }}
              >
                {a.label}
              </text>
              <title>{`${a.label} — ${meta.label}`}</title>
            </g>
          );
        })}
      </svg>

      {/* Legend row (compact) */}
      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 justify-center text-[8.5px] text-muted-foreground">
        <LegendDot className="bg-emerald-400" label="Ativo" />
        <LegendDot className="bg-sky-400" label="Aprendendo" />
        <LegendDot className="bg-violet-400" label="Consolidando" />
        <LegendDot className="bg-amber-400" label="Aguardando" />
      </div>
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("h-1.5 w-1.5 rounded-full", className)} />
      {label}
    </span>
  );
}

/* Compact/collapsed variant — small pulsing icon */
export function NeuralIntelligencePulse() {
  return (
    <div className="mx-auto my-2 flex items-center justify-center">
      <motion.div
        animate={{ scale: [1, 1.15, 1], opacity: [0.7, 1, 0.7] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        className="h-7 w-7 rounded-full bg-primary/15 flex items-center justify-center shadow-[0_0_12px_rgba(56,189,248,0.55)]"
        title="Inteligência Viva"
      >
        <Brain className="h-3.5 w-3.5 text-primary" />
      </motion.div>
    </div>
  );
}

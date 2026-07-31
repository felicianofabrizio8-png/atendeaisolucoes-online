// Cartões do Dashboard Recovery. Puramente apresentacional — recebe os
// números já agregados pelo motor, sem cálculo próprio, para que painel e
// lista nunca divirjam.

import { cn } from "@/lib/utils";
import type { RecoveryDashboardCards } from "@/lib/recovery";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Flame,
  Lock,
  TrendingUp,
  Wallet,
  XCircle,
} from "lucide-react";

export interface RecoveryCardsProps {
  cards: RecoveryDashboardCards;
  loading?: boolean;
}

const TONE = {
  primary: "text-primary",
  amber: "text-amber-600 dark:text-amber-500",
  emerald: "text-emerald-600 dark:text-emerald-500",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
} as const;

function brl(value: number): string {
  if (value >= 1000) return `R$ ${Math.round(value / 1000)}k`;
  return `R$ ${Math.round(value)}`;
}

export function RecoveryCards({ cards, loading = false }: RecoveryCardsProps) {
  const entries: Array<{
    key: string;
    icon: React.ReactNode;
    label: string;
    value: string | number;
    tone: keyof typeof TONE;
  }> = [
    {
      key: "high",
      icon: <Flame className="h-4 w-4" />,
      label: "Prioridade alta",
      value: cards.highPriority,
      tone: "destructive",
    },
    {
      key: "open",
      icon: <Clock className="h-4 w-4" />,
      label: "Janela aberta",
      value: cards.windowOpen,
      tone: "emerald",
    },
    {
      key: "closed",
      icon: <Lock className="h-4 w-4" />,
      label: "Exigem template",
      value: cards.windowClosed,
      tone: "amber",
    },
    {
      key: "pending",
      icon: <AlertTriangle className="h-4 w-4" />,
      label: "A recuperar",
      value: cards.pending,
      tone: "primary",
    },
    {
      key: "today",
      icon: <TrendingUp className="h-4 w-4" />,
      label: "Ativos hoje",
      value: cards.recoveredToday,
      tone: "emerald",
    },
    {
      key: "recovered",
      icon: <CheckCircle2 className="h-4 w-4" />,
      label: "Fechados",
      value: cards.recovered,
      tone: "emerald",
    },
    {
      key: "lost",
      icon: <XCircle className="h-4 w-4" />,
      label: "Perdidos",
      value: cards.lost,
      tone: "muted",
    },
    {
      key: "pipeline",
      icon: <Wallet className="h-4 w-4" />,
      label: "Valor em jogo",
      value: brl(cards.pipelineValue),
      tone: "primary",
    },
  ];

  return (
    <section
      aria-label="Indicadores de recuperação"
      className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2"
    >
      {entries.map((e) => (
        <div
          key={e.key}
          className="rounded-lg border border-border bg-card p-3 flex flex-col gap-1"
        >
          <div className={cn("inline-flex items-center gap-1.5 text-[11px]", TONE[e.tone])}>
            {e.icon}
            <span className="font-medium truncate">{e.label}</span>
          </div>
          <div className="text-xl font-semibold tabular-nums">
            {loading ? <span className="text-muted-foreground">—</span> : e.value}
          </div>
        </div>
      ))}
    </section>
  );
}

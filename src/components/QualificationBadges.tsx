import { Flame, Snowflake, Thermometer, MapPin, Ruler, Target, AlertTriangle, CheckCircle2, DollarSign, Calendar, User2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/data/mock";

type Temp = "frio" | "morno" | "quente" | null | undefined;

const TEMP_META: Record<"frio" | "morno" | "quente", { label: string; icon: typeof Flame; color: string; bg: string; border: string }> = {
  frio:   { label: "Frio",   icon: Snowflake,    color: "#60a5fa", bg: "rgba(96,165,250,0.12)",  border: "rgba(96,165,250,0.35)" },
  morno:  { label: "Morno",  icon: Thermometer,  color: "#f59e0b", bg: "rgba(245,158,11,0.12)",  border: "rgba(245,158,11,0.35)" },
  quente: { label: "Quente", icon: Flame,        color: "#ef4444", bg: "rgba(239,68,68,0.14)",   border: "rgba(239,68,68,0.4)"   },
};

export function TempBadge({ temp, score, compact }: { temp: Temp; score?: number; compact?: boolean }) {
  if (!temp) return null;
  const m = TEMP_META[temp];
  if (!m) return null;
  const Icon = m.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md font-semibold border",
        compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]",
      )}
      style={{ color: m.color, backgroundColor: m.bg, borderColor: m.border }}
      title={`Temperatura: ${m.label}${typeof score === "number" ? ` · score ${score}` : ""}`}
    >
      <Icon className={compact ? "h-2.5 w-2.5" : "h-3 w-3"} />
      {m.label}
      {typeof score === "number" && score > 0 && (
        <span className="opacity-70 font-normal tabular-nums">· {score}</span>
      )}
    </span>
  );
}

export function MiniBadge({
  icon: Icon,
  children,
  tone = "neutral",
  title,
}: {
  icon: typeof Flame;
  children: React.ReactNode;
  tone?: "neutral" | "ready" | "objection" | "ai";
  title?: string;
}) {
  const toneCls = {
    neutral:   "bg-secondary text-muted-foreground border-transparent",
    ready:     "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    objection: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    ai:        "bg-primary/10 text-primary border-primary/30",
  }[tone];
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium max-w-[200px]",
        toneCls,
      )}
    >
      <Icon className="h-2.5 w-2.5 shrink-0" />
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Linha compacta de badges para o card da lista do Inbox. */
export function QualificationInline({ conv }: { conv: Conversation }) {
  const city = conv.detectedCity;
  const state = conv.detectedState;
  const size = conv.detectedPoolSize;
  const ready = conv.leadReadyToClose;
  const objection = (conv.detectedObjections ?? [])[0];
  const temp = conv.leadTemperature;
  const aiActive = conv.aiStatus === "pre_atendido_ia";

  if (!city && !state && !size && !ready && !objection && !temp && !aiActive) return null;
  const loc = [city, state].filter(Boolean).join(" / ");

  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {temp && <TempBadge temp={temp} score={conv.leadScore} compact />}
      {ready && (
        <MiniBadge icon={CheckCircle2} tone="ready" title="Lead sinalizou intenção de fechar">
          Pronto p/ fechar
        </MiniBadge>
      )}
      {aiActive && (
        <MiniBadge icon={Target} tone="ai" title="Pré-atendido pela IA">
          IA
        </MiniBadge>
      )}
      {loc && (
        <MiniBadge icon={MapPin} title={`Local: ${loc}`}>
          {loc}
        </MiniBadge>
      )}
      {size && (
        <MiniBadge icon={Ruler} title={`Medida: ${size}`}>
          {size}
        </MiniBadge>
      )}
      {objection && (
        <MiniBadge icon={AlertTriangle} tone="objection" title={`Objeção detectada: ${objection}`}>
          {objection}
        </MiniBadge>
      )}
    </div>
  );
}

/** Bloco para o painel lateral da conversa. */
export function QualificationPanel({ conv }: { conv: Conversation }) {
  const rows: Array<{ icon: typeof Flame; label: string; value: React.ReactNode }> = [];
  if (conv.detectedCity || conv.detectedState) {
    rows.push({ icon: MapPin, label: "Local", value: [conv.detectedCity, conv.detectedState].filter(Boolean).join(" / ") });
  }
  if (conv.detectedPoolSize) rows.push({ icon: Ruler, label: "Medida", value: conv.detectedPoolSize });
  if (conv.detectedInterest) rows.push({ icon: Target, label: "Interesse", value: conv.detectedInterest });
  if (conv.detectedBudget) rows.push({ icon: DollarSign, label: "Orçamento", value: conv.detectedBudget });
  if (conv.purchaseTiming) rows.push({ icon: Calendar, label: "Prazo", value: conv.purchaseTiming });
  if (conv.customerStage) rows.push({ icon: User2, label: "Estágio", value: conv.customerStage });

  const hasAny =
    rows.length > 0 ||
    conv.leadTemperature ||
    conv.leadReadyToClose ||
    (conv.detectedObjections ?? []).length > 0;

  if (!hasAny) {
    return (
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground mb-2">
          <Target className="h-3 w-3" /> Qualificação IA
        </div>
        <p className="text-xs text-muted-foreground">
          Sem dados ainda. A IA preencherá automaticamente conforme a conversa avança.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 border-b border-border">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground mb-2">
        <Target className="h-3 w-3" /> Qualificação IA
      </div>
      {(conv.leadTemperature || conv.leadReadyToClose) && (
        <div className="mb-2 flex flex-wrap gap-1">
          <TempBadge temp={conv.leadTemperature} score={conv.leadScore} />
          {conv.leadReadyToClose && (
            <MiniBadge icon={CheckCircle2} tone="ready">Pronto p/ fechar</MiniBadge>
          )}
        </div>
      )}
      <div className="space-y-1.5 text-sm">
        {rows.map((r) => {
          const Icon = r.icon;
          return (
            <div key={r.label} className="flex items-start gap-2 text-xs">
              <Icon className="h-3 w-3 mt-0.5 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground w-16 shrink-0">{r.label}</span>
              <span className="text-foreground break-words">{r.value}</span>
            </div>
          );
        })}
      </div>
      {(conv.detectedObjections ?? []).length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Objeções</div>
          <div className="flex flex-wrap gap-1">
            {(conv.detectedObjections ?? []).map((o) => (
              <MiniBadge key={o} icon={AlertTriangle} tone="objection">{o}</MiniBadge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

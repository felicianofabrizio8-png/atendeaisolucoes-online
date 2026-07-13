// ============================================================================
// ExecutiveNarrative — Card premium com a análise gerada pela CEO AI.
// Consumidor READ-ONLY de GET /api/executive/narrative.
// Cache indexado por snapshotGeneratedAt: só refetch quando o snapshot muda.
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowRight, Brain, Lightbulb, RefreshCw, ShieldAlert, Sparkles, Target } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { SnapshotPeriod } from "@/lib/executive-snapshot";
import type { ExecutiveNarrative as Narrative } from "@/lib/executive-narrative/ExecutiveNarrativeTypes";
import { cn } from "@/lib/utils";

interface Props {
  period: SnapshotPeriod;
  snapshotGeneratedAt: string;
}

async function fetchNarrative(period: SnapshotPeriod): Promise<Narrative> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("unauthorized");
  const hour = new Date().getHours();
  const res = await fetch(`/api/executive/narrative?period=${period}&hour=${hour}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await res.json().catch(() => null)) as
    | { ok: boolean; data?: Narrative; error?: string }
    | null;
  if (!res.ok || !body?.ok || !body.data) {
    throw new Error(body?.error ?? `http_${res.status}`);
  }
  return body.data;
}

export function ExecutiveNarrative({ period, snapshotGeneratedAt }: Props) {
  const q = useQuery({
    queryKey: ["executive-narrative", period, snapshotGeneratedAt],
    queryFn: () => fetchNarrative(period),
    enabled: Boolean(snapshotGeneratedAt),
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const generatedStr = q.data
    ? new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(
        new Date(q.data.generatedAt),
      )
    : "—";

  return (
    <section
      aria-label="Análise executiva por IA"
      className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card p-5 md:p-6 shadow-sm"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid place-items-center h-10 w-10 rounded-xl bg-primary/15 text-primary">
            <Brain className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-primary">
              <Sparkles className="h-3 w-3" /> CEO AI
            </div>
            <h2 className="text-lg font-semibold text-foreground">Análise Executiva</h2>
            <p className="text-xs text-muted-foreground">Gerado às {generatedStr}</p>
          </div>
        </div>
        <button
          onClick={() => q.refetch()}
          disabled={q.isFetching}
          aria-label="Atualizar análise"
          className={cn(
            "inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium",
            "border border-border bg-background hover:bg-muted disabled:opacity-60",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          )}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", q.isFetching && "animate-spin")} />
          Atualizar análise
        </button>
      </div>

      <div className="mt-5" aria-live="polite">
        {q.isLoading ? (
          <NarrativeSkeleton />
        ) : q.error ? (
          <NarrativeError message={q.error instanceof Error ? q.error.message : "erro"} onRetry={() => q.refetch()} />
        ) : q.data ? (
          <NarrativeBody data={q.data} />
        ) : null}
      </div>
    </section>
  );
}

function NarrativeBody({ data }: { data: Narrative }) {
  return (
    <div className="space-y-5">
      {data.greeting && (
        <p className="text-base font-medium text-foreground">{data.greeting}</p>
      )}
      <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-line">
        {data.summary}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <NarrativeList
          icon={<Target className="h-4 w-4" />}
          title="Prioridades"
          items={data.priorities}
          tone="primary"
        />
        <NarrativeList
          icon={<Lightbulb className="h-4 w-4" />}
          title="Oportunidades"
          items={data.opportunities}
          tone="emerald"
        />
        <NarrativeList
          icon={<ShieldAlert className="h-4 w-4" />}
          title="Riscos"
          items={data.risks}
          tone="rose"
        />
      </div>

      {data.nextAction && (
        <div className="flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4">
          <ArrowRight className="h-4 w-4 mt-0.5 text-primary" aria-hidden="true" />
          <div>
            <div className="text-xs uppercase tracking-wider text-primary">Próxima ação</div>
            <p className="text-sm text-foreground mt-0.5">{data.nextAction}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function NarrativeList({
  icon,
  title,
  items,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  items: string[];
  tone: "primary" | "emerald" | "rose";
}) {
  const toneClasses =
    tone === "emerald"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "rose"
        ? "text-rose-600 dark:text-rose-400"
        : "text-primary";
  return (
    <div className="rounded-xl border border-border bg-background/40 p-4">
      <div className={cn("flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider", toneClasses)}>
        {icon}
        {title}
      </div>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">Sem itens no período.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="text-sm text-foreground flex gap-2">
              <span className={cn("mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0", `bg-current ${toneClasses}`)} />
              <span className="text-muted-foreground">{it}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NarrativeSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-4 w-1/3 rounded bg-muted/50" />
      <div className="space-y-2">
        <div className="h-3 rounded bg-muted/50" />
        <div className="h-3 rounded bg-muted/50" />
        <div className="h-3 w-5/6 rounded bg-muted/50" />
        <div className="h-3 w-4/6 rounded bg-muted/50" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="h-28 rounded-xl bg-muted/40" />
        <div className="h-28 rounded-xl bg-muted/40" />
        <div className="h-28 rounded-xl bg-muted/40" />
      </div>
    </div>
  );
}

function NarrativeError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const friendly =
    message === "credits_exhausted"
      ? "Créditos de IA esgotados no workspace. Adicione créditos para gerar a análise."
      : message === "rate_limited"
        ? "Limite de requisições da IA atingido. Tente novamente em instantes."
        : message === "forbidden_role"
          ? "Apenas administradores podem gerar a análise executiva."
          : "Não foi possível gerar a análise agora.";
  return (
    <div className="flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4">
      <AlertCircle className="h-5 w-5 text-rose-500 mt-0.5" />
      <div className="flex-1">
        <p className="text-sm text-foreground">{friendly}</p>
        <button
          onClick={onRetry}
          className="mt-2 inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          Tentar novamente
        </button>
      </div>
    </div>
  );
}

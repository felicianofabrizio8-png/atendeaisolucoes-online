// src/components/goals/GoalsDashboard.tsx
import { useMemo, useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/auth/AuthContext";
import { useTeamAccess } from "@/hooks/useTeamAccess";
import { canManageGoals } from "@/lib/team/permissions";
import { useGoals } from "@/lib/goals/useGoals";
import { formatGoalValue, type Goal, type GoalDraft, type GoalProgress } from "@/lib/goals/model";
import type { GoalInsight, GoalStage } from "@/lib/goals/api";
import { MobileSection, MobileSections } from "@/components/layout/MobileSections";
import { MobileRail } from "@/components/layout/MobileRail";
import { SegmentedTabs } from "@/components/layout/MobileSections";
import "@/components/dashboard/dashboard.css";
import "./goals.css";
import { GoalCard } from "./GoalCard";
import { GoalFormModal } from "./GoalFormModal";
import { GoalKanban } from "./GoalKanban";
import { GoalListView } from "./GoalListView";
import { GoalWeekView } from "./GoalWeekView";
import { GoalEntryDialog } from "./GoalEntryDialog";
import { GoalsLumeCard } from "./GoalsLumeCard";

type View = "kanban" | "semana" | "lista";
const MONTH = new Intl.DateTimeFormat("pt-BR", { month: "long" });

export interface GoalsDashboardProps {
  goals: Goal[];
  progress: Map<string, GoalProgress>;
  stages: GoalStage[];
  insights: GoalInsight[];
  members: Array<{ id: string; name: string }>;
  me: string;
  canManage: boolean;
  onCreate: () => void;
  onOpen: (goal: Goal) => void;
  onMove: (goalId: string, stageId: string | null) => void;
  onSaveStage: (stage: Partial<GoalStage> & { name: string }) => void;
  onRemoveStage: (id: string, moveTo: string | null) => void;
  onApply: (insight: GoalInsight) => void;
  onDismiss: (insight: GoalInsight) => void;
  onEntry: (goal: Goal) => void;
}

export function GoalsDashboardView(props: GoalsDashboardProps) {
  const { goals, progress, insights, members, me, canManage } = props;
  const [view, setView] = useState<View>("kanban");
  const counts = useMemo(() => {
    const c = { no_ritmo: 0, em_risco: 0, atrasada: 0, concluida: 0 };
    for (const g of goals) {
      const s = progress.get(g.id)?.status;
      if (s && s in c) c[s as keyof typeof c] += 1;
    }
    return c;
  }, [goals, progress]);
  const overall = goals.length
    ? goals.reduce((s, g) => s + (progress.get(g.id)?.pct ?? 0), 0) / goals.length
    : 0;
  const order = {
    atrasada: 0,
    em_risco: 1,
    no_ritmo: 2,
    sem_dados: 3,
    concluida: 4,
    encerrada: 5,
  } as const;
  const highlights = [...goals]
    .sort(
      (a, b) =>
        order[progress.get(a.id)?.status ?? "sem_dados"] -
        order[progress.get(b.id)?.status ?? "sem_dados"],
    )
    .slice(0, 3);
  const mine = goals.filter((g) => g.scope === "empresa" || g.memberIds.includes(me));
  const ranking = useMemo(() => {
    const total = new Map<string, number>();
    for (const g of goals.filter((x) => x.scope === "empresa")) {
      for (const c of progress.get(g.id)?.contributions ?? [])
        total.set(c.userId, (total.get(c.userId) ?? 0) + c.value);
    }
    return [...total.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [goals, progress]);
  const firstCompany = goals.find((g) => g.scope === "empresa");
  const tips = insights.filter((i) => i.kind === "dica");

  return (
    <main className="lume-dashboard lume-goals min-h-full bg-background">
      <div className="mx-auto w-full max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Metas
            </p>
            <h1 className="gl-title">
              {canManage ? `Metas de ${MONTH.format(new Date())}` : "Suas metas"}
            </h1>
          </div>
          {canManage && (
            <button type="button" className="lq-primary" onClick={props.onCreate}>
              <Plus className="h-4 w-4" aria-hidden /> Nova meta
            </button>
          )}
        </header>

        {goals.length === 0 ? (
          <div className="gl-empty-hero">
            <Sparkles className="h-6 w-6 text-violet-300" aria-hidden />
            <p>{canManage ? "Crie a primeira meta da equipe." : "Ainda não há metas para você."}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <MobileRail
              breakpoint="md"
              label="Resumo"
              className="grid grid-cols-2 gap-3 lg:grid-cols-4"
            >
              <Stat label="No ritmo" value={counts.no_ritmo} tone="ok" />
              <Stat label="Em risco" value={counts.em_risco} tone="warn" />
              <Stat label="Atrasadas" value={counts.atrasada} tone="bad" />
              <Stat label="% geral" value={`${Math.round(overall)}%`} tone="ring" pct={overall} />
            </MobileRail>

            <GoalsLumeCard
              insights={insights.filter((i) => i.kind !== "dica")}
              tips={tips}
              goals={goals}
              canManage={canManage}
              onApply={props.onApply}
              onDismiss={props.onDismiss}
            />

            <MobileSections
              tabs={
                canManage
                  ? [
                      { id: "destaques", label: "Destaques" },
                      { id: "gestao", label: "Gestão" },
                    ]
                  : [
                      { id: "destaques", label: "Minhas" },
                      { id: "semana", label: "Semana" },
                    ]
              }
              label="Seções das metas"
            >
              <MobileSection id="destaques">
                <section aria-label="Destaques" className="grid gap-4 md:grid-cols-3">
                  {(canManage ? highlights : mine).map((goal) => (
                    <GoalCard
                      key={goal.id}
                      goal={goal}
                      progress={progress.get(goal.id)}
                      members={members}
                      onOpen={props.onOpen}
                      variant="highlight"
                      footer={
                        !canManage && goal.measure === "manual" && goal.memberIds.includes(me) ? (
                          <button
                            type="button"
                            className="lq-secondary relative z-[1]"
                            onClick={() => props.onEntry(goal)}
                          >
                            Lançar progresso
                          </button>
                        ) : null
                      }
                    />
                  ))}
                </section>
                {canManage && ranking.length > 0 && firstCompany && (
                  <section role="region" aria-label="Contribuição" className="gl-panel">
                    <h2 className="gl-panel-title">Contribuição nas metas da empresa</h2>
                    <ol className="space-y-2">
                      {ranking.map(([userId, value], index) => (
                        <li key={userId} className="flex items-center gap-3 text-sm">
                          <span className="gl-rank">{index + 1}</span>
                          <span className="min-w-0 flex-1 truncate">
                            {members.find((m) => m.id === userId)?.name ?? "ex-membro"}
                          </span>
                          <strong className="tabular-nums">
                            {formatGoalValue(value, firstCompany)}
                          </strong>
                        </li>
                      ))}
                    </ol>
                  </section>
                )}
              </MobileSection>

              {canManage ? (
                <MobileSection id="gestao">
                  <section aria-label="Gestão das metas" className="gl-panel">
                    <SegmentedTabs
                      label="Visão"
                      value={view}
                      onChange={(v) => setView(v as View)}
                      tabs={[
                        { id: "kanban", label: "Kanban" },
                        { id: "semana", label: "Semana" },
                        { id: "lista", label: "Lista" },
                      ]}
                    />
                    <div className="mt-4">
                      {view === "kanban" && (
                        <GoalKanban
                          goals={goals}
                          progress={progress}
                          stages={props.stages}
                          members={members}
                          canManage
                          onMove={props.onMove}
                          onOpen={props.onOpen}
                          onSaveStage={props.onSaveStage}
                          onRemoveStage={props.onRemoveStage}
                        />
                      )}
                      {view === "semana" && (
                        <GoalWeekView goals={goals} progress={progress} onOpen={props.onOpen} />
                      )}
                      {view === "lista" && (
                        <GoalListView
                          goals={goals}
                          progress={progress}
                          members={members}
                          onOpen={props.onOpen}
                        />
                      )}
                    </div>
                  </section>
                </MobileSection>
              ) : (
                <MobileSection id="semana">
                  <section aria-label="Minhas semanas" className="gl-panel">
                    <GoalWeekView goals={mine} progress={progress} onOpen={props.onOpen} />
                  </section>
                </MobileSection>
              )}
            </MobileSections>
          </div>
        )}
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
  tone,
  pct,
}: {
  label: string;
  value: number | string;
  tone: "ok" | "warn" | "bad" | "ring";
  pct?: number;
}) {
  return (
    <div className="gl-stat" data-tone={tone}>
      {tone === "ring" && (
        <span
          className="gl-ring"
          style={{ background: `conic-gradient(#a855f7 ${pct ?? 0}%, rgb(255 255 255 / 0.08) 0)` }}
          aria-hidden
        />
      )}
      <p className="gl-stat-label">{label}</p>
      <p className="gl-stat-value">{value}</p>
    </div>
  );
}

export function GoalsPage() {
  const { user } = useAuth();
  const access = useTeamAccess();
  const canManage = canManageGoals(access.access);
  const data = useGoals();
  const [editing, setEditing] = useState<Goal | null | undefined>(undefined);
  const [entryFor, setEntryFor] = useState<Goal | null>(null);
  const run = async (task: () => Promise<unknown>, done?: string) => {
    try {
      await task();
      if (done) toast.success(done);
      await data.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir.");
    }
  };

  if (data.ready === false)
    return (
      <div className="p-6 text-sm text-muted-foreground">
        As metas ficam disponíveis depois de publicar a atualização do banco.
      </div>
    );
  if (data.loading && !data.goals.length)
    return <div className="p-6 text-sm text-muted-foreground">Carregando metas…</div>;
  if (data.error)
    return (
      <div role="alert" className="p-6 text-sm text-destructive">
        {data.error}
      </div>
    );

  const save = (draft: GoalDraft) =>
    run(
      async () => {
        if (editing) await data.actions.update(editing.id, draft, data.companyId!);
        else await data.actions.create(draft, data.companyId!);
        setEditing(undefined);
      },
      editing ? "Meta atualizada" : "Meta criada",
    );

  return (
    <>
      <GoalsDashboardView
        goals={data.goals}
        progress={data.progress}
        stages={data.stages}
        insights={data.insights}
        members={data.members}
        me={user?.id ?? ""}
        canManage={canManage}
        onCreate={() => setEditing(null)}
        onOpen={(goal) =>
          canManage
            ? setEditing(goal)
            : goal.measure === "manual" && goal.memberIds.includes(user?.id ?? "")
              ? setEntryFor(goal)
              : undefined
        }
        onMove={(id, stageId) => void run(() => data.actions.move(id, stageId))}
        onSaveStage={(stage) => void run(() => data.actions.saveStage(stage, data.companyId!))}
        onRemoveStage={(id, moveTo) => void run(() => data.actions.removeStage(id, moveTo))}
        onApply={(i) => void run(() => data.actions.apply(i.id), "Sugestão aplicada")}
        onDismiss={(i) => void run(() => data.actions.dismiss(i.id))}
        onEntry={setEntryFor}
      />
      {editing !== undefined && (
        <GoalFormModal
          goal={editing}
          stages={data.stages}
          members={data.members}
          agendaReady={data.agendaReady}
          onClose={() => setEditing(undefined)}
          onSubmit={save}
        />
      )}
      {entryFor && (
        <GoalEntryDialog
          goal={entryFor}
          onClose={() => setEntryFor(null)}
          onSubmit={(amount, note) =>
            run(async () => {
              await data.actions.addEntry({
                goalId: entryFor.id,
                periodId: data.progress.get(entryFor.id)!.periodId,
                amount,
                note,
                companyId: data.companyId!,
              });
              setEntryFor(null);
            }, "Progresso lançado")
          }
        />
      )}
    </>
  );
}

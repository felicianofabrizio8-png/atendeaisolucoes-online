// src/lib/goals/useGoals.ts
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useTeamDirectory, type TeamMember } from "@/components/agenda/useTeamDirectory";
import { goalsApi, type GoalInsight, type GoalStage } from "./api";
import { buildProgress, todayInSaoPaulo, type Goal, type GoalProgress } from "./model";

type AgendaProbe = {
  from: (t: string) => {
    select: (c: string) => { limit: (n: number) => Promise<{ error: unknown }> };
  };
};

export function useGoals() {
  const { company } = useAuth();
  const companyId = company?.id ?? null;
  const [ready, setReady] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Indicador "compromissos concluídos" só existe com a migração da Agenda.
  const [agendaReady, setAgendaReady] = useState(false);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [rawProgress, setRawProgress] = useState<Awaited<ReturnType<typeof goalsApi.progress>>>([]);
  const [stages, setStages] = useState<GoalStage[]>([]);
  const [insights, setInsights] = useState<GoalInsight[]>([]);
  const members: TeamMember[] = useTeamDirectory(true);

  const reload = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const ok = await goalsApi.schemaReady();
      setReady(ok);
      if (!ok) return;
      const agenda = await (supabase as unknown as AgendaProbe)
        .from("agenda_tags")
        .select("id")
        .limit(1);
      setAgendaReady(!agenda.error);
      const [g, p, s, i] = await Promise.all([
        goalsApi.list(companyId),
        goalsApi.progress(),
        goalsApi.stages(companyId),
        goalsApi.insights(companyId),
      ]);
      setGoals(g);
      setRawProgress(p);
      setStages(s);
      setInsights(i);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar as metas.");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const progress = useMemo(() => {
    const today = todayInSaoPaulo();
    const map = new Map<string, GoalProgress>();
    for (const raw of rawProgress) {
      const goal = goals.find((g) => g.id === raw.goalId);
      if (goal) map.set(goal.id, buildProgress(goal, raw, today));
    }
    return map;
  }, [goals, rawProgress]);

  return {
    companyId,
    ready,
    agendaReady,
    loading,
    error,
    goals,
    progress,
    stages,
    insights,
    members,
    reload,
    actions: goalsApi,
  };
}

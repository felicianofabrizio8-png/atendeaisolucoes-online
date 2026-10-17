// src/lib/goals/api.ts
import { supabase } from "@/integrations/supabase/client";
import { METRICS, type Goal, type GoalDraft, type GoalMetric, type GoalProgressRaw } from "./model";

export interface GoalStage {
  id: string;
  name: string;
  hue: number;
  position: number;
}
export type GoalAction =
  | { type: "ajustar_alvo"; goalId: string; target: number }
  | { type: "ajustar_prazo"; goalId: string; endsOn: string }
  | { type: "mover_etapa"; goalId: string; stageId: string };
export interface GoalInsight {
  id: string;
  kind: "resumo" | "atencao" | "sugestao" | "dica";
  goalId: string | null;
  body: string;
  action: GoalAction | null;
  state: "pendente" | "aplicada" | "dispensada";
  generatedOn: string;
}

export interface GoalRow {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  hue: number;
  measure: "automatica" | "manual";
  metric: string | null;
  target: string | number;
  unit: string | null;
  lower_is_better: boolean;
  scope: "empresa" | "pessoa" | "grupo";
  starts_on: string;
  ends_on: string | null;
  recurrence: "semanal" | "mensal" | null;
  stage_id: string | null;
  archived_at: string | null;
}
export interface ProgressRow {
  goal_id: string;
  period_id: string;
  period_start: string;
  period_end: string;
  value: string | number | null;
  weeks: Array<{ startsOn: string; endsOn: string; actual: string | number | null }>;
  contributions: Array<{ userId: string; value: string | number }>;
}

const num = (v: string | number | null) => (v === null ? null : Number(v));
// As novas tabelas ainda não estão nos tipos gerados do Supabase; o cliente
// fica sem tipo aqui e cada função converte o resultado com tipo explícito.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Untyped = any;
const db = supabase as unknown as {
  from: (t: string) => Untyped;
  rpc: (f: string, a?: object) => Untyped;
};

export function mapGoalRow(row: GoalRow, members: string[]): Goal {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    description: row.description,
    hue: row.hue,
    measure: row.measure,
    metric: row.metric as GoalMetric | null,
    target: Number(row.target),
    unit: row.unit,
    lowerIsBetter: row.lower_is_better,
    scope: row.scope,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    recurrence: row.recurrence,
    stageId: row.stage_id,
    archivedAt: row.archived_at,
    memberIds: members,
  };
}

export function mapProgressRow(row: ProgressRow): GoalProgressRaw {
  return {
    goalId: row.goal_id,
    periodId: row.period_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    value: num(row.value),
    weeks: (row.weeks ?? []).map((w) => ({
      startsOn: w.startsOn,
      endsOn: w.endsOn,
      actual: num(w.actual),
    })),
    contributions: (row.contributions ?? []).map((c) => ({
      userId: c.userId,
      value: Number(c.value),
    })),
  };
}

export function draftToRow(draft: GoalDraft, companyId: string) {
  const automatic = draft.measure === "automatica";
  return {
    company_id: companyId,
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    hue: draft.hue,
    measure: draft.measure,
    metric: automatic ? draft.metric : null,
    target: draft.target,
    unit: automatic ? null : draft.unit.trim(),
    lower_is_better: automatic && draft.metric ? METRICS[draft.metric].lowerIsBetter : false,
    scope: draft.scope,
    starts_on: draft.startsOn,
    ends_on: draft.deadline === "unico" ? draft.endsOn : null,
    recurrence: draft.deadline === "recorrente" ? draft.recurrence : null,
    stage_id: draft.stageId,
  };
}

function check<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

async function setMembers(goalId: string, memberIds: string[]) {
  check(await db.from("goal_members").delete().eq("goal_id", goalId));
  if (memberIds.length)
    check(
      await db
        .from("goal_members")
        .insert(memberIds.map((user_id) => ({ goal_id: goalId, user_id }))),
    );
}

export const goalsApi = {
  async schemaReady(): Promise<boolean> {
    const { error } = await db.from("goals").select("id").limit(1);
    return !error;
  },
  async list(companyId: string): Promise<Goal[]> {
    const rows = check<GoalRow[]>(
      await db
        .from("goals")
        .select("*")
        .eq("company_id", companyId)
        .is("archived_at", null)
        .order("created_at"),
    );
    const links = check<Array<{ goal_id: string; user_id: string }>>(
      await db
        .from("goal_members")
        .select("goal_id,user_id")
        .in(
          "goal_id",
          rows.map((r) => r.id),
        ),
    );
    return rows.map((row) =>
      mapGoalRow(
        row,
        links.filter((l) => l.goal_id === row.id).map((l) => l.user_id),
      ),
    );
  },
  async progress(): Promise<GoalProgressRaw[]> {
    return check<ProgressRow[]>(await db.rpc("goals_progress", {})).map(mapProgressRow);
  },
  async stages(companyId: string): Promise<GoalStage[]> {
    return check<GoalStage[]>(
      await db
        .from("goal_stages")
        .select("id,name,hue,position")
        .eq("company_id", companyId)
        .order("position"),
    );
  },
  async insights(companyId: string): Promise<GoalInsight[]> {
    type InsightRow = {
      id: string;
      kind: GoalInsight["kind"];
      goal_id: string | null;
      body: string;
      action: GoalAction | null;
      state: GoalInsight["state"];
      generated_on: string;
    };
    const rows = check<InsightRow[]>(
      await db
        .from("goal_insights")
        .select("id,kind,goal_id,body,action,state,generated_on")
        .eq("company_id", companyId)
        .order("generated_on", { ascending: false })
        .limit(40),
    );
    const latest = rows[0]?.generated_on;
    return rows
      .filter((r) => r.generated_on === latest || r.state === "pendente")
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        goalId: r.goal_id,
        body: r.body,
        action: r.action,
        state: r.state,
        generatedOn: r.generated_on,
      }));
  },
  async create(draft: GoalDraft, companyId: string): Promise<string> {
    const row = check<{ id: string }>(
      await db.from("goals").insert(draftToRow(draft, companyId)).select("id").single(),
    );
    await setMembers(row.id, draft.scope === "empresa" ? [] : draft.memberIds);
    return row.id;
  },
  async update(id: string, draft: GoalDraft, companyId: string) {
    check(await db.from("goals").update(draftToRow(draft, companyId)).eq("id", id));
    await setMembers(id, draft.scope === "empresa" ? [] : draft.memberIds);
  },
  async archive(id: string) {
    check(await db.from("goals").update({ archived_at: new Date().toISOString() }).eq("id", id));
  },
  async remove(id: string) {
    check(await db.from("goals").delete().eq("id", id));
  },
  async move(id: string, stageId: string | null) {
    check(await db.from("goals").update({ stage_id: stageId }).eq("id", id));
  },
  async saveStage(stage: Partial<GoalStage> & { name: string }, companyId: string) {
    if (stage.id)
      check(
        await db
          .from("goal_stages")
          .update({ name: stage.name, hue: stage.hue, position: stage.position })
          .eq("id", stage.id),
      );
    else
      check(
        await db.from("goal_stages").insert({
          company_id: companyId,
          name: stage.name,
          hue: stage.hue ?? 275,
          position: stage.position ?? 0,
        }),
      );
  },
  async removeStage(id: string, moveTo: string | null) {
    check(await db.from("goals").update({ stage_id: moveTo }).eq("stage_id", id));
    check(await db.from("goal_stages").delete().eq("id", id));
  },
  async addEntry(input: {
    goalId: string;
    periodId: string;
    amount: number;
    note: string;
    companyId: string;
  }) {
    check(
      await db.from("goal_entries").insert({
        company_id: input.companyId,
        goal_id: input.goalId,
        period_id: input.periodId,
        amount: input.amount,
        note: input.note.trim() || null,
      }),
    );
  },
  async apply(insightId: string) {
    check(await db.rpc("goals_apply_insight", { _insight: insightId }));
  },
  async dismiss(insightId: string) {
    check(await db.rpc("goals_dismiss_insight", { _insight: insightId }));
  },
};

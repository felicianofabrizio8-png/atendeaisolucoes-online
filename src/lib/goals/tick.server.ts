// src/lib/goals/tick.server.ts
import { analyzeGoals, loadGoalsContext, type SupabaseLike } from "./ai.server";
import { mapGoalRow, mapProgressRow, type GoalRow, type ProgressRow } from "./api";
import { buildProgress } from "./model";

/**
 * Uma passada por dia: fecha/abre períodos, grava a foto de cada meta e
 * substitui a análise da Lume do dia. Idempotente no mesmo dia: fotos têm
 * chave (meta, período, dia) e a análise do dia é apagada antes de gravar.
 */
export async function runGoalsTick(
  admin: SupabaseLike,
  opts: { today: string; analyze?: typeof analyzeGoals },
) {
  const analyze = opts.analyze ?? analyzeGoals;
  const result = { companies: 0, snapshots: 0, closed: 0, analyzed: 0, failures: 0 };
  const rolled = await admin.rpc("goals_roll_periods", { _today: opts.today });
  result.closed = Number(rolled.data ?? 0);

  const all: GoalRow[] = (await admin.from("goals").select("*").is("archived_at", null)).data ?? [];
  const companies = [...new Set(all.map((g) => g.company_id))];
  for (const companyId of companies) {
    result.companies += 1;
    try {
      const rows = all.filter((g) => g.company_id === companyId);
      const links: Array<{ goal_id: string; user_id: string }> =
        (
          await admin
            .from("goal_members")
            .select("goal_id,user_id")
            .in(
              "goal_id",
              rows.map((r) => r.id),
            )
        ).data ?? [];
      const progress: ProgressRow[] =
        (
          await admin.rpc("goals_progress_for", {
            _company: companyId,
            _check: false,
            _goal_ids: null,
          })
        ).data ?? [];
      const snapshots = progress.flatMap((raw) => {
        const row = rows.find((r) => r.id === raw.goal_id);
        if (!row) return [];
        const goal = mapGoalRow(
          row,
          links.filter((l) => l.goal_id === row.id).map((l) => l.user_id),
        );
        const p = buildProgress(goal, mapProgressRow(raw), opts.today);
        return [
          {
            goal_id: goal.id,
            period_id: p.periodId,
            day: opts.today,
            value: p.value,
            expected: p.expected,
            status: p.status,
          },
        ];
      });
      if (snapshots.length) {
        await admin
          .from("goal_snapshots")
          .upsert(snapshots, { onConflict: "goal_id,period_id,day" });
        result.snapshots += snapshots.length;
      }
      const ctx = await loadGoalsContext(admin, companyId, opts.today, { service: true });
      const analysis = await analyze(ctx);
      await admin
        .from("goal_insights")
        .delete()
        .eq("company_id", companyId)
        .eq("generated_on", opts.today);
      const insights = [
        ...(analysis.resumo
          ? [{ kind: "resumo", goal_id: null, user_id: null, body: analysis.resumo, action: null }]
          : []),
        ...analysis.atencao.map((a) => ({
          kind: "atencao",
          goal_id: a.goalId,
          user_id: null,
          body: a.body,
          action: null,
        })),
        ...analysis.sugestoes.map((s) => ({
          kind: "sugestao",
          goal_id: s.goalId,
          user_id: null,
          body: s.body,
          action: s.action,
        })),
        ...analysis.dicas.map((d) => ({
          kind: "dica",
          goal_id: null,
          user_id: d.userId,
          body: d.body,
          action: null,
        })),
      ].map((i) => ({ ...i, company_id: companyId, generated_on: opts.today, state: "pendente" }));
      if (insights.length) await admin.from("goal_insights").insert(insights);
      result.analyzed += 1;
    } catch (error) {
      result.failures += 1;
      console.error("[goals-tick]", {
        companyId: companyId.slice(0, 8),
        error: error instanceof Error ? error.message : "erro",
      });
    }
  }
  return result;
}

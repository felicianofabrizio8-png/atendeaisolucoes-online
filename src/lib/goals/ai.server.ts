// src/lib/goals/ai.server.ts
import { z } from "zod";
import { resolveLumeLlmConfig } from "@/lib/lume/config.server";
import { mapGoalRow, mapProgressRow, type GoalAction, type GoalRow, type ProgressRow } from "./api";
import { buildProgress, formatGoalValue, METRICS, STATUS_LABEL } from "./model";

export interface GoalsContext {
  today: string;
  goals: Array<{
    id: string;
    name: string;
    indicator: string;
    target: string;
    value: string;
    expected: string;
    status: string;
    weeks: Array<{ range: string; actual: string; expected: string }>;
    people: Array<{ userId: string; name: string; value: string }>;
  }>;
  stages: Array<{ id: string; name: string }>;
  members: Array<{ id: string; name: string }>;
}

const Analysis = z.object({
  resumo: z.string().max(400).catch(""),
  atencao: z.array(z.object({ goalId: z.string(), body: z.string().max(400) })).catch([]),
  sugestoes: z
    .array(
      z.object({
        goalId: z.string(),
        body: z.string().max(400),
        action: z
          .object({
            type: z.string(),
            target: z.number().positive().optional(),
            endsOn: z.string().optional(),
            stageId: z.string().optional(),
          })
          .nullable()
          .optional(),
      }),
    )
    .catch([]),
  dicas: z.array(z.object({ userId: z.string(), body: z.string().max(400) })).catch([]),
});

export function parseGoalsAnalysis(raw: unknown, ctx: GoalsContext) {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      value = {};
    }
  }
  const parsed = Analysis.safeParse(value);
  const data = parsed.success ? parsed.data : { resumo: "", atencao: [], sugestoes: [], dicas: [] };
  const goalIds = new Set(ctx.goals.map((g) => g.id));
  const stageIds = new Set(ctx.stages.map((s) => s.id));
  const memberIds = new Set(ctx.members.map((m) => m.id));
  const toAction = (
    goalId: string,
    a: z.infer<typeof Analysis>["sugestoes"][number]["action"],
  ): GoalAction | null | undefined => {
    if (!a || a.type === "foco_semana") return null;
    if (a.type === "ajustar_alvo" && a.target)
      return { type: "ajustar_alvo", goalId, target: a.target };
    if (
      a.type === "ajustar_prazo" &&
      a.endsOn &&
      /^\d{4}-\d{2}-\d{2}$/.test(a.endsOn) &&
      a.endsOn >= ctx.today
    )
      return { type: "ajustar_prazo", goalId, endsOn: a.endsOn };
    if (a.type === "mover_etapa" && a.stageId && stageIds.has(a.stageId))
      return { type: "mover_etapa", goalId, stageId: a.stageId };
    return undefined; // ação inválida: descarta a sugestão
  };
  return {
    resumo: data.resumo.trim(),
    atencao: data.atencao.filter((a) => goalIds.has(a.goalId)),
    sugestoes: data.sugestoes.flatMap((s) => {
      if (!goalIds.has(s.goalId)) return [];
      const action = toAction(s.goalId, s.action);
      return action === undefined ? [] : [{ goalId: s.goalId, body: s.body, action }];
    }),
    dicas: data.dicas.filter((d) => memberIds.has(d.userId)),
  };
}

const SYSTEM = `Você é a Lume, assistente de metas de uma equipe de vendas e atendimento.
Responda SEMPRE em JSON com as chaves: resumo (até 2 frases), atencao [{goalId, body}],
sugestoes [{goalId, body, action}] e dicas [{userId, body}].
action é um destes: {"type":"ajustar_alvo","target":número}, {"type":"ajustar_prazo","endsOn":"AAAA-MM-DD"},
{"type":"mover_etapa","stageId":"id de uma etapa listada"} ou {"type":"foco_semana"} (sem alteração).
Use só números presentes no contexto. Seja direto, em português do Brasil, sem jargão.
dicas: no máximo uma por pessoa, só sobre as metas dela, com algo que dá para fazer hoje.`;

async function callModel(
  messages: Array<{ role: string; content: string }>,
  fetchImpl: typeof fetch,
  json: boolean,
) {
  const config = resolveLumeLlmConfig();
  if (!config) throw new Error("A IA Lume ainda não está configurada. Falta a chave de API.");
  const response = await fetchImpl(config.endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      messages,
      max_completion_tokens: 1200,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error("A Lume não conseguiu analisar as metas agora.");
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return body.choices?.[0]?.message?.content ?? "";
}

export async function analyzeGoals(ctx: GoalsContext, fetchImpl: typeof fetch = fetch) {
  const content = await callModel(
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Hoje é ${ctx.today}. Contexto:\n${JSON.stringify(ctx)}` },
    ],
    fetchImpl,
    true,
  );
  return parseGoalsAnalysis(content, ctx);
}

export async function askGoals(
  question: string,
  ctx: GoalsContext,
  fetchImpl: typeof fetch = fetch,
) {
  const answer = await callModel(
    [
      {
        role: "system",
        content:
          "Você é a Lume. Responda sobre as metas abaixo em até 6 frases, em português do Brasil, usando só os números do contexto. Se não souber, diga o que falta.",
      },
      {
        role: "user",
        content: `Hoje é ${ctx.today}. Metas:\n${JSON.stringify(ctx)}\n\nPergunta: ${question.slice(0, 1000)}`,
      },
    ],
    fetchImpl,
    false,
  );
  return { answer: answer.trim() || "Não consegui responder agora." };
}

// Cliente do Supabase (sessão da pessoa ou chave de serviço). As tabelas de
// metas ainda não estão nos tipos gerados; cada leitura converte com tipo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Untyped = any;
export type SupabaseLike = {
  from: (t: string) => Untyped;
  rpc: (f: string, a?: object) => Untyped;
};

export async function loadGoalsContext(
  client: SupabaseLike,
  companyId: string,
  today: string,
  opts: { service: boolean },
): Promise<GoalsContext> {
  const rows: GoalRow[] =
    (await client.from("goals").select("*").eq("company_id", companyId).is("archived_at", null))
      .data ?? [];
  const links: Array<{ goal_id: string; user_id: string }> = rows.length
    ? ((
        await client
          .from("goal_members")
          .select("goal_id,user_id")
          .in(
            "goal_id",
            rows.map((r) => r.id),
          )
      ).data ?? [])
    : [];
  const progressRows: ProgressRow[] =
    (opts.service
      ? await client.rpc("goals_progress_for", {
          _company: companyId,
          _check: false,
          _goal_ids: null,
        })
      : await client.rpc("goals_progress", {})
    ).data ?? [];
  const stages: Array<{ id: string; name: string }> =
    (await client.from("goal_stages").select("id,name").eq("company_id", companyId)).data ?? [];
  const people: Array<{ id: string; display_name: string | null }> =
    (await client.from("profiles").select("id,display_name").eq("company_id", companyId)).data ??
    [];
  const members = people.map((p) => ({ id: p.id, name: p.display_name ?? "Sem nome" }));
  const goals = rows.flatMap((row) => {
    const goal = mapGoalRow(
      row,
      links.filter((l) => l.goal_id === row.id).map((l) => l.user_id),
    );
    const raw = progressRows.find((p) => p.goal_id === row.id);
    if (!raw) return [];
    const p = buildProgress(goal, mapProgressRow(raw), today);
    return [
      {
        id: goal.id,
        name: goal.name,
        indicator:
          goal.measure === "automatica" && goal.metric
            ? METRICS[goal.metric].label
            : `À mão (${goal.unit})`,
        target: formatGoalValue(goal.target, goal),
        value: formatGoalValue(p.value, goal),
        expected: formatGoalValue(p.expected, goal),
        status: STATUS_LABEL[p.status],
        weeks: p.weeks
          .filter((w) => w.actual !== null)
          .map((w) => ({
            range: `${w.startsOn}..${w.endsOn}`,
            actual: formatGoalValue(w.actual, goal),
            expected: formatGoalValue(w.expected, goal),
          })),
        people: p.contributions.map((c) => ({
          userId: c.userId,
          name: members.find((m) => m.id === c.userId)?.name ?? "ex-membro",
          value: formatGoalValue(c.value, goal),
        })),
      },
    ];
  });
  return { today, goals, stages, members };
}

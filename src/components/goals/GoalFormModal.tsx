// src/components/goals/GoalFormModal.tsx
import { useMemo, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ArrowLeft, ArrowRight, Target, X } from "lucide-react";
import "@/components/orcamentos/quotes.css";
import "@/components/auth/auth-dialog.css";
import {
  METRICS,
  formatGoalValue,
  splitWeeks,
  todayInSaoPaulo,
  validateGoalDraft,
  type Goal,
  type GoalDraft,
  type GoalMetric,
} from "@/lib/goals/model";
import type { GoalStage } from "@/lib/goals/api";

interface Member {
  id: string;
  name: string;
}
const HUES = [275, 300, 250, 200, 160, 40, 10];

export function emptyDraft(today: string = todayInSaoPaulo()): GoalDraft {
  const [y, m] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return {
    name: "",
    description: "",
    hue: 275,
    measure: "automatica",
    metric: null,
    target: 0,
    unit: "",
    scope: "empresa",
    memberIds: [],
    deadline: "unico",
    startsOn: `${today.slice(0, 7)}-01`,
    endsOn: last,
    recurrence: "mensal",
    stageId: null,
  };
}

export function goalToDraft(goal: Goal): GoalDraft {
  return {
    name: goal.name,
    description: goal.description ?? "",
    hue: goal.hue,
    measure: goal.measure,
    metric: goal.metric,
    target: goal.target,
    unit: goal.unit ?? "",
    scope: goal.scope,
    memberIds: goal.memberIds,
    deadline: goal.recurrence ? "recorrente" : "unico",
    startsOn: goal.startsOn,
    endsOn: goal.endsOn ?? goal.startsOn,
    recurrence: goal.recurrence ?? "mensal",
    stageId: goal.stageId,
  };
}

const STEP_FIELDS: Array<(errors: string[]) => string[]> = [
  (e) => e.filter((m) => /nome|alvo|medir|unidade/i.test(m)),
  (e) => e.filter((m) => /pessoa|grupo|data|início|fim/i.test(m)),
  (e) => e,
];

export function GoalFormModal({
  goal,
  stages,
  members,
  agendaReady,
  onClose,
  onSubmit,
}: {
  goal?: Goal | null;
  stages: GoalStage[];
  members: Member[];
  agendaReady: boolean;
  onClose: () => void;
  onSubmit: (draft: GoalDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<GoalDraft>(() => (goal ? goalToDraft(goal) : emptyDraft()));
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof GoalDraft>(key: K, value: GoalDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const metrics = (Object.keys(METRICS) as GoalMetric[]).filter(
    (m) => agendaReady || !METRICS[m].needsAgenda,
  );

  const weeks = useMemo(() => {
    const endsOn = draft.deadline === "unico" ? draft.endsOn : draft.startsOn;
    if (!draft.startsOn || !endsOn || !(draft.target > 0) || endsOn < draft.startsOn) return [];
    const lower =
      draft.measure === "automatica" && draft.metric ? METRICS[draft.metric].lowerIsBetter : false;
    return splitWeeks({ startsOn: draft.startsOn, endsOn }, draft.target, lower);
  }, [draft]);

  const next = async () => {
    const found = STEP_FIELDS[step](validateGoalDraft(draft));
    setErrors(found);
    if (found.length) return;
    if (step < 2) return setStep(step + 1);
    setSaving(true);
    try {
      await onSubmit(draft);
    } catch (e) {
      setErrors([e instanceof Error ? e.message : "Não foi possível salvar a meta."]);
    } finally {
      setSaving(false);
    }
  };

  const fakeGoal = { measure: draft.measure, metric: draft.metric, unit: draft.unit || null };
  const toggleMember = (id: string) =>
    set(
      "memberIds",
      draft.scope === "pessoa"
        ? [id]
        : draft.memberIds.includes(id)
          ? draft.memberIds.filter((m) => m !== id)
          : [...draft.memberIds, id],
    );

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="auth-dialog-overlay fixed inset-0 z-50 bg-black/70 backdrop-blur-[6px]" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="auth-dialog-content lq-black lq-panel lq-form fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-[560px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-6 text-white outline-none max-sm:inset-0 max-sm:h-[100dvh] max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:p-8"
        >
          <span className="lq-panel-glow" aria-hidden="true" />
          <DialogPrimitive.Close aria-label="Fechar" className="lq-close absolute right-4 top-4">
            <X className="h-4 w-4" aria-hidden />
          </DialogPrimitive.Close>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-200/70">
            Passo {step + 1} de 3
          </p>
          <DialogPrimitive.Title className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Target className="h-5 w-5 text-violet-300" aria-hidden />
            {goal ? "Editar meta" : "Nova meta"}
          </DialogPrimitive.Title>

          {step === 0 && (
            <div className="mt-6 space-y-4">
              <label className="lq-field-label block">
                Nome da meta
                <input
                  className="quote-form-input auth-lume-field"
                  value={draft.name}
                  maxLength={120}
                  onChange={(e) => set("name", e.target.value)}
                />
              </label>
              <label className="lq-field-label block">
                Descrição (opcional)
                <textarea
                  className="quote-form-input auth-lume-field"
                  rows={2}
                  value={draft.description}
                  maxLength={600}
                  onChange={(e) => set("description", e.target.value)}
                />
              </label>
              <div role="radiogroup" aria-label="Cor" className="flex gap-2">
                {HUES.map((hue) => (
                  <button
                    key={hue}
                    type="button"
                    role="radio"
                    aria-checked={draft.hue === hue}
                    aria-label={`Cor ${hue}`}
                    onClick={() => set("hue", hue)}
                    className="h-8 w-8 rounded-full ring-offset-2 ring-offset-black aria-checked:ring-2 aria-checked:ring-white"
                    style={{ background: `oklch(0.66 0.17 ${hue})` }}
                  />
                ))}
              </div>
              <div role="radiogroup" aria-label="Como medir" className="lq-chips lq-chips-lg">
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft.measure === "automatica"}
                  onClick={() => set("measure", "automatica")}
                >
                  Medir pelo sistema
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft.measure === "manual"}
                  onClick={() => set("measure", "manual")}
                >
                  Atualizar à mão
                </button>
              </div>
              {draft.measure === "automatica" ? (
                <div role="radiogroup" aria-label="Indicador" className="lq-chips">
                  {metrics.map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={draft.metric === m}
                      onClick={() => set("metric", m)}
                    >
                      {METRICS[m].label}
                    </button>
                  ))}
                </div>
              ) : (
                <label className="lq-field-label block">
                  Unidade
                  <input
                    className="quote-form-input auth-lume-field"
                    value={draft.unit}
                    maxLength={24}
                    placeholder="visitas, posts, treinamentos…"
                    onChange={(e) => set("unit", e.target.value)}
                  />
                </label>
              )}
              <label className="lq-field-label block">
                Alvo
                <input
                  className="quote-form-input auth-lume-field"
                  inputMode="decimal"
                  value={draft.target || ""}
                  onChange={(e) => set("target", Number(e.target.value.replace(",", ".")) || 0)}
                />
              </label>
              {draft.metric &&
                METRICS[draft.metric].lowerIsBetter &&
                draft.measure === "automatica" && (
                  <p className="text-xs text-white/55">
                    Neste indicador, menor é melhor: o alvo é o máximo aceitável.
                  </p>
                )}
            </div>
          )}

          {step === 1 && (
            <div className="mt-6 space-y-4">
              <div role="radiogroup" aria-label="Alcance" className="lq-chips lq-chips-lg">
                {(["empresa", "pessoa", "grupo"] as const).map((scope) => (
                  <button
                    key={scope}
                    type="button"
                    role="radio"
                    aria-checked={draft.scope === scope}
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        scope,
                        memberIds: scope === "pessoa" ? d.memberIds.slice(0, 1) : d.memberIds,
                      }))
                    }
                  >
                    {scope === "empresa" ? "Empresa" : scope === "pessoa" ? "Pessoa" : "Grupo"}
                  </button>
                ))}
              </div>
              {draft.scope !== "empresa" && (
                <div className="lq-chips" role="group" aria-label="Pessoas">
                  {members.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={draft.memberIds.includes(m.id)}
                      onClick={() => toggleMember(m.id)}
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
              )}
              <div role="radiogroup" aria-label="Prazo" className="lq-chips lq-chips-lg">
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft.deadline === "unico"}
                  onClick={() => set("deadline", "unico")}
                >
                  Prazo único
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft.deadline === "recorrente"}
                  onClick={() => set("deadline", "recorrente")}
                >
                  Repetir
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="lq-field-label block">
                  Início
                  <input
                    type="date"
                    className="quote-form-input auth-lume-field"
                    value={draft.startsOn}
                    onChange={(e) => set("startsOn", e.target.value)}
                  />
                </label>
                {draft.deadline === "unico" ? (
                  <label className="lq-field-label block">
                    Fim
                    <input
                      type="date"
                      className="quote-form-input auth-lume-field"
                      value={draft.endsOn}
                      onChange={(e) => set("endsOn", e.target.value)}
                    />
                  </label>
                ) : (
                  <div role="radiogroup" aria-label="Repetição" className="lq-chips self-end">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={draft.recurrence === "semanal"}
                      onClick={() => set("recurrence", "semanal")}
                    >
                      Toda semana
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={draft.recurrence === "mensal"}
                      onClick={() => set("recurrence", "mensal")}
                    >
                      Todo mês
                    </button>
                  </div>
                )}
              </div>
              {stages.length > 0 && (
                <label className="lq-field-label block">
                  Etapa
                  <select
                    className="quote-form-input auth-lume-field"
                    value={draft.stageId ?? ""}
                    onChange={(e) => set("stageId", e.target.value || null)}
                  >
                    <option value="">Sem etapa</option>
                    {stages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="mt-6 space-y-4">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-lg font-semibold">{draft.name}</p>
                <p className="mt-1 text-sm text-white/60">
                  {draft.measure === "automatica" && draft.metric
                    ? METRICS[draft.metric].label
                    : "Atualizada à mão"}{" "}
                  · alvo {formatGoalValue(draft.target, fakeGoal)}
                </p>
                {weeks.length > 0 && (
                  <p className="mt-3 text-sm text-violet-200">
                    ≈{" "}
                    {formatGoalValue(Math.round((draft.target / weeks.length) * 10) / 10, fakeGoal)}{" "}
                    por semana ({weeks.length} semanas)
                  </p>
                )}
                {draft.deadline === "recorrente" && (
                  <p className="mt-1 text-sm text-white/60">
                    Renova {draft.recurrence === "semanal" ? "toda semana" : "todo mês"} com o mesmo
                    alvo.
                  </p>
                )}
              </div>
            </div>
          )}

          {errors.length > 0 && (
            <div
              role="alert"
              className="mt-4 rounded-2xl border border-red-300/20 bg-red-300/10 px-4 py-3 text-xs leading-5 text-red-100"
            >
              {errors.map((e) => (
                <p key={e}>{e}</p>
              ))}
            </div>
          )}

          <div className="mt-6 flex gap-2">
            {step > 0 && (
              <button
                type="button"
                className="lq-secondary"
                onClick={() => {
                  setErrors([]);
                  setStep(step - 1);
                }}
              >
                <ArrowLeft className="h-4 w-4" aria-hidden /> Voltar
              </button>
            )}
            <button
              type="button"
              className="lq-primary ml-auto"
              disabled={saving}
              onClick={() => void next()}
            >
              {step < 2 ? "Continuar" : goal ? "Salvar meta" : "Criar meta"}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

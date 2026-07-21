// Card de uma proposal — cabeçalho, corpo completo (seções recolhíveis),
// edição restrita aos campos aceitos pelo contrato de updateCoachProposalFn,
// dialogs de confirmar/descartar e banners de erro.
//
// Campos EDITÁVEIS (contrato updateCoachProposalFn):
//   title (3-120), instruction (3-2000), priority (0-100, int),
//   scope_kind ('company' | 'channel'), scope_ref.channel (enum de canais).
// Campos SOMENTE LEITURA:
//   category, rule_type, status, confidence, risk_level, warnings,
//   normalized_output.* (condition, examples, rationale, ambiguities,
//   missing_information, duplicate_warning), created_at.
// Campos NÃO SUPORTADOS pelo contrato atual (exibidos como read-only quando
// existirem no normalized_output; edição bloqueada pela UI):
//   rationale, condition, examples, ambiguities, missing_information,
//   category, rule_type.
import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Loader2,
  Pencil,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  COACH_CATEGORY_LABEL,
  COACH_TYPE_LABEL,
  type CoachRuleCategory,
  type CoachRuleType,
} from "@/lib/coach-rules/coach-rules.repository";
import {
  confirmCoachProposalFn,
  discardCoachProposalFn,
  updateCoachProposalFn,
} from "@/lib/coach-interpreter/coach-interpreter.functions";
import {
  COACH_INTERPRETER_CHANNELS,
  COACH_INTERPRETER_SCOPES,
} from "@/lib/coach-interpreter/schema";
import { getSafeInterpreterError } from "@/lib/coach-interpreter/errors";
import type { ProposalRow } from "./types";
import { ProposalStatusBadge } from "./status-badges";
import { ErrorBanner } from "./error-banner";
import { formatDateTime } from "./helpers";

// ---------------------------------------------------------------------------
// Helpers de leitura defensiva do normalized_output.
// ---------------------------------------------------------------------------

type Normalized = {
  condition?: string;
  examples?: string[];
  rationale?: string;
  ambiguities?: string[];
  missing_information?: string[];
  duplicate_warning?: { rule_id?: string; title?: string; reason?: string } | null;
};

function readNormalized(raw: unknown): Normalized {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const asString = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v : undefined;
  const asStringArray = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : undefined;
  const dupRaw = o.duplicate_warning;
  const duplicate_warning =
    dupRaw && typeof dupRaw === "object"
      ? (dupRaw as { rule_id?: string; title?: string; reason?: string })
      : undefined;
  return {
    condition: asString(o.condition),
    examples: asStringArray(o.examples),
    rationale: asString(o.rationale),
    ambiguities: asStringArray(o.ambiguities),
    missing_information: asStringArray(o.missing_information),
    duplicate_warning: duplicate_warning ?? null,
  };
}

function readScopeChannel(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const ch = (raw as Record<string, unknown>).channel;
  return typeof ch === "string" && ch.trim() !== "" ? ch : null;
}

// ---------------------------------------------------------------------------
// Rótulos de risco — legendas textuais acessíveis. NUNCA usar cor pura.
// ---------------------------------------------------------------------------
const RISK_LABEL: Record<string, string> = {
  low: "Baixo",
  medium: "Médio",
  high: "Alto",
  critical: "Crítico",
};
const RISK_STYLE: Record<string, string> = {
  low: "bg-muted text-foreground border-border",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  high: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30",
  critical: "bg-destructive/15 text-destructive border-destructive/40",
};

function RiskBadge({ level }: { level: string }) {
  const label = RISK_LABEL[level] ?? level;
  const cls = RISK_STYLE[level] ?? "bg-muted text-muted-foreground border-border";
  const isCritical = level === "critical";
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold border ${cls}`}
      data-testid="risk-badge"
      data-risk={level}
      aria-label={`Risco ${label}`}
    >
      {isCritical && <ShieldAlert className="h-3 w-3" aria-hidden />}
      Risco {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Seção recolhível <details> — nativa, acessível, sem CSS extra.
// ---------------------------------------------------------------------------
function CollapsibleSection({
  title,
  testId,
  defaultOpen = false,
  children,
}: {
  title: string;
  testId?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      className="rounded border border-border bg-muted/30 open:bg-muted/50"
      open={defaultOpen}
      data-testid={testId}
    >
      <summary className="cursor-pointer select-none list-none flex items-center gap-1 px-2 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
        <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" aria-hidden />
        {title}
      </summary>
      <div className="px-2 pb-2 pt-1 text-xs text-foreground space-y-1">{children}</div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// ProposalCard
// ---------------------------------------------------------------------------

type FieldError = { title?: string; instruction?: string; priority?: string; scope?: string };

export function ProposalCard({
  proposal,
  onChanged,
}: {
  proposal: ProposalRow;
  onChanged: () => void;
}) {
  const updateFn = useServerFn(updateCoachProposalFn);
  const discardFn = useServerFn(discardCoachProposalFn);
  const confirmFn = useServerFn(confirmCoachProposalFn);

  const initialScopeChannel = readScopeChannel(proposal.scope_ref);
  const initialScopeKind =
    proposal.scope_kind === "company" || proposal.scope_kind === "channel"
      ? proposal.scope_kind
      : "company";

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(proposal.title);
  const [instruction, setInstruction] = useState(proposal.instruction);
  const [priority, setPriority] = useState(proposal.priority);
  const [scopeKind, setScopeKind] = useState<string>(initialScopeKind);
  const [scopeChannel, setScopeChannel] = useState<string>(initialScopeChannel ?? "");
  const [fieldErrors, setFieldErrors] = useState<FieldError>({});

  const [criticalConfirmed, setCriticalConfirmed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  // Guard anti-clique-duplo no salvar — fecha janela de corrida antes do
  // React desabilitar o botão via isPending.
  const savingRef = useRef(false);

  function resetEditingState() {
    setTitle(proposal.title);
    setInstruction(proposal.instruction);
    setPriority(proposal.priority);
    setScopeKind(initialScopeKind);
    setScopeChannel(initialScopeChannel ?? "");
    setFieldErrors({});
  }

  function buildPatch():
    | {
        proposal_id: string;
        title?: string;
        instruction?: string;
        priority?: number;
        scope_kind?: "company" | "channel";
        scope_ref?: { channel?: (typeof COACH_INTERPRETER_CHANNELS)[number] };
      }
    | { error: FieldError } {
    const errors: FieldError = {};
    const t = title.trim();
    const i = instruction.trim();
    if (t.length < 3 || t.length > 120) errors.title = "Título deve ter entre 3 e 120 caracteres.";
    if (i.length < 3 || i.length > 2000)
      errors.instruction = "Instrução deve ter entre 3 e 2000 caracteres.";
    if (!Number.isInteger(priority) || priority < 0 || priority > 100)
      errors.priority = "Prioridade deve ser um inteiro entre 0 e 100.";
    if (scopeKind !== "company" && scopeKind !== "channel")
      errors.scope = "Escopo inválido.";
    if (
      scopeKind === "channel" &&
      !COACH_INTERPRETER_CHANNELS.includes(
        scopeChannel as (typeof COACH_INTERPRETER_CHANNELS)[number],
      )
    ) {
      errors.scope = "Selecione um canal válido para o escopo Channel.";
    }
    if (Object.keys(errors).length > 0) return { error: errors };

    const patch: {
      proposal_id: string;
      title?: string;
      instruction?: string;
      priority?: number;
      scope_kind?: "company" | "channel";
      scope_ref?: { channel?: (typeof COACH_INTERPRETER_CHANNELS)[number] };
    } = { proposal_id: proposal.id };
    if (t !== proposal.title) patch.title = t;
    if (i !== proposal.instruction) patch.instruction = i;
    if (priority !== proposal.priority) patch.priority = priority;

    const scopeKindChanged = scopeKind !== initialScopeKind;
    const scopeChannelChanged =
      scopeKind === "channel" ? scopeChannel !== (initialScopeChannel ?? "") : false;
    if (scopeKindChanged || scopeChannelChanged) {
      patch.scope_kind = scopeKind as "company" | "channel";
      patch.scope_ref =
        scopeKind === "channel"
          ? { channel: scopeChannel as (typeof COACH_INTERPRETER_CHANNELS)[number] }
          : {};
    }
    return patch;
  }

  const updateM = useMutation({
    mutationFn: async () => {
      const built = buildPatch();
      if ("error" in built) {
        setFieldErrors(built.error);
        throw new Error("validation");
      }
      setFieldErrors({});
      return updateFn({ data: built });
    },
    onSuccess: () => {
      savingRef.current = false;
      setEditing(false);
      onChanged();
    },
    onError: () => {
      // Mantém o editor aberto para o operador corrigir.
      savingRef.current = false;
    },
  });

  const discardM = useMutation({
    mutationFn: () => discardFn({ data: { proposal_id: proposal.id } }),
    onSuccess: onChanged,
  });

  const confirmM = useMutation({
    mutationFn: () =>
      confirmFn({
        data: {
          proposal_id: proposal.id,
          overrides: {},
          critical_confirmed: criticalConfirmed,
        },
      }),
    onSuccess: onChanged,
  });

  const warnings = useMemo(
    () => (Array.isArray(proposal.warnings) ? (proposal.warnings as string[]) : []),
    [proposal.warnings],
  );
  const normalized = useMemo(() => readNormalized(proposal.normalized_output), [
    proposal.normalized_output,
  ]);
  const currentScopeChannel = readScopeChannel(proposal.scope_ref);
  const dupWarn = normalized.duplicate_warning ?? null;
  const isCritical = proposal.risk_level === "critical";
  const isTerminal =
    proposal.status === "confirmed" ||
    proposal.status === "discarded" ||
    proposal.status === "failed";

  const validationErrorText =
    updateM.error && (updateM.error as Error).message === "validation"
      ? "Corrija os campos destacados antes de salvar."
      : null;

  return (
    <div
      className="rounded-md border border-border bg-card p-3 space-y-2 text-xs"
      data-testid={`proposal-${proposal.id}`}
    >
      {/* Cabeçalho ---------------------------------------------------------- */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-semibold truncate">{proposal.title}</h4>
            <ProposalStatusBadge status={proposal.status} />
            <RiskBadge level={proposal.risk_level} />
          </div>
          <div className="text-[11px] text-muted-foreground mt-1 flex gap-2 flex-wrap">
            <span>
              {COACH_CATEGORY_LABEL[proposal.category as CoachRuleCategory] ?? proposal.category}
            </span>
            <span aria-hidden>·</span>
            <span>
              {COACH_TYPE_LABEL[proposal.rule_type as CoachRuleType] ?? proposal.rule_type}
            </span>
            <span aria-hidden>·</span>
            <span data-testid="scope-summary">
              Escopo {proposal.scope_kind}
              {currentScopeChannel ? ` · ${currentScopeChannel}` : ""}
            </span>
            <span aria-hidden>·</span>
            <span>P{proposal.priority}</span>
            <span aria-hidden>·</span>
            <span>conf {(proposal.confidence * 100).toFixed(0)}%</span>
          </div>
        </div>
      </div>

      {isCritical && (
        <div
          role="note"
          className="rounded border border-destructive/40 bg-destructive/10 p-2 text-destructive flex items-start gap-2"
          data-testid="critical-notice"
        >
          <ShieldAlert className="h-3 w-3 mt-0.5" aria-hidden />
          <span>
            Esta proposta é <b>crítica</b>. Revise o texto e o escopo antes de confirmar.
          </span>
        </div>
      )}

      {/* Corpo: edição x leitura ------------------------------------------- */}
      {editing ? (
        <div className="space-y-2" data-testid="proposal-edit-form">
          <label className="block">
            <span className="text-muted-foreground">Título</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              aria-invalid={!!fieldErrors.title}
              className="w-full h-8 rounded border border-border bg-background px-2 text-xs"
              data-testid="edit-title"
            />
            {fieldErrors.title && (
              <span className="text-destructive text-[11px]" data-testid="error-title">
                {fieldErrors.title}
              </span>
            )}
          </label>
          <label className="block">
            <span className="text-muted-foreground">Instrução</span>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={4}
              maxLength={2000}
              aria-invalid={!!fieldErrors.instruction}
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs"
              data-testid="edit-instruction"
            />
            {fieldErrors.instruction && (
              <span className="text-destructive text-[11px]" data-testid="error-instruction">
                {fieldErrors.instruction}
              </span>
            )}
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label className="block">
              <span className="text-muted-foreground">Prioridade (0-100)</span>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={priority}
                onChange={(e) => setPriority(Number.parseInt(e.target.value, 10) || 0)}
                aria-invalid={!!fieldErrors.priority}
                className="w-full h-8 rounded border border-border bg-background px-2 text-xs"
                data-testid="edit-priority"
              />
              {fieldErrors.priority && (
                <span className="text-destructive text-[11px]" data-testid="error-priority">
                  {fieldErrors.priority}
                </span>
              )}
            </label>
            <label className="block">
              <span className="text-muted-foreground">Escopo</span>
              <select
                value={scopeKind}
                onChange={(e) => setScopeKind(e.target.value)}
                className="w-full h-8 rounded border border-border bg-background px-2 text-xs"
                data-testid="edit-scope-kind"
              >
                {COACH_INTERPRETER_SCOPES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-muted-foreground">Canal</span>
              <select
                value={scopeChannel}
                onChange={(e) => setScopeChannel(e.target.value)}
                disabled={scopeKind !== "channel"}
                aria-invalid={!!fieldErrors.scope}
                className="w-full h-8 rounded border border-border bg-background px-2 text-xs disabled:opacity-50"
                data-testid="edit-scope-channel"
              >
                <option value="">—</option>
                {COACH_INTERPRETER_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {fieldErrors.scope && (
            <span className="block text-destructive text-[11px]" data-testid="error-scope">
              {fieldErrors.scope}
            </span>
          )}
          {validationErrorText && (
            <div
              role="alert"
              className="rounded border border-destructive/40 bg-destructive/10 p-2 text-destructive"
              data-testid="edit-validation-error"
            >
              {validationErrorText}
            </div>
          )}
        </div>
      ) : (
        <>
          <p className="whitespace-pre-wrap text-foreground">{proposal.instruction}</p>

          {/* Seções recolhíveis — só renderiza quando tem conteúdo ---------- */}
          {normalized.condition && (
            <CollapsibleSection title="Condição" testId="section-condition">
              <div className="whitespace-pre-wrap">{normalized.condition}</div>
            </CollapsibleSection>
          )}
          {normalized.rationale && (
            <CollapsibleSection title="Rationale" testId="section-rationale">
              <div className="whitespace-pre-wrap">{normalized.rationale}</div>
            </CollapsibleSection>
          )}
          {normalized.examples && normalized.examples.length > 0 && (
            <CollapsibleSection title="Exemplos" testId="section-examples">
              <ul className="list-disc pl-4 space-y-0.5">
                {normalized.examples.map((ex, i) => (
                  <li key={i} className="whitespace-pre-wrap">
                    {ex}
                  </li>
                ))}
              </ul>
            </CollapsibleSection>
          )}
          {normalized.ambiguities && normalized.ambiguities.length > 0 && (
            <CollapsibleSection title="Ambiguidades" testId="section-ambiguities">
              <ul className="list-disc pl-4 space-y-0.5">
                {normalized.ambiguities.map((a, i) => (
                  <li key={i} className="whitespace-pre-wrap">
                    {a}
                  </li>
                ))}
              </ul>
            </CollapsibleSection>
          )}
          {normalized.missing_information && normalized.missing_information.length > 0 && (
            <CollapsibleSection
              title="Informação faltante"
              testId="section-missing-information"
            >
              <ul className="list-disc pl-4 space-y-0.5">
                {normalized.missing_information.map((m, i) => (
                  <li key={i} className="whitespace-pre-wrap">
                    {m}
                  </li>
                ))}
              </ul>
            </CollapsibleSection>
          )}
        </>
      )}

      {warnings.length > 0 && (
        <div
          className="rounded border border-amber-500/40 bg-amber-500/10 p-2"
          data-testid="section-warnings"
        >
          <div className="flex items-center gap-1 text-amber-700 dark:text-amber-400 font-semibold">
            <AlertTriangle className="h-3 w-3" aria-hidden /> Warnings
          </div>
          <ul className="mt-1 list-disc pl-4">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {dupWarn && (dupWarn.title || dupWarn.rule_id || dupWarn.reason) && (
        <div
          className="rounded border border-amber-500/40 bg-amber-500/10 p-2"
          data-testid="duplicate-warning"
          role="note"
          aria-label="Aviso de possível duplicidade"
        >
          <div className="flex items-center gap-1 text-amber-700 dark:text-amber-400 font-semibold">
            <Copy className="h-3 w-3" aria-hidden /> Possível duplicata
          </div>
          <div className="mt-1">
            {(dupWarn.title || dupWarn.rule_id) && (
              <div>
                <span className="text-muted-foreground">Regra existente:</span>{" "}
                <span className="font-medium">{dupWarn.title ?? dupWarn.rule_id}</span>
              </div>
            )}
            {dupWarn.reason && (
              <div className="text-muted-foreground mt-0.5">{dupWarn.reason}</div>
            )}
          </div>
        </div>
      )}

      <div className="text-[10px] text-muted-foreground flex items-center gap-1">
        <Clock className="h-3 w-3" aria-hidden /> {formatDateTime(proposal.created_at)}
      </div>

      {/* Ações -------------------------------------------------------------- */}
      {!isTerminal && (
        <div className="flex flex-wrap gap-2 pt-1">
          {editing ? (
            <>
              <button
                type="button"
                onClick={() => {
                  if (savingRef.current || updateM.isPending) return;
                  savingRef.current = true;
                  updateM.mutate();
                }}
                disabled={updateM.isPending}
                className="inline-flex items-center gap-1 h-7 px-2 rounded bg-primary text-primary-foreground text-xs disabled:opacity-60"
                data-testid="save-edit"
              >
                {updateM.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                ) : (
                  <CheckCircle2 className="h-3 w-3" aria-hidden />
                )}
                Salvar edição
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  resetEditingState();
                  updateM.reset();
                }}
                disabled={updateM.isPending}
                className="inline-flex items-center gap-1 h-7 px-2 rounded border border-border text-xs hover:bg-accent"
                data-testid="cancel-edit"
              >
                Cancelar
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  resetEditingState();
                  setEditing(true);
                }}
                className="inline-flex items-center gap-1 h-7 px-2 rounded border border-border text-xs hover:bg-accent"
                data-testid="edit-proposal"
              >
                <Pencil className="h-3 w-3" aria-hidden /> Editar
              </button>

              <button
                type="button"
                onClick={() => {
                  setCriticalConfirmed(false);
                  setConfirmOpen(true);
                }}
                disabled={confirmM.isPending}
                className="inline-flex items-center gap-1 h-7 px-2 rounded bg-emerald-600 text-white text-xs disabled:opacity-60"
                data-testid="confirm-proposal"
              >
                {confirmM.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                ) : (
                  <CheckCircle2 className="h-3 w-3" aria-hidden />
                )}
                Confirmar
              </button>

              <button
                type="button"
                onClick={() => setDiscardOpen(true)}
                disabled={discardM.isPending}
                className="inline-flex items-center gap-1 h-7 px-2 rounded border border-destructive/40 text-destructive text-xs hover:bg-destructive/10 disabled:opacity-60"
                data-testid="discard-proposal"
              >
                {discardM.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                ) : (
                  <Trash2 className="h-3 w-3" aria-hidden />
                )}
                Descartar
              </button>
            </>
          )}
        </div>
      )}

      {/* AlertDialog: Confirmar proposal */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isCritical ? "Confirmar regra CRÍTICA?" : "Confirmar regra?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span className="block font-medium text-foreground mb-1">{proposal.title}</span>
              <span className="block text-xs">
                Categoria{" "}
                <b>
                  {COACH_CATEGORY_LABEL[proposal.category as CoachRuleCategory] ??
                    proposal.category}
                </b>{" "}
                · Tipo{" "}
                <b>{COACH_TYPE_LABEL[proposal.rule_type as CoachRuleType] ?? proposal.rule_type}</b>{" "}
                · Escopo <b>{proposal.scope_kind}</b>
                {currentScopeChannel ? (
                  <>
                    {" "}· Canal <b>{currentScopeChannel}</b>
                  </>
                ) : null}{" "}
                · Prioridade <b>P{proposal.priority}</b>
              </span>
              {isCritical && (
                <span className="mt-3 block rounded border border-destructive/40 bg-destructive/10 p-2 text-destructive">
                  Esta regra é <b>crítica</b>. Marque o checkbox abaixo para autorizar
                  explicitamente a confirmação.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {isCritical && (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={criticalConfirmed}
                onChange={(e) => setCriticalConfirmed(e.target.checked)}
                data-testid="critical-checkbox"
              />
              Confirmo estar ciente do risco crítico desta regra.
            </label>
          )}
          {confirmM.error && (
            <ErrorBanner
              title="Falha ao confirmar"
              error={getSafeInterpreterError(confirmM.error)}
              testId="confirm-error"
            />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmM.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmM.isPending || (isCritical && !criticalConfirmed)}
              data-testid="confirm-dialog-action"
              onClick={(e) => {
                e.preventDefault();
                confirmM.mutate(undefined, {
                  onSuccess: () => setConfirmOpen(false),
                });
              }}
            >
              {confirmM.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" aria-hidden />}
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AlertDialog: Descartar proposal */}
      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent data-testid="discard-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar esta proposal?</AlertDialogTitle>
            <AlertDialogDescription>
              A proposal <b>{proposal.title}</b> será marcada como descartada. Esta ação não pode
              ser desfeita a partir da UI.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {discardM.error && (
            <ErrorBanner
              title="Falha ao descartar"
              error={getSafeInterpreterError(discardM.error)}
              testId="discard-error"
            />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={discardM.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={discardM.isPending}
              data-testid="discard-dialog-action"
              onClick={(e) => {
                e.preventDefault();
                discardM.mutate(undefined, {
                  onSuccess: () => setDiscardOpen(false),
                });
              }}
            >
              {discardM.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" aria-hidden />}
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {updateM.error && (updateM.error as Error).message !== "validation" && (
        <ErrorBanner
          title="Falha ao salvar edição"
          error={getSafeInterpreterError(updateM.error)}
          testId="update-error"
        />
      )}
    </div>
  );
}

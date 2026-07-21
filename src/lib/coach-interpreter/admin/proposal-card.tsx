// Card de uma proposal — cabeçalho, corpo, edição, dialogs de
// confirmar/descartar e banners de erro.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Loader2,
  Pencil,
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
import { getSafeInterpreterError } from "@/lib/coach-interpreter/errors";
import type { ProposalRow } from "./types";
import { ProposalStatusBadge } from "./status-badges";
import { ErrorBanner } from "./error-banner";
import { formatDateTime } from "./helpers";

export function ProposalCard({
  proposal,
  onChanged,
}: {
  proposal: ProposalRow;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const updateFn = useServerFn(updateCoachProposalFn);
  const discardFn = useServerFn(discardCoachProposalFn);
  const confirmFn = useServerFn(confirmCoachProposalFn);

  const [title, setTitle] = useState(proposal.title);
  const [instruction, setInstruction] = useState(proposal.instruction);
  const [priority, setPriority] = useState(proposal.priority);
  const [criticalConfirmed, setCriticalConfirmed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const updateM = useMutation({
    mutationFn: () =>
      updateFn({
        data: {
          proposal_id: proposal.id,
          title: title !== proposal.title ? title : undefined,
          instruction: instruction !== proposal.instruction ? instruction : undefined,
          priority: priority !== proposal.priority ? priority : undefined,
        },
      }),
    onSuccess: () => {
      setEditing(false);
      onChanged();
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

  const warnings = Array.isArray(proposal.warnings) ? (proposal.warnings as string[]) : [];
  const normalized = proposal.normalized_output as
    | {
        condition?: string;
        examples?: string[];
        duplicate_warning?: { rule_id?: string; title?: string; reason?: string } | null;
      }
    | null
    | undefined;

  const dupWarn = normalized?.duplicate_warning ?? null;
  const isCritical = proposal.risk_level === "critical";
  const isTerminal =
    proposal.status === "confirmed" ||
    proposal.status === "discarded" ||
    proposal.status === "failed";

  return (
    <div
      className="rounded-md border border-border bg-card p-3 space-y-2 text-xs"
      data-testid={`proposal-${proposal.id}`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-semibold truncate">{proposal.title}</h4>
            <ProposalStatusBadge status={proposal.status} />
            {isCritical && (
              <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-destructive/15 text-destructive border border-destructive/30">
                Crítica
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1 flex gap-2 flex-wrap">
            <span>
              {COACH_CATEGORY_LABEL[proposal.category as CoachRuleCategory] ?? proposal.category}
            </span>
            <span>·</span>
            <span>
              {COACH_TYPE_LABEL[proposal.rule_type as CoachRuleType] ?? proposal.rule_type}
            </span>
            <span>·</span>
            <span>Escopo {proposal.scope_kind}</span>
            <span>·</span>
            <span>P{proposal.priority}</span>
            <span>·</span>
            <span>conf {(proposal.confidence * 100).toFixed(0)}%</span>
          </div>
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <label className="block">
            <span className="text-muted-foreground">Título</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full h-8 rounded border border-border bg-background px-2 text-xs"
            />
          </label>
          <label className="block">
            <span className="text-muted-foreground">Instrução</span>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={4}
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs"
            />
          </label>
          <label className="block">
            <span className="text-muted-foreground">Prioridade (0-100)</span>
            <input
              type="number"
              min={0}
              max={100}
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value) || 0)}
              className="w-24 h-8 rounded border border-border bg-background px-2 text-xs"
            />
          </label>
        </div>
      ) : (
        <>
          <p className="whitespace-pre-wrap text-foreground">{proposal.instruction}</p>
          {normalized?.condition && (
            <div className="rounded bg-muted/50 border border-border p-2">
              <div className="text-[10px] uppercase font-semibold text-muted-foreground">
                Condição
              </div>
              <div className="mt-0.5 whitespace-pre-wrap">{normalized.condition}</div>
            </div>
          )}
          {normalized?.examples && normalized.examples.length > 0 && (
            <div className="rounded bg-muted/50 border border-border p-2">
              <div className="text-[10px] uppercase font-semibold text-muted-foreground">
                Exemplos
              </div>
              <ul className="mt-0.5 list-disc pl-4 space-y-0.5">
                {normalized.examples.map((ex, i) => (
                  <li key={i} className="whitespace-pre-wrap">
                    {ex}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {warnings.length > 0 && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2">
          <div className="flex items-center gap-1 text-amber-700 dark:text-amber-400 font-semibold">
            <AlertTriangle className="h-3 w-3" /> Warnings
          </div>
          <ul className="mt-1 list-disc pl-4">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {dupWarn && (
        <div
          className="rounded border border-amber-500/40 bg-amber-500/10 p-2"
          data-testid="duplicate-warning"
        >
          <div className="flex items-center gap-1 text-amber-700 dark:text-amber-400 font-semibold">
            <Copy className="h-3 w-3" /> Possível duplicata
          </div>
          <div className="mt-1">
            <div>
              <span className="text-muted-foreground">Regra existente:</span>{" "}
              <span className="font-medium">{dupWarn.title ?? dupWarn.rule_id ?? "—"}</span>
            </div>
            {dupWarn.reason && <div className="text-muted-foreground mt-0.5">{dupWarn.reason}</div>}
          </div>
        </div>
      )}

      <div className="text-[10px] text-muted-foreground flex items-center gap-1">
        <Clock className="h-3 w-3" /> {formatDateTime(proposal.created_at)}
      </div>

      {!isTerminal && (
        <div className="flex flex-wrap gap-2 pt-1">
          {editing ? (
            <>
              <button
                type="button"
                onClick={() => updateM.mutate()}
                disabled={updateM.isPending}
                className="inline-flex items-center gap-1 h-7 px-2 rounded bg-primary text-primary-foreground text-xs disabled:opacity-60"
              >
                {updateM.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3 w-3" />
                )}
                Salvar edição
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setTitle(proposal.title);
                  setInstruction(proposal.instruction);
                  setPriority(proposal.priority);
                }}
                className="inline-flex items-center gap-1 h-7 px-2 rounded border border-border text-xs hover:bg-accent"
              >
                Cancelar
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1 h-7 px-2 rounded border border-border text-xs hover:bg-accent"
                data-testid="edit-proposal"
              >
                <Pencil className="h-3 w-3" /> Editar
              </button>

              {/* Confirm — sempre passa por AlertDialog. Dupla confirmação
                  para risco crítico (checkbox dentro do dialog). */}
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
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3 w-3" />
                )}
                Confirmar
              </button>

              {/* Discard — dialog dedicado, ação destrutiva. */}
              <button
                type="button"
                onClick={() => setDiscardOpen(true)}
                disabled={discardM.isPending}
                className="inline-flex items-center gap-1 h-7 px-2 rounded border border-destructive/40 text-destructive text-xs hover:bg-destructive/10 disabled:opacity-60"
                data-testid="discard-proposal"
              >
                {discardM.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
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
                · Escopo <b>{proposal.scope_kind}</b> · Prioridade <b>P{proposal.priority}</b>
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
              {confirmM.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
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
              {discardM.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {updateM.error && (
        <ErrorBanner
          title="Falha ao salvar edição"
          error={getSafeInterpreterError(updateM.error)}
          testId="update-error"
        />
      )}
    </div>
  );
}

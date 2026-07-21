// Tela administrativa isolada: Regras do Coach (Fase 1, dark & feature-flag por admin).
// Sem alterações no CoachPanel existente. Consumo somente do repository/RPCs de coach_rules.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ShieldAlert, Plus, Loader2, CheckCircle2, XCircle, Pause, Play,
  Archive, ClipboardList, History, AlertTriangle, Send, Sparkles,
} from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { cn } from "@/lib/utils";
import {
  listCoachRules, listCoachRuleVersions, listCoachRuleEvents,
  createCoachRuleDraft, createCoachRuleVersion, submitCoachRuleVersion,
  approveCoachRuleVersion, rejectCoachRuleVersion, activateCoachRuleVersion,
  pauseOrResumeCoachRule, archiveCoachRule,
  COACH_RULE_CATEGORIES, COACH_RULE_TYPES, COACH_RULE_SCOPES, COACH_CHANNELS,
  COACH_CRITICAL_CATEGORIES, COACH_CATEGORY_LABEL, COACH_TYPE_LABEL,
  COACH_RULE_STATUS_LABEL, COACH_VERSION_STATUS_LABEL,
  type CoachRuleCategory, type CoachRuleType, type CoachRuleScopeKind,
  type CoachRuleRow, type CoachRuleVersionRow, type CoachRuleScopeRef,
} from "@/lib/coach-rules/coach-rules.repository";

export const Route = createFileRoute("/configuracoes_/regras-coach")({
  component: RulesPage,
  head: () => ({
    meta: [
      { title: "Regras do Coach — Atende Ai!" },
      { name: "description", content: "Gestão de regras e versões do Coach V2 (Fase 1)." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

// ------------------------------------------------------------------
function RulesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();

  useEffect(() => {
    if (!user) navigate({ to: "/login" });
  }, [user, navigate]);

  if (adminLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto p-8">
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <h2 className="font-semibold">Acesso restrito</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Somente administradores podem gerenciar regras do Coach.
            </p>
            <Link to="/configuracoes" className="text-sm text-primary underline mt-2 inline-block">
              Voltar para Configurações
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <RulesShell />;
}

// ------------------------------------------------------------------
function RulesShell() {
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const qc = useQueryClient();
  const rulesQ = useQuery({
    queryKey: ["coach-rules"],
    queryFn: listCoachRules,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["coach-rules"] });
    if (selectedRuleId) {
      qc.invalidateQueries({ queryKey: ["coach-rule-versions", selectedRuleId] });
      qc.invalidateQueries({ queryKey: ["coach-rule-events", selectedRuleId] });
    }
  };

  return (
    <div className="flex flex-col h-full">
      <header className="border-b border-border px-4 py-3 flex items-center gap-3">
        <Link to="/configuracoes" className="p-1.5 rounded hover:bg-accent">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-base font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Regras do Coach
            <span className="text-[10px] uppercase font-bold tracking-wide bg-amber-500/15 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded">
              Beta • Fase 1
            </span>
          </h1>
          <p className="text-xs text-muted-foreground">
            Fundação de regras versionadas. Ainda não afeta o agente em produção.
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Nova regra
        </button>
      </header>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(280px,360px)_1fr] overflow-hidden">
        <aside className="border-r border-border overflow-y-auto p-2">
          {rulesQ.isLoading ? (
            <div className="p-4 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : (rulesQ.data ?? []).length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Nenhuma regra ainda. Crie a primeira em <b>Nova regra</b>.
            </div>
          ) : (
            <ul className="space-y-1">
              {(rulesQ.data ?? []).map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => setSelectedRuleId(r.id)}
                    className={cn(
                      "w-full text-left rounded-md px-3 py-2 hover:bg-accent",
                      selectedRuleId === r.id && "bg-accent",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate flex-1">{r.title}</span>
                      <StatusBadge status={r.status} />
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 flex gap-2">
                      <span>{COACH_CATEGORY_LABEL[r.category]}</span>
                      <span>·</span>
                      <span>P{r.priority}</span>
                      <span>·</span>
                      <span>{r.scope_kind}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="overflow-y-auto p-4">
          {selectedRuleId ? (
            <RuleDetail ruleId={selectedRuleId} onChanged={refresh} />
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              Selecione uma regra à esquerda para ver versões e eventos.
            </div>
          )}
        </section>
      </div>

      {createOpen && (
        <CreateRuleDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(ruleId) => {
            setCreateOpen(false);
            setSelectedRuleId(ruleId);
            refresh();
          }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------
function StatusBadge({ status }: { status: CoachRuleRow["status"] }) {
  const map: Record<CoachRuleRow["status"], string> = {
    draft: "bg-muted text-muted-foreground",
    active: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    paused: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    archived: "bg-muted text-muted-foreground line-through",
    replaced: "bg-muted text-muted-foreground",
  };
  return (
    <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", map[status])}>
      {COACH_RULE_STATUS_LABEL[status]}
    </span>
  );
}

function VersionStatusBadge({ status }: { status: CoachRuleVersionRow["status"] }) {
  const map: Record<CoachRuleVersionRow["status"], string> = {
    draft: "bg-muted text-muted-foreground",
    pending_approval: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    approved: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    rejected: "bg-destructive/15 text-destructive",
    archived: "bg-muted text-muted-foreground",
  };
  return (
    <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", map[status])}>
      {COACH_VERSION_STATUS_LABEL[status]}
    </span>
  );
}

// ------------------------------------------------------------------
function RuleDetail({ ruleId, onChanged }: { ruleId: string; onChanged: () => void }) {
  const versionsQ = useQuery({
    queryKey: ["coach-rule-versions", ruleId],
    queryFn: () => listCoachRuleVersions(ruleId),
  });
  const eventsQ = useQuery({
    queryKey: ["coach-rule-events", ruleId],
    queryFn: () => listCoachRuleEvents(ruleId),
  });
  const rulesQ = useQuery({ queryKey: ["coach-rules"], queryFn: listCoachRules });
  const rule = (rulesQ.data ?? []).find((r) => r.id === ruleId) ?? null;

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newVersionOpen, setNewVersionOpen] = useState(false);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setError(null);
    try { await fn(); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  if (!rule) return <div className="text-sm text-muted-foreground">Regra não encontrada.</div>;

  const versions = versionsQ.data ?? [];
  const isCritical = COACH_CRITICAL_CATEGORIES.has(rule.category);

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              {rule.title}
              {isCritical && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-amber-600 dark:text-amber-400 bg-amber-500/15 px-1.5 py-0.5 rounded">
                  <AlertTriangle className="h-3 w-3" /> Crítica
                </span>
              )}
            </h2>
            <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-2">
              <span>{COACH_CATEGORY_LABEL[rule.category]}</span>
              <span>·</span>
              <span>Prioridade P{rule.priority}</span>
              <span>·</span>
              <span>Escopo: {rule.scope_kind}</span>
              <StatusBadge status={rule.status} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            <button
              onClick={() => setNewVersionOpen(true)}
              disabled={rule.status === "archived" || rule.status === "replaced"}
              className="text-xs h-8 px-2.5 rounded-md border border-border hover:bg-accent disabled:opacity-40"
            >
              <Plus className="h-3 w-3 inline mr-1" /> Nova versão
            </button>
            {(rule.status === "active" || rule.status === "paused") && (
              <button
                onClick={() => run("pause", () => pauseOrResumeCoachRule(ruleId))}
                disabled={busy === "pause"}
                className="text-xs h-8 px-2.5 rounded-md border border-border hover:bg-accent"
              >
                {rule.status === "active"
                  ? <><Pause className="h-3 w-3 inline mr-1" /> Pausar</>
                  : <><Play className="h-3 w-3 inline mr-1" /> Retomar</>}
              </button>
            )}
            {rule.status !== "archived" && rule.status !== "replaced" && (
              <button
                onClick={() => {
                  if (confirm("Arquivar esta regra? Ela deixará de ter versão ativa.")) {
                    run("archive", () => archiveCoachRule(ruleId));
                  }
                }}
                disabled={busy === "archive"}
                className="text-xs h-8 px-2.5 rounded-md border border-border hover:bg-accent"
              >
                <Archive className="h-3 w-3 inline mr-1" /> Arquivar
              </button>
            )}
          </div>
        </div>
        {error && (
          <div className="mt-3 rounded-md bg-destructive/10 border border-destructive/40 text-destructive text-xs p-2">
            {error}
          </div>
        )}
      </div>

      <section>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <ClipboardList className="h-4 w-4" /> Versões
        </h3>
        {versionsQ.isLoading ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : (
          <ul className="space-y-2">
            {versions.map((v) => (
              <VersionItem
                key={v.id}
                version={v}
                rule={rule}
                busy={busy}
                onAction={run}
              />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <History className="h-4 w-4" /> Auditoria (append-only)
        </h3>
        <div className="rounded-lg border border-border bg-card divide-y divide-border text-xs max-h-72 overflow-y-auto">
          {(eventsQ.data ?? []).length === 0 && (
            <div className="p-3 text-muted-foreground">Nenhum evento.</div>
          )}
          {(eventsQ.data ?? []).map((ev) => (
            <div key={ev.id} className="p-2.5 flex items-start gap-2">
              <span className="font-mono text-[10px] text-muted-foreground shrink-0 w-32">
                {new Date(ev.created_at).toLocaleString("pt-BR")}
              </span>
              <div className="flex-1">
                <span className="font-medium">{ev.event_type}</span>
                {ev.is_self_approval && (
                  <span className="ml-2 text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded">
                    autoaprovação
                  </span>
                )}
                {ev.details && Object.keys(ev.details as object).length > 0 && (
                  <pre className="mt-1 text-[10px] text-muted-foreground whitespace-pre-wrap">
                    {JSON.stringify(ev.details, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {newVersionOpen && (
        <NewVersionDialog
          rule={rule}
          onClose={() => setNewVersionOpen(false)}
          onCreated={() => { setNewVersionOpen(false); onChanged(); }}
        />
      )}
    </div>
  );
}

function VersionItem({
  version, rule, busy, onAction,
}: {
  version: CoachRuleVersionRow;
  rule: CoachRuleRow;
  busy: string | null;
  onAction: (key: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [confirmCritical, setConfirmCritical] = useState(false);
  const isCritical = COACH_CRITICAL_CATEGORIES.has(version.category);
  const isActive = rule.active_version_id === version.id;

  return (
    <li className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono">v{version.version_number}</span>
        <VersionStatusBadge status={version.status} />
        {isActive && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">
            ATIVA
          </span>
        )}
        <span className="text-[11px] text-muted-foreground ml-auto">
          {COACH_TYPE_LABEL[version.rule_type]} · P{version.priority}
        </span>
      </div>
      <div className="mt-2 text-sm font-medium">{version.title}</div>
      <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">
        {version.content}
      </p>

      {version.status === "rejected" && version.rejection_reason && (
        <div className="mt-2 text-xs bg-destructive/5 border border-destructive/30 p-2 rounded">
          <b>Motivo:</b> {version.rejection_reason}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {version.status === "draft" && (
          <button
            onClick={() => onAction(`submit-${version.id}`, () => submitCoachRuleVersion(version.id))}
            disabled={busy === `submit-${version.id}`}
            className="text-xs h-8 px-2.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Send className="h-3 w-3 inline mr-1" /> Enviar para aprovação
          </button>
        )}
        {version.status === "pending_approval" && (
          <>
            {isCritical && (
              <label className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                <input
                  type="checkbox"
                  checked={confirmCritical}
                  onChange={(e) => setConfirmCritical(e.target.checked)}
                />
                Confirmo alteração crítica ({COACH_CATEGORY_LABEL[version.category]})
              </label>
            )}
            <button
              onClick={() => onAction(
                `approve-${version.id}`,
                () => approveCoachRuleVersion(version.id, isCritical ? confirmCritical : false),
              )}
              disabled={busy === `approve-${version.id}` || (isCritical && !confirmCritical)}
              className="text-xs h-8 px-2.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-600/90 disabled:opacity-40"
            >
              <CheckCircle2 className="h-3 w-3 inline mr-1" /> Aprovar
            </button>
            <button
              onClick={() => setRejectOpen(true)}
              className="text-xs h-8 px-2.5 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <XCircle className="h-3 w-3 inline mr-1" /> Rejeitar
            </button>
          </>
        )}
        {version.status === "approved" && !isActive && (
          <button
            onClick={() => onAction(
              `activate-${version.id}`,
              () => activateCoachRuleVersion(version.id),
            )}
            disabled={busy === `activate-${version.id}`}
            className="text-xs h-8 px-2.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Play className="h-3 w-3 inline mr-1" /> Ativar
          </button>
        )}
      </div>

      {rejectOpen && (
        <RejectDialog
          onClose={() => setRejectOpen(false)}
          onSubmit={async (reason) => {
            await onAction(`reject-${version.id}`, () => rejectCoachRuleVersion(version.id, reason));
            setRejectOpen(false);
          }}
        />
      )}
    </li>
  );
}

// ------------------------------------------------------------------
// Dialogs
// ------------------------------------------------------------------
function DialogShell({
  title, onClose, children,
}: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold text-sm">{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-accent rounded">
            <XCircle className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

interface RuleFormState {
  category: CoachRuleCategory;
  ruleType: CoachRuleType;
  title: string;
  content: string;
  priority: number;
  scopeKind: CoachRuleScopeKind;
  agentId: string;
  channel: (typeof COACH_CHANNELS)[number];
}

function useRuleForm(initial?: Partial<RuleFormState>) {
  const [state, setState] = useState<RuleFormState>({
    category: initial?.category ?? "sales",
    ruleType: initial?.ruleType ?? "instruction",
    title: initial?.title ?? "",
    content: initial?.content ?? "",
    priority: initial?.priority ?? 50,
    scopeKind: initial?.scopeKind ?? "company",
    agentId: initial?.agentId ?? "",
    channel: initial?.channel ?? "whatsapp",
  });
  const scopeRef = useMemo<CoachRuleScopeRef>(() => {
    if (state.scopeKind === "company") return {};
    if (state.scopeKind === "agent") return { agent_id: state.agentId.trim() };
    return { channel: state.channel };
  }, [state.scopeKind, state.agentId, state.channel]);
  return { state, setState, scopeRef };
}

function RuleFormFields({
  state, setState,
}: { state: RuleFormState; setState: React.Dispatch<React.SetStateAction<RuleFormState>> }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs">
          <div className="mb-1 font-medium">Categoria</div>
          <select
            value={state.category}
            onChange={(e) => setState((s) => ({ ...s, category: e.target.value as CoachRuleCategory }))}
            className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
          >
            {COACH_RULE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{COACH_CATEGORY_LABEL[c]}</option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <div className="mb-1 font-medium">Tipo</div>
          <select
            value={state.ruleType}
            onChange={(e) => setState((s) => ({ ...s, ruleType: e.target.value as CoachRuleType }))}
            className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
          >
            {COACH_RULE_TYPES.map((c) => (
              <option key={c} value={c}>{COACH_TYPE_LABEL[c]}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="text-xs block">
        <div className="mb-1 font-medium">Título</div>
        <input
          value={state.title}
          onChange={(e) => setState((s) => ({ ...s, title: e.target.value }))}
          className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
          maxLength={200}
        />
      </label>
      <label className="text-xs block">
        <div className="mb-1 font-medium">Conteúdo da regra</div>
        <textarea
          value={state.content}
          onChange={(e) => setState((s) => ({ ...s, content: e.target.value }))}
          rows={5}
          className="w-full rounded-md border border-border bg-background p-2 text-sm"
          maxLength={8000}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs">
          <div className="mb-1 font-medium">Prioridade (0-100)</div>
          <input
            type="number" min={0} max={100}
            value={state.priority}
            onChange={(e) => setState((s) => ({ ...s, priority: Number(e.target.value) }))}
            className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
          />
        </label>
        <label className="text-xs">
          <div className="mb-1 font-medium">Escopo</div>
          <select
            value={state.scopeKind}
            onChange={(e) => setState((s) => ({ ...s, scopeKind: e.target.value as CoachRuleScopeKind }))}
            className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
          >
            {COACH_RULE_SCOPES.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
      </div>
      {state.scopeKind === "agent" && (
        <label className="text-xs block">
          <div className="mb-1 font-medium">ID do agente</div>
          <input
            value={state.agentId}
            onChange={(e) => setState((s) => ({ ...s, agentId: e.target.value }))}
            className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
            placeholder="identificador do agente"
          />
        </label>
      )}
      {state.scopeKind === "channel" && (
        <label className="text-xs block">
          <div className="mb-1 font-medium">Canal</div>
          <select
            value={state.channel}
            onChange={(e) => setState((s) => ({ ...s, channel: e.target.value as typeof state.channel }))}
            className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
          >
            {COACH_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

function CreateRuleDialog({
  onClose, onCreated,
}: { onClose: () => void; onCreated: (ruleId: string) => void }) {
  const { state, setState, scopeRef } = useRuleForm();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const { rule_id } = await createCoachRuleDraft({
        category: state.category,
        ruleType: state.ruleType,
        title: state.title.trim(),
        content: state.content.trim(),
        priority: state.priority,
        scopeKind: state.scopeKind,
        scopeRef,
      });
      onCreated(rule_id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell title="Nova regra" onClose={onClose}>
      <RuleFormFields state={state} setState={setState} />
      {err && (
        <div className="mt-3 rounded-md bg-destructive/10 border border-destructive/40 text-destructive text-xs p-2">
          {err}
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="text-xs h-9 px-3 rounded-md border border-border hover:bg-accent">
          Cancelar
        </button>
        <button
          onClick={submit}
          disabled={busy || !state.title.trim() || !state.content.trim()}
          className="text-xs h-9 px-3 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 inline-flex items-center gap-1.5"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          Criar rascunho
        </button>
      </div>
    </DialogShell>
  );
}

function NewVersionDialog({
  rule, onClose, onCreated,
}: { rule: CoachRuleRow; onClose: () => void; onCreated: () => void }) {
  const { state, setState, scopeRef } = useRuleForm({
    category: rule.category,
    title: rule.title,
    priority: rule.priority,
    scopeKind: rule.scope_kind,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await createCoachRuleVersion({
        ruleId: rule.id,
        ruleType: state.ruleType,
        title: state.title.trim(),
        content: state.content.trim(),
        priority: state.priority,
        scopeKind: state.scopeKind,
        scopeRef,
      });
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell title={`Nova versão de "${rule.title}"`} onClose={onClose}>
      <p className="text-xs text-muted-foreground mb-3">
        Toda alteração cria uma nova versão. Versões aprovadas/ativas são imutáveis.
      </p>
      <RuleFormFields state={state} setState={setState} />
      {err && (
        <div className="mt-3 rounded-md bg-destructive/10 border border-destructive/40 text-destructive text-xs p-2">
          {err}
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="text-xs h-9 px-3 rounded-md border border-border hover:bg-accent">
          Cancelar
        </button>
        <button
          onClick={submit}
          disabled={busy || !state.title.trim() || !state.content.trim()}
          className="text-xs h-9 px-3 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 inline-flex items-center gap-1.5"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          Criar rascunho
        </button>
      </div>
    </DialogShell>
  );
}

function RejectDialog({
  onClose, onSubmit,
}: { onClose: () => void; onSubmit: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <DialogShell title="Rejeitar versão" onClose={onClose}>
      <label className="text-xs block">
        <div className="mb-1 font-medium">Motivo da rejeição</div>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={4}
          className="w-full rounded-md border border-border bg-background p-2 text-sm"
        />
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="text-xs h-9 px-3 rounded-md border border-border hover:bg-accent">
          Cancelar
        </button>
        <button
          onClick={async () => { setBusy(true); try { await onSubmit(reason.trim()); } finally { setBusy(false); } }}
          disabled={busy || reason.trim().length < 3}
          className="text-xs h-9 px-3 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-40 inline-flex items-center gap-1.5"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          Rejeitar
        </button>
      </div>
    </DialogShell>
  );
}

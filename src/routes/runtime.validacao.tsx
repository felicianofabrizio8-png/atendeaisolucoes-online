// Painel admin para validação manual da cadeia central de inteligência.
// READ-ONLY: apenas dispara jobs sob demanda via POST /api/runtime/execute
// usando o bearer da sessão autenticada. Nenhuma automação é ativada.

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/auth/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  CheckCircle2,
  Loader2,
  ShieldAlert,
  XCircle,
  Play,
  Repeat,
  AlertTriangle,
} from "lucide-react";

export const Route = createFileRoute("/runtime/validacao")({
  component: RuntimeValidationPage,
});

const CHAIN = [
  "system-health",
  "business-brain",
  "business-learning",
  "scientific-knowledge",
  "scientific-memory",
  "professor",
  "executive-intelligence",
  "executive-knowledge",
  "executive-narrative",
] as const;

type AgentId = (typeof CHAIN)[number];

type AgentStatus =
  | "idle"
  | "queued"
  | "processing"
  | "done"
  | "failed"
  | "blocked";

interface AgentRow {
  agentId: AgentId;
  status: AgentStatus;
  durationMs: number | null;
  jobId: string | null;
  executionId: string | null;
  outcome: string | null;
  reason: string | null;
  knowledgeBus: string | null;
  topic: string | null;
  error: string | null;
}

function mask(id: string | null | undefined): string {
  if (!id) return "—";
  if (id.length <= 10) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function kbSummary(kb: unknown): string | null {
  if (!kb || typeof kb !== "object") return null;
  const r = kb as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof r.hits === "number") parts.push(`hits=${r.hits}`);
  if (typeof r.misses === "number") parts.push(`miss=${r.misses}`);
  if (typeof r.partialHits === "number") parts.push(`partial=${r.partialHits}`);
  if (typeof r.fallbacks === "number") parts.push(`fb=${r.fallbacks}`);
  if (typeof r.knowledgeBusHit === "boolean")
    parts.push(r.knowledgeBusHit ? "HIT" : "MISS");
  if (typeof r.knowledgeBusFallback === "boolean" && r.knowledgeBusFallback)
    parts.push("FALLBACK");
  return parts.join(" · ") || null;
}

function publishedTopic(kb: unknown): string | null {
  if (!kb || typeof kb !== "object") return null;
  const r = kb as Record<string, unknown>;
  const t = r.publishedTopics;
  if (Array.isArray(t) && t.length) return t.join(", ");
  if (typeof r.knowledgeTopic === "string") return r.knowledgeTopic;
  return null;
}

function initRows(agents: readonly AgentId[]): AgentRow[] {
  return agents.map((a) => ({
    agentId: a,
    status: "idle",
    durationMs: null,
    jobId: null,
    executionId: null,
    outcome: null,
    reason: null,
    knowledgeBus: null,
    topic: null,
    error: null,
  }));
}

interface PreflightState {
  loading: boolean;
  error: string | null;
  runtimeOnline: boolean;
  schedulerDisabled: boolean;
  workerReady: boolean;
  jobsPending: number;
  jobsProcessing: number;
  jobsFailed: number;
  jobsDead: number;
  tenantMasked: string;
  allowlist: string[];
}

async function bearer(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function fetchStatus(): Promise<unknown> {
  const token = await bearer();
  if (!token) throw new Error("unauthorized");
  const res = await fetch("/api/runtime/status", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || typeof body !== "object")
    throw new Error(`http_${res.status}`);
  return body;
}

async function runAgent(
  agentId: AgentId,
  correlationId: string,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const token = await bearer();
  if (!token) throw new Error("unauthorized");
  const res = await fetch("/api/runtime/execute", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ agentId, correlationId }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok && Boolean(body?.ok), data: body };
}

function extractPreflight(snapshot: unknown, tenantMasked: string): PreflightState {
  const s = snapshot as Record<string, unknown> | null;
  const snap = (s?.snapshot ?? s) as Record<string, unknown> | undefined;
  const status = snap?.status as Record<string, unknown> | undefined;
  const scheduler = snap?.scheduler as Record<string, unknown> | undefined;
  const worker = snap?.worker as Record<string, unknown> | undefined;
  const counters = snap?.counters as Record<string, unknown> | undefined;
  const execution = snap?.execution as Record<string, unknown> | undefined;

  const schedulerEnabled =
    Boolean(scheduler?.enabled) || Boolean(scheduler?.running);

  const allow = execution?.allowlist;
  const allowlist = Array.isArray(allow) ? (allow as string[]) : [...CHAIN];

  return {
    loading: false,
    error: null,
    runtimeOnline: Boolean(status?.online),
    schedulerDisabled: !schedulerEnabled,
    workerReady: Boolean(worker),
    jobsPending: Number(counters?.pending ?? 0),
    jobsProcessing: Number(counters?.processing ?? 0),
    jobsFailed: Number(counters?.failed ?? 0),
    jobsDead: Number(counters?.dead_letter ?? counters?.deadLetter ?? 0),
    tenantMasked,
    allowlist,
  };
}

function RuntimeValidationPage() {
  const { profile } = useAuth();
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const navigate = useNavigate();
  const [preflight, setPreflight] = useState<PreflightState>({
    loading: true,
    error: null,
    runtimeOnline: false,
    schedulerDisabled: false,
    workerReady: false,
    jobsPending: 0,
    jobsProcessing: 0,
    jobsFailed: 0,
    jobsDead: 0,
    tenantMasked: "—",
    allowlist: [...CHAIN],
  });
  const [rows, setRows] = useState<AgentRow[]>(initRows(CHAIN));
  const [running, setRunning] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState<false | "chain" | "replace">(
    false,
  );
  const [summary, setSummary] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | null>(null);
  const [totalMs, setTotalMs] = useState<number | null>(null);

  const tenantMasked = mask(profile?.company_id ?? null);

  const refreshStatus = useCallback(async () => {
    try {
      const snap = await fetchStatus();
      setPreflight(extractPreflight(snap, tenantMasked));
    } catch (e) {
      setPreflight((p) => ({
        ...p,
        loading: false,
        error: e instanceof Error ? e.message : "erro",
      }));
    }
  }, [tenantMasked]);

  useEffect(() => {
    if (!adminLoading && isAdmin) void refreshStatus();
  }, [adminLoading, isAdmin, refreshStatus]);

  useEffect(() => {
    if (!adminLoading && !isAdmin) {
      // não-admin: redireciona para home.
      navigate({ to: "/" });
    }
  }, [adminLoading, isAdmin, navigate]);

  const blocked =
    !preflight.runtimeOnline ||
    !preflight.schedulerDisabled ||
    preflight.jobsProcessing > 0;

  const updateRow = useCallback(
    (agentId: AgentId, patch: Partial<AgentRow>) => {
      setRows((prev) =>
        prev.map((r) => (r.agentId === agentId ? { ...r, ...patch } : r)),
      );
    },
    [],
  );

  const executeSequence = useCallback(
    async (chain: readonly AgentId[]) => {
      setRunning(true);
      setSummary(null);
      setTotalMs(null);
      setRows(initRows(chain));
      const cid = `val-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setCorrelationId(cid);

      const started = Date.now();
      let stoppedAt: AgentId | null = null;

      for (const agentId of chain) {
        updateRow(agentId, { status: "queued" });
        updateRow(agentId, { status: "processing" });
        try {
          const { ok, data } = await runAgent(agentId, cid);
          const job = data.job as Record<string, unknown> | undefined;
          const exec = data.execution as Record<string, unknown> | undefined;
          const kb = exec?.knowledgeBus;
          updateRow(agentId, {
            status: ok ? "done" : "failed",
            jobId: (job?.id as string | undefined) ?? null,
            executionId: (exec?.executionId as string | undefined) ?? null,
            durationMs:
              typeof exec?.durationMs === "number"
                ? (exec.durationMs as number)
                : null,
            outcome: (exec?.outcome as string | undefined) ?? null,
            reason:
              (exec?.reason as string | undefined) ??
              (data.reason as string | undefined) ??
              null,
            knowledgeBus: kbSummary(kb),
            topic: publishedTopic(kb),
            error: ok
              ? null
              : (data.error as string | undefined) ??
                (data.reason as string | undefined) ??
                "falhou",
          });
          if (!ok) {
            stoppedAt = agentId;
            break;
          }
        } catch (e) {
          updateRow(agentId, {
            status: "failed",
            error: e instanceof Error ? e.message : "erro",
          });
          stoppedAt = agentId;
          break;
        }
      }

      setTotalMs(Date.now() - started);
      setRunning(false);
      setSummary(
        stoppedAt
          ? `Cadeia interrompida em "${stoppedAt}".`
          : `Cadeia concluída (${chain.length} agentes).`,
      );
      await refreshStatus();
    },
    [refreshStatus, updateRow],
  );

  if (adminLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Card className="p-6">
          <div className="flex items-center gap-3">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            <div>
              <div className="font-semibold">Acesso restrito</div>
              <div className="text-sm text-muted-foreground">
                Esta ferramenta é exclusiva para administradores.
              </div>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Validação do Runtime</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Esta ferramenta executa somente análises READ-ONLY. Nenhuma automação
          ou envio será ativado.
        </p>
      </div>

      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Pré-validação</h2>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => {
              setPreflight((p) => ({ ...p, loading: true }));
              void refreshStatus();
            }}
            disabled={running}
          >
            Atualizar
          </Button>
        </div>
        {preflight.loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> carregando snapshot…
          </div>
        ) : preflight.error ? (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <XCircle className="h-4 w-4" /> falha: {preflight.error}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <PreflightPill ok={preflight.runtimeOnline} label="Runtime" />
            <PreflightPill
              ok={preflight.schedulerDisabled}
              label="Scheduler off"
            />
            <PreflightPill ok={preflight.workerReady} label="Worker" />
            <PreflightPill ok label="Knowledge Bus" />
            <Metric label="pending" value={preflight.jobsPending} />
            <Metric label="processing" value={preflight.jobsProcessing} />
            <Metric label="failed" value={preflight.jobsFailed} />
            <Metric label="dead_letter" value={preflight.jobsDead} />
            <div className="col-span-2 md:col-span-4 text-xs text-muted-foreground">
              tenant: <span className="font-mono">{preflight.tenantMasked}</span>
              {" · "}
              agentes permitidos: {preflight.allowlist.length}
            </div>
          </div>
        )}
        {blocked && !preflight.loading && !preflight.error && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <div>
              Execução bloqueada.
              {!preflight.runtimeOnline && " Runtime offline."}
              {!preflight.schedulerDisabled && " Scheduler ativo."}
              {preflight.jobsProcessing > 0 &&
                ` ${preflight.jobsProcessing} job(s) em processamento.`}
            </div>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Cadeia de validação</h2>
          <div className="ml-auto flex gap-2">
            <Button
              onClick={() => setConfirmOpen("chain")}
              disabled={running || blocked}
              size="sm"
            >
              <Play className="mr-1.5 h-3.5 w-3.5" />
              Executar cadeia de validação
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmOpen("replace")}
              disabled={running || blocked}
            >
              <Repeat className="mr-1.5 h-3.5 w-3.5" />
              Testar replace do Business Brain
            </Button>
          </div>
        </div>

        {correlationId && (
          <div className="mb-3 text-xs text-muted-foreground">
            correlationId: <span className="font-mono">{correlationId}</span>
            {totalMs != null && (
              <>
                {" · "}
                duração total: <span className="font-mono">{totalMs} ms</span>
              </>
            )}
          </div>
        )}

        <div className="divide-y divide-border rounded-md border border-border">
          {rows.map((r) => (
            <AgentRowView key={r.agentId} row={r} />
          ))}
        </div>

        {summary && (
          <div className="mt-4 text-sm text-muted-foreground">{summary}</div>
        )}
      </Card>

      {confirmOpen && (
        <ConfirmDialog
          label={
            confirmOpen === "chain"
              ? "Executar a cadeia completa (9 agentes) READ-ONLY?"
              : "Reexecutar Business Brain → Business Learning?"
          }
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            const chain =
              confirmOpen === "chain"
                ? CHAIN
                : (["business-brain", "business-learning"] as const);
            setConfirmOpen(false);
            void executeSequence(chain);
          }}
        />
      )}
    </div>
  );
}

function PreflightPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
      ) : (
        <XCircle className="h-4 w-4 text-destructive" />
      )}
      <span>{label}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-sm">{value}</span>
    </div>
  );
}

function AgentRowView({ row }: { row: AgentRow }) {
  const badge = statusBadge(row.status);
  return (
    <div className="p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm">{row.agentId}</span>
        <Badge variant={badge.variant} className="text-[10px]">
          {badge.label}
        </Badge>
        {row.durationMs != null && (
          <span className="text-xs text-muted-foreground">
            {row.durationMs} ms
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          job {mask(row.jobId)} · exec {mask(row.executionId)}
        </span>
      </div>
      <div className="mt-1 grid grid-cols-1 gap-1 text-xs text-muted-foreground md:grid-cols-3">
        {row.outcome && <div>outcome: {row.outcome}</div>}
        {row.knowledgeBus && <div>bus: {row.knowledgeBus}</div>}
        {row.topic && <div>topic: {row.topic}</div>}
      </div>
      {row.error && (
        <div className="mt-1 text-xs text-destructive">erro: {row.error}</div>
      )}
    </div>
  );
}

function statusBadge(s: AgentStatus): {
  variant: "default" | "secondary" | "destructive" | "outline";
  label: string;
} {
  switch (s) {
    case "idle":
      return { variant: "outline", label: "aguardando" };
    case "queued":
      return { variant: "secondary", label: "enfileirando" };
    case "processing":
      return { variant: "secondary", label: "processando" };
    case "done":
      return { variant: "default", label: "concluído" };
    case "failed":
      return { variant: "destructive", label: "falhou" };
    case "blocked":
      return { variant: "destructive", label: "bloqueado" };
  }
}

function ConfirmDialog({
  label,
  onConfirm,
  onCancel,
}: {
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-md p-5">
        <div className="mb-3 flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Confirmar validação</h3>
        </div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Nenhum envio, follow-up ou alteração operacional será executada.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
          <Button size="sm" onClick={onConfirm}>
            CONFIRMAR VALIDAÇÃO
          </Button>
        </div>
      </Card>
    </div>
  );
}

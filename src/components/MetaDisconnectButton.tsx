// ============================================================================
// Botão "Desconectar Meta" — dry-run + confirmação textual + execução.
// Admin-only por convenção (o backend recusa não-admins com 403).
// Não altera outros fluxos: preserva histórico, apenas revoga acesso futuro.
// ============================================================================

import { useState } from "react";
import { AlertTriangle, PlugZap, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Mode = "dry-run" | "disconnect";

interface StepView {
  step: string;
  status: string;
  code?: string;
  detail?: string;
}

interface DryRunPayload {
  ok: true;
  mode: "dry-run";
  report: {
    integrationId: string;
    plan: {
      asset: {
        channel: string;
        hasAccessToken: boolean;
        hasWebhookSecret: boolean;
        externalAccountIdMasked: string | null;
        wabaIdMasked?: string | null;
        phoneMasked?: string | null;
        active: boolean;
      };
      metaPages: unknown[];
      actions: string[];
      risks: string[];
    };
    wouldExecute: string[];
  };
}

interface DisconnectPayload {
  ok: true;
  mode: "disconnect";
  report: {
    integrationId: string;
    status: string;
    alreadyDisconnected: boolean;
    steps: StepView[];
    manualActionsRequired: string[];
    durationMs: number;
  };
}

async function callDisconnect(
  integrationId: string,
  mode: Mode,
): Promise<DryRunPayload | DisconnectPayload> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sessão expirada");
  const res = await fetch("/api/meta/disconnect", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ integrationId, mode }),
  });
  const json = (await res.json()) as
    | DryRunPayload
    | DisconnectPayload
    | { error: string };
  if (!res.ok || !("ok" in json)) {
    throw new Error(
      "error" in json ? json.error : `HTTP ${res.status}`,
    );
  }
  return json;
}

export function MetaDisconnectButton({
  integrationId,
  onDisconnected,
}: {
  integrationId: string;
  onDisconnected: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"idle" | "dry" | "confirm" | "running" | "done">(
    "idle",
  );
  const [plan, setPlan] = useState<DryRunPayload["report"] | null>(null);
  const [result, setResult] = useState<DisconnectPayload["report"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const start = async () => {
    setOpen(true);
    setPhase("dry");
    setError(null);
    setResult(null);
    setPlan(null);
    try {
      const r = await callDisconnect(integrationId, "dry-run");
      if (r.mode !== "dry-run") throw new Error("resposta inesperada");
      setPlan(r.report);
      setPhase("confirm");
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro desconhecido");
      setPhase("idle");
    }
  };

  const confirm = async () => {
    if (confirmText.trim().toUpperCase() !== "DESCONECTAR") {
      setError("digite DESCONECTAR para confirmar");
      return;
    }
    setPhase("running");
    setError(null);
    try {
      const r = await callDisconnect(integrationId, "disconnect");
      if (r.mode !== "disconnect") throw new Error("resposta inesperada");
      setResult(r.report);
      setPhase("done");
      onDisconnected();
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro desconhecido");
      setPhase("confirm");
    }
  };

  const close = () => {
    setOpen(false);
    setPhase("idle");
    setPlan(null);
    setResult(null);
    setError(null);
    setConfirmText("");
  };

  return (
    <>
      <button
        onClick={start}
        className="text-[11px] font-semibold rounded-md bg-destructive/10 text-destructive px-2 py-1 hover:bg-destructive/20 inline-flex items-center gap-1"
        title="Desconectar Meta (revoga token e webhooks)"
      >
        <PlugZap className="h-3 w-3" />
        Desconectar Meta
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-background border border-border rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-4 border-b border-border flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <div className="font-semibold text-sm">Desconectar Meta</div>
            </div>

            <div className="p-4 space-y-3 text-sm">
              {phase === "dry" && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Analisando integração…
                </div>
              )}

              {phase === "confirm" && plan && (
                <>
                  <div className="rounded-md border border-border p-3 space-y-1 text-xs">
                    <div>
                      <span className="text-muted-foreground">Canal:</span>{" "}
                      <span className="font-semibold uppercase">{plan.plan.asset.channel}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">ID externo:</span>{" "}
                      <span className="font-mono">
                        {plan.plan.asset.externalAccountIdMasked ?? "—"}
                      </span>
                    </div>
                    {plan.plan.asset.wabaIdMasked && (
                      <div>
                        <span className="text-muted-foreground">WABA:</span>{" "}
                        <span className="font-mono">{plan.plan.asset.wabaIdMasked}</span>
                      </div>
                    )}
                    {plan.plan.asset.phoneMasked && (
                      <div>
                        <span className="text-muted-foreground">Telefone:</span>{" "}
                        <span className="font-mono">{plan.plan.asset.phoneMasked}</span>
                      </div>
                    )}
                    <div>
                      <span className="text-muted-foreground">Token presente:</span>{" "}
                      {plan.plan.asset.hasAccessToken ? "sim" : "não"}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Páginas locais:</span>{" "}
                      {plan.plan.metaPages.length}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-muted-foreground mb-1">
                      Ações que serão executadas
                    </div>
                    <ul className="text-xs space-y-1 list-disc pl-4">
                      {plan.wouldExecute.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </div>

                  {plan.plan.risks.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground mb-1">
                        Riscos
                      </div>
                      <ul className="text-xs space-y-1 list-disc pl-4 text-destructive">
                        {plan.plan.risks.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="rounded-md bg-secondary p-2 text-xs">
                    O histórico será preservado, mas novos eventos e mensagens deixarão de
                    ser recebidos.
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-muted-foreground block mb-1">
                      Digite <span className="font-mono">DESCONECTAR</span> para confirmar
                    </label>
                    <input
                      type="text"
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm font-mono"
                      placeholder="DESCONECTAR"
                      autoFocus
                    />
                  </div>
                </>
              )}

              {phase === "running" && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Executando desconexão…
                </div>
              )}

              {phase === "done" && result && (
                <>
                  <div
                    className={cn(
                      "rounded-md p-2 text-xs font-semibold uppercase",
                      result.status === "disconnected"
                        ? "bg-[var(--status-won)]/15 text-[var(--status-won)]"
                        : result.status === "partial_disconnect"
                          ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400"
                          : "bg-destructive/15 text-destructive",
                    )}
                  >
                    {result.status}
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground mb-1">
                      Etapas
                    </div>
                    <ul className="text-xs space-y-1">
                      {result.steps.map((s, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span
                            className={cn(
                              "font-mono text-[10px] px-1 rounded",
                              s.status === "ok" &&
                                "bg-[var(--status-won)]/15 text-[var(--status-won)]",
                              s.status === "failed" && "bg-destructive/15 text-destructive",
                              s.status === "skipped" && "bg-secondary text-muted-foreground",
                              s.status === "manual_action_required" &&
                                "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
                            )}
                          >
                            {s.status}
                          </span>
                          <span className="flex-1">
                            <span className="font-mono">{s.step}</span>
                            {s.detail && (
                              <span className="text-muted-foreground"> — {s.detail}</span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {result.manualActionsRequired.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground mb-1">
                        Ações manuais restantes
                      </div>
                      <ul className="text-xs space-y-1 list-disc pl-4">
                        {result.manualActionsRequired.map((m, i) => (
                          <li key={i}>{m}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}

              {error && (
                <div className="text-xs text-destructive font-semibold">{error}</div>
              )}
            </div>

            <div className="p-3 border-t border-border flex justify-end gap-2">
              {phase === "confirm" && (
                <button
                  onClick={confirm}
                  className="text-xs font-semibold rounded-md bg-destructive text-destructive-foreground px-3 py-1.5 hover:opacity-90"
                >
                  Confirmar desconexão
                </button>
              )}
              <button
                onClick={close}
                disabled={phase === "running" || phase === "dry"}
                className="text-xs font-semibold rounded-md bg-secondary text-foreground px-3 py-1.5 hover:bg-accent disabled:opacity-50"
              >
                {phase === "done" ? "Fechar" : "Cancelar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

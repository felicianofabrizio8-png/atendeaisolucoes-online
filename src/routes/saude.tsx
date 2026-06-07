// Health Dashboard — visão de saúde da operação. Acesso restrito a admin.
// Não altera funcionalidades: apenas leitura agregada do error_log, audit_log,
// integrations e webhooks recentes.

import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getHealthSummary } from "@/lib/health.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldAlert, XCircle } from "lucide-react";

export const Route = createFileRoute("/saude")({
  component: HealthPage,
});

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function timeAgo(iso: string | null): string {
  if (!iso) return "nunca";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return `há ${d} d`;
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
      ) : (
        <XCircle className="h-4 w-4 text-destructive" />
      )}
      <span className="text-sm font-medium">{label}</span>
      <Badge variant={ok ? "secondary" : "destructive"} className="text-[10px]">
        {ok ? "OK" : "Atenção"}
      </Badge>
    </div>
  );
}

function HealthPage() {
  const fetchHealth = useServerFn(getHealthSummary);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["health-summary"],
    queryFn: async () => {
      try {
        const r = await fetchHealth();
        // eslint-disable-next-line no-console
        console.log("[HEALTH PAGE] getHealthSummary ok. keys:", Object.keys(r ?? {}));
        return r;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[HEALTH PAGE ERROR] getHealthSummary threw", e);
        throw e;
      }
    },
    refetchInterval: 60_000,
  });

  if (error) {
    // eslint-disable-next-line no-console
    console.error("[HEALTH PAGE ERROR] useQuery error state", error);
  }

  if (isLoading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Carregando saúde do sistema…</div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Card className="p-6">
          <h2 className="text-base font-semibold text-destructive">Erro ao carregar Saúde</h2>
          <pre className="mt-2 text-xs whitespace-pre-wrap break-all">
            {(error as Error)?.name}: {(error as Error)?.message}
          </pre>
          <pre className="mt-2 text-[10px] whitespace-pre-wrap break-all text-muted-foreground max-h-60 overflow-auto">
            {(error as Error)?.stack}
          </pre>
        </Card>
      </div>
    );
  }

  if (!data?.ok) {
    return (
      <div className="p-6">
        <Card className="p-6 flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 text-amber-500 mt-0.5" />
          <div>
            <h2 className="text-base font-semibold">Acesso restrito</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Esta área é exclusiva para administradores da empresa.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  const alerts: { label: string; tone: "warn" | "error" }[] = [];
  if (!data.whatsapp.connected) alerts.push({ label: "WhatsApp não conectado", tone: "error" });
  if (!data.meta.connected) alerts.push({ label: "Meta não conectada", tone: "warn" });
  if (!data.ai.ok) alerts.push({ label: "Erros recentes na IA", tone: "warn" });
  if (data.whatsapp.lastError) alerts.push({ label: `WhatsApp: ${data.whatsapp.lastError}`, tone: "error" });
  if (data.meta.lastError) alerts.push({ label: `Meta: ${data.meta.lastError}`, tone: "error" });
  if (!data.lastWebhookAt || Date.now() - new Date(data.lastWebhookAt).getTime() > 24 * 3600_000) {
    alerts.push({ label: "Sem webhooks nas últimas 24h", tone: "warn" });
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-full overflow-x-hidden">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold">Saúde do sistema</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Atualizado {timeAgo(data.generatedAt)} · auto a cada 60s
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {alerts.length > 0 && (
        <Card className="p-4 border-amber-500/30 bg-amber-500/5">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <h2 className="text-sm font-semibold">Alertas internos ({alerts.length})</h2>
          </div>
          <ul className="space-y-1 text-sm">
            {alerts.map((a, i) => (
              <li key={i} className="flex items-start gap-2">
                <span
                  className={`mt-1 inline-block h-1.5 w-1.5 rounded-full ${
                    a.tone === "error" ? "bg-destructive" : "bg-amber-500"
                  }`}
                />
                <span>{a.label}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4 space-y-2">
          <StatusPill ok={data.whatsapp.connected} label="WhatsApp" />
          <p className="text-xs text-muted-foreground">
            Última sync: {timeAgo(data.whatsapp.lastSyncedAt)}
          </p>
          <p className="text-xs text-muted-foreground">
            Última msg: {timeAgo(data.lastWhatsappMessageAt)}
          </p>
        </Card>
        <Card className="p-4 space-y-2">
          <StatusPill ok={data.meta.connected} label="Meta (Ads/IG/FB)" />
          <p className="text-xs text-muted-foreground">
            Última sync: {timeAgo(data.meta.lastSyncedAt)}
          </p>
          {data.meta.lastError && (
            <p className="text-xs text-destructive truncate" title={data.meta.lastError}>
              {data.meta.lastError}
            </p>
          )}
        </Card>
        <Card className="p-4 space-y-2">
          <StatusPill ok={data.ai.ok} label="IA de Atendimento" />
          <p className="text-xs text-muted-foreground">
            Último erro: {timeAgo(data.ai.lastErrorAt)}
          </p>
          {data.ai.lastError && (
            <p className="text-xs text-muted-foreground truncate" title={data.ai.lastError}>
              {data.ai.lastError}
            </p>
          )}
        </Card>
        <Card className="p-4 space-y-2">
          <StatusPill ok={Boolean(data.lastWebhookAt)} label="Webhooks" />
          <p className="text-xs text-muted-foreground">
            Último recebido: {timeAgo(data.lastWebhookAt)}
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3">Erros nos últimos 7 dias</h3>
          <div className="flex items-end gap-1 h-24">
            {data.errorCountsByDay.map((d) => {
              const max = Math.max(1, ...data.errorCountsByDay.map((x) => x.count));
              const h = Math.round((d.count / max) * 100);
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full bg-primary/70 rounded-sm min-h-[2px]"
                    style={{ height: `${h}%` }}
                    title={`${d.date}: ${d.count}`}
                  />
                  <span className="text-[9px] text-muted-foreground">
                    {d.date.slice(5)}
                  </span>
                </div>
              );
            })}
          </div>
          {data.errorBySource.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {data.errorBySource.map((s) => (
                <Badge key={s.source} variant="outline" className="text-[10px]">
                  {s.source}: {s.count}
                </Badge>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3">Integrações</h3>
          <div className="space-y-2">
            {data.integrations.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhuma integração configurada.</p>
            )}
            {data.integrations.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-2 text-sm border-b border-border/40 pb-2 last:border-0">
                <div className="min-w-0">
                  <div className="font-medium truncate">{i.display_name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {i.channel} · sync {timeAgo(i.last_synced_at)}
                  </div>
                </div>
                <Badge variant={i.active && i.has_access_token ? "secondary" : "destructive"} className="text-[10px] shrink-0">
                  {i.active && i.has_access_token ? "Ativa" : "Inativa"}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Erros recentes ({data.recentErrors.length})</h3>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="py-2 pr-2">Quando</th>
                <th className="py-2 pr-2">Origem</th>
                <th className="py-2 pr-2">Severidade</th>
                <th className="py-2">Mensagem</th>
              </tr>
            </thead>
            <tbody>
              {data.recentErrors.length === 0 && (
                <tr><td colSpan={4} className="py-3 text-xs text-muted-foreground">Sem erros registrados — tudo certo.</td></tr>
              )}
              {data.recentErrors.map((e) => (
                <tr key={e.id} className="border-b border-border/40">
                  <td className="py-2 pr-2 text-xs text-muted-foreground whitespace-nowrap">{timeAgo(e.created_at)}</td>
                  <td className="py-2 pr-2"><Badge variant="outline" className="text-[10px]">{e.source}</Badge></td>
                  <td className="py-2 pr-2 text-xs">{e.severity}</td>
                  <td className="py-2 text-xs truncate max-w-[280px]" title={e.message}>{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Auditoria recente ({data.recentAudit.length})</h3>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="py-2 pr-2">Quando</th>
                <th className="py-2 pr-2">Ação</th>
                <th className="py-2 pr-2">Entidade</th>
                <th className="py-2">Referência</th>
              </tr>
            </thead>
            <tbody>
              {data.recentAudit.length === 0 && (
                <tr><td colSpan={4} className="py-3 text-xs text-muted-foreground">Sem registros ainda.</td></tr>
              )}
              {data.recentAudit.map((a) => (
                <tr key={a.id} className="border-b border-border/40">
                  <td className="py-2 pr-2 text-xs text-muted-foreground whitespace-nowrap" title={fmtDate(a.created_at)}>{timeAgo(a.created_at)}</td>
                  <td className="py-2 pr-2 text-xs font-medium">{a.action}</td>
                  <td className="py-2 pr-2 text-xs">{a.entity}</td>
                  <td className="py-2 text-xs text-muted-foreground truncate max-w-[200px]">{a.entity_id ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

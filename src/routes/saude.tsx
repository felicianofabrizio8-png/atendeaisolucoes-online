// Health Dashboard — Centro de Operações (NOC) Enterprise.
// Reorganização VISUAL apenas: reutiliza integralmente o `getHealthSummary`
// (mesma query, mesmo polling, mesmo shape). Nenhuma API, consulta ou lógica
// foi alterada — só a apresentação dos dados já existentes.

import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { getHealthSummary } from "@/lib/health.functions";
import type { HealthSummary, HealthIntegration } from "@/lib/health.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  Facebook,
  Instagram,
  MessageSquare,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Webhook,
  XCircle,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/saude")({
  component: HealthPage,
});

// ─────────────────── utils ───────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
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

type Tone = "ok" | "info" | "warn" | "crit" | "idle";

const toneStyles: Record<Tone, { dot: string; ring: string; text: string; bg: string }> = {
  ok:   { dot: "bg-emerald-500", ring: "ring-emerald-500/30", text: "text-emerald-500", bg: "bg-emerald-500/10" },
  info: { dot: "bg-sky-500",     ring: "ring-sky-500/30",     text: "text-sky-500",     bg: "bg-sky-500/10" },
  warn: { dot: "bg-amber-500",   ring: "ring-amber-500/30",   text: "text-amber-500",   bg: "bg-amber-500/10" },
  crit: { dot: "bg-red-500",     ring: "ring-red-500/30",     text: "text-red-500",     bg: "bg-red-500/10" },
  idle: { dot: "bg-muted-foreground", ring: "ring-muted-foreground/20", text: "text-muted-foreground", bg: "bg-muted/40" },
};

function channelMeta(channel: string) {
  switch (channel) {
    case "whatsapp":  return { icon: MessageSquare, label: "WhatsApp",  color: "text-emerald-500" };
    case "instagram": return { icon: Instagram,     label: "Instagram", color: "text-pink-500" };
    case "facebook":  return { icon: Facebook,      label: "Facebook",  color: "text-blue-500" };
    default:          return { icon: Zap,           label: channel,     color: "text-primary" };
  }
}

// Palavras-chave que caracterizam um erro REAL de integração
// (auth/token/assinatura/HTTP/timeout/conexão/webhook rejeitado).
const REAL_ERROR_RE =
  /(unauthor|forbidden|invalid[_ ]?token|token[_ ]?expired|expired|signature|assinatura|reject|http\s*[45]\d\d|status\s*[45]\d\d|timeout|econn|network|refused|disconnect|desconect)/i;

function isRealError(msg: string | null | undefined): boolean {
  if (!msg) return false;
  return REAL_ERROR_RE.test(msg);
}

function integrationTone(i: HealthIntegration): Tone {
  // Desconectada ou sem token → crítico.
  if (!i.active || !i.has_access_token) return "crit";
  // Token já expirado → crítico; expira em breve → atenção.
  if (i.token_expires_at) {
    const days = (new Date(i.token_expires_at).getTime() - Date.now()) / 86_400_000;
    if (days < 0) return "crit";
    if (days < 3) return "warn";
  }
  // Erro registrado: só é crítico se for um erro real de comunicação.
  if (i.last_error) return isRealError(i.last_error) ? "crit" : "warn";
  // Silêncio prolongado (>24h) sem erro é apenas informativo.
  if (i.last_synced_at) {
    const hours = (Date.now() - new Date(i.last_synced_at).getTime()) / 3_600_000;
    if (hours > 24) return "info";
  }
  return "ok";
}

interface DerivedAlert {
  id: string;
  tone: Tone;
  title: string;
  detail: string;
  when: string | null;
  action: string;
}

function deriveAlerts(data: HealthSummary): DerivedAlert[] {
  const alerts: DerivedAlert[] = [];

  if (!data.whatsapp.connected) {
    alerts.push({
      id: "wa-off", tone: "crit",
      title: "WhatsApp não conectado",
      detail: "Nenhum token ativo para envio/recebimento.",
      when: null,
      action: "Ir para Configurações › WhatsApp e conectar a conta.",
    });
  }
  if (data.whatsapp.lastError) {
    const tone: Tone = isRealError(data.whatsapp.lastError) ? "crit" : "warn";
    alerts.push({
      id: "wa-err", tone,
      title: "Erro no WhatsApp",
      detail: data.whatsapp.lastError,
      when: data.whatsapp.lastSyncedAt,
      action: "Revisar credenciais e reenviar teste.",
    });
  }

  // Meta nunca conectada é apenas informativo.
  if (!data.meta.connected) {
    alerts.push({
      id: "meta-off", tone: "info",
      title: "Meta (IG/FB) não conectada",
      detail: "Sem integração ativa com Instagram/Facebook.",
      when: null,
      action: "Conectar Meta em Configurações › Integrações.",
    });
  }
  if (data.meta.lastError) {
    const tone: Tone = isRealError(data.meta.lastError) ? "crit" : "warn";
    alerts.push({
      id: "meta-err", tone,
      title: "Erro na Meta",
      detail: data.meta.lastError,
      when: data.meta.lastSyncedAt,
      action: "Renovar token da página/conta Meta.",
    });
  }

  if (!data.ai.ok) {
    const tone: Tone = isRealError(data.ai.lastError) ? "crit" : "warn";
    alerts.push({
      id: "ai-err", tone,
      title: "IA com erros recentes",
      detail: data.ai.lastError ?? "Falha ao invocar IA nas últimas 24h.",
      when: data.ai.lastErrorAt,
      action: "Verificar chaves e limites do provedor.",
    });
  }

  // Integrações ativas silenciosas há muito tempo → apenas informativo.
  for (const i of data.integrations) {
    if (!i.active || !i.has_access_token || i.last_error) continue;
    if (!i.last_synced_at) continue;
    const days = Math.floor((Date.now() - new Date(i.last_synced_at).getTime()) / 86_400_000);
    if (days >= 2) {
      const meta = channelMeta(i.channel);
      alerts.push({
        id: `idle-${i.id}`, tone: "info",
        title: `${meta.label} sem eventos há ${days} ${days === 1 ? "dia" : "dias"}`,
        detail: "Nenhum webhook recebido recentemente — pode ser apenas baixo movimento.",
        when: i.last_synced_at,
        action: "Verificar se há campanhas ativas ou testar envio manual.",
      });
    }
  }

  // Ausência de webhooks nas últimas 24h agora é INFORMATIVO (baixo movimento).
  if (!data.lastWebhookAt || Date.now() - new Date(data.lastWebhookAt).getTime() > 24 * 3_600_000) {
    alerts.push({
      id: "wh-idle", tone: "info",
      title: "Nenhum webhook nas últimas 24h",
      detail: "Sem eventos externos no período — normal fora do horário comercial ou em baixo movimento.",
      when: data.lastWebhookAt,
      action: "Nenhuma ação necessária se as integrações estão conectadas.",
    });
  }

  return alerts;
}

function computeHealthScore(data: HealthSummary, alerts: DerivedAlert[]): number {
  let score = 100;
  for (const a of alerts) {
    if (a.tone === "crit") score -= 25;
    else if (a.tone === "warn") score -= 8;
    else if (a.tone === "info") score -= 2;
  }
  const errorsToday = data.errorCountsByDay[data.errorCountsByDay.length - 1]?.count ?? 0;
  if (errorsToday > 10) score -= 10;
  else if (errorsToday > 0) score -= 3;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function overallStatus(
  data: HealthSummary,
  alerts: DerivedAlert[],
  score: number,
): { tone: Tone; label: string; sub: string } {
  if (alerts.some((a) => a.tone === "crit")) {
    return { tone: "crit", label: "Crítico", sub: "Ação imediata recomendada." };
  }
  if (alerts.some((a) => a.tone === "warn")) {
    return { tone: "warn", label: "Atenção", sub: "Itens exigindo revisão." };
  }
  const hasInfoOnly = alerts.some((a) => a.tone === "info");
  if (hasInfoOnly) {
    return {
      tone: "ok",
      label: "Sistema saudável",
      sub: `Baixo movimento detectado — score ${score}/100.`,
    };
  }
  if (data.whatsapp.connected && data.ai.ok && data.lastWebhookAt) {
    return { tone: "ok", label: "Excelente", sub: "Todos os sistemas operando normalmente." };
  }
  return { tone: "ok", label: "Bom", sub: "Operando dentro do esperado." };
}

// ─────────────────── UI blocks ───────────────────

function Stat({ label, value, sub, tone = "idle", icon: Icon }: {
  label: string; value: string | number; sub?: string; tone?: Tone; icon?: typeof Activity;
}) {
  const t = toneStyles[tone];
  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        {Icon && <Icon className={cn("h-3.5 w-3.5", t.text)} aria-hidden="true" />}
        <span>{label}</span>
      </div>
      <div className="mt-1 text-2xl font-semibold text-foreground tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function IntegrationCard({ i }: { i: HealthIntegration }) {
  const tone = integrationTone(i);
  const t = toneStyles[tone];
  const meta = channelMeta(i.channel);
  const Icon = meta.icon;
  const label =
    tone === "ok" ? "Operacional"
    : tone === "info" ? "Baixo movimento"
    : tone === "warn" ? "Atenção"
    : "Crítico";
  return (
    <div className={cn("relative rounded-2xl border border-border bg-card p-5 overflow-hidden group",
      "hover:border-primary/40 transition-colors")}>
      <div className={cn("absolute inset-x-0 -top-px h-px", t.bg)} aria-hidden="true" />
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn("h-10 w-10 rounded-xl bg-muted/60 flex items-center justify-center ring-1", t.ring)}>
            <Icon className={cn("h-5 w-5", meta.color)} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground truncate">{i.display_name || meta.label}</div>
            <div className="text-[11px] text-muted-foreground truncate">{meta.label}</div>
          </div>
        </div>
        <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-full",
          t.bg, t.text)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", t.dot)} aria-hidden="true" />
          {label}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div>
          <dt className="text-muted-foreground">Última sync</dt>
          <dd className="text-foreground font-medium">{timeAgo(i.last_synced_at)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Token</dt>
          <dd className="text-foreground font-medium">
            {i.token_expires_at ? `expira ${timeAgo(i.token_expires_at)}` : i.has_access_token ? "presente" : "ausente"}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-muted-foreground">Último erro</dt>
          <dd className={cn("truncate", i.last_error ? "text-red-500" : "text-emerald-500")}
            title={i.last_error ?? ""}>
            {i.last_error ?? "nenhum"}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function SparkBars({ data }: { data: { date: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="flex items-end gap-1.5 h-28">
      {data.map((d) => {
        const h = Math.max(4, Math.round((d.count / max) * 100));
        const tone: Tone = d.count === 0 ? "ok" : d.count > max * 0.6 ? "crit" : "warn";
        return (
          <div key={d.date} className="flex-1 flex flex-col items-center gap-1.5" title={`${d.date}: ${d.count}`}>
            <div className="w-full flex-1 flex items-end">
              <div
                className={cn("w-full rounded-md transition-all",
                  tone === "ok" && "bg-emerald-500/50",
                  tone === "warn" && "bg-amber-500/70",
                  tone === "crit" && "bg-red-500/80")}
                style={{ height: `${h}%` }}
              />
            </div>
            <span className="text-[9px] text-muted-foreground tabular-nums">{d.date.slice(5)}</span>
          </div>
        );
      })}
    </div>
  );
}

function TimelineItem({ time, title, meta, dotTone = "idle" }: {
  time: string; title: string; meta?: string; dotTone?: Tone;
}) {
  const t = toneStyles[dotTone];
  return (
    <li className="relative pl-8 pb-4 last:pb-0">
      <span className="absolute left-2 top-0 bottom-0 w-px bg-border" aria-hidden="true" />
      <span className={cn("absolute left-[3px] top-1.5 h-3 w-3 rounded-full ring-4 ring-background", t.dot)} aria-hidden="true" />
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{time}</span>
        <span className="text-sm font-medium text-foreground">{title}</span>
      </div>
      {meta && <div className="text-[11px] text-muted-foreground mt-0.5">{meta}</div>}
    </li>
  );
}

// ─────────────────── page ───────────────────

function HealthPage() {
  const fetchHealth = useServerFn(getHealthSummary);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["health-summary"],
    queryFn: () => fetchHealth(),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const [showAllErrors, setShowAllErrors] = useState(false);
  const [showAllAudit, setShowAllAudit] = useState(false);

  const alerts = useMemo(() => (data?.ok ? deriveAlerts(data) : []), [data]);
  const status = useMemo(
    () => (data?.ok ? overallStatus(data, alerts) : null),
    [data, alerts],
  );

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando saúde do sistema…</div>;
  }

  if (error) {
    return (
      <div className="p-6">
        <Card className="p-6">
          <h2 className="text-base font-semibold text-destructive">Erro ao carregar Saúde</h2>
          <pre className="mt-2 text-xs whitespace-pre-wrap break-all">
            {(error as Error)?.name}: {(error as Error)?.message}
          </pre>
        </Card>
      </div>
    );
  }

  if (!data?.ok || !status) {
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

  const t = toneStyles[status.tone];
  const activeIntegrations = data.integrations.filter((i) => i.active && i.has_access_token).length;
  const totalIntegrations = data.integrations.length;
  const totalErrors7d = data.errorCountsByDay.reduce((s, d) => s + d.count, 0);
  const errorsToday = data.errorCountsByDay[data.errorCountsByDay.length - 1]?.count ?? 0;

  const errors = showAllErrors ? data.recentErrors : data.recentErrors.slice(0, 6);
  const audit = showAllAudit ? data.recentAudit : data.recentAudit.slice(0, 8);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-full overflow-x-hidden">
      {/* ── HEADER EXECUTIVO ── */}
      <section
        aria-labelledby="health-hero"
        className={cn(
          "relative overflow-hidden rounded-3xl border border-border p-6 md:p-8",
          "bg-gradient-to-br from-card via-card to-background",
        )}
      >
        <div
          aria-hidden="true"
          className={cn("absolute -top-24 -right-24 h-72 w-72 rounded-full blur-3xl opacity-30", t.bg)}
        />
        <div className="relative flex flex-col lg:flex-row lg:items-center gap-6 lg:justify-between">
          <div className="flex items-start gap-4 min-w-0">
            <div className={cn("relative h-14 w-14 shrink-0 rounded-2xl flex items-center justify-center ring-1", t.bg, t.ring)}>
              {status.tone === "ok" ? (
                <CheckCircle2 className={cn("h-7 w-7", t.text)} />
              ) : status.tone === "warn" ? (
                <AlertTriangle className={cn("h-7 w-7", t.text)} />
              ) : (
                <XCircle className={cn("h-7 w-7", t.text)} />
              )}
              <span className={cn("absolute inset-0 rounded-2xl animate-ping opacity-20", t.bg)} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Saúde geral do sistema</div>
              <h1 id="health-hero" className={cn("mt-1 text-3xl md:text-4xl font-semibold", t.text)}>
                {status.label}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">{status.sub}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[11px]">
              {activeIntegrations}/{totalIntegrations} integrações ativas
            </Badge>
            <Badge variant="outline" className={cn("text-[11px]", alerts.length > 0 && "border-amber-500/40 text-amber-500")}>
              {alerts.length} alertas
            </Badge>
            <Badge variant="outline" className="text-[11px]">
              Atualizado {timeAgo(data.generatedAt)}
            </Badge>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={cn("h-3.5 w-3.5 mr-2", isFetching && "animate-spin")} />
              Atualizar
            </Button>
          </div>
        </div>

        {/* estatísticas rápidas */}
        <div className="relative mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat
            label="WhatsApp"
            value={data.whatsapp.connected ? "Online" : "Offline"}
            sub={`última msg ${timeAgo(data.lastWhatsappMessageAt)}`}
            tone={data.whatsapp.connected ? "ok" : "crit"}
            icon={MessageSquare}
          />
          <Stat
            label="Webhooks"
            value={data.lastWebhookAt ? "Recebendo" : "Silencioso"}
            sub={`último ${timeAgo(data.lastWebhookAt)}`}
            tone={data.lastWebhookAt ? "ok" : "warn"}
            icon={Webhook}
          />
          <Stat
            label="IA"
            value={data.ai.ok ? "OK" : "Degradada"}
            sub={data.ai.lastErrorAt ? `último erro ${timeAgo(data.ai.lastErrorAt)}` : "sem erros recentes"}
            tone={data.ai.ok ? "ok" : "warn"}
            icon={Sparkles}
          />
          <Stat
            label="Erros hoje"
            value={errorsToday}
            sub={`${totalErrors7d} nos últimos 7 dias`}
            tone={errorsToday === 0 ? "ok" : errorsToday > 10 ? "crit" : "warn"}
            icon={Activity}
          />
        </div>
      </section>

      {/* ── ALERTAS ATIVOS ── */}
      <section aria-labelledby="alerts-title">
        <div className="flex items-center justify-between mb-3">
          <h2 id="alerts-title" className="text-sm font-semibold flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Alertas ativos
            <span className="text-muted-foreground font-normal">({alerts.length})</span>
          </h2>
        </div>
        {alerts.length === 0 ? (
          <Card className="p-5 flex items-center gap-3 border-emerald-500/30 bg-emerald-500/5">
            <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
            <div className="text-sm">
              <div className="font-medium text-emerald-500">Nenhum alerta ativo</div>
              <div className="text-xs text-muted-foreground">Todos os subsistemas operando dentro dos parâmetros.</div>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {alerts.map((a) => {
              const ts = toneStyles[a.tone];
              return (
                <Card key={a.id} className={cn("p-4 border-l-4",
                  a.tone === "crit" ? "border-l-red-500" : "border-l-amber-500")}>
                  <div className="flex items-start gap-3">
                    <div className={cn("h-8 w-8 shrink-0 rounded-lg flex items-center justify-center", ts.bg)}>
                      {a.tone === "crit"
                        ? <XCircle className={cn("h-4 w-4", ts.text)} />
                        : <AlertTriangle className={cn("h-4 w-4", ts.text)} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-foreground">{a.title}</span>
                        <span className={cn("text-[10px] uppercase px-1.5 py-0.5 rounded", ts.bg, ts.text)}>
                          {a.tone === "crit" ? "Crítico" : "Atenção"}
                        </span>
                        {a.when && (
                          <span className="text-[11px] text-muted-foreground">· {timeAgo(a.when)}</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 break-words">{a.detail}</p>
                      <p className="text-[11px] text-foreground/80 mt-2 flex items-center gap-1">
                        <ChevronRight className="h-3 w-3" />
                        {a.action}
                      </p>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* ── INTEGRAÇÕES ── */}
      <section aria-labelledby="integr-title">
        <div className="flex items-center justify-between mb-3">
          <h2 id="integr-title" className="text-sm font-semibold flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Integrações
            <span className="text-muted-foreground font-normal">({totalIntegrations})</span>
          </h2>
        </div>
        {data.integrations.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground text-center">
            Nenhuma integração configurada ainda.
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.integrations.map((i) => <IntegrationCard key={i.id} i={i} />)}
          </div>
        )}
      </section>

      {/* ── GRÁFICO + TIMELINE ── */}
      <section className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        <Card className="p-5 lg:col-span-3">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold">Erros — últimos 7 dias</h3>
              <p className="text-[11px] text-muted-foreground">Distribuição por dia · total {totalErrors7d}</p>
            </div>
            <Badge variant="outline" className="text-[10px]">
              {data.errorBySource.length} fontes
            </Badge>
          </div>
          <SparkBars data={data.errorCountsByDay} />
          {data.errorBySource.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-4">
              {data.errorBySource.map((s) => (
                <span key={s.source}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-foreground/80">
                  {s.source} · <span className="font-semibold">{s.count}</span>
                </span>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              Eventos recentes
            </h3>
          </div>
          {audit.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sem registros ainda.</p>
          ) : (
            <ol className="list-none p-0 m-0">
              {audit.map((a) => (
                <TimelineItem
                  key={a.id}
                  time={fmtTime(a.created_at)}
                  title={a.action}
                  meta={`${a.entity}${a.entity_id ? ` · ${a.entity_id.slice(0, 8)}` : ""} · ${timeAgo(a.created_at)}`}
                  dotTone="ok"
                />
              ))}
            </ol>
          )}
          {data.recentAudit.length > 8 && (
            <Button variant="ghost" size="sm" className="mt-2 text-xs"
              onClick={() => setShowAllAudit((s) => !s)}>
              {showAllAudit ? "Mostrar menos" : `Ver auditoria completa (${data.recentAudit.length})`}
            </Button>
          )}
        </Card>
      </section>

      {/* ── DETALHES TÉCNICOS ── */}
      <details className="group rounded-2xl border border-border bg-card/50 open:bg-card">
        <summary className="cursor-pointer list-none p-4 flex items-center justify-between text-sm font-medium">
          <span className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            Detalhes técnicos — erros brutos ({data.recentErrors.length})
          </span>
          <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
        </summary>
        <div className="border-t border-border p-4">
          {data.recentErrors.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sem erros registrados no período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[520px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                    <th className="py-2 pr-3">Quando</th>
                    <th className="py-2 pr-3">Origem</th>
                    <th className="py-2 pr-3">Severidade</th>
                    <th className="py-2">Mensagem</th>
                  </tr>
                </thead>
                <tbody>
                  {errors.map((e) => (
                    <tr key={e.id} className="border-b border-border/40 last:border-0">
                      <td className="py-2 pr-3 text-xs text-muted-foreground whitespace-nowrap"
                        title={fmtDate(e.created_at)}>
                        {timeAgo(e.created_at)}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant="outline" className="text-[10px]">{e.source}</Badge>
                      </td>
                      <td className="py-2 pr-3 text-xs">{e.severity}</td>
                      <td className="py-2 text-xs break-words" title={e.message}>{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.recentErrors.length > 6 && (
                <Button variant="ghost" size="sm" className="mt-2 text-xs"
                  onClick={() => setShowAllErrors((s) => !s)}>
                  {showAllErrors ? "Mostrar menos" : `Ver todos (${data.recentErrors.length})`}
                </Button>
              )}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

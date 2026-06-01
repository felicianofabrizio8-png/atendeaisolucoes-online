// ============================================================================
// AIFollowupPanel — V2 UI
// Apenas conecta UI às APIs já existentes (/api/ai/followup-config,
// /api/ai/followup-reactivate). NÃO altera backend.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock,
  Flame,
  Loader2,
  MessageSquare,
  Play,
  RefreshCw,
  Save,
  Sparkles,
  Target,
  XCircle,
  Zap,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

type Rule =
  | "quote_no_reply"
  | "lead_silent"
  | "visit_no_return"
  | "hot_lead_idle"
  | "returning_customer";

const RULE_LABEL: Record<Rule, string> = {
  quote_no_reply: "Orçamento enviado sem resposta",
  lead_silent: "Cliente sumiu",
  visit_no_return: "Visita realizada sem retorno",
  hot_lead_idle: "Lead quente parado",
  returning_customer: "Cliente voltou após dias",
};

interface Settings {
  enabled: boolean;
  maxPerLead: number;
  minHoursBetween: number;
  quoteDelayHours: number;
  silenceDelayHours: number;
  visitDelayHours: number;
  hotDelayHours: number;
  businessHoursOnly: boolean;
  tone: string;
  templates: Record<Rule, string>;
  agentName: string;
}

interface V2Settings {
  humanize: boolean;
  delayJitterMinutes: number;
  dailyLimit: number;
  minResponseRate: number;
  warmupEnabled: boolean;
  warmupStartedAt: string | null;
  reactivationEnabled: boolean;
  reactivationDays: number;
  reactivationDailyMax: number;
  reactivationHoursStart: string;
  reactivationHoursEnd: string;
  reactivationTemplate: string;
}

interface LogRow {
  id: string;
  rule_type: Rule;
  attempt_number: number;
  message_text: string;
  status: "sent" | "responded" | "recovered" | "ignored" | "failed" | "cancelled";
  sent_at: string;
  responded_at: string | null;
  response_outcome: string | null;
  conversation_id: string;
  lead_id: string | null;
  trigger_reason: string | null;
  cancel_reason: string | null;
  cancelled_at: string | null;
  lead_temperature: "hot" | "warm" | "cold" | null;
  metadata?: Record<string, unknown> | null;
}

interface Metrics {
  sent: number;
  responded: number;
  recovered: number;
  failed: number;
  responseRate: number;
  bestHour: number | null;
  bestRule: Rule | null;
  bestRuleRate: number;
}

interface WhatsappStatus {
  connected: boolean;
  hasUnmapped: boolean;
  unmappedCount: number;
  displayName: string | null;
}

interface Gate {
  ok: boolean;
  reason?: string;
  remainingToday?: number;
}

interface Analytics {
  byDay: Array<{ day: string; sent: number; responded: number; recovered: number }>;
  byRule: Array<{ rule: string; sent: number; responded: number; rate: number }>;
  recoveredValue: number;
  bestHour: number | null;
  bestTemplate: string | null;
  bestTemplateRate: number;
  todaySent: number;
  todayLimit: number;
}

interface Temperatures {
  hot: number;
  warm: number;
  cold: number;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtMoney(n: number) {
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

function TempBadge({ t }: { t: LogRow["lead_temperature"] }) {
  if (t === "hot")
    return (
      <Badge className="bg-orange-500/15 text-orange-600 border-orange-500/30">
        🔥 Quente
      </Badge>
    );
  if (t === "warm")
    return (
      <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30">
        🟡 Morno
      </Badge>
    );
  if (t === "cold")
    return <Badge variant="secondary">⚪ Frio</Badge>;
  return null;
}

function StatusBadge({ status }: { status: LogRow["status"] }) {
  if (status === "recovered")
    return (
      <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30">
        Lead recuperado
      </Badge>
    );
  if (status === "responded")
    return (
      <Badge className="bg-primary/15 text-primary border-primary/30">
        Respondido
      </Badge>
    );
  if (status === "cancelled")
    return (
      <Badge className="bg-muted text-muted-foreground border-muted">
        Cancelado
      </Badge>
    );
  if (status === "failed") return <Badge variant="destructive">Bloqueado</Badge>;
  if (status === "ignored") return <Badge variant="secondary">Ignorado</Badge>;
  return <Badge variant="outline">Enviado</Badge>;
}

function MiniBars({ data }: { data: Analytics["byDay"] }) {
  if (!data.length)
    return (
      <p className="text-xs text-muted-foreground">Sem dados nos últimos 30 dias.</p>
    );
  const max = Math.max(1, ...data.map((d) => d.sent));
  return (
    <div className="flex items-end gap-[2px] h-24">
      {data.slice(-30).map((d) => {
        const sentH = (d.sent / max) * 100;
        const respH = d.sent ? (d.responded / d.sent) * sentH : 0;
        return (
          <div
            key={d.day}
            className="flex-1 relative bg-muted rounded-sm overflow-hidden"
            title={`${d.day}: ${d.sent} enviado(s), ${d.responded} resp., ${d.recovered} recup.`}
            style={{ height: `${Math.max(4, sentH)}%` }}
          >
            <div
              className="absolute bottom-0 left-0 right-0 bg-primary/70"
              style={{ height: `${respH}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

export function AIFollowupPanel() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [v2, setV2] = useState<V2Settings | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [whatsapp, setWhatsapp] = useState<WhatsappStatus | null>(null);
  const [gate, setGate] = useState<Gate | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [temps, setTemps] = useState<Temperatures | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [reactivating, setReactivating] = useState(false);

  const authHeaders = async () => {
    const { data } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${data.session?.access_token ?? ""}` };
  };

  const load = async () => {
    setLoading(true);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/ai/followup-config", { headers });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Falha");
      setSettings(json.settings);
      setV2(json.v2 ?? null);
      setLog(json.log ?? []);
      setMetrics(json.metrics ?? null);
      setWhatsapp(json.whatsapp ?? null);
      setGate(json.gate ?? null);
      setAnalytics(json.analytics ?? null);
      setTemps(json.temperatures ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const headers = {
        ...(await authHeaders()),
        "Content-Type": "application/json",
      };
      const body: Record<string, unknown> = {
        enabled: settings.enabled,
        maxPerLead: settings.maxPerLead,
        minHoursBetween: settings.minHoursBetween,
        quoteDelayHours: settings.quoteDelayHours,
        silenceDelayHours: settings.silenceDelayHours,
        visitDelayHours: settings.visitDelayHours,
        hotDelayHours: settings.hotDelayHours,
        businessHoursOnly: settings.businessHoursOnly,
        tone: settings.tone,
        templates: settings.templates,
      };
      if (v2) {
        body.humanize = v2.humanize;
        body.delayJitterMinutes = v2.delayJitterMinutes;
        body.dailyLimit = v2.dailyLimit;
        body.minResponseRate = v2.minResponseRate;
        body.warmupEnabled = v2.warmupEnabled;
        body.reactivationEnabled = v2.reactivationEnabled;
        body.reactivationDays = v2.reactivationDays;
        body.reactivationDailyMax = v2.reactivationDailyMax;
        body.reactivationHoursStart = v2.reactivationHoursStart;
        body.reactivationHoursEnd = v2.reactivationHoursEnd;
        body.reactivationTemplate = v2.reactivationTemplate;
      }
      const res = await fetch("/api/ai/followup-config", {
        method: "PUT",
        headers,
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Falha");
      toast.success("Configurações salvas");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const headers = {
        ...(await authHeaders()),
        "Content-Type": "application/json",
      };
      const res = await fetch("/api/ai/followup-config", {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "run" }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Falha");
      const r = json.result;
      toast.success(
        `Tick: ${r.sent} enviado(s), ${r.scanned} analisado(s), ${r.skipped.length} ignorado(s)`,
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao executar");
    } finally {
      setRunning(false);
    }
  };

  const runReactivation = async () => {
    setReactivating(true);
    try {
      const headers = {
        ...(await authHeaders()),
        "Content-Type": "application/json",
      };
      const res = await fetch("/api/ai/followup-reactivate", {
        method: "POST",
        headers,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Falha");
      const r = json.result;
      toast.success(
        `Reativação: ${r.sent} enviado(s), ${r.scanned} analisado(s), ${r.skipped.length} ignorado(s)`,
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao reativar");
    } finally {
      setReactivating(false);
    }
  };

  const reactivationPreview = useMemo(() => {
    if (!v2) return "";
    return v2.reactivationTemplate.replace(/\{\{nome\}\}/g, "Maria");
  }, [v2]);

  if (loading && !settings) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando follow-ups...
        </CardContent>
      </Card>
    );
  }
  if (!settings) return null;

  const setS = (patch: Partial<Settings>) => setSettings({ ...settings, ...patch });
  const setTpl = (rule: Rule, value: string) =>
    setSettings({
      ...settings,
      templates: { ...settings.templates, [rule]: value },
    });
  const setV = (patch: Partial<V2Settings>) =>
    v2 ? setV2({ ...v2, ...patch }) : undefined;

  return (
    <div className="space-y-4">
      {/* Status WhatsApp */}
      {whatsapp && (
        <Card
          className={
            !whatsapp.connected
              ? "border-destructive/40 bg-destructive/5"
              : whatsapp.hasUnmapped
                ? "border-amber-500/40 bg-amber-500/5"
                : "border-emerald-500/40 bg-emerald-500/5"
          }
        >
          <CardContent className="p-3 text-sm flex items-center gap-2">
            {!whatsapp.connected ? (
              <>
                <XCircle className="h-4 w-4 text-destructive" />
                <span>
                  ⚠️ Sem integração WhatsApp ativa — follow-up automático não
                  enviará mensagens até conectar um número.
                </span>
              </>
            ) : whatsapp.hasUnmapped ? (
              <>
                <Bell className="h-4 w-4 text-amber-600" />
                <span>
                  ⚠️ Número WhatsApp não vinculado detectado (
                  {whatsapp.unmappedCount}). Conecte em Configurações para a IA
                  responder.
                </span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span>
                  ✅ WhatsApp conectado
                  {whatsapp.displayName ? ` — ${whatsapp.displayName}` : ""}
                </span>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Gate de envio */}
      {gate && !gate.ok && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-3 text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span>
              Follow-up bloqueado:{" "}
              <strong>{gate.reason ?? "motivo não informado"}</strong>
            </span>
          </CardContent>
        </Card>
      )}

      {/* Header + master switch */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" />
              Follow-up automático
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              A IA reabre conversas paradas com mensagens humanizadas —
              respeitando horário comercial, limites e janela de 24h.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={settings.enabled}
              onCheckedChange={(v) => setS({ enabled: v })}
            />
            <span className="text-sm">
              {settings.enabled ? "Ativo" : "Inativo"}
            </span>
          </div>
        </CardHeader>
      </Card>

      <Tabs defaultValue="geral" className="w-full">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="geral">Geral</TabsTrigger>
          <TabsTrigger value="inteligencia">Inteligência</TabsTrigger>
          <TabsTrigger value="reativacao">Reativação</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>

        {/* GERAL */}
        <TabsContent value="geral" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Regras e tempos</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">
                  Orçamento sem resposta após (horas)
                </Label>
                <Input
                  type="number"
                  min={1}
                  value={settings.quoteDelayHours}
                  onChange={(e) =>
                    setS({ quoteDelayHours: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <Label className="text-xs">Cliente sumiu após (horas)</Label>
                <Input
                  type="number"
                  min={1}
                  value={settings.silenceDelayHours}
                  onChange={(e) =>
                    setS({ silenceDelayHours: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <Label className="text-xs">Após visita realizada (horas)</Label>
                <Input
                  type="number"
                  min={1}
                  value={settings.visitDelayHours}
                  onChange={(e) =>
                    setS({ visitDelayHours: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <Label className="text-xs flex items-center gap-1">
                  <Flame className="h-3 w-3 text-orange-500" /> Lead quente
                  parado (horas)
                </Label>
                <Input
                  type="number"
                  min={1}
                  value={settings.hotDelayHours}
                  onChange={(e) =>
                    setS({ hotDelayHours: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <Label className="text-xs">Máximo de follow-ups por lead</Label>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={settings.maxPerLead}
                  onChange={(e) =>
                    setS({ maxPerLead: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <Label className="text-xs">
                  Intervalo mínimo entre envios (horas)
                </Label>
                <Input
                  type="number"
                  min={1}
                  value={settings.minHoursBetween}
                  onChange={(e) =>
                    setS({ minHoursBetween: Number(e.target.value) })
                  }
                />
              </div>
              <div className="md:col-span-2 flex items-center gap-3">
                <Switch
                  checked={settings.businessHoursOnly}
                  onCheckedChange={(v) => setS({ businessHoursOnly: v })}
                />
                <span className="text-sm">
                  Enviar apenas em horário comercial
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Mensagens (templates)</CardTitle>
              <p className="text-xs text-muted-foreground">
                Use <code className="text-foreground">{"{{nome}}"}</code> para o
                nome do cliente. A IA aplica variações sutis a partir da 2ª
                tentativa.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {(Object.keys(RULE_LABEL) as Rule[]).map((r) => (
                <div key={r}>
                  <Label className="text-xs">{RULE_LABEL[r]}</Label>
                  <Textarea
                    rows={2}
                    value={settings.templates[r] ?? ""}
                    onChange={(e) => setTpl(r, e.target.value)}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* INTELIGÊNCIA */}
        <TabsContent value="inteligencia" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" /> Inteligência da IA
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Configura humanização, ritmo de envio e proteção anti-bloqueio.
              </p>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {v2 ? (
                <>
                  <div className="flex items-center justify-between md:col-span-2 border rounded-md p-3">
                    <div>
                      <div className="text-sm font-medium">
                        Humanização ativa
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Varia saudação, emojis e CTA para parecer humano.
                      </div>
                    </div>
                    <Switch
                      checked={v2.humanize}
                      onCheckedChange={(c) => setV({ humanize: c })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Limite diário de envios</Label>
                    <Input
                      type="number"
                      min={1}
                      value={v2.dailyLimit}
                      onChange={(e) =>
                        setV({ dailyLimit: Number(e.target.value) })
                      }
                    />
                  </div>
                  <div>
                    <Label className="text-xs">
                      Delay randômico (± minutos)
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      value={v2.delayJitterMinutes}
                      onChange={(e) =>
                        setV({ delayJitterMinutes: Number(e.target.value) })
                      }
                    />
                  </div>
                  <div>
                    <Label className="text-xs">
                      Taxa mínima de resposta (0 a 1)
                    </Label>
                    <Input
                      type="number"
                      step={0.01}
                      min={0}
                      max={1}
                      value={v2.minResponseRate}
                      onChange={(e) =>
                        setV({ minResponseRate: Number(e.target.value) })
                      }
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Pausa automática se a taxa cair abaixo deste valor.
                    </p>
                  </div>
                  <div className="flex items-center justify-between border rounded-md p-3">
                    <div>
                      <div className="text-sm font-medium">Warmup</div>
                      <div className="text-xs text-muted-foreground">
                        Aumenta o limite gradualmente em 7 dias.
                      </div>
                    </div>
                    <Switch
                      checked={v2.warmupEnabled}
                      onCheckedChange={(c) => setV({ warmupEnabled: c })}
                    />
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground md:col-span-2">
                  Configurações v2 indisponíveis.
                </p>
              )}
            </CardContent>
          </Card>

          {gate && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap className="h-4 w-4 text-primary" /> Estado atual do motor
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <div className="flex items-center gap-2">
                  {gate.ok ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <XCircle className="h-4 w-4 text-amber-600" />
                  )}
                  <span>
                    {gate.ok ? "Pronto para enviar" : "Envio bloqueado"}
                  </span>
                </div>
                {gate.reason && (
                  <p className="text-xs text-muted-foreground">
                    Motivo: {gate.reason}
                  </p>
                )}
                {typeof gate.remainingToday === "number" && (
                  <p className="text-xs text-muted-foreground">
                    Restante hoje: {gate.remainingToday}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* REATIVAÇÃO */}
        <TabsContent value="reativacao" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <RotateCcw className="h-4 w-4 text-primary" /> Reativação de
                leads antigos
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Reabre conversas com leads parados há X dias, dentro de uma
                janela horária segura.
              </p>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {v2 ? (
                <>
                  <div className="flex items-center justify-between md:col-span-2 border rounded-md p-3">
                    <div>
                      <div className="text-sm font-medium">
                        Reativação ativada
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Quando ligado, leads frios recebem uma nova abordagem.
                      </div>
                    </div>
                    <Switch
                      checked={v2.reactivationEnabled}
                      onCheckedChange={(c) => setV({ reactivationEnabled: c })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Leads parados há (dias)</Label>
                    <Input
                      type="number"
                      min={1}
                      value={v2.reactivationDays}
                      onChange={(e) =>
                        setV({ reactivationDays: Number(e.target.value) })
                      }
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Máximo por dia</Label>
                    <Input
                      type="number"
                      min={1}
                      value={v2.reactivationDailyMax}
                      onChange={(e) =>
                        setV({ reactivationDailyMax: Number(e.target.value) })
                      }
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Janela horária — início</Label>
                    <Input
                      type="time"
                      value={v2.reactivationHoursStart.slice(0, 5)}
                      onChange={(e) =>
                        setV({
                          reactivationHoursStart: e.target.value + ":00",
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Janela horária — fim</Label>
                    <Input
                      type="time"
                      value={v2.reactivationHoursEnd.slice(0, 5)}
                      onChange={(e) =>
                        setV({ reactivationHoursEnd: e.target.value + ":00" })
                      }
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Label className="text-xs">
                      Mensagem de reativação (use {"{{nome}}"})
                    </Label>
                    <Textarea
                      rows={3}
                      value={v2.reactivationTemplate}
                      onChange={(e) =>
                        setV({ reactivationTemplate: e.target.value })
                      }
                    />
                  </div>
                  <div className="md:col-span-2 border rounded-md p-3 bg-muted/30">
                    <div className="text-xs text-muted-foreground mb-1">
                      Pré-visualização
                    </div>
                    <div className="text-sm whitespace-pre-wrap">
                      {reactivationPreview || "—"}
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <Button
                      variant="outline"
                      onClick={runReactivation}
                      disabled={reactivating || !v2.reactivationEnabled}
                    >
                      {reactivating ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4 mr-1" />
                      )}
                      Rodar reativação agora
                    </Button>
                    {!v2.reactivationEnabled && (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Ative a reativação para liberar o botão.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground md:col-span-2">
                  Configurações v2 indisponíveis.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                Logs de reativação recentes
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(() => {
                const reactLogs = log.filter(
                  (l) => l.rule_type === "returning_customer",
                );
                if (!reactLogs.length)
                  return (
                    <p className="text-xs text-muted-foreground">
                      Nenhuma reativação registrada ainda.
                    </p>
                  );
                return (
                  <ol className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {reactLogs.map((f) => (
                      <li
                        key={f.id}
                        className="text-xs border-l-2 border-primary/40 pl-2 py-1"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <StatusBadge status={f.status} />
                          <span className="text-muted-foreground">
                            {fmtTime(f.sent_at)}
                          </span>
                        </div>
                        <div className="text-muted-foreground mt-1 line-clamp-2">
                          {f.message_text}
                        </div>
                      </li>
                    ))}
                  </ol>
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ANALYTICS */}
        <TabsContent value="analytics" className="space-y-4">
          {metrics && analytics ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Card>
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" /> Enviados (30d)
                    </div>
                    <div className="text-xl font-semibold mt-1">
                      {metrics.sent}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Respondidos
                    </div>
                    <div className="text-xl font-semibold mt-1">
                      {metrics.responded}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <Sparkles className="h-3 w-3" /> Recuperados
                    </div>
                    <div className="text-xl font-semibold mt-1 text-emerald-500">
                      {metrics.recovered}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <Target className="h-3 w-3" /> Taxa de retorno
                    </div>
                    <div className="text-xl font-semibold mt-1">
                      {metrics.responseRate.toFixed(1)}%
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <Sparkles className="h-3 w-3" /> Valor recuperado
                    </div>
                    <div className="text-xl font-semibold mt-1">
                      {fmtMoney(analytics.recoveredValue)}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Card>
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Melhor horário
                    </div>
                    <div className="text-xl font-semibold mt-1">
                      {analytics.bestHour !== null
                        ? `${String(analytics.bestHour).padStart(2, "0")}h`
                        : "—"}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground">
                      Melhor template
                    </div>
                    <div className="text-sm font-semibold mt-1 truncate">
                      {analytics.bestTemplate
                        ? RULE_LABEL[analytics.bestTemplate as Rule] ??
                          analytics.bestTemplate
                        : "—"}
                    </div>
                    {analytics.bestTemplate && (
                      <div className="text-[10px] text-muted-foreground">
                        {analytics.bestTemplateRate.toFixed(1)}% de resposta
                      </div>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground">
                      Hoje / limite
                    </div>
                    <div className="text-xl font-semibold mt-1">
                      {analytics.todaySent} / {analytics.todayLimit || "—"}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {temps && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">
                      Temperatura dos leads
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex gap-3 text-sm">
                    <Badge className="bg-orange-500/15 text-orange-600 border-orange-500/30">
                      🔥 Quentes: {temps.hot}
                    </Badge>
                    <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30">
                      🟡 Mornos: {temps.warm}
                    </Badge>
                    <Badge variant="secondary">⚪ Frios: {temps.cold}</Badge>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    Últimos 30 dias (enviados vs respondidos)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <MiniBars data={analytics.byDay} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    Taxa de resposta por tipo
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {analytics.byRule.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Sem dados ainda.
                    </p>
                  ) : (
                    analytics.byRule.map((r) => (
                      <div
                        key={r.rule}
                        className="flex items-center justify-between text-xs gap-2"
                      >
                        <span className="truncate">
                          {RULE_LABEL[r.rule as Rule] ?? r.rule}
                        </span>
                        <span className="text-muted-foreground">
                          {r.responded}/{r.sent}
                        </span>
                        <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary"
                            style={{ width: `${Math.min(100, r.rate)}%` }}
                          />
                        </div>
                        <span className="w-12 text-right tabular-nums">
                          {r.rate.toFixed(1)}%
                        </span>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Sem métricas disponíveis.
            </p>
          )}
        </TabsContent>

        {/* TIMELINE */}
        <TabsContent value="timeline" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Timeline recente</CardTitle>
            </CardHeader>
            <CardContent>
              {log.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhum follow-up registrado ainda.
                </p>
              ) : (
                <ol className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                  {log.map((f) => (
                    <li
                      key={f.id}
                      className="text-xs border-l-2 border-primary/40 pl-2 py-1"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">
                          {RULE_LABEL[f.rule_type]}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          tentativa {f.attempt_number}
                        </Badge>
                        <StatusBadge status={f.status} />
                        <TempBadge t={f.lead_temperature} />
                        <span className="text-muted-foreground">
                          {fmtTime(f.sent_at)}
                        </span>
                      </div>
                      {f.trigger_reason && (
                        <div className="text-[11px] text-primary mt-1">
                          Motivo: {f.trigger_reason}
                        </div>
                      )}
                      <div className="text-muted-foreground mt-1 line-clamp-2">
                        {f.message_text}
                      </div>
                      {f.cancel_reason && (
                        <div className="text-amber-600 mt-1">
                          Cancelado: {f.cancel_reason}
                        </div>
                      )}
                      {f.responded_at ? (
                        <div className="text-emerald-500 mt-1 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> respondido em{" "}
                          {fmtTime(f.responded_at)}
                        </div>
                      ) : f.status === "failed" ? (
                        <div className="text-destructive mt-1 flex items-center gap-1">
                          <XCircle className="h-3 w-3" /> bloqueado / falha de
                          envio
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex flex-wrap gap-2 pt-2 border-t">
        <Button onClick={save} disabled={saving}>
          {saving ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-1" />
          )}
          Salvar configurações
        </Button>
        <Button
          variant="outline"
          onClick={runNow}
          disabled={running || !settings.enabled}
        >
          {running ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <Play className="h-4 w-4 mr-1" />
          )}
          Rodar agora
        </Button>
        <Button variant="ghost" onClick={load} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-1" /> Atualizar
        </Button>
      </div>
    </div>
  );
}

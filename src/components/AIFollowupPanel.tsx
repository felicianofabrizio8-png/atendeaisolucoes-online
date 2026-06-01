// ============================================================================
// AIFollowupPanel
// Configuração de follow-up automático + log recente + métricas.
// Lê e escreve em /api/ai/followup-config. NÃO altera engine principal,
// meta-send, meta-webhook, Evolution.
// ============================================================================

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
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

interface LogRow {
  id: string;
  rule_type: Rule;
  attempt_number: number;
  message_text: string;
  status: "sent" | "responded" | "recovered" | "ignored" | "failed";
  sent_at: string;
  responded_at: string | null;
  response_outcome: string | null;
  conversation_id: string;
  lead_id: string | null;
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

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  if (status === "failed")
    return <Badge variant="destructive">Falhou</Badge>;
  if (status === "ignored")
    return <Badge variant="secondary">Ignorado</Badge>;
  return <Badge variant="outline">Enviado</Badge>;
}

export function AIFollowupPanel() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

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
      setLog(json.log ?? []);
      setMetrics(json.metrics ?? null);
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
      const res = await fetch("/api/ai/followup-config", {
        method: "PUT",
        headers,
        body: JSON.stringify({
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
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Falha");
      toast.success("Configurações salvas");
      setSettings(json.settings);
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
        `Tick concluído: ${r.sent} enviado(s), ${r.scanned} analisado(s), ${r.skipped.length} ignorado(s)`,
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao executar");
    } finally {
      setRunning(false);
    }
  };

  const [waStatus, setWaStatus] = useState<{
    connected: boolean;
    hasUnmapped: boolean;
    unmappedCount: number;
    displayName: string | null;
  } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const headers = await authHeaders();
        const res = await fetch("/api/ai/followup-status", { headers });
        const j = await res.json();
        if (j?.ok) setWaStatus(j.whatsapp);
      } catch {
        /* safe fallback */
      }
    })();
  }, []);

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

  return (
    <div className="space-y-4">
      {/* Header + master switch */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" />
              Follow-up automático
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              A IA reabre conversas paradas com mensagens humanizadas — sempre
              respeitando horário comercial, limites e janela de 24h.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={settings.enabled}
              onCheckedChange={(v) => setS({ enabled: v })}
            />
            <span className="text-sm">{settings.enabled ? "Ativo" : "Inativo"}</span>
          </div>
        </CardHeader>
      </Card>

      {/* Métricas */}
      {metrics ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card>
            <CardContent className="p-3">
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <MessageSquare className="h-3 w-3" /> Enviados (30d)
              </div>
              <div className="text-xl font-semibold mt-1">{metrics.sent}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Respondidos
              </div>
              <div className="text-xl font-semibold mt-1">{metrics.responded}</div>
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
                <Clock className="h-3 w-3" /> Melhor horário
              </div>
              <div className="text-xl font-semibold mt-1">
                {metrics.bestHour !== null
                  ? `${String(metrics.bestHour).padStart(2, "0")}h`
                  : "—"}
              </div>
              {metrics.bestRule ? (
                <div className="text-[10px] text-muted-foreground mt-1 truncate">
                  Melhor mensagem: {RULE_LABEL[metrics.bestRule]} (
                  {metrics.bestRuleRate.toFixed(1)}%)
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Regras e tempos */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Regras e tempos</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Orçamento sem resposta após (horas)</Label>
            <Input
              type="number"
              min={1}
              value={settings.quoteDelayHours}
              onChange={(e) => setS({ quoteDelayHours: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label className="text-xs">Cliente sumiu após (horas)</Label>
            <Input
              type="number"
              min={1}
              value={settings.silenceDelayHours}
              onChange={(e) => setS({ silenceDelayHours: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label className="text-xs">Após visita realizada (horas)</Label>
            <Input
              type="number"
              min={1}
              value={settings.visitDelayHours}
              onChange={(e) => setS({ visitDelayHours: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label className="text-xs flex items-center gap-1">
              <Flame className="h-3 w-3 text-orange-500" /> Lead quente parado (horas)
            </Label>
            <Input
              type="number"
              min={1}
              value={settings.hotDelayHours}
              onChange={(e) => setS({ hotDelayHours: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label className="text-xs">Máximo de follow-ups por lead</Label>
            <Input
              type="number"
              min={1}
              max={10}
              value={settings.maxPerLead}
              onChange={(e) => setS({ maxPerLead: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label className="text-xs">Intervalo mínimo entre envios (horas)</Label>
            <Input
              type="number"
              min={1}
              value={settings.minHoursBetween}
              onChange={(e) => setS({ minHoursBetween: Number(e.target.value) })}
            />
          </div>
          <div className="md:col-span-2 flex items-center gap-3">
            <Switch
              checked={settings.businessHoursOnly}
              onCheckedChange={(v) => setS({ businessHoursOnly: v })}
            />
            <span className="text-sm">Enviar apenas em horário comercial</span>
          </div>
        </CardContent>
      </Card>

      {/* Templates */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Mensagens (templates)</CardTitle>
          <p className="text-xs text-muted-foreground">
            Use <code className="text-foreground">{"{{nome}}"}</code> para o nome
            do cliente. A IA aplica variações sutis a partir da 2ª tentativa.
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

      <div className="flex flex-wrap gap-2">
        <Button onClick={save} disabled={saving}>
          {saving ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-1" />
          )}
          Salvar configurações
        </Button>
        <Button variant="outline" onClick={runNow} disabled={running || !settings.enabled}>
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

      {/* Timeline / log */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Timeline recente</CardTitle>
        </CardHeader>
        <CardContent>
          {log.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nenhum follow-up enviado ainda.
            </p>
          ) : (
            <ol className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {log.map((f) => (
                <li
                  key={f.id}
                  className="text-xs border-l-2 border-primary/40 pl-2 py-1"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{RULE_LABEL[f.rule_type]}</span>
                    <Badge variant="outline" className="text-[10px]">
                      tentativa {f.attempt_number}
                    </Badge>
                    <StatusBadge status={f.status} />
                    <span className="text-muted-foreground">
                      {fmtTime(f.sent_at)}
                    </span>
                  </div>
                  <div className="text-muted-foreground mt-1 line-clamp-2">
                    {f.message_text}
                  </div>
                  {f.responded_at ? (
                    <div className="text-emerald-500 mt-1 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> respondido em{" "}
                      {fmtTime(f.responded_at)}
                    </div>
                  ) : f.status === "failed" ? (
                    <div className="text-destructive mt-1 flex items-center gap-1">
                      <XCircle className="h-3 w-3" /> falha de envio
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

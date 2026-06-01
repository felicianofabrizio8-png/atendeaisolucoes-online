// ============================================================================
// Painel "Modo Piloto + Saúde da IA" — exibido na rota /ia.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Activity,
  AlertTriangle,
  Bot,
  Check,
  Loader2,
  PlayCircle,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";

type AIStatus =
  | "desativada"
  | "parcialmente_configurada"
  | "pronta"
  | "piloto"
  | "ativa";

interface ChecklistItem {
  key: string;
  label: string;
  ok: boolean;
}
interface Readiness {
  status: AIStatus;
  pilotMode: boolean;
  autoReplyEnabled: boolean;
  canActivate: boolean;
  checklist: ChecklistItem[];
  missing: string[];
}
interface Health {
  lastRunAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  autoRepliesToday: number;
  handoffsToday: number;
  hotLeadsDetected: number;
  sendFailuresToday: number;
  qualificationEventsToday: number;
  pilotEnabledAt: string | null;
  lastTestAt: string | null;
  lastTestResult: Record<string, unknown> | null;
}

interface TestStep {
  name: string;
  ok: boolean;
  detail?: string;
}
interface TestResult {
  ok: boolean;
  steps: TestStep[];
  sample: string;
  outcome?: { action: string; message?: string; reason?: string; qualification?: Record<string, unknown> };
}

const STATUS_META: Record<AIStatus, { label: string; tone: string; desc: string }> = {
  desativada: { label: "IA desativada", tone: "bg-muted text-muted-foreground", desc: "Nenhuma configuração feita." },
  parcialmente_configurada: {
    label: "Parcialmente configurada",
    tone: "bg-amber-500/15 text-amber-400 border border-amber-500/30",
    desc: "Faltam pré-requisitos antes do piloto.",
  },
  pronta: {
    label: "Pronta para piloto",
    tone: "bg-blue-500/15 text-blue-400 border border-blue-500/30",
    desc: "Todos os pré-requisitos atendidos.",
  },
  piloto: {
    label: "Em modo piloto",
    tone: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
    desc: "IA respondendo automaticamente com monitoramento reforçado.",
  },
  ativa: {
    label: "Ativa",
    tone: "bg-primary/20 text-primary border border-primary/40",
    desc: "Operação contínua.",
  },
};

export function AIPilotPanel() {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState(
    "Boa noite! Quanto custa uma piscina de fibra 6x3 para Campinas?",
  );
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const authHeader = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {};
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const headers = await authHeader();
    const res = await fetch("/api/ai/readiness", { headers });
    const json = await res.json();
    if (json.ok) {
      setReadiness(json.readiness);
      setHealth(json.health);
    }
    setLoading(false);
  }, [authHeader]);

  useEffect(() => {
    void load();
  }, [load]);

  const togglePilot = async (enable: boolean) => {
    setToggling(true);
    const headers = await authHeader();
    const res = await fetch("/api/ai/pilot-toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ enable }),
    });
    const json = await res.json();
    setToggling(false);
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Falha ao alternar modo piloto", {
        description: Array.isArray(json.missing) ? json.missing.join(" • ") : undefined,
      });
      return;
    }
    toast.success(enable ? "Modo piloto ATIVADO" : "Modo piloto desligado");
    await load();
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    const headers = await authHeader();
    const res = await fetch("/api/ai/test-now", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ message: testMessage }),
    });
    const json = (await res.json()) as TestResult & { error?: string };
    setTesting(false);
    if (!res.ok) {
      toast.error("Falha no teste", { description: json.error ?? "Erro" });
      return;
    }
    setTestResult(json);
    await load();
  };

  if (loading || !readiness) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando status da IA…
        </CardContent>
      </Card>
    );
  }

  const meta = STATUS_META[readiness.status];

  return (
    <div className="space-y-4">
      {/* STATUS GERAL */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="h-4 w-4" /> Status da IA
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium ${meta.tone}`}>
                {readiness.status === "piloto" && <Sparkles className="h-3 w-3" />}
                {meta.label}
              </div>
              <div className="text-xs text-muted-foreground mt-1.5">{meta.desc}</div>
            </div>
            <div className="flex gap-2">
              {readiness.pilotMode ? (
                <Button variant="destructive" size="sm" onClick={() => togglePilot(false)} disabled={toggling}>
                  {toggling && <Loader2 className="h-3 w-3 animate-spin" />}
                  Desligar piloto
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => togglePilot(true)}
                  disabled={!readiness.canActivate || toggling}
                >
                  {toggling && <Loader2 className="h-3 w-3 animate-spin" />}
                  Ativar modo piloto
                </Button>
              )}
            </div>
          </div>

          {/* CHECKLIST */}
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">Pré-requisitos</div>
            {readiness.checklist.map((c) => (
              <div key={c.key} className="flex items-center gap-2 text-sm">
                {c.ok ? (
                  <Check className="h-4 w-4 text-emerald-500" />
                ) : (
                  <X className="h-4 w-4 text-amber-500" />
                )}
                <span className={c.ok ? "" : "text-muted-foreground"}>{c.label}</span>
              </div>
            ))}
          </div>

          {!readiness.canActivate && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-300 flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                Modo piloto bloqueado até completar todos os pré-requisitos. A IA não responde
                automaticamente sem perfil + WhatsApp + horário + mensagem inicial.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* SAÚDE DA IA */}
      {health && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" /> Saúde da IA — hoje
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
              <Metric label="Respostas automáticas" value={health.autoRepliesToday} />
              <Metric label="Handoffs" value={health.handoffsToday} />
              <Metric label="Leads quentes detectados" value={health.hotLeadsDetected} />
              <Metric label="Eventos de qualificação" value={health.qualificationEventsToday} />
              <Metric label="Falhas de envio" value={health.sendFailuresToday} tone="danger" />
              <Metric
                label="Última execução"
                value={health.lastRunAt ? new Date(health.lastRunAt).toLocaleTimeString("pt-BR") : "—"}
                isText
              />
            </div>
            {health.lastError && (
              <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-300 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">
                    Último erro {health.lastErrorAt && `(${new Date(health.lastErrorAt).toLocaleString("pt-BR")})`}
                  </div>
                  <div className="break-all">{health.lastError}</div>
                </div>
              </div>
            )}
            {health.pilotEnabledAt && (
              <div className="text-xs text-muted-foreground">
                Piloto ligado em {new Date(health.pilotEnabledAt).toLocaleString("pt-BR")}.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* TESTAR IA */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <PlayCircle className="h-4 w-4" /> Testar IA agora
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Simula um turno completo (pré-checks → handoff regex → LLM → safety) sem enviar mensagem real.
          </div>
          <Textarea
            rows={2}
            value={testMessage}
            onChange={(e) => setTestMessage(e.target.value)}
            placeholder="Mensagem do cliente para simular"
          />
          <div className="flex justify-end">
            <Button onClick={runTest} disabled={testing || !testMessage.trim()}>
              {testing && <Loader2 className="h-4 w-4 animate-spin" />}
              Rodar simulação
            </Button>
          </div>

          {testResult && (
            <div className="rounded-md border border-border bg-card/50 p-3 space-y-2 text-sm">
              <div className="font-medium">Resultado:</div>
              {testResult.steps.map((s, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  {s.ok ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500 mt-0.5" />
                  ) : (
                    <X className="h-3.5 w-3.5 text-rose-500 mt-0.5" />
                  )}
                  <div>
                    <span className="font-medium">{s.name}</span>
                    {s.detail && <span className="text-muted-foreground"> — {s.detail}</span>}
                  </div>
                </div>
              ))}
              {testResult.outcome && (
                <div className="border-t border-border pt-2 mt-2">
                  <div className="text-xs text-muted-foreground">Decisão final:</div>
                  <div className="text-xs">
                    <span className="font-mono rounded bg-muted px-1.5 py-0.5">
                      {testResult.outcome.action}
                    </span>
                    {testResult.outcome.message && (
                      <div className="mt-1 italic">"{testResult.outcome.message}"</div>
                    )}
                    {testResult.outcome.reason && (
                      <div className="mt-1 text-muted-foreground">Motivo: {testResult.outcome.reason}</div>
                    )}
                    {testResult.outcome.qualification && (
                      <pre className="mt-1 whitespace-pre-wrap text-muted-foreground">
                        {JSON.stringify(testResult.outcome.qualification, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
  isText,
}: {
  label: string;
  value: number | string;
  tone?: "danger";
  isText?: boolean;
}) {
  return (
    <div className="rounded-md border border-border p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={`mt-0.5 font-semibold ${isText ? "text-sm" : "text-xl"} ${
          tone === "danger" && typeof value === "number" && value > 0 ? "text-rose-400" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

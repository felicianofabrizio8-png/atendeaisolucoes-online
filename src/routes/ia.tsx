import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, Trash2, Check, X, Sparkles, RefreshCw, Bot, AlertTriangle, BarChart3, Bell, MessageSquareText } from "lucide-react";
import { AIPilotPanel } from "@/components/AIPilotPanel";
import { AIAnalyticsDashboard } from "@/components/AIAnalyticsDashboard";
import { AIFollowupPanel } from "@/components/AIFollowupPanel";
import { WhatsappTemplatesPanel } from "@/components/WhatsappTemplatesPanel";
import { toast } from "sonner";


export const Route = createFileRoute("/ia")({
  component: ConfiguracoesIA,
});

type Tone = "comercial" | "amigavel" | "premium" | "tecnico" | "informal";

interface FaqItem {
  q: string;
  a: string;
}

interface AIProfile {
  company_id: string;
  company_name: string | null;
  description: string | null;
  products: string | null;
  payment_methods: string | null;
  avg_lead_time: string | null;
  faq: FaqItem[];
  business_hours: string | null;
  region: string | null;
  differentials: string | null;
  tone: Tone;
}

interface Proposal {
  id: string;
  type: "faq" | "objection" | "recurring_reply" | "sales_pattern";
  question: string;
  answer: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
}

interface LogRow {
  id: string;
  created_at: string;
  classification: string | null;
  low_confidence: boolean;
  was_sent: boolean;
  was_edited: boolean;
  generated_text: string;
}

interface AutomationSettings {
  ai_auto_reply_enabled: boolean;
  ai_after_hours_only: boolean;
  ai_initial_message: string | null;
  ai_max_auto_replies: number;
  ai_handoff_timeout_minutes: number;
  ai_agent_name: string;
  business_hours_start: string;
  business_hours_end: string;
}

interface FlowEvent {
  id: string;
  created_at: string;
  event_type: string;
  conversation_id: string | null;
  payload: Record<string, unknown> | null;
}

const TONE_OPTIONS: { value: Tone; label: string }[] = [
  { value: "comercial", label: "Comercial" },
  { value: "amigavel", label: "Amigável" },
  { value: "premium", label: "Premium" },
  { value: "tecnico", label: "Técnico" },
  { value: "informal", label: "Informal" },
];

function emptyProfile(companyId: string, companyName?: string | null): AIProfile {
  return {
    company_id: companyId,
    company_name: companyName ?? null,
    description: null,
    products: null,
    payment_methods: null,
    avg_lead_time: null,
    faq: [],
    business_hours: null,
    region: null,
    differentials: null,
    tone: "comercial",
  };
}

function ConfiguracoesIA() {
  const { profile, company } = useAuth();
  const companyId = profile?.company_id;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<AIProfile | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [usage, setUsage] = useState<{ count: number; monthly_limit: number } | null>(null);
  const [proposing, setProposing] = useState(false);
  const [automation, setAutomation] = useState<AutomationSettings | null>(null);
  const [savingAutomation, setSavingAutomation] = useState(false);
  const [events, setEvents] = useState<FlowEvent[]>([]);

  const loadAll = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    const monthKey = `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, "0")}-01`;

    const [
      { data: prof },
      { data: props },
      { data: lgs },
      { data: usg },
      { data: settings },
      { data: evts },
    ] = await Promise.all([
      supabase.from("ai_profiles").select("*").eq("company_id", companyId).maybeSingle(),
      supabase
        .from("ai_knowledge_proposals")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("ai_suggestions_log")
        .select("id, created_at, classification, low_confidence, was_sent, was_edited, generated_text")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("ai_usage_counters")
        .select("count, monthly_limit")
        .eq("company_id", companyId)
        .eq("month", monthKey)
        .maybeSingle(),
      supabase
        .from("company_settings")
        .select(
          "ai_auto_reply_enabled, ai_after_hours_only, ai_initial_message, ai_max_auto_replies, ai_handoff_timeout_minutes, ai_agent_name, business_hours_start, business_hours_end",
        )
        .eq("company_id", companyId)
        .maybeSingle(),
      supabase
        .from("ai_flow_events")
        .select("id, created_at, event_type, conversation_id, payload")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    setData(
      prof
        ? {
            ...prof,
            faq: Array.isArray(prof.faq) ? (prof.faq as unknown as FaqItem[]) : [],
            tone: (prof.tone ?? "comercial") as Tone,
          }
        : emptyProfile(companyId, company?.name),
    );
    setProposals((props ?? []) as Proposal[]);
    setLogs((lgs ?? []) as LogRow[]);
    setUsage(usg ?? { count: 0, monthly_limit: 1000 });
    setAutomation(
      settings
        ? {
            ai_auto_reply_enabled: !!settings.ai_auto_reply_enabled,
            ai_after_hours_only: settings.ai_after_hours_only ?? true,
            ai_initial_message: settings.ai_initial_message ?? null,
            ai_max_auto_replies: settings.ai_max_auto_replies ?? 5,
            ai_handoff_timeout_minutes: settings.ai_handoff_timeout_minutes ?? 30,
            ai_agent_name: settings.ai_agent_name ?? "Fabrizio",
            business_hours_start: settings.business_hours_start ?? "09:00:00",
            business_hours_end: settings.business_hours_end ?? "18:00:00",
          }
        : null,
    );
    setEvents((evts ?? []) as FlowEvent[]);
    setLoading(false);
  }, [companyId, company?.name]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const saveProfile = async () => {
    if (!data || !companyId) return;
    setSaving(true);
    const payload = { ...data, company_id: companyId, faq: data.faq as unknown as never };
    const { error } = await supabase
      .from("ai_profiles")
      .upsert([payload], { onConflict: "company_id" });
    setSaving(false);
    if (error) {
      toast.error("Falha ao salvar", { description: error.message });
      return;
    }
    toast.success("Perfil da IA salvo");
  };

  const setField = <K extends keyof AIProfile>(k: K, v: AIProfile[K]) =>
    setData((d) => (d ? { ...d, [k]: v } : d));

  const addFaq = () => setData((d) => (d ? { ...d, faq: [...d.faq, { q: "", a: "" }] } : d));
  const updateFaq = (i: number, k: "q" | "a", v: string) =>
    setData((d) =>
      d ? { ...d, faq: d.faq.map((f, idx) => (idx === i ? { ...f, [k]: v } : f)) } : d,
    );
  const removeFaq = (i: number) =>
    setData((d) => (d ? { ...d, faq: d.faq.filter((_, idx) => idx !== i) } : d));

  const updateProposal = async (id: string, status: "approved" | "rejected") => {
    const { error } = await supabase
      .from("ai_knowledge_proposals")
      .update({ status, reviewed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      toast.error("Falha", { description: error.message });
      return;
    }
    setProposals((arr) => arr.map((p) => (p.id === id ? { ...p, status } : p)));
    toast.success(status === "approved" ? "Aprovado" : "Rejeitado");
  };

  const deleteProposal = async (id: string) => {
    const { error } = await supabase.from("ai_knowledge_proposals").delete().eq("id", id);
    if (error) {
      toast.error("Falha", { description: error.message });
      return;
    }
    setProposals((arr) => arr.filter((p) => p.id !== id));
  };

  const proposeFromConversations = async () => {
    setProposing(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sessão expirada");
      const res = await fetch("/api/ai/propose-knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Erro ${res.status}`);
      toast.success(`${json.created ?? 0} aprendizado(s) sugerido(s)`, {
        description: json.message,
      });
      await loadAll();
    } catch (e) {
      toast.error("Falha ao analisar", {
        description: e instanceof Error ? e.message : "Erro",
      });
    } finally {
      setProposing(false);
    }
  };

  const updateLimit = async (newLimit: number) => {
    if (!companyId || !usage) return;
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    const monthKey = `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const { error } = await supabase
      .from("ai_usage_counters")
      .upsert(
        [{ company_id: companyId, month: monthKey, count: usage.count, monthly_limit: newLimit }],
        { onConflict: "company_id,month" },
      );
    if (error) {
      toast.error("Falha", { description: error.message });
      return;
    }
    setUsage({ ...usage, monthly_limit: newLimit });
    toast.success("Limite atualizado");
  };

  const saveAutomation = async () => {
    if (!companyId || !automation) return;
    setSavingAutomation(true);
    const { error } = await supabase
      .from("company_settings")
      .update({
        ai_auto_reply_enabled: automation.ai_auto_reply_enabled,
        ai_after_hours_only: automation.ai_after_hours_only,
        ai_initial_message: automation.ai_initial_message,
        ai_max_auto_replies: automation.ai_max_auto_replies,
        ai_handoff_timeout_minutes: automation.ai_handoff_timeout_minutes,
        ai_agent_name: automation.ai_agent_name,
        business_hours_start: automation.business_hours_start,
        business_hours_end: automation.business_hours_end,
      })
      .eq("company_id", companyId);
    setSavingAutomation(false);
    if (error) {
      toast.error("Falha ao salvar automação", { description: error.message });
      return;
    }
    toast.success("Automação salva");
  };

  const setAuto = <K extends keyof AutomationSettings>(k: K, v: AutomationSettings[K]) =>
    setAutomation((s) => (s ? { ...s, [k]: v } : s));

  if (!companyId) {
    return <div className="p-8">Entre para configurar a IA.</div>;
  }

  if (loading || !data) {
    return (
      <div className="p-8 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  const pendingCount = proposals.filter((p) => p.status === "pending").length;

  return (
    <div className="p-3 md:p-6 max-w-5xl mx-auto space-y-4">
      <header className="sticky top-0 z-20 -mx-3 md:mx-0 px-3 md:px-0 py-2 md:py-0 bg-background/95 backdrop-blur md:bg-transparent md:backdrop-blur-none border-b md:border-0 border-border safe-top flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary shrink-0" />
        <h1 className="text-base md:text-xl font-semibold truncate">IA de Atendimento</h1>
      </header>

      <Tabs defaultValue="perfil" className="space-y-4">
        <TabsList className="w-full md:w-auto h-auto md:h-9 flex md:inline-flex overflow-x-auto scrollbar-none justify-start md:justify-center gap-1 p-1 rounded-lg">
          <TabsTrigger value="perfil" className="min-h-11 md:min-h-0 shrink-0">Perfil</TabsTrigger>
          <TabsTrigger value="faq" className="min-h-11 md:min-h-0 shrink-0">FAQ</TabsTrigger>
          <TabsTrigger value="aprendizados" className="min-h-11 md:min-h-0 shrink-0">
            Aprendizados{pendingCount ? ` (${pendingCount})` : ""}
          </TabsTrigger>
          <TabsTrigger value="uso" className="min-h-11 md:min-h-0 shrink-0">Uso & Logs</TabsTrigger>
          <TabsTrigger value="analytics" className="min-h-11 md:min-h-0 shrink-0">
            <BarChart3 className="h-3.5 w-3.5 mr-1" /> Analytics
          </TabsTrigger>
          <TabsTrigger value="followup" className="min-h-11 md:min-h-0 shrink-0">
            <Bell className="h-3.5 w-3.5 mr-1" /> Follow-up
          </TabsTrigger>
          <TabsTrigger value="templates" className="min-h-11 md:min-h-0 shrink-0">
            <MessageSquareText className="h-3.5 w-3.5 mr-1" /> Templates
          </TabsTrigger>
          <TabsTrigger value="automacao" className="min-h-11 md:min-h-0 shrink-0">
            <Bot className="h-3.5 w-3.5 mr-1" /> Automação
          </TabsTrigger>
        </TabsList>


        {/* ---------- PERFIL ---------- */}
        <TabsContent value="perfil" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Contexto da empresa</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="Nome da empresa">
                <Input
                  value={data.company_name ?? ""}
                  onChange={(e) => setField("company_name", e.target.value)}
                />
              </Field>
              <Field label="Tom de voz">
                <Select value={data.tone} onValueChange={(v) => setField("tone", v as Tone)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TONE_OPTIONS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Descrição da empresa" full>
                <Textarea
                  rows={3}
                  value={data.description ?? ""}
                  onChange={(e) => setField("description", e.target.value)}
                />
              </Field>
              <Field label="Produtos / serviços" full>
                <Textarea
                  rows={3}
                  value={data.products ?? ""}
                  onChange={(e) => setField("products", e.target.value)}
                />
              </Field>
              <Field label="Formas de pagamento">
                <Input
                  value={data.payment_methods ?? ""}
                  onChange={(e) => setField("payment_methods", e.target.value)}
                  placeholder="Pix, cartão em até 12x, boleto"
                />
              </Field>
              <Field label="Prazo médio">
                <Input
                  value={data.avg_lead_time ?? ""}
                  onChange={(e) => setField("avg_lead_time", e.target.value)}
                  placeholder="Ex.: 15 dias úteis"
                />
              </Field>
              <Field label="Horário de atendimento">
                <Input
                  value={data.business_hours ?? ""}
                  onChange={(e) => setField("business_hours", e.target.value)}
                  placeholder="Seg–Sex 9h às 18h"
                />
              </Field>
              <Field label="Cidade / região atendida">
                <Input
                  value={data.region ?? ""}
                  onChange={(e) => setField("region", e.target.value)}
                  placeholder="Itapetininga e região"
                />
              </Field>
              <Field label="Diferenciais" full>
                <Textarea
                  rows={3}
                  value={data.differentials ?? ""}
                  onChange={(e) => setField("differentials", e.target.value)}
                />
              </Field>
            </CardContent>
          </Card>
          <div className="flex justify-end sticky bottom-0 -mx-3 md:mx-0 px-3 md:px-0 py-2 md:py-0 bg-background/95 backdrop-blur md:bg-transparent md:backdrop-blur-none safe-bottom border-t md:border-0 border-border">
            <Button onClick={saveProfile} disabled={saving} className="w-full md:w-auto min-h-11 md:min-h-9">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar perfil
            </Button>
          </div>
        </TabsContent>

        {/* ---------- FAQ ---------- */}
        <TabsContent value="faq" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Perguntas frequentes</CardTitle>
              <Button size="sm" variant="outline" onClick={addFaq}>
                <Plus className="h-4 w-4" /> Nova
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.faq.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhuma cadastrada.</p>
              )}
              {data.faq.map((f, i) => (
                <div key={i} className="grid gap-2 md:grid-cols-[1fr_2fr_auto] items-start rounded-md border border-border md:border-0 p-2 md:p-0">
                  <Input
                    placeholder="Pergunta"
                    className="min-h-11 md:min-h-9"
                    value={f.q}
                    onChange={(e) => updateFaq(i, "q", e.target.value)}
                  />
                  <Textarea
                    rows={2}
                    placeholder="Resposta"
                    value={f.a}
                    onChange={(e) => updateFaq(i, "a", e.target.value)}
                  />
                  <Button size="icon" variant="ghost" className="h-11 w-11 md:h-9 md:w-9 self-end md:self-start" onClick={() => removeFaq(i)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
          <div className="flex justify-end">
            <Button onClick={saveProfile} disabled={saving} className="w-full md:w-auto min-h-11 md:min-h-9">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar FAQ
            </Button>
          </div>
        </TabsContent>

        {/* ---------- APRENDIZADOS ---------- */}
        <TabsContent value="aprendizados" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Aprendizados sugeridos pela IA</CardTitle>
              <Button size="sm" onClick={proposeFromConversations} disabled={proposing}>
                {proposing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Analisar conversas
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Itens aprovados entram automaticamente no contexto da IA. Itens rejeitados são
                ignorados.
              </p>
              {proposals.length === 0 && (
                <p className="text-sm text-muted-foreground py-4">
                  Nenhuma sugestão ainda. Clique em "Analisar conversas".
                </p>
              )}
              {proposals.map((p) => (
                <div
                  key={p.id}
                  className="rounded-md border border-border p-3 space-y-1 bg-card"
                >
                  <div className="flex items-center gap-2 text-xs">
                    <span className="rounded bg-secondary px-1.5 py-0.5 uppercase">{p.type}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 ${
                        p.status === "approved"
                          ? "bg-[var(--status-warm)]/20 text-[var(--status-warm)]"
                          : p.status === "rejected"
                            ? "bg-muted text-muted-foreground"
                            : "bg-primary/15 text-primary"
                      }`}
                    >
                      {p.status}
                    </span>
                    <span className="ml-auto text-muted-foreground">
                      {new Date(p.created_at).toLocaleString("pt-BR")}
                    </span>
                  </div>
                  <div className="text-sm font-medium">{p.question}</div>
                  <div className="text-sm text-muted-foreground whitespace-pre-wrap">{p.answer}</div>
                  <div className="flex gap-2 pt-1">
                    {p.status !== "approved" && (
                      <Button size="sm" onClick={() => updateProposal(p.id, "approved")}>
                        <Check className="h-3.5 w-3.5" /> Aprovar
                      </Button>
                    )}
                    {p.status !== "rejected" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateProposal(p.id, "rejected")}
                      >
                        <X className="h-3.5 w-3.5" /> Rejeitar
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => deleteProposal(p.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------- USO ---------- */}
        <TabsContent value="uso" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Uso da IA no mês</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <Stat label="Gerações" value={usage?.count ?? 0} />
              <Stat label="Limite" value={usage?.monthly_limit ?? 1000} />
              <Field label="Novo limite mensal">
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min={0}
                    defaultValue={usage?.monthly_limit ?? 1000}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v) || v < 0) return;
                      if (v !== usage?.monthly_limit) void updateLimit(v);
                    }}
                  />
                </div>
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Últimas 50 sugestões</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {logs.length === 0 && (
                <p className="text-sm text-muted-foreground">Sem registros.</p>
              )}
              {logs.map((l) => (
                <div key={l.id} className="rounded-md border border-border p-2 text-sm bg-card">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{new Date(l.created_at).toLocaleString("pt-BR")}</span>
                    {l.classification && (
                      <span className="rounded bg-secondary px-1.5 py-0.5">{l.classification}</span>
                    )}
                    {l.low_confidence && (
                      <span className="rounded bg-[var(--status-urgent)]/20 text-[var(--status-urgent)] px-1.5 py-0.5">
                        low confidence
                      </span>
                    )}
                    {l.was_sent && (
                      <span className="rounded bg-primary/15 text-primary px-1.5 py-0.5">
                        enviada{l.was_edited ? " (editada)" : ""}
                      </span>
                    )}
                  </div>
                  <div className="whitespace-pre-wrap mt-1 line-clamp-3">{l.generated_text}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------- ANALYTICS ---------- */}
        <TabsContent value="analytics" className="space-y-4">
          <AIAnalyticsDashboard />
        </TabsContent>

        {/* ---------- FOLLOW-UP ---------- */}
        <TabsContent value="followup" className="space-y-4">
          <AIFollowupPanel />
        </TabsContent>

        <TabsContent value="templates" className="space-y-4">
          <WhatsappTemplatesPanel />
        </TabsContent>


        {/* ---------- AUTOMAÇÃO ---------- */}
        <TabsContent value="automacao" className="space-y-4">
          <AIPilotPanel />
          {!automation ? (
            <Card>
              <CardContent className="py-8 text-sm text-muted-foreground">
                Configurações da empresa ainda não inicializadas.
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Bot className="h-4 w-4" /> Pré-atendimento automático
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="md:col-span-2 flex items-center justify-between rounded-md border border-border p-3">
                    <div>
                      <div className="text-sm font-medium">Ativar pré-atendimento da IA</div>
                      <div className="text-xs text-muted-foreground">
                        Quando ativado, a IA responde leads novos automaticamente.
                      </div>
                    </div>
                    <Switch
                      checked={automation.ai_auto_reply_enabled}
                      onCheckedChange={(v) => setAuto("ai_auto_reply_enabled", v)}
                    />
                  </div>
                  <div className="md:col-span-2 flex items-center justify-between rounded-md border border-border p-3">
                    <div>
                      <div className="text-sm font-medium">Somente fora do horário comercial</div>
                      <div className="text-xs text-muted-foreground">
                        Recomendado. A IA não interfere no fluxo durante o expediente.
                      </div>
                    </div>
                    <Switch
                      checked={automation.ai_after_hours_only}
                      onCheckedChange={(v) => setAuto("ai_after_hours_only", v)}
                    />
                  </div>
                  <Field label="Início do expediente">
                    <Input
                      type="time"
                      value={automation.business_hours_start.slice(0, 5)}
                      onChange={(e) => setAuto("business_hours_start", `${e.target.value}:00`)}
                    />
                  </Field>
                  <Field label="Fim do expediente">
                    <Input
                      type="time"
                      value={automation.business_hours_end.slice(0, 5)}
                      onChange={(e) => setAuto("business_hours_end", `${e.target.value}:00`)}
                    />
                  </Field>
                  <Field label="Nome do agente">
                    <Input
                      value={automation.ai_agent_name}
                      onChange={(e) => setAuto("ai_agent_name", e.target.value)}
                    />
                  </Field>
                  <Field label="Limite de respostas automáticas / conversa">
                    <Input
                      type="number"
                      min={1}
                      max={20}
                      value={automation.ai_max_auto_replies}
                      onChange={(e) =>
                        setAuto("ai_max_auto_replies", Number(e.target.value) || 5)
                      }
                    />
                  </Field>
                  <Field label="Timeout p/ humano assumir (min)">
                    <Input
                      type="number"
                      min={5}
                      max={240}
                      value={automation.ai_handoff_timeout_minutes}
                      onChange={(e) =>
                        setAuto("ai_handoff_timeout_minutes", Number(e.target.value) || 30)
                      }
                    />
                  </Field>
                  <Field label="Mensagem inicial sugerida (opcional)" full>
                    <Textarea
                      rows={3}
                      placeholder="Boa noite, tudo bem? Me chamo Fabrizio e vou dar sequência..."
                      value={automation.ai_initial_message ?? ""}
                      onChange={(e) =>
                        setAuto("ai_initial_message", e.target.value || null)
                      }
                    />
                  </Field>
                  <div className="md:col-span-2 flex justify-end">
                    <Button onClick={saveAutomation} disabled={savingAutomation}>
                      {savingAutomation && <Loader2 className="h-4 w-4 animate-spin" />}
                      Salvar automação
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Últimos eventos do agente</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {events.length === 0 && (
                    <p className="text-sm text-muted-foreground">Sem eventos ainda.</p>
                  )}
                  {events.map((e) => {
                    const isAlert =
                      e.event_type === "handoff_human" || e.event_type === "safety_block" || e.event_type === "agent_error";
                    return (
                      <div
                        key={e.id}
                        className="rounded-md border border-border p-2 text-xs flex items-start gap-2 bg-card"
                      >
                        {isAlert ? (
                          <AlertTriangle className="h-3.5 w-3.5 text-[var(--status-urgent)] mt-0.5" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5 text-primary mt-0.5" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono">{e.event_type}</span>
                            <span className="ml-auto text-muted-foreground">
                              {new Date(e.created_at).toLocaleString("pt-BR")}
                            </span>
                          </div>
                          {e.payload && Object.keys(e.payload).length > 0 && (
                            <pre className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
                              {JSON.stringify(e.payload, null, 0).slice(0, 240)}
                            </pre>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={`space-y-1 ${full ? "md:col-span-2" : ""}`}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value.toLocaleString("pt-BR")}</div>
    </div>
  );
}

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
import { Loader2, Plus, Trash2, Check, X, Sparkles, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/configuracoes/ia")({
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

  const loadAll = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    const monthKey = `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, "0")}-01`;

    const [{ data: prof }, { data: props }, { data: lgs }, { data: usg }] = await Promise.all([
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
    setLoading(false);
  }, [companyId, company?.name]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const saveProfile = async () => {
    if (!data || !companyId) return;
    setSaving(true);
    const payload = { ...data, company_id: companyId };
    const { error } = await supabase
      .from("ai_profiles")
      .upsert(payload, { onConflict: "company_id" });
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
        { company_id: companyId, month: monthKey, count: usage.count, monthly_limit: newLimit },
        { onConflict: "company_id,month" },
      );
    if (error) {
      toast.error("Falha", { description: error.message });
      return;
    }
    setUsage({ ...usage, monthly_limit: newLimit });
    toast.success("Limite atualizado");
  };

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
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <header className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold">IA de Atendimento</h1>
      </header>

      <Tabs defaultValue="perfil" className="space-y-4">
        <TabsList>
          <TabsTrigger value="perfil">Perfil</TabsTrigger>
          <TabsTrigger value="faq">FAQ</TabsTrigger>
          <TabsTrigger value="aprendizados">
            Aprendizados{pendingCount ? ` (${pendingCount})` : ""}
          </TabsTrigger>
          <TabsTrigger value="uso">Uso & Logs</TabsTrigger>
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
          <div className="flex justify-end">
            <Button onClick={saveProfile} disabled={saving}>
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
                <div key={i} className="grid gap-2 md:grid-cols-[1fr_2fr_auto] items-start">
                  <Input
                    placeholder="Pergunta"
                    value={f.q}
                    onChange={(e) => updateFaq(i, "q", e.target.value)}
                  />
                  <Textarea
                    rows={2}
                    placeholder="Resposta"
                    value={f.a}
                    onChange={(e) => updateFaq(i, "a", e.target.value)}
                  />
                  <Button size="icon" variant="ghost" onClick={() => removeFaq(i)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
          <div className="flex justify-end">
            <Button onClick={saveProfile} disabled={saving}>
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

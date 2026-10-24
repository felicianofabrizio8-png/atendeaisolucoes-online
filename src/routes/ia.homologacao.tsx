import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Bot, Loader2, ShieldCheck, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/auth/AuthContext";
import { useTeamAccess } from "@/hooks/useTeamAccess";
import { supabase } from "@/integrations/supabase/client";

type ChatMessage = { role: "lead" | "agent"; text: string };
type HomologationReport = { latencyMs: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number | null; openAiKind: string | null; nextActionMatch: boolean; memoryMatch: boolean; safetyRisk: boolean; fallback: boolean };

const SCENARIOS = [
  "Quero saber o preço da piscina de 6x3 e se existe desconto no Pix.",
  "Gostei, mas preciso conversar com minha família antes de decidir.",
  "O vendedor ficou de me retornar sobre o prazo e não retornou.",
  "Não quero mais receber contato, por favor.",
  "Pode transferir para uma pessoa do atendimento? Tenho uma condição especial para negociar.",
];

export const Route = createFileRoute("/ia/homologacao")({ component: BrunaHomologacao });

function BrunaHomologacao() {
  const { profile } = useAuth();
  const access = useTeamAccess();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [report, setReport] = useState<HomologationReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = access.access?.active === true && access.access.role === "admin";
  const companyLabel = useMemo(() => profile?.company_id ? `${profile.company_id.slice(0, 8)}…` : "—", [profile?.company_id]);

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true); setError(null); setReport(null);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const session = (await supabase.auth.getSession()).data.session;
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    const nextHistory = [...messages, { role: "lead" as const, text }];
    try {
      const response = await fetch("/api/ai/bruna-homologation", { method: "POST", headers, body: JSON.stringify({ message: text, history: messages }) });
      const body = await response.json() as { ok?: boolean; error?: string; message?: string | null; report?: HomologationReport };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "homologation_failed");
      const answer = body.message ?? "A OpenAI não retornou texto; revisar o relatório.";
      setMessages([...nextHistory, { role: "agent", text: answer }]);
      setReport(body.report ?? null);
      setDraft("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "homologation_failed");
    } finally { setBusy(false); }
  }

  if (!isAdmin) {
    return <Card><CardContent className="py-10 text-sm text-muted-foreground">Acesso restrito a administradores autorizados.</CardContent></Card>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <Card className="border-amber-500/40">
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4" /> Homologação isolada da Bruna OpenAI</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Empresa autorizada: <span className="font-mono">{companyLabel}</span>. Fixture 100% fictício; sem Meta, sem ferramentas externas e sem alteração de memória.</p>
          <p className="text-amber-600 dark:text-amber-400">A interface só funciona quando os guards server-side, orçamento e migration do shadow estiverem previamente configurados.</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex flex-wrap gap-2">{SCENARIOS.map((scenario) => <Button key={scenario} variant="outline" size="sm" onClick={() => setDraft(scenario)}>{scenario.slice(0, 42)}…</Button>)}</div>
          <div className="min-h-64 space-y-3 rounded-md border p-3">
            {messages.length === 0 && <p className="text-sm text-muted-foreground">Escolha um cenário ou escreva uma mensagem fictícia.</p>}
            {messages.map((item, index) => <div key={`${index}-${item.role}`} className={`flex gap-2 ${item.role === "agent" ? "justify-end" : ""}`}><div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${item.role === "agent" ? "bg-primary/10" : "bg-muted"}`}><div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">{item.role === "agent" ? <Bot className="h-3 w-3" /> : <UserRound className="h-3 w-3" />} {item.role === "agent" ? "Bruna OpenAI" : "Cliente fictício"}</div>{item.text}</div></div>)}
          </div>
          <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Digite uma mensagem fictícia…" maxLength={1200} rows={3} />
          <div className="flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">Somente simulação • flags de atendimento real desligadas</span><Button onClick={() => void send()} disabled={busy || !draft.trim()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Testar Bruna</Button></div>
          {error && <p className="text-sm text-destructive">Teste bloqueado: {error}</p>}
        </CardContent>
      </Card>
      {report && <Card><CardHeader><CardTitle className="text-base">Telemetria sanitizada</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4"><Metric label="Latência" value={`${report.latencyMs} ms`} /><Metric label="Tokens" value={`${report.inputTokens} → ${report.outputTokens}`} /><Metric label="Custo estimado" value={report.estimatedCostUsd === null ? "indisponível" : `$${report.estimatedCostUsd.toFixed(6)}`} /><Metric label="Risco" value={report.safetyRisk ? "revisar" : "não detectado"} /></CardContent></Card>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="font-medium">{value}</div></div>;
}

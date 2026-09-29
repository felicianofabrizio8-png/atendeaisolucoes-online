import { createLazyFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, CheckCircle2, FlaskConical, Play, RefreshCw, ShieldCheck } from "lucide-react";

type Campaign = {
  id: string;
  name: string;
  status: string;
  template_purpose: string;
  recipients: { total: number; pending: number; failed: number; sent: number; replied: number };
};

type Recipient = {
  id: string;
  lead_id: string;
  name_snapshot: string;
  phone_snapshot: string | null;
  status: string;
  attempts: number;
  last_error: string | null;
};

export const Route = createLazyFileRoute("/campanhas-relacionamento")({
  component: RelationshipCampaignsPage,
});

function RelationshipCampaignsPage() {
  const { session } = useAuth();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [templatePurpose, setTemplatePurpose] = useState("reactivation");
  const [definition, setDefinition] = useState('{"all":[{"field":"status","op":"eq","value":"novo"}]}');
  const [segmentId, setSegmentId] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function callApi(body?: Record<string, unknown>, query = "") {
    const token = session?.access_token;
    const response = await fetch("/api/relationship-campaigns" + query, {
      method: body ? "POST" : "GET",
      headers: {
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await response.json();
    if (!response.ok || json.ok === false) throw new Error(json.error ?? "Falha na operação");
    return json;
  }

  async function refresh() {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const json = await callApi();
      setCampaigns(json.campaigns ?? []);
      setSettings(json.settings ?? {});
      if (selected) {
        const rows = await callApi(undefined, "?campaign_id=" + encodeURIComponent(selected));
        setRecipients(rows.recipients ?? []);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [session?.access_token, selected]);

  async function run(action: Record<string, unknown>) {
    setLoading(true);
    setMessage("");
    try {
      const result = await callApi(action);
      if (result.count !== undefined) setMessage("Prévia: " + result.count + " destinatários elegíveis.");
      else if (result.status) setMessage("Resultado: " + result.status + (result.reason ? " — " + result.reason : ""));
      else setMessage("Operação concluída.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha na operação");
    } finally {
      setLoading(false);
    }
  }

  async function createSegment() {
    try {
      const parsed = JSON.parse(definition);
      const result = await callApi({ action: "create_segment", name: name || "Segmento operacional", definition: parsed });
      setSegmentId(result.segment.id);
      setMessage("Segmento salvo. ID: " + result.segment.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "JSON inválido");
    }
  }

  async function createCampaign() {
    if (!segmentId) { setMessage("Salve um segmento primeiro."); return; }
    await run({ action: "create_campaign", name: campaignName || "Campanha de relacionamento", segment_id: segmentId, template_purpose: templatePurpose });
  }

  const automationOn = settings.automatic_enabled === true;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto w-full space-y-6">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link to="/campanhas" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="h-3.5 w-3.5" /> Campanhas de mídia
          </Link>
          <h1 className="text-2xl font-semibold mt-2">Campanhas de relacionamento</h1>
          <p className="text-sm text-muted-foreground">
            Segmentos e destinatários WhatsApp. O envio real está bloqueado nesta versão.
          </p>
        </div>
        <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          {automationOn ? "Automação configurada" : "Automação desligada"}
        </div>
      </header>

      {message && <div className="rounded-md border bg-card px-3 py-2 text-sm">{message}</div>}

      <section className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <h2 className="font-medium">Configurar segmento</h2>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do segmento" className="w-full h-9 rounded-md border bg-background px-3 text-sm" />
          <textarea value={definition} onChange={(e) => setDefinition(e.target.value)} rows={5} className="w-full rounded-md border bg-background p-3 font-mono text-xs" />
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => run({ action: "preview_segment", definition: JSON.parse(definition) })} className="h-9 px-3 rounded-md border text-sm inline-flex items-center gap-2">
              <FlaskConical className="h-4 w-4" /> Preview/count
            </button>
            <button onClick={() => void createSegment()} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm">Salvar segmento</button>
          </div>
          {segmentId && <p className="text-xs text-muted-foreground break-all">Segmento atual: {segmentId}</p>}
          <div className="border-t pt-3 space-y-2">
            <h3 className="text-sm font-medium">Criar campanha operacional</h3>
            <input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="Nome da campanha" className="w-full h-9 rounded-md border bg-background px-3 text-sm" />
            <select value={templatePurpose} onChange={(e) => setTemplatePurpose(e.target.value)} className="w-full h-9 rounded-md border bg-background px-3 text-sm">
              <option value="reactivation">Reativação</option>
              <option value="quote_followup">Follow-up de orçamento</option>
              <option value="followup_resume">Retomada</option>
            </select>
            <button onClick={() => void createCampaign()} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm">Criar campanha</button>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4 space-y-3">
          <h2 className="font-medium">Automação segura</h2>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted-foreground">Limite diário<input type="number" value={Number(settings.daily_limit ?? 50)} onChange={(e) => setSettings((s) => ({ ...s, daily_limit: Number(e.target.value) }))} className="mt-1 w-full h-9 rounded-md border bg-background px-2 text-sm" /></label>
            <label className="text-xs text-muted-foreground">Limite por hora<input type="number" value={Number(settings.hourly_limit ?? 10)} onChange={(e) => setSettings((s) => ({ ...s, hourly_limit: Number(e.target.value) }))} className="mt-1 w-full h-9 rounded-md border bg-background px-2 text-sm" /></label>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input value={String(settings.business_hours_start ?? "09:00")} onChange={(e) => setSettings((s) => ({ ...s, business_hours_start: e.target.value }))} className="h-9 rounded-md border bg-background px-2 text-sm" aria-label="Início" />
            <input value={String(settings.business_hours_end ?? "18:00")} onChange={(e) => setSettings((s) => ({ ...s, business_hours_end: e.target.value }))} className="h-9 rounded-md border bg-background px-2 text-sm" aria-label="Fim" />
            <input value={String(settings.timezone ?? "America/Sao_Paulo")} onChange={(e) => setSettings((s) => ({ ...s, timezone: e.target.value }))} className="h-9 rounded-md border bg-background px-2 text-sm" aria-label="Timezone" />
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => run({ action: "save_settings", settings })} className="h-9 px-3 rounded-md border text-sm">Salvar limites/horário</button>
            <button onClick={() => run({ action: "activate_automation", enabled: !automationOn })} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm">
              {automationOn ? "Desativar automação" : "Ativar automação"}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">Ativar apenas agenda planejamento; o gate server-side mantém o disparo real bloqueado.</p>
        </div>
      </section>

      <section className="rounded-xl border bg-card">
        <div className="px-4 py-3 border-b flex items-center justify-between gap-2">
          <h2 className="font-medium">Campanhas operacionais</h2>
          <button onClick={() => void refresh()} className="h-8 px-2 rounded-md border text-xs inline-flex items-center gap-1"><RefreshCw className="h-3.5 w-3.5" /> Atualizar</button>
        </div>
        <div className="divide-y">
          {campaigns.length === 0 && <div className="p-8 text-sm text-muted-foreground text-center">Crie um segmento e uma campanha pela API operacional para começar.</div>}
          {campaigns.map((campaign) => (
            <div key={campaign.id} className="p-4 space-y-3">
              <div className="flex items-center gap-3">
                <button onClick={() => setSelected(campaign.id)} className="text-left flex-1">
                  <div className="font-medium text-sm">{campaign.name}</div>
                  <div className="text-xs text-muted-foreground">{campaign.status} · template: {campaign.template_purpose}</div>
                </button>
                <span className="text-xs text-muted-foreground">{campaign.recipients.total} destinatários · {campaign.recipients.sent} enviados · {campaign.recipients.replied} respostas</span>
                <button onClick={() => run({ action: "materialize_recipients", relationship_campaign_id: campaign.id })} className="h-8 px-2 rounded-md border text-xs">Materializar</button>
                <button onClick={() => run({ action: "schedule", relationship_campaign_id: campaign.id, mode: "assisted" })} className="h-8 px-2 rounded-md border text-xs inline-flex items-center gap-1"><Play className="h-3.5 w-3.5" /> Planejar</button>
              </div>
              {selected === campaign.id && <RecipientList campaign={campaign} recipients={recipients} onAction={run} />}
            </div>
          ))}
        </div>
      </section>

      {loading && <div className="text-xs text-muted-foreground">Atualizando…</div>}
    </div>
  );
}

function RecipientList({ campaign, recipients, onAction }: { campaign: Campaign; recipients: Recipient[]; onAction: (action: Record<string, unknown>) => void }) {
  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="px-3 py-2 bg-muted/30 text-xs font-medium">Recipients</div>
      <div className="divide-y max-h-80 overflow-auto">
        {recipients.length === 0 && <div className="p-4 text-xs text-muted-foreground">Nenhum recipient materializado.</div>}
        {recipients.map((recipient) => (
          <div key={recipient.id} className="px-3 py-2 flex items-center gap-2 text-xs">
            <span className="flex-1 truncate">{recipient.name_snapshot || recipient.lead_id}</span>
            <span className="text-muted-foreground">{recipient.phone_snapshot || "sem telefone"}</span>
            <span className="rounded-full bg-muted px-2 py-0.5">{recipient.status}</span>
            {recipient.status === "pending" && <button onClick={() => onAction({ action: "dispatch_preview", relationship_campaign_id: campaign.id, recipient_id: recipient.id, mode: "manual" })} className="h-7 px-2 rounded border inline-flex items-center gap-1"><FlaskConical className="h-3 w-3" /> Testar</button>}
            {["pending", "failed"].includes(recipient.status) && <button onClick={() => onAction({ action: "suppress", lead_id: recipient.lead_id, reason: "opt_out" })} className="h-7 px-2 rounded border">Opt-out</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

import { createLazyFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowLeft,
  CheckCircle2,
  FlaskConical,
  Pause,
  Play,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  isRelationshipPurpose,
  RELATIONSHIP_PURPOSES,
  relationshipPurposeLabel,
  type RelationshipPurpose,
} from "@/lib/relationship-campaign-purposes";

type DispatchMode = "manual" | "assisted" | "automatic";

/** Modos de envio por campanha. */
const DISPATCH_MODES: Record<DispatchMode, { label: string; description: string }> = {
  manual: {
    label: "Manual",
    description: "O operador prepara (Testar) e envia cada mensagem.",
  },
  assisted: {
    label: "Assistido",
    description: "A IA prepara as mensagens (Preparar com IA); o operador aprova cada envio.",
  },
  automatic: {
    label: "Automático",
    description:
      "Depois de \u201cAtivar automação\u201d, o sistema prepara e envia sozinho, dentro dos limites e do horário. Criada sempre desligada.",
  },
};

function isDispatchMode(value: unknown): value is DispatchMode {
  return typeof value === "string" && value in DISPATCH_MODES;
}

type Campaign = {
  id: string;
  name: string;
  status: string;
  template_purpose: string;
  dispatch_mode: DispatchMode;
  automatic_enabled: boolean;
  automation_changed_at?: string | null;
  recipients: { total: number; pending: number; failed: number; sent: number; replied: number };
};

type DispatchPreview = {
  status: "preview";
  would_send: boolean;
  blockers: string[];
  outcome?: string;
  purpose?: string;
  purpose_label?: string;
  template?: { name: string; category: string; language: string };
  variables?: Record<string, string>;
  content?: string;
  content_preview?: string;
  phrase_source?: string | null;
  prepared?: {
    id: string;
    prepared_at: string;
    reused: boolean;
    saved: boolean;
    error: string | null;
  };
  conversation_id?: string | null;
  conversation_note?: string | null;
};

type Recipient = {
  id: string;
  lead_id: string;
  name_snapshot: string;
  phone_snapshot: string | null;
  status: string;
  attempts: number;
  last_error: string | null;
  metadata?: { prepared_dispatch?: { variables?: Record<string, string> } } | null;
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
  const [templatePurpose, setTemplatePurpose] = useState<RelationshipPurpose>("reactivation");
  const [dispatchMode, setDispatchMode] = useState<DispatchMode>("manual");
  const [realSendEnabled, setRealSendEnabled] = useState(false);
  const [previews, setPreviews] = useState<Record<string, DispatchPreview | { error: string }>>({});
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
      setRealSendEnabled(json.real_send_enabled === true);
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
      else if (result.status === "prepared")
        setMessage(
          "Preparados com IA: " + result.prepared + " novos, " + result.reused + " já prontos, " + result.blocked + " bloqueados. Nada foi enviado.",
        );
      else if (result.status) setMessage("Resultado: " + result.status + (result.reason ? " · " + result.reason : ""));
      else if (result.campaign) setMessage("Campanha atualizada.");
      else setMessage("Operação concluída.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha na operação");
    } finally {
      setLoading(false);
    }
  }

  /** "Testar": prévia sem efeitos, mostrada junto do destinatário. */
  async function previewRecipient(campaignId: string, recipientId: string, regenerate = false) {
    setPreviews((p) => ({ ...p, [recipientId]: { error: "" } }));
    try {
      const result = await callApi({
        action: "dispatch_preview",
        relationship_campaign_id: campaignId,
        recipient_id: recipientId,
        mode: "manual",
        regenerate,
      });
      setPreviews((p) => ({ ...p, [recipientId]: result as DispatchPreview }));
    } catch (error) {
      setPreviews((p) => ({
        ...p,
        [recipientId]: { error: error instanceof Error ? error.message : "Falha na prévia" },
      }));
    }
  }

  /** "Enviar" (manual) / "Aprovar e enviar" (assistido): só o var1 salvo. */
  async function sendRecipient(campaignId: string, recipientId: string) {
    setLoading(true);
    setMessage("");
    try {
      const result = await callApi({
        action: "dispatch_send",
        relationship_campaign_id: campaignId,
        recipient_id: recipientId,
      });
      if (result.status === "preview") {
        setMessage("Envio real bloqueado no servidor — nada foi enviado. O var1 salvo continua valendo.");
        setPreviews((p) => ({ ...p, [recipientId]: result as DispatchPreview }));
      } else {
        setMessage(
          "Resultado: " + result.status + (result.reason || result.error ? " · " + (result.reason ?? result.error) : ""),
        );
      }
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha no envio");
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
    await run({ action: "create_campaign", name: campaignName || "Campanha de relacionamento", segment_id: segmentId, template_purpose: templatePurpose, dispatch_mode: dispatchMode });
  }

  const activeAutomations = campaigns.filter(
    (c) => c.dispatch_mode === "automatic" && c.automatic_enabled,
  ).length;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto w-full space-y-6">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link to="/campanhas" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="h-3.5 w-3.5" /> Campanhas de mídia
          </Link>
          <h1 className="text-2xl font-semibold mt-2">Campanhas de relacionamento</h1>
          <p className="text-sm text-muted-foreground">
            Segmentos e destinatários WhatsApp, com envio manual, assistido ou automático por campanha.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div
            className="rounded-lg border bg-muted/30 px-3 py-2 text-xs flex items-center gap-2"
            aria-label="Envio real no servidor"
          >
            {realSendEnabled ? (
              <ShieldAlert className="h-4 w-4 text-amber-600" />
            ) : (
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
            )}
            {realSendEnabled
              ? "Envio real liberado no servidor"
              : "Envio real bloqueado no servidor — nada é enviado"}
          </div>
          <div className="text-xs text-muted-foreground">
            {activeAutomations > 0
              ? activeAutomations + (activeAutomations === 1 ? " automação ativa" : " automações ativas")
              : "Nenhuma automação ativa"}
          </div>
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
            <select
              value={templatePurpose}
              onChange={(e) => {
                if (isRelationshipPurpose(e.target.value)) setTemplatePurpose(e.target.value);
              }}
              aria-label="Tipo de campanha"
              className="w-full h-9 rounded-md border bg-background px-3 text-sm"
            >
              {(Object.keys(RELATIONSHIP_PURPOSES) as RelationshipPurpose[]).map((key) => (
                <option key={key} value={key}>
                  {RELATIONSHIP_PURPOSES[key].label} · {RELATIONSHIP_PURPOSES[key].template}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">{RELATIONSHIP_PURPOSES[templatePurpose].description}</p>
            <select
              value={dispatchMode}
              onChange={(e) => {
                if (isDispatchMode(e.target.value)) setDispatchMode(e.target.value);
              }}
              aria-label="Modo de envio"
              className="w-full h-9 rounded-md border bg-background px-3 text-sm"
            >
              {(Object.keys(DISPATCH_MODES) as DispatchMode[]).map((key) => (
                <option key={key} value={key}>
                  Envio {DISPATCH_MODES[key].label.toLowerCase()}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">{DISPATCH_MODES[dispatchMode].description}</p>
            <button onClick={() => void createCampaign()} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm">Criar campanha</button>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4 space-y-3">
          <h2 className="font-medium">Limites e horário</h2>
          <p className="text-xs text-muted-foreground">
            Valem para todas as campanhas automáticas da empresa (janela móvel de 24 h e de 1 h).
          </p>
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
          </div>
          <p className="text-xs text-muted-foreground">
            A automação é ativada por campanha (modo Automático). Mesmo ativa, nada é enviado enquanto o
            envio real estiver bloqueado no servidor.
          </p>
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
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                    <PurposeBadge purpose={campaign.template_purpose} />
                    <ModeBadge campaign={campaign} />
                    <span>{campaign.status}</span>
                  </div>
                </button>
                <span className="text-xs text-muted-foreground">{campaign.recipients.total} destinatários · {campaign.recipients.sent} enviados · {campaign.recipients.replied} respostas</span>
                <button onClick={() => run({ action: "materialize_recipients", relationship_campaign_id: campaign.id })} className="h-8 px-2 rounded-md border text-xs">Materializar</button>
                <button onClick={() => run({ action: "schedule", relationship_campaign_id: campaign.id, mode: "assisted" })} className="h-8 px-2 rounded-md border text-xs inline-flex items-center gap-1"><Play className="h-3.5 w-3.5" /> Planejar</button>
              </div>
              <CampaignModeControls
                campaign={campaign}
                realSendEnabled={realSendEnabled}
                onAction={run}
              />
              {selected === campaign.id && (
                <RecipientList
                  campaign={campaign}
                  recipients={recipients}
                  previews={previews}
                  onPreview={(recipientId, regenerate) =>
                    void previewRecipient(campaign.id, recipientId, regenerate)
                  }
                  onSend={(recipientId) => void sendRecipient(campaign.id, recipientId)}
                  onAction={run}
                />
              )}
            </div>
          ))}
        </div>
      </section>

      {loading && <div className="text-xs text-muted-foreground">Atualizando…</div>}
    </div>
  );
}

function ModeBadge({ campaign }: { campaign: Campaign }) {
  const mode = isDispatchMode(campaign.dispatch_mode) ? campaign.dispatch_mode : "manual";
  if (mode === "automatic") {
    return campaign.automatic_enabled ? (
      <span
        className="rounded-full px-2 py-0.5 text-[11px] font-medium bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1"
        aria-label="Automação ativa"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> Automático · ativo
      </span>
    ) : (
      <span className="rounded-full px-2 py-0.5 text-[11px] font-medium bg-muted text-muted-foreground">
        Automático · pausado
      </span>
    );
  }
  return (
    <span className="rounded-full px-2 py-0.5 text-[11px] font-medium bg-muted text-foreground">
      {DISPATCH_MODES[mode].label}
    </span>
  );
}

/** Modo da campanha + "Ativar/Pausar automação" (admin) + "Preparar com IA" (assistido). */
function CampaignModeControls({
  campaign,
  realSendEnabled,
  onAction,
}: {
  campaign: Campaign;
  realSendEnabled: boolean;
  onAction: (action: Record<string, unknown>) => void;
}) {
  const mode = isDispatchMode(campaign.dispatch_mode) ? campaign.dispatch_mode : "manual";
  const active = mode === "automatic" && campaign.automatic_enabled;
  return (
    <div className="flex items-center gap-2 flex-wrap text-xs">
      <label className="inline-flex items-center gap-1.5 text-muted-foreground">
        Modo de envio
        <select
          value={mode}
          onChange={(e) =>
            onAction({
              action: "set_campaign_mode",
              relationship_campaign_id: campaign.id,
              dispatch_mode: e.target.value,
            })
          }
          aria-label={"Modo de envio de " + campaign.name}
          className="h-8 rounded-md border bg-background px-2 text-xs text-foreground"
        >
          {(Object.keys(DISPATCH_MODES) as DispatchMode[]).map((key) => (
            <option key={key} value={key}>
              {DISPATCH_MODES[key].label}
            </option>
          ))}
        </select>
      </label>
      {mode === "assisted" && (
        <button
          onClick={() => onAction({ action: "prepare_batch", relationship_campaign_id: campaign.id })}
          className="h-8 px-2 rounded-md border inline-flex items-center gap-1"
        >
          <Sparkles className="h-3.5 w-3.5" /> Preparar com IA
        </button>
      )}
      {mode === "automatic" && (
        <>
          <button
            onClick={() =>
              onAction({
                action: "set_campaign_automation",
                relationship_campaign_id: campaign.id,
                enabled: !active,
              })
            }
            className={
              "h-8 px-2 rounded-md inline-flex items-center gap-1 " +
              (active ? "border" : "bg-primary text-primary-foreground")
            }
          >
            {active ? (
              <>
                <Pause className="h-3.5 w-3.5" /> Pausar automação
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" /> Ativar automação
              </>
            )}
          </button>
          <span className={active ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}>
            {active
              ? "Automação ativa" +
                (campaign.automation_changed_at
                  ? " desde " + new Date(campaign.automation_changed_at).toLocaleString("pt-BR")
                  : "") +
                (realSendEnabled ? " — prepara e envia a cada ciclo." : " — envio real bloqueado no servidor: nada sai.")
              : "Automação pausada — nada é preparado nem enviado automaticamente."}
          </span>
        </>
      )}
      {mode !== "automatic" && <span className="text-muted-foreground">{DISPATCH_MODES[mode].description}</span>}
    </div>
  );
}

function PurposeBadge({ purpose }: { purpose: string }) {
  const info = isRelationshipPurpose(purpose) ? RELATIONSHIP_PURPOSES[purpose] : null;
  return (
    <span
      title={info?.description}
      className={
        "rounded-full px-2 py-0.5 text-[11px] font-medium " +
        (purpose === "followup_resume"
          ? "bg-sky-500/10 text-sky-700 dark:text-sky-300"
          : "bg-amber-500/10 text-amber-700 dark:text-amber-300")
      }
    >
      {relationshipPurposeLabel(purpose)}
      {info ? ` · ${info.template}` : ""}
    </span>
  );
}

/** Destaca os trechos {{…}} da prévia (o texto fixo do template fica intacto). */
function MarkedContent({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\{\{[\s\S]*?\}\})/).map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-sky-500/15 px-0.5 text-foreground">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

function PreviewPanel({
  preview,
  onRegenerate,
}: {
  preview: DispatchPreview | { error: string };
  onRegenerate: () => void;
}) {
  if ("error" in preview) {
    return (
      <div className="mt-2 rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        {preview.error ? preview.error : "Gerando prévia…"}
      </div>
    );
  }
  return (
    <div className="mt-2 rounded-md border bg-muted/20 px-3 py-2 text-xs space-y-1.5" aria-label="Prévia do envio">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium">Prévia — nada foi enviado</span>
        {preview.purpose && <PurposeBadge purpose={preview.purpose} />}
        {preview.template && (
          <span className="text-muted-foreground">
            template {preview.template.name} ({preview.template.category}, {preview.template.language})
          </span>
        )}
      </div>
      {preview.variables && Object.keys(preview.variables).length > 0 && (
        <div>
          <span className="text-muted-foreground">Variáveis: </span>
          {Object.entries(preview.variables).map(([name, value]) => (
            <code key={name} className="mr-2 rounded bg-background px-1">
              {name} = "{value}"
            </code>
          ))}
          {preview.phrase_source && (
            <span className="text-muted-foreground">(frase: {preview.phrase_source})</span>
          )}
        </div>
      )}
      {(preview.content_preview ?? preview.content) && (
        <div className="rounded border bg-background px-2 py-1.5 whitespace-pre-wrap">
          <MarkedContent text={preview.content_preview ?? preview.content ?? ""} />
        </div>
      )}
      {preview.content_preview && (
        <div className="text-muted-foreground">
          As chaves {"{{ }}"} só marcam o trecho variável; a Meta recebe apenas o conteúdo interno.
        </div>
      )}
      {preview.prepared && (
        <div className="flex items-center gap-2 flex-wrap text-muted-foreground">
          <span>
            {preview.prepared.saved
              ? preview.prepared.reused
                ? "var1 já salvo — o envio real usará exatamente este texto, sem nova IA."
                : "var1 salvo — o envio real usará exatamente este texto, sem nova IA."
              : "var1 não salvo — o envio real ficará bloqueado."}
          </span>
          {preview.purpose === "followup_resume" && (
            <button onClick={onRegenerate} className="h-6 px-2 rounded border text-foreground">
              Gerar outra frase
            </button>
          )}
        </div>
      )}
      {preview.conversation_note && <div className="text-muted-foreground">{preview.conversation_note}</div>}
      {preview.blockers.length > 0 ? (
        <ul className="list-disc pl-4 text-amber-700 dark:text-amber-300">
          {preview.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : (
        <div className="text-emerald-700 dark:text-emerald-300">Pronto para envio quando o envio real for habilitado.</div>
      )}
    </div>
  );
}

function RecipientList({
  campaign,
  recipients,
  previews,
  onPreview,
  onSend,
  onAction,
}: {
  campaign: Campaign;
  recipients: Recipient[];
  previews: Record<string, DispatchPreview | { error: string }>;
  onPreview: (recipientId: string, regenerate?: boolean) => void;
  onSend: (recipientId: string) => void;
  onAction: (action: Record<string, unknown>) => void;
}) {
  const operatorSends = campaign.dispatch_mode === "manual" || campaign.dispatch_mode === "assisted";
  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="px-3 py-2 bg-muted/30 text-xs font-medium">Recipients</div>
      <div className="divide-y max-h-80 overflow-auto">
        {recipients.length === 0 && <div className="p-4 text-xs text-muted-foreground">Nenhum recipient materializado.</div>}
        {recipients.map((recipient) => (
          <div key={recipient.id} className="px-3 py-2 text-xs">
            <div className="flex items-center gap-2">
            <span className="flex-1 truncate">{recipient.name_snapshot || recipient.lead_id}</span>
            <span className="text-muted-foreground">{recipient.phone_snapshot || "sem telefone"}</span>
            <span className="rounded-full bg-muted px-2 py-0.5">{recipient.status}</span>
            {["pending", "failed"].includes(recipient.status) && <button onClick={() => onPreview(recipient.id)} className="h-7 px-2 rounded border inline-flex items-center gap-1"><FlaskConical className="h-3 w-3" /> Testar</button>}
            {recipient.metadata?.prepared_dispatch && (
              <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-sky-700 dark:text-sky-300">preparado</span>
            )}
            {operatorSends && ["pending", "failed"].includes(recipient.status) && (
              <button
                onClick={() => onSend(recipient.id)}
                disabled={!recipient.metadata?.prepared_dispatch}
                title={recipient.metadata?.prepared_dispatch ? undefined : "Prepare a mensagem antes (Testar ou Preparar com IA)"}
                className="h-7 px-2 rounded border inline-flex items-center gap-1 disabled:opacity-50"
              >
                <Send className="h-3 w-3" />
                {campaign.dispatch_mode === "assisted" ? "Aprovar e enviar" : "Enviar"}
              </button>
            )}
            {["pending", "failed"].includes(recipient.status) && <button onClick={() => onAction({ action: "suppress", lead_id: recipient.lead_id, reason: "opt_out" })} className="h-7 px-2 rounded border">Opt-out</button>}
            </div>
            {previews[recipient.id] && (
              <PreviewPanel
                preview={previews[recipient.id]}
                onRegenerate={() => onPreview(recipient.id, true)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

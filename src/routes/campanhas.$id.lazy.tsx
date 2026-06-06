import { createLazyFileRoute, Link, useNavigate, useRouter, getRouteApi } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { publishCampaign } from "@/lib/campaign-publish.functions";
import { syncCampaignStatusFromMeta, type CampaignMetaLiveStatus } from "@/lib/campaign-meta-sync.functions";
import { activateCampaignOnMeta } from "@/lib/campaign-meta-activate.functions";
import { syncCampaignInsightsFromMeta, type CampaignInsightsResult } from "@/lib/campaign-meta-insights.functions";

import { MetaPublishReadinessPanel } from "@/components/MetaPublishReadinessPanel";
import { Loader2, Rocket } from "lucide-react";
import {
  getCampaign,
  deleteCampaign,
  formatBRL,
  statusLabel,
  channelLabel,
  goalLabel,
  type Campaign,
  type CampaignStatus,
} from "@/lib/campaigns";
import {
  ArrowLeft,
  Trash2,
  Sparkles,
  Users,
  MessageSquare,
  DollarSign,
  TrendingUp,
  Calendar,
  MapPin,
  Target,
  CheckCircle2,
  CircleDashed,
  PauseCircle,
  PlayCircle,
  AlertTriangle,
  XCircle,
  Clock,
  Image as ImageIcon,
  Send,
  Activity,
  Eye,
  MousePointerClick,
  BarChart3,
  Wand2,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SmartImage } from "@/components/SmartImage";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const routeApi = getRouteApi("/campanhas/$id");

// Display-only status superset: maps onto Campaign["status"] plus future Meta states.
type DisplayStatus = CampaignStatus | "publishing" | "error" | "rejected";
type MetaPanelStatus = {
  label: string;
  hint: string;
  variant: "active" | "paused" | "review" | "issues" | "archived" | "unknown";
  rows: Array<{ label: string; id: string | null; status: string; effective: string }>;
};

export const Route = createLazyFileRoute("/campanhas/$id")({
  component: CampaignDetailPage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-6 max-w-md mx-auto space-y-3 text-center">
        <h2 className="text-lg font-semibold">Erro ao carregar a campanha</h2>
        <p className="text-sm text-muted-foreground">{error.message}</p>
        <div className="flex gap-2 justify-center">
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
          >
            Tentar novamente
          </button>
          <Link to="/campanhas" className="h-9 px-4 inline-flex items-center rounded-md border text-sm">
            Voltar
          </Link>
        </div>
      </div>
    );
  },
  notFoundComponent: () => (
    <div className="p-6 max-w-md mx-auto space-y-3 text-center">
      <h2 className="text-lg font-semibold">Campanha não encontrada</h2>
      <Link to="/campanhas" className="text-sm text-primary hover:underline">Voltar</Link>
    </div>
  ),
});

function CampaignDetailPage() {
  const { id } = routeApi.useParams();
  const navigate = useNavigate();
  const [c, setC] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [improveOpen, setImproveOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishStage, setPublishStage] = useState<string>("");
  const [metaLiveStatus, setMetaLiveStatus] = useState<CampaignMetaLiveStatus | null>(null);
  const [mediaCheck, setMediaCheck] = useState<{
    url: string;
    status: number | null;
    contentType: string | null;
    ok: boolean;
    method: string;
    source: string;
    error?: string;
  } | null>(null);
  const publishFn = useServerFn(publishCampaign);
  const syncMetaFn = useServerFn(syncCampaignStatusFromMeta);
  const activateMetaFn = useServerFn(activateCampaignOnMeta);
  const syncInsightsFn = useServerFn(syncCampaignInsightsFromMeta);
  const [activating, setActivating] = useState(false);
  const [insights, setInsights] = useState<CampaignInsightsResult | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);

  async function performActivate() {
    if (!c) return;
    setActivating(true);
    try {
      const r = await activateMetaFn({ data: { campaignId: c.id } });
      if (r.ok) {
        toast.success("Os 3 objetos foram ativados na Meta.");
      } else {
        const msg = (r as { message?: string }).message ?? r.error ?? "Falha ao ativar na Meta.";
        toast.error(msg);
      }
      try {
        const live = await syncMetaFn({ data: { campaignId: c.id } });
        setMetaLiveStatus(live);
      } catch (e) {
        console.warn("[campaign-detail] sync after activate failed", e);
      }
      const fresh = await getCampaign(c.id);
      if (fresh) setC(fresh);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao ativar na Meta.");
    } finally {
      setActivating(false);
    }
  }

  async function performSyncInsights(opts?: { silent?: boolean }) {
    if (!c?.meta_campaign_id) return;
    setInsightsLoading(true);
    try {
      const r = await syncInsightsFn({ data: { campaignId: c.id } });
      setInsights(r);
      if (r.ok && r.metrics) {
        // Recarrega campaign para refletir leads_count/messages_count/spent atualizados
        const fresh = await getCampaign(c.id);
        if (fresh) setC(fresh);
        if (!opts?.silent) toast.success("Métricas sincronizadas com a Meta.");
      } else if (r.ok && !r.has_data && !opts?.silent) {
        toast.info("Campanha ativa aguardando primeiras impressões.");
      } else if (!r.ok && !opts?.silent) {
        toast.error(r.error ?? "Falha ao sincronizar métricas.");
      }
    } catch (e) {
      if (!opts?.silent) toast.error(e instanceof Error ? e.message : "Erro ao sincronizar.");
    } finally {
      setInsightsLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    setMetaLiveStatus(null);
    setInsights(null);
    getCampaign(id)
      .then(async (camp) => {
        setC(camp);
        if (camp?.meta_campaign_id) {
          try {
            const live = await syncMetaFn({ data: { campaignId: id } });
            setMetaLiveStatus(live);
          } catch (e) {
            console.warn("[campaign-detail] meta sync failed", e);
          }
          try {
            const ins = await syncInsightsFn({ data: { campaignId: id } });
            setInsights(ins);
          } catch (e) {
            console.warn("[campaign-detail] insights sync failed", e);
          }
          const fresh = await getCampaign(id);
          if (fresh) setC(fresh);
        }
      })
      .catch(() => setC(null))
      .finally(() => setLoading(false));
  }, [id, syncMetaFn, syncInsightsFn]);

  // Auto-refresh a cada 15 minutos enquanto a tela estiver aberta
  useEffect(() => {
    if (!c?.meta_campaign_id) return;
    const handle = window.setInterval(() => {
      syncInsightsFn({ data: { campaignId: c.id } })
        .then((r) => setInsights(r))
        .catch((e) => console.warn("[campaign-detail] auto insights sync failed", e));
    }, 15 * 60 * 1000);
    return () => window.clearInterval(handle);
  }, [c?.id, c?.meta_campaign_id, syncInsightsFn]);



  async function performDelete() {
    if (!c) return;
    setDeleting(true);
    try {
      await deleteCampaign(c.id);
      toast.success("Campanha excluída.");
      navigate({ to: "/campanhas" });
    } catch {
      toast.error("Erro ao excluir.");
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  }

  async function performPublish() {
    if (!c || publishing) return;
    // Validação base (independente do canal). Requisitos específicos por canal
    // (WhatsApp número, Página FB, Instagram actor) são validados no servidor
    // com mensagens dedicadas — aqui apenas garantimos o mínimo universal.
    const channelOk = c.objective === "whatsapp" || c.objective === "messenger" || c.objective === "instagram";
    const canPublish =
      channelOk &&
      c.goal === "leads" &&
      Boolean(c.media_url) &&
      c.media_type !== "video" &&
      Number(c.daily_budget ?? 0) > 0;
    if (!canPublish) {
      toast.error("Requisitos mínimos: canal válido + Leads + imagem única + orçamento diário.");
      return;
    }
    setPublishing(true);
    setPublishStage("Validando integração Meta…");
    // Progresso simulado (o pipeline real é sequencial mas atômico do lado do servidor).
    const stages = ["Enviando mídia…", "Criando campanha…", "Criando público…", "Publicando anúncio…"];
    let i = 0;
    const tick = window.setInterval(() => {
      i = Math.min(i + 1, stages.length - 1);
      setPublishStage(stages[i]);
    }, 1200);
    try {
      const r = await publishFn({ data: { campaignId: c.id } });
      window.clearInterval(tick);
      const mc = (r as { mediaCheck?: typeof mediaCheck }).mediaCheck ?? null;
      setMediaCheck(mc);
      if (r.ok) {
        toast.success("Campanha ativada na Meta com status real confirmado.");
        try {
          const live = await syncMetaFn({ data: { campaignId: c.id } });
          setMetaLiveStatus(live);
        } catch (e) {
          console.warn("[campaign-detail] meta sync after publish failed", e);
        }
        const fresh = await getCampaign(c.id);
        if (fresh) setC(fresh);
      } else {
        const msg = "message" in r && r.message ? r.message : "Falha ao publicar.";
        toast.error(msg);
        const fresh = await getCampaign(c.id);
        if (fresh) setC(fresh);
      }
    } catch (e) {
      window.clearInterval(tick);
      const raw = e instanceof Error ? e.message : String(e ?? "");
      if (/unauthorized|no authorization header|401/i.test(raw)) {
        toast.error("Sessão expirada. Faça login novamente para publicar.");
      } else {
        toast.error(raw || "Erro inesperado ao publicar.");
      }
    } finally {
      setPublishing(false);
      setPublishStage("");
    }
  }


  const scores = useMemo(() => (c ? scoreCampaign(c) : null), [c]);
  const suggestions = useMemo(() => (c ? buildSuggestions(c) : []), [c]);
  const timeline = useMemo(() => (c ? buildTimeline(c) : []), [c]);

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;
  }
  if (!c) {
    return (
      <div className="p-6 space-y-3">
        <div className="text-sm text-muted-foreground">Campanha não encontrada.</div>
        <Link to="/campanhas" className="text-sm text-primary hover:underline">
          ← Voltar
        </Link>
      </div>
    );
  }

  const status: DisplayStatus = c.status;
  const cpl = c.leads_count > 0 ? Number(c.spent) / c.leads_count : 0;
  const metaActive = Boolean(c.meta_campaign_id);
  const metaStatus = getMetaPanelStatus(c, metaLiveStatus);
  // Anúncio incompleto: já criou campaign+adset na Meta, mas falta o ad.
  const needsAdRetry = Boolean(c.meta_campaign_id && c.meta_adset_id && !c.meta_ad_id);
  const hasAllMetaIds = Boolean(c.meta_campaign_id && c.meta_adset_id && c.meta_ad_id);
  const canActivateOnMeta = hasAllMetaIds && c.meta_delivery_status !== "active_on_meta";

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto w-full space-y-5">
      <Link
        to="/campanhas"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Campanhas
      </Link>

      {/* Header + status banner */}
      <header className="space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold truncate">{c.name}</h1>
            <p className="text-sm text-muted-foreground">
              Canal: {channelLabel(c.objective)} · Objetivo: {goalLabel(c.goal)}
              {c.product ? ` · ${c.product}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {needsAdRetry && (
              <button
                onClick={performPublish}
                disabled={publishing}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-amber-500 text-white text-sm font-medium hover:bg-amber-500/90 disabled:opacity-60 disabled:cursor-not-allowed"
                title="A campanha e o conjunto já existem na Meta, mas o anúncio final não foi criado."
              >
                {publishing ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> {publishStage || "Retomando…"}</>
                ) : (
                  <><Rocket className="h-4 w-4" /> Tentar criar anúncio novamente</>
                )}
              </button>
            )}
            {!metaActive && c.status !== "active" && !needsAdRetry && (
              <button
                onClick={performPublish}
                disabled={publishing}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {publishing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {publishStage || "Publicando…"}
                  </>
                ) : (
                  <>
                    <Rocket className="h-4 w-4" /> Publicar campanha
                  </>
                )}
              </button>
            )}
            {canActivateOnMeta && (
              <button
                onClick={performActivate}
                disabled={activating || publishing}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-600/90 disabled:opacity-60 disabled:cursor-not-allowed"
                title="Faz POST status=ACTIVE nos 3 objetos (campaign, adset, ad) usando os IDs já salvos."
              >
                {activating ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Ativando…</>
                ) : (
                  <><PlayCircle className="h-4 w-4" /> Ativar na Meta</>
                )}
              </button>
            )}
            <button
              onClick={() => setConfirmOpen(true)}
              disabled={publishing || activating}
              className="inline-flex items-center gap-1 h-9 px-3 rounded-md border text-sm hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40 disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" /> Excluir
            </button>
          </div>

        </div>
        <StatusBanner status={status} updatedAt={c.updated_at} metaId={c.meta_campaign_id} metaStatus={metaStatus} />
        {(needsAdRetry || c.meta_publish_error) && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              {needsAdRetry && (
                <div className="font-medium">Anúncio não foi finalizado na Meta. Use “Tentar criar anúncio novamente”.</div>
              )}
              {c.meta_publish_error && (
                <div className="font-mono break-all opacity-80">{c.meta_publish_error}</div>
              )}
            </div>
          </div>
        )}
        {mediaCheck && (
          <div
            className={cn(
              "rounded-lg border px-3 py-2 text-xs flex items-start gap-2",
              mediaCheck.ok
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-destructive/40 bg-destructive/10 text-destructive",
            )}
          >
            {mediaCheck.ok ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            )}
            <div className="space-y-0.5 min-w-0">
              <div className="font-medium">
                Pré-check da imagem enviada à Meta · {mediaCheck.ok ? "OK" : "Falhou"}
              </div>
              <div className="opacity-80">
                HTTP {mediaCheck.status ?? "—"} · {mediaCheck.contentType ?? "sem content-type"} ·
                fonte: {mediaCheck.source} · método: {mediaCheck.method}
              </div>
              <a
                href={mediaCheck.url}
                target="_blank"
                rel="noreferrer"
                className="font-mono break-all underline opacity-80 hover:opacity-100"
              >
                {mediaCheck.url}
              </a>
              {mediaCheck.error && (
                <div className="opacity-80">Erro: {mediaCheck.error}</div>
              )}
            </div>
          </div>
        )}
      </header>



      {!metaActive && <MetaPublishReadinessPanel campaign={c} />}

      {/* Dados reais da campanha */}
      <section className="space-y-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" /> Dados reais da campanha
            </h2>
            <p className="text-xs text-muted-foreground">
              Métricas oficiais sincronizadas com a Meta Ads.
            </p>
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium",
              metaActive
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-muted text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                metaActive ? "bg-emerald-500" : "bg-muted-foreground",
              )}
            />
            {metaActive ? "Meta Ads conectado" : "Aguardando publicação Meta"}
          </span>
        </div>

        {!metaActive && (
          <div className="rounded-lg border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            Sem dados reais ainda — os KPIs serão preenchidos automaticamente assim que a campanha for publicada na Meta.
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <Kpi icon={Users} label="Leads" value={metaActive ? String(c.leads_count) : "—"} muted={!metaActive} />
          <Kpi icon={MessageSquare} label="Mensagens" value={metaActive ? String(c.messages_count) : "—"} muted={!metaActive} />
          <Kpi
            icon={TrendingUp}
            label="Custo / lead"
            value={metaActive && c.leads_count > 0 ? formatBRL(cpl) : "—"}
            muted={!metaActive}
          />
          <Kpi icon={DollarSign} label="Gasto real" value={metaActive ? formatBRL(c.spent) : "—"} muted={!metaActive} />
          <Kpi icon={DollarSign} label="Orçamento/dia" value={formatBRL(c.daily_budget)} />
          <Kpi icon={Eye} label="Impressões" value="—" muted />
          <Kpi icon={Users} label="Alcance" value="—" muted />
          <Kpi icon={MousePointerClick} label="CTR" value="—" muted />
          <Kpi icon={BarChart3} label="CPC" value="—" muted />
          <Kpi icon={BarChart3} label="CPM" value="—" muted />
        </div>
      </section>

      {/* Criativo + Detalhes */}
      <section className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl border bg-card p-4 space-y-3">
          <h2 className="text-sm font-semibold">Criativo</h2>
          {c.media_url ? (
            c.media_type === "video" ? (
              <video src={c.media_url} controls className="w-full rounded-md max-h-72" />
            ) : (
              <SmartImage
                src={c.media_url}
                alt={c.headline ?? ""}
                aspectRatio="16/9"
                wrapperClassName="w-full rounded-md max-h-72"
                className="object-contain"
              />
            )
          ) : (
            <div className="h-40 rounded-md border border-dashed flex items-center justify-center text-xs text-muted-foreground">
              Sem mídia
            </div>
          )}
          {c.headline && <div className="font-medium">{c.headline}</div>}
          {c.primary_text && (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{c.primary_text}</p>
          )}
          {c.cta && (
            <div className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-primary/10 text-primary text-xs font-medium">
              {c.cta}
            </div>
          )}
        </div>

        <aside className="rounded-xl border bg-card p-4 space-y-3 text-sm">
          <h2 className="text-sm font-semibold">Detalhes</h2>
          <Info icon={Target} label="Canal" value={channelLabel(c.objective)} />
          <Info icon={Sparkles} label="Objetivo" value={goalLabel(c.goal)} />
          <Info icon={MapPin} label="Local" value={c.city ?? "—"} />
          <Info icon={MapPin} label="Raio" value={c.radius_km ? `${c.radius_km} km` : "—"} />
          <Info
            icon={Calendar}
            label="Início"
            value={c.start_date ? new Date(c.start_date).toLocaleDateString("pt-BR") : "—"}
          />
          <Info icon={DollarSign} label="Total gasto" value={formatBRL(c.spent)} />
        </aside>
      </section>

      {/* Insights da IA */}
      {scores && (
        <section className="rounded-xl border bg-card p-4 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-primary font-semibold flex items-center gap-1.5">
                <Sparkles className="h-3 w-3" /> Insights da IA
              </div>
              <h2 className="text-sm font-semibold mt-1">Diagnóstico da campanha</h2>
              <p className="text-xs text-muted-foreground">
                Análise heurística baseada no criativo, copy e estrutura da campanha — não substitui dados reais da Meta.
              </p>
            </div>
            <button
              onClick={() => setImproveOpen(true)}
              className="inline-flex items-center gap-2 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
            >
              <Wand2 className="h-4 w-4" /> Melhorar campanha
            </button>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <ScoreBar label="Força do criativo" value={scores.creative} />
            <ScoreBar label="Clareza da oferta" value={scores.offer} />
            <ScoreBar label="Qualidade do CTA" value={scores.cta} />
            <ScoreBar label="Potencial de conversão" value={scores.conversion} />
            <ScoreBar label="Orçamento recomendado" value={scores.budget} />
            <ScoreBar label="Público recomendado" value={scores.audience} />
          </div>
          <ul className="space-y-1.5 pt-1">
            {scores.notes.map((n, i) => (
              <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                <Sparkles className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Timeline */}
      <section className="rounded-xl border bg-card p-4 space-y-4">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" /> Timeline da campanha
        </h2>

        <TimelineGroup
          title="Sistema & IA"
          subtitle="Eventos internos do Atende Ai"
          events={timeline.filter((e) => e.source === "system")}
          emptyLabel="Nenhuma atividade registrada."
        />

        <TimelineGroup
          title="Meta Ads"
          subtitle="Eventos sincronizados com a plataforma Meta"
          events={timeline.filter((e) => e.source === "meta")}
          emptyLabel="Aguardando integração com a Meta — eventos aparecerão aqui após a publicação."
        />
      </section>

      {/* Excluir */}
      <AlertDialog open={confirmOpen} onOpenChange={(o) => !deleting && setConfirmOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir esta campanha?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. Os dados de desempenho serão perdidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); performDelete(); }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Melhorar campanha */}
      <Dialog open={improveOpen} onOpenChange={setImproveOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-primary" /> Sugestões da IA
            </DialogTitle>
            <DialogDescription>
              Revise as ideias e aplique manualmente o que fizer sentido. Nada será alterado automaticamente.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-3">
            {suggestions.map((s, i) => (
              <li key={i} className="rounded-lg border p-3 space-y-1">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {s.field}
                </div>
                <div className="text-sm">{s.suggestion}</div>
                {s.why && <div className="text-xs text-muted-foreground">{s.why}</div>}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <button
              onClick={() => setImproveOpen(false)}
              className="h-9 px-3 rounded-md border text-sm"
            >
              Fechar
            </button>
            <Link
              to="/campanhas/nova"
              className="inline-flex items-center gap-1 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
            >
              Editar criativo <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------- Status banner ---------- */

const STATUS_META: Record<DisplayStatus, {
  label: string;
  icon: typeof CheckCircle2;
  badge: string;
  ring: string;
  dot: string;
  hint: string;
}> = {
  draft: {
    label: "Rascunho",
    icon: CircleDashed,
    badge: "bg-muted text-foreground",
    ring: "bg-muted/40 border-muted",
    dot: "bg-muted-foreground",
    hint: "Ainda não publicada — finalize e envie para a Meta.",
  },
  scheduled: {
    label: "Agendada",
    icon: Clock,
    badge: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    ring: "bg-blue-500/5 border-blue-500/20",
    dot: "bg-blue-500",
    hint: "Aguardando data de início.",
  },
  publishing: {
    label: "Publicando",
    icon: Send,
    badge: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
    ring: "bg-indigo-500/5 border-indigo-500/20",
    dot: "bg-indigo-500 animate-pulse",
    hint: "Enviando para a Meta…",
  },
  active: {
    label: "Ativa",
    icon: PlayCircle,
    badge: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    ring: "bg-emerald-500/5 border-emerald-500/20",
    dot: "bg-emerald-500",
    hint: "Veiculando agora.",
  },
  paused: {
    label: "Pausada",
    icon: PauseCircle,
    badge: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    ring: "bg-amber-500/5 border-amber-500/20",
    dot: "bg-amber-500",
    hint: "Entrega suspensa.",
  },
  ended: {
    label: "Encerrada",
    icon: CheckCircle2,
    badge: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
    ring: "bg-zinc-500/5 border-zinc-500/20",
    dot: "bg-zinc-500",
    hint: "Campanha finalizada.",
  },
  error: {
    label: "Erro",
    icon: AlertTriangle,
    badge: "bg-destructive/15 text-destructive",
    ring: "bg-destructive/5 border-destructive/30",
    dot: "bg-destructive",
    hint: "Algo deu errado ao sincronizar com a Meta.",
  },
  rejected: {
    label: "Rejeitada pela Meta",
    icon: XCircle,
    badge: "bg-destructive/15 text-destructive",
    ring: "bg-destructive/5 border-destructive/30",
    dot: "bg-destructive",
    hint: "Revise a política de anúncios e reenvie.",
  },
};

function getMetaPanelStatus(c: Campaign, live: CampaignMetaLiveStatus | null): MetaPanelStatus | null {
  if (!c.meta_campaign_id) return null;
  const statusOf = (obj: CampaignMetaLiveStatus["campaign"]) =>
    obj && !("error" in obj) ? { status: obj.status ?? "—", effective: obj.effective_status ?? "—" } : { status: "—", effective: "—" };
  const campaign = statusOf(live?.campaign ?? null);
  const adset = statusOf(live?.adset ?? null);
  const ad = statusOf(live?.ad ?? null);
  const delivery = live?.delivery ?? c.meta_delivery_status;
  const rows = [
    { label: "Campaign", id: c.meta_campaign_id, ...campaign },
    { label: "AdSet", id: c.meta_adset_id, ...adset },
    { label: "Ad", id: c.meta_ad_id, ...ad },
  ];
  if (delivery === "active_on_meta") return { label: "ACTIVE", hint: "Status real confirmado na Meta.", variant: "active", rows };
  if (delivery === "review_on_meta") return { label: "PENDING_REVIEW / IN_PROCESS", hint: "A Meta ainda está revisando ou processando o anúncio.", variant: "review", rows };
  if (delivery === "issues_on_meta") return { label: "WITH_ISSUES", hint: "A Meta retornou problema de entrega.", variant: "issues", rows };
  if (delivery === "archived_on_meta") return { label: "ARCHIVED", hint: "A campanha está arquivada na Meta.", variant: "archived", rows };
  if (delivery === "paused_on_meta") return { label: "PAUSED", hint: "A Meta informa que a entrega está desativada.", variant: "paused", rows };
  return { label: "Status Meta pendente", hint: "Sincronizando status real da Meta.", variant: "unknown", rows };
}

function StatusBanner({ status, updatedAt, metaId, metaStatus }: { status: DisplayStatus; updatedAt: string; metaId: string | null; metaStatus: MetaPanelStatus | null }) {
  const m = STATUS_META[status] ?? STATUS_META.draft;
  const Icon = m.icon;
  const metaTone = metaStatus?.variant === "active" ? STATUS_META.active
    : metaStatus?.variant === "paused" || metaStatus?.variant === "review" ? STATUS_META.paused
    : metaStatus?.variant === "issues" ? STATUS_META.rejected
    : metaStatus?.variant === "archived" ? STATUS_META.ended
    : null;
  const visual = metaTone ?? m;
  const VisualIcon = metaStatus?.variant === "active" ? PlayCircle
    : metaStatus?.variant === "paused" ? PauseCircle
    : metaStatus?.variant === "review" ? Clock
    : metaStatus?.variant === "issues" ? AlertTriangle
    : metaStatus?.variant === "archived" ? CheckCircle2
    : Icon;
  return (
    <div className={cn("rounded-xl border p-4 flex items-center gap-3 flex-wrap", visual.ring)}>
      <div className={cn("h-10 w-10 rounded-full flex items-center justify-center shrink-0", visual.badge)}>
        <VisualIcon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold", visual.badge)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", visual.dot)} />
            {metaStatus?.label ?? statusLabel(status as CampaignStatus) ?? m.label}
          </span>
          {metaId && (
            <span className="text-[11px] text-muted-foreground">
              Meta ID: <span className="font-mono">{metaId}</span>
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">{metaStatus?.hint ?? m.hint}</p>
        {metaStatus && (
          <div className="mt-2 grid sm:grid-cols-3 gap-2">
            {metaStatus.rows.map((row) => (
              <div key={row.label} className="rounded-md border bg-background/60 px-2 py-1.5 text-[11px]">
                <div className="font-medium">{row.label}</div>
                <div className="font-mono text-muted-foreground truncate">{row.id ?? "—"}</div>
                <div className="text-muted-foreground">{row.status} / {row.effective}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="text-xs text-muted-foreground whitespace-nowrap">
        Atualizada {relative(updatedAt)}
      </div>
    </div>
  );
}

/* ---------- KPI / Info / Score ---------- */

function Kpi({
  icon: Icon,
  label,
  value,
  muted,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className={cn("rounded-xl border bg-card p-3 space-y-1.5", muted && "opacity-70")}>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function Info({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </span>
      <span className="font-medium truncate">{value}</span>
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const tone =
    pct >= 75 ? "bg-emerald-500" : pct >= 50 ? "bg-primary" : pct >= 30 ? "bg-amber-500" : "bg-destructive";
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ---------- Heuristics (frontend-only) ---------- */

function scoreCampaign(c: Campaign) {
  const headline = (c.headline ?? "").trim();
  const primary = (c.primary_text ?? "").trim();
  const cta = (c.cta ?? "").trim();

  const creative =
    (c.media_url ? 50 : 10) +
    (c.media_type === "video" ? 25 : c.media_url ? 15 : 0) +
    (headline.length >= 6 ? 15 : 0) +
    (primary.length >= 40 ? 10 : 0);

  const offer =
    (headline.length >= 6 ? 30 : 10) +
    (primary.length >= 60 ? 35 : primary.length >= 20 ? 20 : 5) +
    (/\bgrátis|desconto|promo|oferta|brinde|garantia\b/i.test(primary + " " + headline) ? 25 : 10);

  const ctaScore =
    (cta ? 50 : 10) +
    (/\bsaiba|comprar|agendar|falar|whats|enviar|quero|conversar\b/i.test(cta) ? 30 : 0) +
    (cta.length > 0 && cta.length <= 22 ? 20 : 0);

  const audienceQuality = (c.city ? 40 : 10) + (c.radius_km && c.radius_km > 0 ? 30 : 10) + 20;
  const budgetQuality =
    !c.daily_budget ? 20 : c.daily_budget < 15 ? 35 : c.daily_budget <= 80 ? 90 : 70;

  const conversion = Math.round((creative * 0.35 + offer * 0.3 + ctaScore * 0.2 + audienceQuality * 0.15));

  const notes: string[] = [];
  if (!c.media_url) notes.push("Adicione uma imagem ou vídeo — criativos com mídia geram muito mais cliques.");
  else if (c.media_type !== "video") notes.push("Imagem com boa taxa potencial de clique — teste também um vídeo curto.");
  if (cta.length === 0) notes.push("Defina um CTA claro como “Falar no WhatsApp” ou “Quero saber mais”.");
  else if (cta.length > 22) notes.push("Seu CTA pode ser mais direto — tente algo com até 3 palavras.");
  if (c.objective === "whatsapp" && c.media_url) notes.push("Criativo forte para WhatsApp — mantenha a mensagem inicial curta.");
  if (!c.city) notes.push("Selecione a cidade para focar o orçamento em quem realmente pode comprar.");
  if (c.daily_budget && c.daily_budget < 15) notes.push("Orçamento diário baixo pode atrasar o aprendizado da Meta — considere R$ 20–40/dia.");
  if (notes.length === 0) notes.push("Tudo bem configurado. Acompanhe nas próximas 24–48h e ajuste pelo desempenho.");

  return {
    creative: clamp(creative),
    offer: clamp(offer),
    cta: clamp(ctaScore),
    conversion: clamp(conversion),
    budget: clamp(budgetQuality),
    audience: clamp(audienceQuality),
    notes,
  };
}

function clamp(n: number) {
  return Math.max(0, Math.min(100, n));
}

function buildSuggestions(c: Campaign) {
  const product = c.product ?? "seu produto";
  const city = c.city ?? "sua região";
  const budget = c.daily_budget ?? 0;
  const recBudget = budget < 20 ? 30 : budget > 100 ? Math.round(budget * 0.8) : budget;

  return [
    {
      field: "Título",
      suggestion: `Conheça ${product} — atendimento rápido em ${city}.`,
      why: "Título curto, com benefício e localização aumentam o CTR.",
    },
    {
      field: "Texto principal",
      suggestion: `Está procurando ${product}? A gente te ajuda pelo WhatsApp em poucos minutos, com condições especiais essa semana.`,
      why: "Inclui prova de agilidade + senso de urgência sem ser agressivo.",
    },
    {
      field: "CTA",
      suggestion: "Falar no WhatsApp",
      why: "CTAs de 2–3 palavras com verbo direto convertem mais.",
    },
    {
      field: "Público",
      suggestion: `Pessoas em ${city} num raio de ${c.radius_km ?? 15} km, 25–55 anos, interesses relacionados a ${product}.`,
      why: "Audiência local + faixa etária qualificada melhora o custo por lead.",
    },
    {
      field: "Orçamento",
      suggestion: `Recomendado: R$ ${recBudget}/dia por pelo menos 7 dias.`,
      why: "Tempo mínimo para a Meta otimizar a entrega.",
    },
  ];
}

type TimelineEvent = {
  icon: typeof CheckCircle2;
  label: string;
  detail?: string;
  at: string;
  tone: string;
  source: "system" | "meta";
};

function buildTimeline(c: Campaign): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  // Sistema & IA
  events.push({
    source: "system",
    icon: CircleDashed,
    label: "Campanha criada",
    at: c.created_at,
    tone: "bg-muted text-foreground",
  });
  if (c.media_url || c.headline || c.primary_text) {
    events.push({
      source: "system",
      icon: ImageIcon,
      label: "Criativo salvo",
      detail: c.headline ?? undefined,
      at: c.updated_at,
      tone: "bg-primary/15 text-primary",
    });
    events.push({
      source: "system",
      icon: Sparkles,
      label: "IA analisou o anúncio",
      detail: "Diagnóstico heurístico gerado a partir do criativo e copy.",
      at: c.updated_at,
      tone: "bg-primary/15 text-primary",
    });
  }

  // Meta Ads
  if (c.meta_campaign_id) {
    events.push({
      source: "meta",
      icon: Send,
      label: "Publicada na Meta",
      detail: `ID: ${c.meta_campaign_id}`,
      at: c.updated_at,
      tone: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
    });
    if (c.meta_delivery_status === "active_on_meta") {
      events.push({
        source: "meta",
        icon: PlayCircle,
        label: "Entrega iniciada",
        at: c.updated_at,
        tone: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
      });
    }
    if (c.leads_count > 0) {
      events.push({
        source: "meta",
        icon: Users,
        label: `${c.leads_count} lead${c.leads_count > 1 ? "s" : ""} gerado${c.leads_count > 1 ? "s" : ""}`,
        at: c.updated_at,
        tone: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
      });
    }
    if (c.meta_delivery_status === "paused_on_meta" || c.status === "paused") {
      events.push({
        source: "meta",
        icon: PauseCircle,
        label: "Campanha pausada",
        at: c.updated_at,
        tone: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
      });
    }
    if (c.meta_delivery_status === "review_on_meta" || c.meta_delivery_status === "issues_on_meta") {
      events.push({
        source: "meta",
        icon: c.meta_delivery_status === "issues_on_meta" ? AlertTriangle : Clock,
        label: c.meta_delivery_status === "issues_on_meta" ? "Meta retornou problema" : "Em revisão/processamento na Meta",
        detail: c.meta_publish_error ?? undefined,
        at: c.meta_last_sync_at ?? c.updated_at,
        tone: c.meta_delivery_status === "issues_on_meta"
          ? "bg-destructive/15 text-destructive"
          : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
      });
    }
    if (c.status === "ended") {
      events.push({
        source: "meta",
        icon: CheckCircle2,
        label: "Campanha encerrada",
        at: c.updated_at,
        tone: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
      });
    }
  }

  // Sort newest first within each section preserved by caller
  return events.sort((a, b) => +new Date(b.at) - +new Date(a.at));
}

function TimelineGroup({
  title,
  subtitle,
  events,
  emptyLabel,
}: {
  title: string;
  subtitle: string;
  events: TimelineEvent[];
  emptyLabel: string;
}) {
  return (
    <div className="space-y-2">
      <div>
        <div className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">
          {title}
        </div>
        <div className="text-[11px] text-muted-foreground/80">{subtitle}</div>
      </div>
      {events.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          {emptyLabel}
        </div>
      ) : (
        <ol className="space-y-3 pt-1">
          {events.map((ev, i) => (
            <li key={i} className="flex items-start gap-3">
              <div
                className={cn(
                  "mt-0.5 h-7 w-7 rounded-full flex items-center justify-center shrink-0",
                  ev.tone,
                )}
              >
                <ev.icon className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{ev.label}</div>
                {ev.detail && (
                  <div className="text-xs text-muted-foreground">{ev.detail}</div>
                )}
              </div>
              <div className="text-xs text-muted-foreground whitespace-nowrap">
                {relative(ev.at)}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function relative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const diff = Math.max(0, Date.now() - then);
  const m = Math.round(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.round(h / 24);
  if (d < 30) return `há ${d}d`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `há ${mo} meses`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

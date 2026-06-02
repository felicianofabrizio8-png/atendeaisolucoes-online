import { createLazyFileRoute, Link, useNavigate, useRouter, getRouteApi } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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

  useEffect(() => {
    setLoading(true);
    getCampaign(id)
      .then(setC)
      .catch(() => setC(null))
      .finally(() => setLoading(false));
  }, [id]);

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
          <button
            onClick={() => setConfirmOpen(true)}
            className="inline-flex items-center gap-1 h-9 px-3 rounded-md border text-sm hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40"
          >
            <Trash2 className="h-4 w-4" /> Excluir
          </button>
        </div>
        <StatusBanner status={status} updatedAt={c.updated_at} metaId={c.meta_campaign_id} />
      </header>

      {/* KPIs Meta-ready */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Kpi icon={Users} label="Leads" value={String(c.leads_count)} />
        <Kpi icon={MessageSquare} label="Mensagens" value={String(c.messages_count)} />
        <Kpi
          icon={TrendingUp}
          label="Custo / lead"
          value={c.leads_count > 0 ? formatBRL(cpl) : "—"}
        />
        <Kpi icon={DollarSign} label="Gasto real" value={formatBRL(c.spent)} />
        <Kpi icon={DollarSign} label="Orçamento/dia" value={formatBRL(c.daily_budget)} />
        <Kpi icon={Eye} label="Impressões" value="—" muted />
        <Kpi icon={Users} label="Alcance" value="—" muted />
        <Kpi icon={MousePointerClick} label="CTR" value="—" muted />
        <Kpi icon={BarChart3} label="CPC" value="—" muted />
        <Kpi icon={BarChart3} label="CPM" value="—" muted />
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

      {/* Diagnóstico IA */}
      {scores && (
        <section className="rounded-xl border bg-card p-4 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> Diagnóstico da IA
            </h2>
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
      <section className="rounded-xl border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" /> Timeline da campanha
        </h2>
        <ol className="space-y-3 pt-1">
          {timeline.map((ev, i) => (
            <li key={i} className="flex items-start gap-3">
              <div className={cn("mt-0.5 h-7 w-7 rounded-full flex items-center justify-center shrink-0", ev.tone)}>
                <ev.icon className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{ev.label}</div>
                {ev.detail && (
                  <div className="text-xs text-muted-foreground">{ev.detail}</div>
                )}
              </div>
              <div className="text-xs text-muted-foreground whitespace-nowrap">{relative(ev.at)}</div>
            </li>
          ))}
        </ol>
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

function StatusBanner({ status, updatedAt, metaId }: { status: DisplayStatus; updatedAt: string; metaId: string | null }) {
  const m = STATUS_META[status] ?? STATUS_META.draft;
  const Icon = m.icon;
  return (
    <div className={cn("rounded-xl border p-4 flex items-center gap-3 flex-wrap", m.ring)}>
      <div className={cn("h-10 w-10 rounded-full flex items-center justify-center shrink-0", m.badge)}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold", m.badge)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
            {statusLabel(status as CampaignStatus) ?? m.label}
          </span>
          {metaId && (
            <span className="text-[11px] text-muted-foreground">
              Meta ID: <span className="font-mono">{metaId}</span>
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">{m.hint}</p>
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

function buildTimeline(c: Campaign) {
  const events: { icon: typeof CheckCircle2; label: string; detail?: string; at: string; tone: string }[] = [];
  events.push({
    icon: CircleDashed,
    label: "Campanha criada",
    at: c.created_at,
    tone: "bg-muted text-foreground",
  });
  if (c.media_url || c.headline || c.primary_text) {
    events.push({
      icon: ImageIcon,
      label: "Criativo salvo",
      detail: c.headline ?? undefined,
      at: c.updated_at,
      tone: "bg-primary/15 text-primary",
    });
  }
  if (c.meta_campaign_id) {
    events.push({
      icon: Send,
      label: "Publicada na Meta",
      detail: `ID: ${c.meta_campaign_id}`,
      at: c.updated_at,
      tone: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
    });
  }
  if (c.status === "active") {
    events.push({
      icon: PlayCircle,
      label: "Entrega iniciada",
      at: c.updated_at,
      tone: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    });
  }
  if (c.leads_count > 0) {
    events.push({
      icon: Users,
      label: `${c.leads_count} lead${c.leads_count > 1 ? "s" : ""} gerado${c.leads_count > 1 ? "s" : ""}`,
      at: c.updated_at,
      tone: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    });
  }
  if (c.status === "paused") {
    events.push({
      icon: PauseCircle,
      label: "Campanha pausada",
      at: c.updated_at,
      tone: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    });
  }
  if (c.status === "ended") {
    events.push({
      icon: CheckCircle2,
      label: "Campanha encerrada",
      at: c.updated_at,
      tone: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
    });
  }
  // Sort newest first
  return events.sort((a, b) => +new Date(b.at) - +new Date(a.at));
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

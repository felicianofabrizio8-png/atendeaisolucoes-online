import { createLazyFileRoute, Link, useNavigate, useRouter, getRouteApi } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  getCampaign,
  deleteCampaign,
  formatBRL,
  statusLabel,
  channelLabel,
  goalLabel,
  type Campaign,
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
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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

const routeApi = getRouteApi("/campanhas/$id");

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

  const cpl = c.leads_count > 0 ? Number(c.spent) / c.leads_count : 0;
  const diagnosis =
    c.ai_diagnosis ??
    (c.status === "draft"
      ? "Sua campanha está como rascunho. Quando publicar, a IA começará a monitorar desempenho e sugerir otimizações."
      : c.leads_count === 0
        ? "Ainda sem leads suficientes para diagnóstico. Aguarde 24–48h após o início."
        : cpl > 50
          ? "Custo por lead acima do esperado. Sugerimos revisar segmentação e criativo."
          : "Desempenho saudável. Continue monitorando.");

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto w-full space-y-5">
      <Link
        to="/campanhas"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Campanhas
      </Link>

      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-semibold truncate">{c.name}</h1>
            <StatusPill status={c.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            Canal: {channelLabel(c.objective)} · Objetivo: {goalLabel((c as any).goal)}
            {c.product ? ` · ${c.product}` : ""}
          </p>
        </div>
        <button
          onClick={() => setConfirmOpen(true)}
          className="inline-flex items-center gap-1 h-9 px-3 rounded-md border text-sm hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40"
        >
          <Trash2 className="h-4 w-4" /> Excluir
        </button>
      </header>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={DollarSign} label="Orçamento/dia" value={formatBRL(c.daily_budget)} />
        <Kpi icon={Users} label="Leads gerados" value={String(c.leads_count)} />
        <Kpi icon={MessageSquare} label="Mensagens" value={String(c.messages_count)} />
        <Kpi
          icon={TrendingUp}
          label="Custo por lead"
          value={c.leads_count > 0 ? formatBRL(cpl) : "—"}
        />
      </section>

      <section className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl border bg-card p-4 space-y-3">
          <h2 className="text-sm font-semibold">Criativo</h2>
          {c.media_url ? (
            c.media_type === "video" ? (
              <video src={c.media_url} controls className="w-full rounded-md max-h-72" />
            ) : (
              <img
                src={c.media_url}
                alt=""
                className="w-full rounded-md max-h-72 object-contain bg-muted"
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
          <Info icon={Sparkles} label="Objetivo" value={goalLabel((c as any).goal)} />
          <Info icon={MapPin} label="Local" value={c.city ?? "—"} />
          <Info
            icon={MapPin}
            label="Raio"
            value={c.radius_km ? `${c.radius_km} km` : "—"}
          />
          <Info
            icon={Calendar}
            label="Início"
            value={c.start_date ? new Date(c.start_date).toLocaleDateString("pt-BR") : "—"}
          />
          <Info icon={DollarSign} label="Total gasto" value={formatBRL(c.spent)} />
        </aside>
      </section>

      <section className="rounded-xl border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" /> Diagnóstico da IA
        </h2>
        <p className="text-sm text-muted-foreground">{diagnosis}</p>
        <button
          onClick={() => toast.info("Otimização inteligente em breve.")}
          className="inline-flex items-center gap-2 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
        >
          <Sparkles className="h-4 w-4" /> Melhorar campanha
        </button>
      </section>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-1.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="text-xl font-semibold">{value}</div>
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

function StatusPill({ status }: { status: Campaign["status"] }) {
  const map: Record<Campaign["status"], string> = {
    draft: "bg-muted text-muted-foreground",
    scheduled: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    active: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    paused: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    ended: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
  };
  return (
    <span className={cn("text-[11px] font-medium px-2 py-1 rounded-full", map[status])}>
      {statusLabel(status)}
    </span>
  );
}

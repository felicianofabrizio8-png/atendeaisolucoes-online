import { createLazyFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import {
  listCampaigns,
  formatBRL,
  statusLabel,
  channelLabel,
  type Campaign,
} from "@/lib/campaigns";
import { Megaphone, Plus, TrendingUp, Users, DollarSign, Target } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createLazyFileRoute("/campanhas/")({
  component: CampaignsPage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-6 max-w-md mx-auto space-y-3 text-center">
        <h2 className="text-lg font-semibold">Erro ao carregar campanhas</h2>
        <p className="text-sm text-muted-foreground">{error.message}</p>
        <button
          onClick={() => { router.invalidate(); reset(); }}
          className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
        >
          Tentar novamente
        </button>
      </div>
    );
  },
  notFoundComponent: () => (
    <div className="p-6 max-w-md mx-auto space-y-3 text-center">
      <h2 className="text-lg font-semibold">Página não encontrada</h2>
      <Link to="/campanhas" className="text-sm text-primary hover:underline">Voltar</Link>
    </div>
  ),
});

function CampaignsPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile?.company_id) return;
    setLoading(true);
    listCampaigns(profile.company_id)
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [profile?.company_id]);

  const active = items.filter((c) => c.status === "active").length;
  const invested = items.reduce((s, c) => s + Number(c.spent ?? 0), 0);
  const leads = items.reduce((s, c) => s + (c.leads_count ?? 0), 0);
  const cpl = leads > 0 ? invested / leads : 0;

  const kpis = [
    { label: "Campanhas ativas", value: String(active), icon: Target },
    { label: "Investido", value: formatBRL(invested), icon: DollarSign },
    { label: "Leads gerados", value: String(leads), icon: Users },
    { label: "Custo por lead", value: leads > 0 ? formatBRL(cpl) : "—", icon: TrendingUp },
  ];

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto w-full space-y-6">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Megaphone className="h-6 w-6 text-primary" />
            Campanhas
          </h1>
          <p className="text-sm text-muted-foreground">
            Anúncios inteligentes para atrair mais leads.
          </p>
        </div>
        <button
          onClick={() => navigate({ to: "/campanhas/nova" })}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Nova campanha
        </button>
      </header>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div
              key={k.label}
              className="rounded-xl border bg-card p-4 flex flex-col gap-1.5"
            >
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Icon className="h-3.5 w-3.5" /> {k.label}
              </div>
              <div className="text-xl font-semibold">{k.value}</div>
            </div>
          );
        })}
      </section>

      <section className="rounded-xl border bg-card">
        <div className="px-4 py-3 border-b text-sm font-medium">Suas campanhas</div>
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <div className="text-sm text-muted-foreground">
              Você ainda não tem campanhas. Crie a primeira agora.
            </div>
            <button
              onClick={() => navigate({ to: "/campanhas/nova" })}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" /> Criar campanha
            </button>
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((c) => (
              <li key={c.id}>
                <Link
                  to="/campanhas/$id"
                  params={{ id: c.id }}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-accent/40 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{c.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {objectiveLabel(c.objective)}
                      {c.city ? ` · ${c.city}` : ""}
                      {c.daily_budget ? ` · ${formatBRL(c.daily_budget)}/dia` : ""}
                    </div>
                  </div>
                  <div className="hidden sm:flex flex-col items-end text-xs text-muted-foreground">
                    <span>{c.leads_count} leads</span>
                    <span>{formatBRL(c.spent)} gasto</span>
                  </div>
                  <StatusPill status={c.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
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

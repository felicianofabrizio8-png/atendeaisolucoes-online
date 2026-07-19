import { useEffect, useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Loader2, RefreshCw, RotateCcw, ExternalLink, AlertCircle, History, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import {
  listMarketingPublications,
  getPublisherStats,
  retryPublication,
} from "@/lib/marketing-publisher/publisher.functions";
import {
  selectOperational,
  selectHistory,
  type HistoryFilters,
} from "@/lib/marketing-publisher/publication-filters";
import type { PublicationRow, PublisherStats } from "@/lib/marketing-publisher/types";

interface Props {
  companyId: string;
}

const STATUS_LABEL: Record<string, string> = {
  queued: "Na fila",
  publishing: "Publicando",
  published: "Publicado",
  failed: "Falha",
  cancelled: "Cancelado",
};

const STATUS_CLASS: Record<string, string> = {
  queued: "bg-muted text-foreground",
  publishing: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  published: "bg-green-500/15 text-green-700 dark:text-green-300",
  failed: "bg-destructive/15 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

const AUTO_REFRESH_MS = 15_000;

export function MarketingPublisherDashboard({ companyId }: Props) {
  void companyId;
  const [stats, setStats] = useState<(PublisherStats & { scheduled: number }) | null>(null);
  const [pubs, setPubs] = useState<PublicationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);

  const refresh = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true);
    try {
      const [s, p] = await Promise.all([
        getPublisherStats(),
        listMarketingPublications({ data: { scope: "operational" } }),
      ]);
      setStats(s as PublisherStats & { scheduled: number });
      setPubs(p.publications as PublicationRow[]);
    } catch (e) {
      if (!opts.silent) toast.error(e instanceof Error ? e.message : "Falha ao carregar publicações.");
    } finally {
      if (!opts.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Auto-refresh silencioso — itens que viram "published" somem sem recarregar a página.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh({ silent: true });
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const operational = useMemo(() => selectOperational(pubs), [pubs]);

  async function onRetry(id: string) {
    setRetrying(id);
    try {
      const r = (await retryPublication({ data: { id } })) as { ok: boolean };
      if (r.ok) toast.success("Publicação reencaminhada para a fila.");
      else toast.error("Não foi possível reprocessar (só publicações com falha).");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao reprocessar.");
    } finally {
      setRetrying(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs text-muted-foreground">
          Publica automaticamente conteúdos aprovados e agendados. Nada é publicado sem aprovação humana.
        </div>
        <div className="flex items-center gap-2">
          <HistoryDialog />
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <StatCard label="Agendados" value={stats?.scheduled ?? 0} />
        <StatCard label="Na fila" value={stats?.queued ?? 0} />
        <StatCard label="Publicando" value={stats?.publishing ?? 0} />
        <StatCard label="Publicados" value={stats?.published ?? 0} tone="success" />
        <StatCard label="Falhas" value={stats?.failed ?? 0} tone="danger" />
        <StatCard label="Cancelados" value={stats?.cancelled ?? 0} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Publicações que precisam de acompanhamento</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…
            </div>
          ) : operational.length === 0 ? (
            <div className="py-8 text-center space-y-1">
              <CheckCircle2 className="h-6 w-6 text-green-500 mx-auto" />
              <div className="text-sm font-medium">Tudo certo por aqui.</div>
              <div className="text-xs text-muted-foreground">
                Não há publicações aguardando processamento ou correção.
              </div>
            </div>
          ) : (
            <div className="divide-y">
              {operational.map((p) => (
                <PublicationItem
                  key={p.id}
                  p={p}
                  retrying={retrying === p.id}
                  onRetry={() => void onRetry(p.id)}
                  allowRetry
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PublicationItem({
  p,
  retrying,
  onRetry,
  allowRetry,
}: {
  p: PublicationRow;
  retrying?: boolean;
  onRetry?: () => void;
  allowRetry?: boolean;
}) {
  // Guarda: nunca oferecer reprocessar em publicação concluída ou já com platform_post_id.
  const showRetry = allowRetry && p.status === "failed" && !p.platform_post_id && !!onRetry;
  return (
    <div className="py-3 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`text-[10px] uppercase font-semibold rounded px-1.5 py-0.5 ${STATUS_CLASS[p.status] ?? "bg-muted"}`}
          >
            {STATUS_LABEL[p.status] ?? p.status}
          </span>
          <span className="text-[10px] uppercase text-muted-foreground">
            {p.channel} · {p.format}
          </span>
          {p.retry_count > 0 && (
            <span className="text-[10px] text-muted-foreground">tentativas: {p.retry_count}</span>
          )}
        </div>
        {p.platform_post_id && (
          <div className="text-xs mt-1 flex items-center gap-1 text-muted-foreground">
            <ExternalLink className="h-3 w-3" />
            id: {p.platform_post_id}
          </div>
        )}
        {p.error_message && (
          <div className="text-xs mt-1 text-destructive flex items-start gap-1">
            <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
            <span className="break-words">
              {p.error_code ? `[${p.error_code}] ` : ""}
              {p.error_message}
            </span>
          </div>
        )}
        <div className="text-[10px] text-muted-foreground mt-1">
          criada em {new Date(p.created_at).toLocaleString("pt-BR")}
          {p.published_at && (
            <> · publicada em {new Date(p.published_at).toLocaleString("pt-BR")}</>
          )}
        </div>
      </div>
      {showRetry && (
        <Button variant="outline" size="sm" disabled={retrying} onClick={onRetry}>
          {retrying ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
          )}
          Reprocessar
        </Button>
      )}
    </div>
  );
}

function HistoryDialog() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<PublicationRow[]>([]);
  const [filters, setFilters] = useState<HistoryFilters>({
    channel: "all",
    format: "all",
    status: "published",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listMarketingPublications({ data: { scope: "history", limit: 100 } });
      setRows(r.publications as PublicationRow[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar histórico.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const filtered = useMemo(() => selectHistory(rows, filters), [rows, filters]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <History className="h-3.5 w-3.5 mr-1" />
          Ver histórico
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm">Histórico de publicações</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <select
            className="h-8 rounded-md border bg-background px-2"
            value={filters.channel ?? "all"}
            onChange={(e) => setFilters((f) => ({ ...f, channel: e.target.value as HistoryFilters["channel"] }))}
          >
            <option value="all">Todos canais</option>
            <option value="instagram">Instagram</option>
            <option value="facebook">Facebook</option>
          </select>
          <select
            className="h-8 rounded-md border bg-background px-2"
            value={filters.format ?? "all"}
            onChange={(e) => setFilters((f) => ({ ...f, format: e.target.value as HistoryFilters["format"] }))}
          >
            <option value="all">Todos formatos</option>
            <option value="feed">Feed</option>
            <option value="reel">Reel</option>
            <option value="story">Story</option>
          </select>
          <input
            type="date"
            className="h-8 rounded-md border bg-background px-2"
            onChange={(e) =>
              setFilters((f) => ({ ...f, from: e.target.value ? new Date(e.target.value).toISOString() : undefined }))
            }
          />
          <input
            type="date"
            className="h-8 rounded-md border bg-background px-2"
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                to: e.target.value ? new Date(`${e.target.value}T23:59:59`).toISOString() : undefined,
              }))
            }
          />
        </div>

        <div className="mt-2 overflow-y-auto pr-1">
          {loading ? (
            <div className="text-xs text-muted-foreground flex items-center gap-2 py-4">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando histórico…
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-xs text-muted-foreground py-6 text-center">
              Nenhuma publicação no histórico com esses filtros.
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((p) => (
                <PublicationItem key={p.id} p={p} />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "success" | "danger";
}) {
  const toneCls =
    tone === "success"
      ? "text-green-600 dark:text-green-400"
      : tone === "danger"
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold ${toneCls}`}>{value}</div>
    </div>
  );
}

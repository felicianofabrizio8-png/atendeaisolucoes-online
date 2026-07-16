import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, RefreshCw, RotateCcw, ExternalLink, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import {
  listMarketingPublications,
  getPublisherStats,
  retryPublication,
} from "@/lib/marketing-publisher/publisher.functions";
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

export function MarketingPublisherDashboard({ companyId }: Props) {
  void companyId;
  const [stats, setStats] = useState<(PublisherStats & { scheduled: number }) | null>(null);
  const [pubs, setPubs] = useState<PublicationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p] = await Promise.all([getPublisherStats(), listMarketingPublications()]);
      setStats(s);
      setPubs(p.publications);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar publicações.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onRetry(id: string) {
    setRetrying(id);
    try {
      const r = await retryPublication({ data: { id } });
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
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          Publica automaticamente conteúdos aprovados e agendados. Nada é publicado sem aprovação humana.
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
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
          <CardTitle className="text-sm">Últimas publicações</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…
            </div>
          ) : pubs.length === 0 ? (
            <div className="text-xs text-muted-foreground">
              Nenhuma publicação registrada ainda. Aprove um conteúdo e agende para a próxima data.
            </div>
          ) : (
            <div className="divide-y">
              {pubs.map((p) => (
                <div key={p.id} className="py-3 flex items-start gap-3">
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
                        <span className="text-[10px] text-muted-foreground">
                          tentativas: {p.retry_count}
                        </span>
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
                  {p.status === "failed" && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={retrying === p.id}
                      onClick={() => void onRetry(p.id)}
                    >
                      {retrying === p.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5 mr-1" />
                      )}
                      Reprocessar
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
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

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiListPublishContents, apiListPublishSchedule } from "@/data/marketingRepo";
import type { MarketingContentRow, MarketingScheduleRow } from "@/lib/marketing/marketing.types";
import { useContentPreviews } from "@/lib/marketing/useContentPreviews";
import { MediaThumb } from "./ui/MarketingUi";
import type { PublishView } from "./MarketingPublishHub";

interface Props {
  companyId: string;
  onCreate?: () => void;
  onOpenPublish?: (view: PublishView) => void;
}

const FORMAT_LABEL: Record<string, string> = { feed: "Feed", story: "Story", reel: "Reel", whatsapp_cta: "WhatsApp" };

export function MarketingDashboard({ companyId, onCreate, onOpenPublish }: Props) {
  const [contents, setContents] = useState<MarketingContentRow[]>([]);
  const [schedule, setSchedule] = useState<MarketingScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void Promise.all([apiListPublishContents().catch(() => []), apiListPublishSchedule().catch(() => [])]).then(([c, s]) => {
      if (!active) return;
      setContents(c);
      setSchedule(s);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [companyId]);

  const review = contents.filter((c) => c.status === "draft" || c.status === "pending");
  const upcoming = useMemo(
    () =>
      schedule
        .filter((s) => s.status === "planned" || s.status === "queued" || s.status === "publishing")
        .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)),
    [schedule],
  );
  const failures = schedule.filter((s) => s.status === "failed");

  const byId = useMemo(() => new Map(contents.map((c) => [c.id, c])), [contents]);
  const upcomingContents = useMemo(
    () => upcoming.slice(0, 5).map((s) => byId.get(s.content_id)).filter((c): c is MarketingContentRow => !!c),
    [upcoming, byId],
  );
  const previews = useContentPreviews(companyId, upcomingContents);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">O que vamos criar hoje?</h2>
        <p className="mt-1 text-sm text-muted-foreground">Crie, revise e publique no Instagram e no Facebook.</p>
        <Button onClick={onCreate} size="lg" className="marketing-primary mt-4 px-6 shadow-md">
          <Plus className="mr-2 h-4 w-4" /> Criar publicação
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Para revisar" value={review.length} loading={loading} onClick={() => onOpenPublish?.("review")} />
        <StatCard label="Agendadas" value={upcoming.length} loading={loading} onClick={() => onOpenPublish?.("scheduled")} />
        <StatCard label="Com problema" value={failures.length} loading={loading} danger onClick={() => onOpenPublish?.("problems")} />
      </div>

      {failures.length > 0 && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1 basis-48">
            {failures.length === 1 ? "1 publicação não saiu." : `${failures.length} publicações não saíram.`}
          </span>
          <Button size="sm" className="rounded-full" onClick={() => onOpenPublish?.("problems")}>
            Resolver
          </Button>
        </div>
      )}

      <section>
        <h3 className="mb-2 font-semibold">Próximas publicações</h3>
        <div className="marketing-card">
          {loading ? (
            <p className="py-5 text-sm text-muted-foreground">Carregando…</p>
          ) : upcoming.length === 0 ? (
            <p className="py-5 text-sm text-muted-foreground">Nada agendado.</p>
          ) : (
            upcoming.slice(0, 5).map((s) => {
              const c = byId.get(s.content_id);
              return (
                <div key={s.id} className="flex items-center gap-3 border-b py-3 last:border-0">
                  <MediaThumb preview={c ? previews[c.id] : null} className="h-14 w-14 shrink-0 rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{c?.title || c?.body?.split("\n")[0] || "Publicação"}</div>
                    <div className="text-xs text-muted-foreground">
                      {FORMAT_LABEL[c?.format ?? ""] ?? c?.format ?? ""} ·{" "}
                      {new Date(s.scheduled_at).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value, loading, danger, onClick }: { label: string; value: number; loading: boolean; danger?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="marketing-card text-center transition-all hover:-translate-y-0.5 hover:shadow-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className={`block text-3xl font-semibold tabular-nums ${danger && value > 0 ? "text-destructive" : ""}`}>{loading ? "–" : value}</span>
      <span className="text-xs text-muted-foreground sm:text-sm">{label}</span>
    </button>
  );
}

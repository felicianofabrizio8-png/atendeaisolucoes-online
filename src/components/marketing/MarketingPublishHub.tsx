import { useCallback, useEffect, useState } from "react";
import { apiListContents, apiListSchedule } from "@/data/marketingRepo";
import { getPublisherStats } from "@/lib/marketing-publisher/publisher.functions";
import { MarketingApprovals } from "./MarketingApprovals";
import { MarketingSchedule } from "./MarketingSchedule";
import { MarketingPublisherDashboard } from "./MarketingPublisherDashboard";
import { Chip, ChipRow } from "./ui/MarketingUi";

export type PublishView = "review" | "approved" | "scheduled" | "published" | "problems";

interface Props {
  companyId: string;
  view?: PublishView;
  onViewChange?: (view: PublishView) => void;
}

const VIEWS: Array<{ id: PublishView; label: string }> = [
  { id: "review", label: "Para revisar" },
  { id: "approved", label: "Aprovadas" },
  { id: "scheduled", label: "Agendadas" },
  { id: "published", label: "Publicadas" },
  { id: "problems", label: "Com problema" },
];

type Counts = Partial<Record<PublishView, number>>;

/** Revisão, agendamento e acompanhamento em um só lugar, filtrados por etapa. */
export function MarketingPublishHub({ companyId, view: controlled, onViewChange }: Props) {
  const [inner, setInner] = useState<PublishView>("review");
  const view = controlled ?? inner;
  const setView = (next: PublishView) => {
    setInner(next);
    onViewChange?.(next);
  };
  const [counts, setCounts] = useState<Counts>({});

  const loadCounts = useCallback(async () => {
    const [contents, schedule, stats] = await Promise.all([
      apiListContents().catch(() => null),
      apiListSchedule().catch(() => null),
      getPublisherStats().catch(() => null),
    ]);
    const s = stats as { published?: number; failed?: number } | null;
    setCounts({
      review: contents ? contents.filter((c) => c.status === "draft" || c.status === "pending" || c.status === "rejected").length : undefined,
      approved: contents ? contents.filter((c) => c.status === "approved").length : undefined,
      scheduled: schedule ? schedule.filter((x) => x.status === "planned" || x.status === "queued" || x.status === "publishing").length : undefined,
      published: s?.published,
      problems: s?.failed,
    });
  }, []);

  useEffect(() => {
    void loadCounts();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadCounts();
    }, 20000);
    return () => window.clearInterval(id);
  }, [loadCounts, view, companyId]);

  return (
    <div className="min-w-0 space-y-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Publicar</h2>
        <p className="text-sm text-muted-foreground">Revise, agende e acompanhe.</p>
      </div>
      <ChipRow label="Etapa da publicação">
        {VIEWS.map((v) => (
          <Chip key={v.id} active={view === v.id} onClick={() => setView(v.id)} count={counts[v.id] ?? null} tone={v.id === "problems" ? "danger" : undefined}>
            {v.label}
          </Chip>
        ))}
      </ChipRow>
      {view === "review" && <MarketingApprovals companyId={companyId} forcedFilter="review" onChanged={loadCounts} />}
      {view === "approved" && <MarketingApprovals companyId={companyId} forcedFilter="approved" onChanged={loadCounts} />}
      {view === "scheduled" && <MarketingSchedule companyId={companyId} upcomingOnly />}
      {view === "published" && <MarketingPublisherDashboard companyId={companyId} view="published" />}
      {view === "problems" && <MarketingPublisherDashboard companyId={companyId} view="problems" />}
    </div>
  );
}

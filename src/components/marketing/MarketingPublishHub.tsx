import { useState } from "react";
import { CalendarDays, Clock3, Send } from "lucide-react";
import { MarketingApprovals } from "./MarketingApprovals";
import { MarketingSchedule } from "./MarketingSchedule";
import { MarketingPublisherDashboard } from "./MarketingPublisherDashboard";

interface Props { companyId: string; }
type View = "review" | "calendar" | "tracking";

const VIEWS: Array<{ id: View; label: string; icon: typeof Clock3 }> = [
  { id: "review", label: "Para revisar", icon: Clock3 },
  { id: "calendar", label: "Calendário", icon: CalendarDays },
  { id: "tracking", label: "Acompanhamento", icon: Send },
];

/** Uma porta de entrada única para revisão, programação e acompanhamento. */
export function MarketingPublishHub({ companyId }: Props) {
  const [view, setView] = useState<View>("review");

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Publicar</h2>
        <p className="text-sm text-muted-foreground">
          Revise, programe e acompanhe seus conteúdos em um só lugar.
        </p>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b pb-1" role="tablist" aria-label="Publicação">
        {VIEWS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            onClick={() => setView(id)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-t-md px-3 py-2 text-sm ${
              view === id ? "border-b-2 border-primary font-medium text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>
      {view === "review" && <MarketingApprovals companyId={companyId} />}
      {view === "calendar" && <MarketingSchedule companyId={companyId} />}
      {/* Fila, falhas e histórico de publicados ficam no mesmo painel. */}
      {view === "tracking" && <MarketingPublisherDashboard companyId={companyId} />}
    </div>
  );
}

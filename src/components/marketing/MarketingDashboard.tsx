import { useEffect, useState } from "react";
import { Sparkles, Image as ImageIcon, Megaphone, CheckCircle2, Calendar } from "lucide-react";
import {
  apiListMedia,
  apiListPromotions,
  apiListContents,
  apiListSchedule,
} from "@/data/marketingRepo";

interface Props {
  companyId: string;
}

interface Stats {
  media: number;
  promotions: number;
  drafts: number;
  approved: number;
  scheduled: number;
}

export function MarketingDashboard({ companyId }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [m, p, c, s] = await Promise.all([
        apiListMedia().catch(() => []),
        apiListPromotions().catch(() => []),
        apiListContents().catch(() => []),
        apiListSchedule().catch(() => []),
      ]);
      if (cancelled) return;
      setStats({
        media: m.length,
        promotions: p.filter((x) => x.status === "active").length,
        drafts: c.filter((x) => x.status === "draft" || x.status === "pending").length,
        approved: c.filter((x) => x.status === "approved").length,
        scheduled: s.filter((x) => x.status === "planned").length,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const cards = [
    { label: "Mídias na biblioteca", value: stats?.media ?? "—", icon: ImageIcon },
    { label: "Promoções ativas", value: stats?.promotions ?? "—", icon: Megaphone },
    { label: "Rascunhos / pendentes", value: stats?.drafts ?? "—", icon: Sparkles },
    { label: "Conteúdos aprovados", value: stats?.approved ?? "—", icon: CheckCircle2 },
    { label: "Agendamentos planejados", value: stats?.scheduled ?? "—", icon: Calendar },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="rounded-lg border bg-card p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Icon className="h-3.5 w-3.5" />
                {c.label}
              </div>
              <div className="text-2xl font-semibold mt-1">{c.value}</div>
            </div>
          );
        })}
      </div>
      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        <strong className="text-foreground">Fluxo:</strong> envie fotos e vídeos na Biblioteca,
        cadastre promoções, gere conteúdos com a IA, aprove ou edite manualmente e agende no
        calendário editorial. A publicação automática nas redes sociais não faz parte desta fase.
      </div>
    </div>
  );
}

import { Link } from "@tanstack/react-router";
import { ArrowRight, CalendarDays, Facebook, Instagram } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChartCard } from "./charts/ChartCard";
import { num } from "./charts/primitives";
import type { DashboardData } from "./useDashboardData";
const WEEK = 7 * 86400000;
export function marketingWeeks(data: DashboardData, now = Date.now()) {
  return Array.from({ length: 8 }, (_, i) => {
    const end = now - (7 - i) * WEEK,
      start = end - WEEK;
    const count = (channel: string) =>
      data.schedule.filter(
        (p) =>
          p.channel === channel &&
          p.status === "published" &&
          +new Date(p.scheduled_at) >= start &&
          +new Date(p.scheduled_at) < end,
      ).length;
    return {
      label: new Date(start).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
      instagram: count("instagram"),
      facebook: count("facebook"),
    };
  });
}
export function MarketingPanel({ data }: { data: DashboardData }) {
  const weeks = marketingWeeks(data),
    total = weeks.reduce((s, w) => s + w.instagram + w.facebook, 0);
  const pending = data.schedule.filter(
    (p) =>
      ["planned", "queued"].includes(p.status) && ["instagram", "facebook"].includes(p.channel),
  );
  const next = [...pending]
    .filter((p) => +new Date(p.scheduled_at) >= Date.now())
    .sort((a, b) => +new Date(a.scheduled_at) - +new Date(b.scheduled_at))[0];
  return (
    <ChartCard
      title="Marketing"
      subtitle="Sua presença nas últimas 8 semanas"
      className="dash-marketing col-span-12 lg:col-span-4"
      analysis={{
        title: "Marketing",
        period: "Últimas 8 semanas",
        notes: `${pending.length} publicações programadas. Contagens de posts publicados, não alcance nem engajamento.`,
        columns: ["Semana iniciada em", "Instagram", "Facebook"],
        rows: weeks.map((w) => [w.label, num(w.instagram), num(w.facebook)]),
      }}
    >
      <div className="dash-marketing-layout">
        <div className="dash-marketing-total">
          <div>
            <strong>{num(total)}</strong>
            <p>publicações no período</p>
          </div>
          <span className="dash-marketing-badge">
            <CalendarDays size={18} />
            {num(weeks.filter((w) => w.instagram + w.facebook > 0).length)}/8 semanas ativas
          </span>
        </div>
        <div className="dash-network-grid">
          {[
            { key: "instagram" as const, label: "Instagram", Icon: Instagram },
            { key: "facebook" as const, label: "Facebook", Icon: Facebook },
          ].map(({ key, label, Icon }) => (
            <div key={key} className={`dash-network dash-network-${key}`}>
              <div className="flex items-center gap-2 text-xs font-medium">
                <Icon size={16} />
                {label}
              </div>
              <strong>{num(weeks.reduce((s, w) => s + w[key], 0))}</strong>
              <span>{num(pending.filter((p) => p.channel === key).length)} programadas</span>
            </div>
          ))}
        </div>
        <div className="dash-publishing-trail">
          <p className="mb-3 text-[10px] uppercase tracking-widest text-muted-foreground">
            Trilha de publicações
          </p>
          <div className="dash-week-grid" role="list" aria-label="Publicações por semana">
            {weeks.map((w) => (
              <div
                key={w.label}
                role="listitem"
                className={w.instagram + w.facebook > 0 ? "is-active" : ""}
                title={`${w.label}: Instagram ${w.instagram}, Facebook ${w.facebook}`}
              >
                <span>{w.label}</span>
                <strong>{num(w.instagram + w.facebook)}</strong>
                <i
                  aria-hidden
                  style={{
                    background:
                      w.instagram + w.facebook > 0
                        ? "linear-gradient(90deg,#fa69b8,#6eb5ff)"
                        : "var(--dash-track)",
                  }}
                />
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            {total
              ? "Cada semana mostra o total publicado nos dois canais."
              : "Sua próxima publicação inicia uma nova sequência. Os espaços se acendem conforme você publica."}
          </p>
        </div>
        <div className="dash-publishing-next">
          <CalendarDays size={17} />
          <div>
            <strong>{next ? "Próxima publicação" : "Seu próximo passo"}</strong>
            <p>
              {next
                ? new Date(next.scheduled_at).toLocaleString("pt-BR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })
                : "Planeje um conteúdo para manter sua marca presente."}
            </p>
          </div>
        </div>
        <Button asChild className="w-full">
          <Link to="/marketing">
            Criar publicação <ArrowRight />
          </Link>
        </Button>
      </div>
    </ChartCard>
  );
}

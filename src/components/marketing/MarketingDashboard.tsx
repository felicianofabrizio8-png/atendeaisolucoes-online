import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CheckCheck,
  Images,
  Library,
  Megaphone,
  Music2,
  Send,
  Sparkles,
  Upload,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketingHero } from "./MarketingHero";
import { LumeNumber } from "./MarketingMotion";

import {
  apiListMedia,
  apiListPromotions,
  apiListContents,
  apiListSchedule,
} from "@/data/marketingRepo";
import type { MarketingContentRow, MarketingScheduleRow } from "@/lib/marketing/marketing.types";
import type { MarketingSection } from "./MarketingWorkspace";

interface Overview {
  media: number;
  promotions: number;
  drafts: number;
  approved: number;
  planned: number;
  upcoming: MarketingScheduleRow[];
  contents: MarketingContentRow[];
  /** Active schedule entries per day, today first, for the next seven days. */
  week: { date: Date; count: number }[];
}

function nextSevenDays(schedule: MarketingScheduleRow[]) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const count = schedule.filter((s) => {
      if (s.status !== "planned" && s.status !== "queued") return false;
      const at = new Date(s.scheduled_at);
      return at.toDateString() === date.toDateString();
    }).length;
    return { date, count };
  });
}
const channelLabel = { instagram: "Instagram", facebook: "Facebook", whatsapp: "WhatsApp" };
const formatLabel = { feed: "Feed", story: "Story", reel: "Reel", whatsapp_cta: "Mensagem" };

export function MarketingDashboard({
  companyId,
  onNavigate,
}: {
  companyId: string;
  onNavigate: (section: MarketingSection) => void;
}) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(false);
    void Promise.all([apiListMedia(), apiListPromotions(), apiListContents(), apiListSchedule()])
      .then(([media, promotions, contents, schedule]) => {
        if (cancelled) return;
        setData({
          media: media.length,
          promotions: promotions.filter((p) => p.status === "active").length,
          drafts: contents.filter((c) => c.status === "draft" || c.status === "pending").length,
          approved: contents.filter((c) => c.status === "approved").length,
          planned: schedule.filter((s) => s.status === "planned").length,
          upcoming: schedule
            .filter((s) => s.status === "planned" || s.status === "queued")
            .filter((s) => new Date(s.scheduled_at).getTime() >= Date.now())
            .sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at))
            .slice(0, 3),
          contents,
          week: nextSevenDays(schedule),
        });
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, reload]);
  const value = (key: "media" | "promotions" | "drafts" | "approved" | "planned") =>
    data?.[key].toLocaleString("pt-BR") ?? "—";
  const next = !data
    ? null
    : data.drafts > 0
      ? {
          title: "Vamos dar o seu toque?",
          text: `${data.drafts} ${data.drafts === 1 ? "conteúdo precisa" : "conteúdos precisam"} de revisão antes de seguir para a agenda.`,
          action: "Revisar conteúdos",
          target: "approvals" as const,
        }
      : data.media === 0
        ? {
            title: "Comece com uma boa imagem.",
            text: "Adicione fotos ou vídeos à biblioteca para preparar sua primeira campanha.",
            action: "Adicionar mídias",
            target: "library" as const,
          }
        : {
            title: "Sua próxima campanha começa aqui.",
            text: "Use seu acervo e as informações da marca para criar uma nova campanha.",
            action: "Criar campanha",
            target: "generator" as const,
          };

  return (
    <div className="mkt-overview">
      <MarketingHero onCreate={() => onNavigate("generator")} />
      <div className="mkt-hero-grid">
        <section className="mkt-next mkt-card">
          <h2>
            {next?.title ??
              (error ? "Vamos retomar de onde parou." : "Preparando sua visão geral…")}
          </h2>
          <p>
            {next?.text ??
              (error
                ? "Não foi possível consultar os dados agora. Seus recursos continuam disponíveis nas abas."
                : "Reunindo sua biblioteca, conteúdos e agenda.")}
          </p>
          {error ? (
            <Button className="mkt-primary" onClick={() => setReload((v) => v + 1)}>
              Tentar novamente
            </Button>
          ) : (
            next && (
              <Button className="mkt-primary" onClick={() => onNavigate(next.target)}>
                {next.action}
                <ArrowRight />
              </Button>
            )
          )}
        </section>
        <div className="mkt-metrics" aria-label="Resumo do marketing" aria-busy={!data && !error}>
          <button
            data-lume-light
            className="mkt-metric mkt-metric-vivid"
            onClick={() => onNavigate("approvals")}
          >
            <span className="mkt-metric-top">
              <CheckCheck size={16} />
              Para revisar
              <ArrowUpRight size={15} />
            </span>
            <strong>{<LumeNumber value={data?.drafts ?? null} />}</strong>
            <span className="mkt-metric-ratio" aria-hidden>
              <i
                style={{
                  transform: `scaleX(${
                    data && data.drafts + data.approved > 0
                      ? data.approved / (data.drafts + data.approved)
                      : 0
                  })`,
                }}
              />
            </span>
            <span className="mkt-metric-foot">
              {value("approved")}{" "}
              {data?.approved === 1 ? "conteúdo aprovado" : "conteúdos aprovados"}
            </span>
          </button>
          <button
            data-lume-light
            className="mkt-metric mkt-metric-calendar"
            onClick={() => onNavigate("schedule")}
          >
            <span className="mkt-metric-top">
              <CalendarDays size={16} />
              Na programação
              <ArrowUpRight size={15} />
            </span>
            <strong>{<LumeNumber value={data?.planned ?? null} />}</strong>
            <span className="mkt-week" aria-hidden>
              {(data?.week ?? nextSevenDays([])).map(({ date, count }, i) => (
                <span key={i} data-today={i === 0 || undefined} data-busy={count > 0 || undefined}>
                  <i style={{ animationDelay: `${120 + i * 60}ms` }} />
                  {date.toLocaleDateString("pt-BR", { weekday: "narrow" })}
                </span>
              ))}
            </span>
            <span className="mkt-metric-foot">Agendamentos nos próximos dias</span>
          </button>
          <button
            data-lume-light
            className="mkt-metric mkt-metric-media"
            onClick={() => onNavigate("library")}
          >
            <span className="mkt-metric-top">
              <Images size={16} />
              Seu acervo
              <ArrowUpRight size={15} />
            </span>
            <strong>{<LumeNumber value={data?.media ?? null} />}</strong>
            <span className="mkt-metric-foot">Fotos e vídeos na biblioteca</span>
          </button>
        </div>
      </div>
      {error && (
        <p className="mkt-error" role="alert">
          Não foi possível carregar os indicadores. Nenhum valor foi estimado.
        </p>
      )}
      <div className="mkt-overview-heading">
        <h2>Sua campanha, passo a passo.</h2>
        <span>Você está no controle de cada etapa.</span>
      </div>
      <nav className="mkt-workflow" aria-label="Etapas de uma campanha">
        {[
          { id: "generator", icon: Sparkles, title: "Crie", text: "Escolha imagens e uma ideia" },
          { id: "approvals", icon: CheckCheck, title: "Revise", text: "Deixe com a sua cara" },
          { id: "schedule", icon: CalendarDays, title: "Agende", text: "Escolha o melhor momento" },
          { id: "publisher", icon: Send, title: "Acompanhe", text: "Veja o que já foi publicado" },
        ].map(({ id, icon: Icon, title, text }, index) => (
          <button
            key={id}
            data-hue={["blue", "violet", "orchid", "lilac"][index]}
            onClick={() => onNavigate(id as MarketingSection)}
          >
            <span className="mkt-workflow-node" aria-hidden />
            <span className="mkt-icon-chip" aria-hidden>
              <Icon size={17} />
            </span>
            <strong>{title}</strong>
            <small>{text}</small>
            <ArrowUpRight aria-hidden size={16} className="mkt-workflow-arrow" />
          </button>
        ))}
      </nav>

      <div className="mkt-bottom-grid">
        <section className="mkt-agenda mkt-card">
          <header>
            <h2>Próximas publicações</h2>
            <button className="mkt-text-link" onClick={() => onNavigate("schedule")}>
              Ver calendário <ArrowUpRight size={14} />
            </button>
          </header>
          {!data ? (
            <p className="mkt-empty">
              {error ? "Agenda indisponível no momento." : "Carregando agenda…"}
            </p>
          ) : data.upcoming.length ? (
            <ol className="mkt-agenda-list">
              {data.upcoming.map((item) => {
                const content = data.contents.find((c) => c.id === item.content_id);
                const date = new Date(item.scheduled_at);
                return (
                  <li key={item.id} data-channel={item.channel}>
                    <time dateTime={item.scheduled_at}>
                      <strong>{date.toLocaleDateString("pt-BR", { day: "2-digit" })}</strong>
                      <span>{date.toLocaleDateString("pt-BR", { month: "short" })}</span>
                    </time>
                    <div>
                      <h3>
                        {content?.title || content?.body?.slice(0, 80) || "Conteúdo agendado"}
                      </h3>
                      <p>
                        <span className={`mkt-channel mkt-channel-${item.channel}`}>
                          {channelLabel[item.channel]}
                        </span>
                        {date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} ·{" "}
                        {content ? formatLabel[content.format] : "Conteúdo"} ·{" "}
                        {item.status === "queued" ? "Na fila" : "Planejado"}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="mkt-empty-agenda">
              <h3>Um espaço para suas próximas ideias.</h3>
              <p>Aprove um conteúdo e escolha uma data para ele aparecer aqui.</p>
              <Button variant="outline" size="sm" onClick={() => onNavigate("approvals")}>
                Ir para revisão <ArrowRight />
              </Button>
            </div>
          )}
          <button className="mkt-agenda-foot" onClick={() => onNavigate("generator")}>
            Planejar a próxima criação <ArrowRight size={15} />
          </button>
        </section>
        <section className="mkt-resources mkt-card">
          <header>
            <h2>Tudo para a próxima ideia.</h2>
          </header>
          <div className="mkt-resource-grid">
            {[
              {
                id: "library",
                title: "Fotos e vídeos",
                text: "Envie e organize seu acervo",
                icon: Upload,
                hue: "violet",
              },
              {
                id: "audio",
                title: "Trilhas e áudios",
                text: "Encontre o ritmo da campanha",
                icon: Music2,
                hue: "blue",
              },
              {
                id: "promotions",
                title: "Ofertas da vez",
                text: `${value("promotions")} ${data?.promotions === 1 ? "promoção ativa" : "promoções ativas"}`,
                icon: Megaphone,
                hue: "orchid",
              },
              {
                id: "knowledge",
                title: "Sua marca",
                text: "Voz, diferenciais e informações",
                icon: Library,
                hue: "lilac",
              },
            ].map(({ id, title, text, icon: Icon, hue }) => (
              <button
                key={id}
                data-hue={hue}
                data-lume-light
                className="mkt-resource"
                onClick={() => onNavigate(id as MarketingSection)}
              >
                <span className="mkt-icon-chip" aria-hidden>
                  <Icon size={17} />
                </span>
                <ArrowUpRight aria-hidden size={15} className="mkt-resource-arrow" />
                <strong>{title}</strong>
                <span>{text}</span>
              </button>
            ))}
          </div>
          <button className="mkt-video-link" onClick={() => onNavigate("videos")}>
            <Video size={16} /> Procurando um vídeo já gerado?{" "}
            <span>
              Ver vídeos <ArrowRight size={14} />
            </span>
          </button>
        </section>
      </div>
    </div>
  );
}

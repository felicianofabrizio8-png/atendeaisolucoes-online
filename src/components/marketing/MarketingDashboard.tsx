import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CheckCheck,
  Images,
  Megaphone,
  Music2,
  Upload,
  Library,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketingHero } from "./MarketingHero";
import { LumeNumber } from "./MarketingMotion";
import { MarketingArtwork } from "./MarketingArtwork";

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
          <span className="mkt-eyebrow">SEU PRÓXIMO PASSO</span>
          <span className="mkt-next-symbol" aria-hidden>
            <ArrowUpRight />
          </span>
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
            <Button onClick={() => setReload((v) => v + 1)}>Tentar novamente</Button>
          ) : (
            next && (
              <Button onClick={() => onNavigate(next.target)}>
                {next.action}
                <ArrowRight />
              </Button>
            )
          )}
        </section>
        <div className="mkt-metrics" aria-label="Resumo do marketing" aria-busy={!data && !error}>
          <button
            data-lume-light
            className="mkt-metric mkt-metric-review"
            onClick={() => onNavigate("approvals")}
          >
            <span className="mkt-metric-top">
              <CheckCheck size={17} />
              Para revisar
              <ArrowUpRight size={16} />
            </span>
            <strong>{<LumeNumber value={data?.drafts ?? null} />}</strong>
            <span className="mkt-metric-foot">
              <i />
              {value("approved")}{" "}
              {data?.approved === 1 ? "conteúdo aprovado" : "conteúdos aprovados"}
            </span>
            <span className="mkt-metric-art" aria-hidden>
              <MarketingArtwork kind="prism" />
            </span>
          </button>
          <button
            data-lume-light
            className="mkt-metric mkt-metric-calendar"
            onClick={() => onNavigate("schedule")}
          >
            <span className="mkt-metric-top">
              <CalendarDays size={17} />
              Na programação
              <ArrowUpRight size={16} />
            </span>
            <strong>{<LumeNumber value={data?.planned ?? null} />}</strong>
            <span className="mkt-metric-foot">Agendamentos planejados</span>
            <span className="mkt-metric-art" aria-hidden>
              <MarketingArtwork kind="capsule" />
            </span>
          </button>
          <button
            data-lume-light
            className="mkt-metric mkt-metric-media"
            onClick={() => onNavigate("library")}
          >
            <span className="mkt-metric-top">
              <Images size={17} />
              Seu acervo
              <ArrowUpRight size={16} />
            </span>
            <strong>{<LumeNumber value={data?.media ?? null} />}</strong>
            <span className="mkt-metric-foot">Fotos e vídeos na biblioteca</span>
            <span className="mkt-metric-art" aria-hidden>
              <MarketingArtwork kind="wave" />
            </span>
          </button>
        </div>
      </div>
      {error && (
        <p className="mkt-error" role="alert">
          Não foi possível carregar os indicadores. Nenhum valor foi estimado.
        </p>
      )}
      <div className="mkt-overview-heading">
        <div>
          <span className="mkt-eyebrow">DO PRIMEIRO RASCUNHO AO MUNDO</span>
          <h2>Sua campanha, passo a passo.</h2>
        </div>
        <span>Você está no controle de cada etapa.</span>
      </div>
      <nav className="mkt-workflow" aria-label="Etapas de uma campanha">
        {[
          {
            id: "generator",
            n: "01",
            title: "Crie",
            text: "Escolha imagens e uma ideia",
          },
          { id: "approvals", n: "02", title: "Revise", text: "Deixe com a sua cara" },
          {
            id: "schedule",
            n: "03",
            title: "Agende",
            text: "Escolha o melhor momento",
          },
          {
            id: "publisher",
            n: "04",
            title: "Acompanhe",
            text: "Veja o que já foi publicado",
          },
        ].map((step) => (
          <button key={step.id} onClick={() => onNavigate(step.id as MarketingSection)}>
            <span>{step.n}</span>
            <div>
              <strong>{step.title}</strong>
              <small>{step.text}</small>
            </div>
            <ArrowUpRight aria-hidden size={16} />
            <MarketingArtwork
              kind={
                step.id === "generator"
                  ? "capsule"
                  : step.id === "approvals"
                    ? "prism"
                    : step.id === "schedule"
                      ? "orbit"
                      : "wave"
              }
            />
          </button>
        ))}
      </nav>

      <div className="mkt-bottom-grid">
        <section className="mkt-agenda mkt-card">
          <header>
            <div>
              <span className="mkt-eyebrow">NO HORIZONTE</span>
              <h2>Próximas publicações</h2>
            </div>
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
                  <li key={item.id}>
                    <time dateTime={item.scheduled_at}>
                      <strong>{date.toLocaleDateString("pt-BR", { day: "2-digit" })}</strong>
                      <span>{date.toLocaleDateString("pt-BR", { month: "short" })}</span>
                    </time>
                    <div>
                      <span className={`mkt-channel mkt-channel-${item.channel}`}>
                        {channelLabel[item.channel]}
                      </span>
                      <h3>
                        {content?.title || content?.body?.slice(0, 80) || "Conteúdo agendado"}
                      </h3>
                      <p>
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
              <CalendarDays aria-hidden size={28} />
              <h3>Um espaço para suas próximas ideias.</h3>
              <p>Aprove um conteúdo e escolha uma data para ele aparecer aqui.</p>
              <Button variant="outline" size="sm" onClick={() => onNavigate("approvals")}>
                Ir para revisão <ArrowRight />
              </Button>
            </div>
          )}
          <div className="lume-agenda-note">
            <span className="mkt-eyebrow">CONSTÂNCIA CRIA CONEXÃO</span>
            <h3>Uma boa ideia merece um próximo capítulo.</h3>
            <button className="mkt-text-link" onClick={() => onNavigate("generator")}>
              Planejar minha próxima criação <ArrowUpRight size={16} />
            </button>
            <span className="lume-agenda-light lume-fluted" aria-hidden />
          </div>
        </section>
        <section className="mkt-resources mkt-card">
          <header>
            <div>
              <span className="mkt-eyebrow">MATÉRIA-PRIMA</span>
              <h2>Tudo para a próxima ideia.</h2>
            </div>
          </header>
          <div className="mkt-resource-grid">
            {[
              {
                id: "library",
                title: "Fotos e vídeos",
                text: "Envie e organize seu acervo",
                icon: Upload,
                tone: "violet",
              },
              {
                id: "audio",
                title: "Trilhas e áudios",
                text: "Encontre o ritmo da campanha",
                icon: Music2,
                tone: "cyan",
              },
              {
                id: "promotions",
                title: "Ofertas da vez",
                text: `${value("promotions")} ${data?.promotions === 1 ? "promoção ativa" : "promoções ativas"}`,
                icon: Megaphone,
                tone: "pink",
              },
              {
                id: "knowledge",
                title: "DNA da marca",
                text: "Voz, diferenciais e informações",
                icon: Library,
                tone: "lime",
              },
            ].map(({ id, title, text, icon: Icon, tone }) => (
              <button
                key={id}
                data-lume-light
                className={`mkt-resource mkt-resource-${tone}`}
                onClick={() => onNavigate(id as MarketingSection)}
              >
                <Icon aria-hidden size={20} />
                <ArrowUpRight aria-hidden size={14} />
                <strong>{title}</strong>
                <span>{text}</span>
                <MarketingArtwork
                  kind={
                    tone === "violet"
                      ? "capsule"
                      : tone === "cyan"
                        ? "wave"
                        : tone === "pink"
                          ? "orbit"
                          : "bloom"
                  }
                />
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

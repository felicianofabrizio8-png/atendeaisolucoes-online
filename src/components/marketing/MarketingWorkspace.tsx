import { lazy, Suspense, useRef, useState, useId } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  CheckCheck,
  Images,
  LayoutDashboard,
  Library,
  Megaphone,
  Music2,
  Send,
  Sparkles,
  Video,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { MarketingDashboard } from "./MarketingDashboard";
import { MarketingChapter } from "./MarketingChapter";

import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { LumePulse, lumeEase, useMarketingAmbient } from "./MarketingMotion";
import "./marketing.css";
import "./lume-optical.css";

// O editor de vídeo e as bibliotecas só entram quando a seção é aberta.
const MarketingGenerator = lazy(() =>
  import("./MarketingGenerator").then((m) => ({ default: m.MarketingGenerator })),
);
const MarketingApprovals = lazy(() =>
  import("./MarketingApprovals").then((m) => ({ default: m.MarketingApprovals })),
);
const MarketingSchedule = lazy(() =>
  import("./MarketingSchedule").then((m) => ({ default: m.MarketingSchedule })),
);
const MarketingPublisherDashboard = lazy(() =>
  import("./MarketingPublisherDashboard").then((m) => ({ default: m.MarketingPublisherDashboard })),
);
const MarketingLibrary = lazy(() =>
  import("./MarketingLibrary").then((m) => ({ default: m.MarketingLibrary })),
);
const AudioLibrary = lazy(() =>
  import("./AudioLibrary").then((m) => ({ default: m.AudioLibrary })),
);
const MarketingKnowledgeBase = lazy(() =>
  import("./MarketingKnowledgeBase").then((m) => ({ default: m.MarketingKnowledgeBase })),
);
const MarketingPromotions = lazy(() =>
  import("./MarketingPromotions").then((m) => ({ default: m.MarketingPromotions })),
);
const VideoLibraryGrid = lazy(() =>
  import("./video-render/VideoLibraryGrid").then((m) => ({ default: m.VideoLibraryGrid })),
);

export type MarketingSection =
  | "dashboard"
  | "generator"
  | "approvals"
  | "schedule"
  | "publisher"
  | "library"
  | "audio"
  | "knowledge"
  | "promotions"
  | "videos";

const sections = [
  {
    id: "dashboard",
    label: "Visão geral",
    icon: LayoutDashboard,
    description: "Sua criação e sua agenda, no mesmo lugar.",
  },
  {
    id: "generator",
    label: "Criar com Lume",
    icon: Sparkles,
    description:
      "Escolha suas imagens, defina a mensagem e crie uma campanha com Lume ou manualmente.",
  },
  {
    id: "approvals",
    label: "Revisar conteúdos",
    icon: CheckCheck,
    description: "Revise textos e criativos. Depois de aprovar, escolha quando e onde publicar.",
  },
  {
    id: "schedule",
    label: "Calendário",
    icon: CalendarDays,
    description: "Veja o que está programado e organize a presença da sua marca.",
  },
  {
    id: "publisher",
    label: "Publicações",
    icon: Send,
    description: "Acompanhe a fila, confira o histórico e resolva falhas de publicação.",
  },
  {
    id: "library",
    label: "Fotos e vídeos",
    icon: Images,
    description: "Envie arquivos e encontre as imagens dos seus produtos para usar nas campanhas.",
  },
  {
    id: "videos",
    label: "Vídeos prontos",
    icon: Video,
    description: "Encontre os vídeos gerados e acompanhe suas renderizações.",
  },
  {
    id: "audio",
    label: "Áudios",
    icon: Music2,
    description: "Organize as trilhas que dão ritmo às suas campanhas.",
  },
  {
    id: "promotions",
    label: "Promoções",
    icon: Megaphone,
    description: "Mantenha ofertas, valores e condições comerciais prontos para a criação.",
  },
  {
    id: "knowledge",
    label: "Sua marca",
    icon: Library,
    description:
      "Base de conhecimento: ensine à Lume seu tom de voz, diferenciais e informações comerciais.",
  },
] as const;

export function MarketingWorkspace({ companyId }: { companyId: string }) {
  const [tab, setTab] = useState<MarketingSection>("dashboard");
  const workspace = useRef<HTMLDivElement>(null);
  function navigate(section: MarketingSection) {
    setTab(section);
    requestAnimationFrame(() => {
      workspace.current
        ?.querySelector<HTMLButtonElement>(`[role="tab"][data-state="active"]`)
        ?.focus({ preventScroll: true });
    });
  }
  useMarketingAmbient(workspace);
  const reduced = useReducedMotion();
  const motionId = useId();
  const active = sections.find((s) => s.id === tab)!;
  return (
    <div className="lume-marketing" data-section={tab} ref={workspace}>
      <header className="mkt-page-header">
        <div>
          <span className="mkt-eyebrow">SEU ESTÚDIO CRIATIVO</span>
          <h1>
            Marketing IA
            <span className="mkt-title-dot" aria-hidden />
          </h1>
          <p>Ideias que conectam. Conteúdos que movem.</p>
        </div>
        <div className="mkt-header-actions">
          <Button variant="outline" onClick={() => navigate("knowledge")}>
            Sua marca <ArrowUpRight />
          </Button>
          <Button className="mkt-primary" onClick={() => navigate("generator")}>
            <Sparkles /> Criar conteúdo
          </Button>
        </div>
      </header>
      <LayoutGroup id={motionId}>
        <Tabs value={tab} onValueChange={(v) => setTab(v as MarketingSection)}>
          <div className="mkt-navigation">
            <TabsList className="mkt-main-nav" aria-label="Fluxo de marketing">
              {sections.slice(0, 5).map(({ id, label, icon: Icon }, index) => (
                <TabsTrigger key={id} value={id}>
                  {tab === id && (
                    <motion.span
                      className="lume-nav-glow"
                      layoutId="navigation-glow"
                      transition={{ duration: reduced ? 0 : 0.55, ease: lumeEase }}
                    />
                  )}
                  <Icon aria-hidden className="h-4 w-4" />
                  {label}
                  <span className="mkt-nav-index" aria-hidden>
                    {index === 0 ? "00" : `0${index}`}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
            <div className="mkt-resource-nav">
              <span>ACERVO E MARCA</span>
              <TabsList aria-label="Recursos de marketing">
                {sections.slice(5).map(({ id, label }) => (
                  <TabsTrigger key={id} value={id}>
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              className="lume-stage"
              initial={{ opacity: 0, y: reduced ? 0 : 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduced ? 0 : -8 }}
              transition={{
                duration: reduced ? 0 : 0.6,
                ease: lumeEase,
                opacity: { duration: reduced ? 0 : 0.24 },
              }}
            >
              {tab !== "dashboard" && (
                <MarketingChapter
                  section={tab}
                  description={active.description}
                  onBack={() => navigate("dashboard")}
                />
              )}
              <TabsContent
                forceMount
                value={tab}
                className={`mkt-tab-panel ${tab === "dashboard" ? "" : "mkt-tool-panel"}`}
              >
                <Suspense
                  fallback={
                    <div className="mkt-loading" role="status">
                      <LumePulse /> Abrindo {active.label.toLocaleLowerCase("pt-BR")}…
                    </div>
                  }
                >
                  {tab === "dashboard" && (
                    <MarketingDashboard companyId={companyId} onNavigate={navigate} />
                  )}
                  {tab === "generator" && (
                    <MarketingGenerator
                      companyId={companyId}
                      onGenerated={() => navigate("approvals")}
                    />
                  )}
                  {tab === "approvals" && <MarketingApprovals companyId={companyId} />}
                  {tab === "schedule" && <MarketingSchedule companyId={companyId} />}
                  {tab === "publisher" && <MarketingPublisherDashboard companyId={companyId} />}
                  {tab === "library" && <MarketingLibrary companyId={companyId} />}
                  {tab === "videos" && <VideoLibraryGrid companyId={companyId} />}
                  {tab === "audio" && <AudioLibrary companyId={companyId} />}
                  {tab === "promotions" && <MarketingPromotions companyId={companyId} />}
                  {tab === "knowledge" && <MarketingKnowledgeBase companyId={companyId} />}
                </Suspense>
              </TabsContent>
            </motion.div>
          </AnimatePresence>
        </Tabs>
      </LayoutGroup>
    </div>
  );
}

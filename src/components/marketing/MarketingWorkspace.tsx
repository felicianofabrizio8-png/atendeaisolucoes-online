import { lazy, Suspense, useRef, useState, useId } from "react";
import {
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
import { LumePulse, PillIndicator, lumeEase, useMarketingAmbient } from "./MarketingMotion";
import "./marketing.css";

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
          <h1>Marketing IA</h1>
          <p>Crie, revise e publique campanhas com a Lume.</p>
        </div>
        <div className="mkt-header-actions">
          <Button variant="outline" className="mkt-secondary" onClick={() => navigate("knowledge")}>
            Sua marca
          </Button>
          <Button className="mkt-primary" onClick={() => navigate("generator")}>
            <Sparkles /> Criar conteúdo
          </Button>
        </div>
      </header>
      <LayoutGroup id={motionId}>
        <Tabs value={tab} onValueChange={(v) => setTab(v as MarketingSection)}>
          <div className="mkt-navigation">
            <TabsList className="mkt-pill mkt-main-nav" aria-label="Fluxo de marketing">
              {sections.slice(0, 5).map(({ id, label, icon: Icon }) => (
                <TabsTrigger key={id} value={id}>
                  {tab === id && <PillIndicator layoutId="mkt-main-nav" />}
                  <Icon aria-hidden />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsList
              className="mkt-pill mkt-pill-quiet mkt-resource-nav"
              aria-label="Recursos de marketing"
            >
              {sections.slice(5).map(({ id, label }) => (
                <TabsTrigger key={id} value={id}>
                  {tab === id && <PillIndicator layoutId="mkt-resource-nav" />}
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              className="lume-stage"
              initial={{ opacity: 0, y: reduced ? 0 : 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduced ? 0 : -6 }}
              transition={{
                duration: reduced ? 0 : 0.55,
                ease: lumeEase,
                opacity: { duration: reduced ? 0 : 0.22 },
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

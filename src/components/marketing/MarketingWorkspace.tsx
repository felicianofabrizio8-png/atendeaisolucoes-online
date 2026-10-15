import { useId, useRef, useState } from "react";
import { CalendarCheck, Home, Images, Sparkles } from "lucide-react";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { MarketingDashboard } from "./MarketingDashboard";
import { MarketingLibraryHub, type LibraryKind } from "./MarketingLibraryHub";
import { MarketingPromotions } from "./MarketingPromotions";
import { MarketingGenerator } from "./MarketingGenerator";
import { MarketingPublishHub, type PublishView } from "./MarketingPublishHub";
import { StudioLauncher } from "./studio/StudioLauncher";
import { Chip, ChipRow } from "./ui/MarketingUi";
import { PillIndicator, lumeEase, useMarketingAmbient } from "./MarketingMotion";
import {
  DEFAULT_MARKETING_GROUP,
  GENERATED_DESTINATION,
  MARKETING_NAV,
  type MarketingGroupId,
} from "@/lib/marketing/marketing-nav";
import type { MediaSelection } from "@/lib/marketing/media-selection";
import "./marketing.css";

/** Destinos que o Início oferece; cada um abre uma área e a tela certa dentro dela. */
export type MarketingSection =
  | "dashboard"
  | "generator"
  | "studio"
  | "promotions"
  | "approvals"
  | "approved"
  | "schedule"
  | "publisher"
  | "problems"
  | "library"
  | "videos"
  | "audio"
  | "generated";

type CreateScreen = "generator" | "studio" | "promotions";

const ICONS: Record<MarketingGroupId, typeof Home> = {
  inicio: Home,
  criar: Sparkles,
  acervo: Images,
  publicar: CalendarCheck,
};

const PUBLISH_TARGET: Partial<Record<MarketingSection, PublishView>> = {
  approvals: "review",
  approved: "approved",
  schedule: "scheduled",
  publisher: "published",
  problems: "problems",
};
const LIBRARY_TARGET: Partial<Record<MarketingSection, LibraryKind>> = {
  library: "photos",
  videos: "videos",
  audio: "audio",
  generated: "generated",
};

export function MarketingWorkspace({ companyId }: { companyId: string }) {
  const [group, setGroup] = useState<MarketingGroupId>(DEFAULT_MARKETING_GROUP);
  const [createScreen, setCreateScreen] = useState<CreateScreen>("generator");
  const [publishView, setPublishView] = useState<PublishView>("review");
  const [libraryKind, setLibraryKind] = useState<LibraryKind>("photos");
  // Mídia escolhida no Acervo para começar uma publicação; `nonce` reinicia o fluxo.
  const [seed, setSeed] = useState<{ selection: MediaSelection[]; nonce: number }>({
    selection: [],
    nonce: 0,
  });
  const workspace = useRef<HTMLDivElement>(null);
  useMarketingAmbient(workspace);
  const reduced = useReducedMotion();
  const motionId = useId();

  function openCreate(selection: MediaSelection[] = []) {
    setSeed((cur) => ({ selection, nonce: cur.nonce + 1 }));
    setCreateScreen("generator");
    setGroup("criar");
  }
  function navigate(section: MarketingSection) {
    const publish = PUBLISH_TARGET[section];
    const library = LIBRARY_TARGET[section];
    if (publish) {
      setPublishView(publish);
      setGroup("publicar");
    } else if (library) {
      setLibraryKind(library);
      setGroup("acervo");
    } else if (section === "generator") {
      openCreate();
    } else if (section === "studio" || section === "promotions") {
      setCreateScreen(section);
      setGroup("criar");
    } else {
      setGroup("inicio");
    }
  }

  return (
    <div className="lume-marketing" data-section={group} ref={workspace}>
      <header className="mkt-page-header">
        <div>
          <h1>Marketing IA</h1>
          <p>Crie conteúdos, organize seu acervo e publique no Instagram, Facebook e WhatsApp.</p>
        </div>
        <div className="mkt-header-actions">
          <Button className="mkt-primary" onClick={() => openCreate()}>
            <Sparkles /> Criar conteúdo
          </Button>
        </div>
      </header>
      <LayoutGroup id={motionId}>
        <Tabs value={group} onValueChange={(value) => setGroup(value as MarketingGroupId)}>
          <div className="mkt-navigation">
            <TabsList
              className="mkt-pill mkt-main-nav marketing-nav"
              aria-label="Áreas do marketing"
            >
              {MARKETING_NAV.map((item) => {
                const Icon = ICONS[item.id];
                return (
                  <TabsTrigger key={item.id} value={item.id}>
                    {group === item.id && <PillIndicator layoutId="mkt-main-nav" />}
                    <Icon aria-hidden />
                    {item.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>
          <motion.div
            key={group}
            className="lume-stage"
            initial={{ opacity: 0, y: reduced ? 0 : 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: reduced ? 0 : 0.55,
              ease: lumeEase,
              opacity: { duration: reduced ? 0 : 0.22 },
            }}
          >
            <TabsContent value="inicio" className="mkt-tab-panel">
              <MarketingDashboard companyId={companyId} onNavigate={navigate} />
            </TabsContent>

            <TabsContent value="criar" className="mkt-tab-panel mkt-tool-panel">
              <ChipRow label="Criar" className="mkt-chip-row">
                <Chip
                  className="mkt-chip"
                  active={createScreen === "generator"}
                  onClick={() => setCreateScreen("generator")}
                >
                  Nova publicação
                </Chip>
                <Chip
                  className="mkt-chip"
                  active={createScreen === "studio"}
                  onClick={() => setCreateScreen("studio")}
                >
                  Estúdio criativo
                </Chip>
                <Chip
                  className="mkt-chip"
                  active={createScreen === "promotions"}
                  onClick={() => setCreateScreen("promotions")}
                >
                  Promoções
                </Chip>
              </ChipRow>
              {createScreen === "generator" ? (
                <MarketingGenerator
                  key={seed.nonce}
                  companyId={companyId}
                  initialSelection={seed.selection}
                  onGenerated={() => {
                    // A próxima criação começa do zero, sem a mídia da anterior.
                    setSeed((cur) => ({ selection: [], nonce: cur.nonce + 1 }));
                    setGroup(GENERATED_DESTINATION.group);
                    setPublishView("review");
                  }}
                />
              ) : createScreen === "studio" ? (
                <StudioLauncher companyId={companyId} />
              ) : (
                <MarketingPromotions companyId={companyId} />
              )}
            </TabsContent>

            <TabsContent value="acervo" className="mkt-tab-panel mkt-tool-panel">
              <MarketingLibraryHub
                companyId={companyId}
                kind={libraryKind}
                onKindChange={setLibraryKind}
                onUseMedia={(selection) => openCreate([selection])}
              />
            </TabsContent>

            <TabsContent value="publicar" className="mkt-tab-panel mkt-tool-panel">
              <MarketingPublishHub
                companyId={companyId}
                view={publishView}
                onViewChange={setPublishView}
              />
            </TabsContent>
          </motion.div>
        </Tabs>
      </LayoutGroup>
    </div>
  );
}

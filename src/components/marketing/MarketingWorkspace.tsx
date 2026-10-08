import { useState } from "react";
import { CalendarCheck, Home, Images, Sparkles } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MarketingDashboard } from "./MarketingDashboard";
import { MarketingLibraryHub } from "./MarketingLibraryHub";
import { MarketingPromotions } from "./MarketingPromotions";
import { MarketingGenerator } from "./MarketingGenerator";
import { MarketingPublishHub, type PublishView } from "./MarketingPublishHub";
import { Chip, ChipRow } from "./ui/MarketingUi";
import { DEFAULT_MARKETING_GROUP, GENERATED_DESTINATION, MARKETING_NAV, type MarketingGroupId } from "@/lib/marketing/marketing-nav";
import type { MediaSelection } from "@/lib/marketing/media-selection";

interface Props { companyId: string; }

const ICONS: Record<MarketingGroupId, typeof Home> = { inicio: Home, criar: Sparkles, acervo: Images, publicar: CalendarCheck };

export function MarketingWorkspace({ companyId }: Props) {
  const [group, setGroup] = useState<MarketingGroupId>(DEFAULT_MARKETING_GROUP);
  const [createScreen, setCreateScreen] = useState<"generator" | "promotions">("generator");
  const [publishView, setPublishView] = useState<PublishView>("review");
  // Mídia escolhida no Acervo para começar uma publicação; `nonce` reinicia o fluxo.
  const [seed, setSeed] = useState<{ selection: MediaSelection[]; nonce: number }>({ selection: [], nonce: 0 });

  function openCreate(selection: MediaSelection[] = []) {
    setSeed((cur) => ({ selection, nonce: cur.nonce + 1 }));
    setCreateScreen("generator");
    setGroup("criar");
  }
  function openPublish(view: PublishView) {
    setPublishView(view);
    setGroup("publicar");
  }

  return (
    <Tabs value={group} onValueChange={(value) => setGroup(value as MarketingGroupId)} className="w-full min-w-0">
      <TabsList className="mx-auto flex h-auto w-full max-w-md justify-between gap-1 rounded-full bg-card p-1 sm:w-fit sm:max-w-none">
        {MARKETING_NAV.map((item) => {
          const Icon = ICONS[item.id];
          return (
            <TabsTrigger
              key={item.id}
              value={item.id}
              className="flex-1 gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-muted-foreground data-[state=active]:bg-foreground data-[state=active]:text-background sm:flex-none sm:px-5"
            >
              <Icon className="hidden h-4 w-4 sm:block" aria-hidden />
              {item.label}
            </TabsTrigger>
          );
        })}
      </TabsList>

      <TabsContent value="inicio" className="mt-5 min-w-0">
        <MarketingDashboard companyId={companyId} onCreate={() => openCreate()} onOpenPublish={openPublish} />
      </TabsContent>

      <TabsContent value="criar" className="mt-5 min-w-0 space-y-4">
        <ChipRow label="Criar">
          <Chip active={createScreen === "generator"} onClick={() => setCreateScreen("generator")}>Nova publicação</Chip>
          <Chip active={createScreen === "promotions"} onClick={() => setCreateScreen("promotions")}>Promoções</Chip>
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
        ) : (
          <MarketingPromotions companyId={companyId} />
        )}
      </TabsContent>

      <TabsContent value="acervo" className="mt-5 min-w-0">
        <MarketingLibraryHub companyId={companyId} onUseMedia={(selection) => openCreate([selection])} />
      </TabsContent>

      <TabsContent value="publicar" className="mt-5 min-w-0">
        <MarketingPublishHub companyId={companyId} view={publishView} onViewChange={setPublishView} />
      </TabsContent>
    </Tabs>
  );
}

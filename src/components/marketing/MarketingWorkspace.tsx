import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MarketingDashboard } from "./MarketingDashboard";
import { MarketingLibraryHub } from "./MarketingLibraryHub";
import { MarketingPromotions } from "./MarketingPromotions";
import { MarketingGenerator } from "./MarketingGenerator";
import { MarketingPublishHub } from "./MarketingPublishHub";
import { DEFAULT_MARKETING_GROUP, GENERATED_DESTINATION, MARKETING_NAV, defaultMarketingScreens, type MarketingGroupId, type MarketingScreenId } from "@/lib/marketing/marketing-nav";

interface Props { companyId: string; }
export function MarketingWorkspace({ companyId }: Props) {
  const [group, setGroup] = useState<MarketingGroupId>(DEFAULT_MARKETING_GROUP);
  const [screens, setScreens] = useState(defaultMarketingScreens);
  function openScreen(g: MarketingGroupId, s: MarketingScreenId) { setScreens((prev) => ({ ...prev, [g]: s })); setGroup(g); }
  function renderScreen(id: MarketingScreenId) {
    switch (id) {
      case "dashboard": return <MarketingDashboard companyId={companyId} onCreate={() => openScreen("criar", "generator")} />;
      case "generator": return <MarketingGenerator companyId={companyId} onGenerated={() => openScreen(GENERATED_DESTINATION.group, GENERATED_DESTINATION.screen)} />;
      case "promotions": return <MarketingPromotions companyId={companyId} />;
      case "library": return <MarketingLibraryHub companyId={companyId} />;
      case "publish": return <MarketingPublishHub companyId={companyId} />;
    }
  }
  return (
    <Tabs value={group} onValueChange={(value) => setGroup(value as MarketingGroupId)}>
      <TabsList className="grid w-full grid-cols-4 sm:inline-flex sm:w-auto">
        {MARKETING_NAV.map((item) => <TabsTrigger key={item.id} value={item.id} className="sm:px-5">{item.label}</TabsTrigger>)}
      </TabsList>
      {MARKETING_NAV.map((item) => (
        <TabsContent key={item.id} value={item.id} className="mt-4">
          {item.screens.length === 1 ? renderScreen(item.screens[0].id) : (
            <Tabs value={screens[item.id]} onValueChange={(value) => setScreens((prev) => ({ ...prev, [item.id]: value as MarketingScreenId }))}>
              <TabsList aria-label={item.label} className="h-auto w-full justify-start gap-5 rounded-none border-b bg-transparent p-0">
                {item.screens.map((screen) => <TabsTrigger key={screen.id} value={screen.id} className="-mb-px rounded-none border-b-2 border-transparent px-0 pb-2 pt-1 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">{screen.label}</TabsTrigger>)}
              </TabsList>
              {item.screens.map((screen) => <TabsContent key={screen.id} value={screen.id} className="mt-4">{renderScreen(screen.id)}</TabsContent>)}
            </Tabs>
          )}
        </TabsContent>
      ))}
    </Tabs>
  );
}
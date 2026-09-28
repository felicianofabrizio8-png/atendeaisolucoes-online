import { useSyncExternalStore } from "react";
import { getSettings, subscribeSettings } from "@/data/settings";
import { QuickRepliesSection } from "@/components/configuracoes/QuickRepliesSection";
import { NotificationsCard } from "@/components/configuracoes/NotificationsCard";
import { SlaSection } from "@/components/configuracoes/SlaSection";
import { LossReasonsSection } from "@/components/configuracoes/LossReasonsSection";
import { CompanyLocationCard } from "@/components/configuracoes/CompanyLocationCard";
import { SettingsTabHeader } from "./settings-ui";

export function ServiceTab() {
  const settings = useSyncExternalStore(subscribeSettings, getSettings, getSettings);

  return (
    <>
      <SettingsTabHeader
        title="Atendimento"
        description="Respostas rápidas, notificações, SLA, motivos de perda e localização"
      />
      <div className="space-y-6">
        <QuickRepliesSection />
        <NotificationsCard />
        <SlaSection slaMinutes={settings.slaMinutes} />
        <LossReasonsSection reasons={settings.lossReasons} />
        <CompanyLocationCard />
      </div>
    </>
  );
}

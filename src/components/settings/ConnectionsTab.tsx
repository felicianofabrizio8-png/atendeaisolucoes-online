import { ChannelIntegrationsSection } from "@/components/configuracoes/ChannelIntegrationsSection";
import { MetaIntegrationSection } from "@/components/configuracoes/MetaIntegrationSection";
import { SettingsTabHeader } from "./settings-ui";

export function ConnectionsTab() {
  return (
    <>
      <SettingsTabHeader
        title="Conexões"
        description="Conecte WhatsApp, Instagram, Facebook e outros canais da Meta"
      />
      <div className="space-y-6">
        <ChannelIntegrationsSection />
        <MetaIntegrationSection />
      </div>
    </>
  );
}

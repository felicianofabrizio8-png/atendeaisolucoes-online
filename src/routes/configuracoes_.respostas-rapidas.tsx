import { createFileRoute } from "@tanstack/react-router";
import { SettingsRedirect } from "@/components/settings/SettingsRedirect";

// Mantida para links antigos — abre o popup de Configurações na aba Atendimento.
export const Route = createFileRoute("/configuracoes_/respostas-rapidas")({
  component: () => <SettingsRedirect tab="atendimento" />,
});

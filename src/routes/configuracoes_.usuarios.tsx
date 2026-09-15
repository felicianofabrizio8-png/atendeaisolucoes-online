import { createFileRoute } from "@tanstack/react-router";
import { SettingsRedirect } from "@/components/settings/SettingsRedirect";

// Mantida para links antigos (ex.: onboarding) — abre o popup de Configurações.
export const Route = createFileRoute("/configuracoes_/usuarios")({
  component: () => <SettingsRedirect tab="usuarios" />,
});

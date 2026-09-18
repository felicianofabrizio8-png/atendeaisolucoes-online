import { createFileRoute } from "@tanstack/react-router";
import { SettingsRedirect } from "@/components/settings/SettingsRedirect";

// Configurações virou um popup (src/components/settings/SettingsDialog.tsx).
// A rota continua existindo para links antigos e para o callback OAuth da Meta
// (/configuracoes?meta_connected=1), que abrem o popup na aba certa.
export const Route = createFileRoute("/configuracoes")({
  component: () => <SettingsRedirect />,
});

import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { openSettings, type SettingsTab } from "@/lib/settings-dialog";

/**
 * Configurações agora é um popup. As URLs antigas (/configuracoes e subpáginas)
 * continuam válidas para links externos, o callback OAuth da Meta e o
 * onboarding: abrem o popup na aba certa e levam o usuário ao dashboard.
 */
export function SettingsRedirect({ tab }: { tab?: SettingsTab }) {
  const navigate = useNavigate();

  useEffect(() => {
    let target = tab;
    if (!target) {
      const hash = window.location.hash.replace("#", "");
      const params = new URLSearchParams(window.location.search);
      if (hash === "meta" || params.has("meta_connected")) target = "conexoes";
      else if (hash === "company-location") target = "atendimento";
    }
    openSettings(target);
    void navigate({ to: "/", replace: true });
  }, [tab, navigate]);

  return null;
}

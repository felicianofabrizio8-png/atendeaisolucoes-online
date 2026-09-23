import { ShieldCheck } from "lucide-react";
import { SettingsTabHeader } from "./settings-ui";

export function PrivacyTab() {
  return (
    <>
      <SettingsTabHeader title="Privacidade" description="Dados, consentimento e segurança da conta" />
      <div className="rounded-lg border border-dashed border-border p-10 flex flex-col items-center gap-2 text-center">
        <ShieldCheck className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">Em breve</p>
        <p className="text-xs text-muted-foreground max-w-xs">
          As configurações de privacidade vão aparecer aqui.
        </p>
      </div>
    </>
  );
}

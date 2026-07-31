// Extraído de src/routes/configuracoes.tsx (Sprint 7 — Fase 7.1).
// Conteúdo idêntico ao original: apenas movido para reduzir o tamanho da rota.

import { useState, useEffect, useSyncExternalStore } from "react";
import { Bell } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  getNotificationPrefs,
  setNotificationPrefs,
  subscribeNotificationPrefs,
  getBrowserPermission,
  requestBrowserPermission,
} from "@/lib/notification-prefs";

export function NotificationsCard() {
  const prefs = useSyncExternalStore(
    subscribeNotificationPrefs,
    getNotificationPrefs,
    getNotificationPrefs,
  );
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    setPermission(getBrowserPermission());
  }, []);

  const handleRequest = async () => {
    const result = await requestBrowserPermission();
    setPermission(result);
  };

  const browserBlocked = permission === "denied" || permission === "unsupported";

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-1">
        <Bell className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Notificações de novas mensagens</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Avisos quando chegar uma nova mensagem de cliente em qualquer canal (WhatsApp, Instagram,
        Facebook). Não notifica mensagens enviadas pelo atendente.
      </p>

      <div className="space-y-3">
        <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2.5">
          <div>
            <div className="text-sm font-medium">Som ao receber mensagem</div>
            <div className="text-[11px] text-muted-foreground">
              Toca um beep curto quando entra uma mensagem nova.
            </div>
          </div>
          <Switch
            checked={prefs.soundEnabled}
            onCheckedChange={(v) => setNotificationPrefs({ soundEnabled: v })}
          />
        </label>

        <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2.5">
          <div>
            <div className="text-sm font-medium">Notificação do navegador</div>
            <div className="text-[11px] text-muted-foreground">
              {permission === "unsupported"
                ? "Este navegador não suporta notificações."
                : permission === "denied"
                  ? "Permissão bloqueada — libere nas configurações do navegador."
                  : permission === "granted"
                    ? "Permissão concedida."
                    : "Você ainda não concedeu permissão."}
            </div>
          </div>
          <Switch
            checked={prefs.browserEnabled && permission === "granted"}
            disabled={browserBlocked}
            onCheckedChange={(v) => setNotificationPrefs({ browserEnabled: v })}
          />
        </label>

        {permission !== "granted" && permission !== "unsupported" && (
          <button
            onClick={handleRequest}
            className="text-[11px] font-semibold rounded-md bg-primary text-primary-foreground px-3 py-1.5 hover:bg-primary/90"
          >
            Pedir permissão ao navegador
          </button>
        )}
      </div>
    </section>
  );
}

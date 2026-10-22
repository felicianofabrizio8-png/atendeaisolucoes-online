import { lazy, Suspense, useEffect, useState } from "react";
import { useSettingsDialog } from "@/lib/settings-dialog";

/**
 * Configurações sob demanda.
 *
 * O diálogo traz junto todas as abas (integrações de canal, Meta, respostas
 * rápidas com arrastar-e-soltar, equipe, convites, perfil…) — eram cerca de
 * 150 KB no código inicial de toda visita, para uma tela aberta de vez em
 * quando. Agora o pacote é baixado em segundo plano quando o app fica ocioso
 * e montado na primeira vez que alguém abre as configurações; depois disso
 * continua montado, como antes (animação de fechar e estado das abas).
 */
const loadSettingsDialog = () => import("./SettingsDialog");
const SettingsDialog = lazy(() =>
  loadSettingsDialog().then((module) => ({ default: module.SettingsDialog })),
);

export function LazySettingsDialog() {
  const { open } = useSettingsDialog();
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  // Pré-carrega com o app ocioso, para a primeira abertura ser imediata.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;
    const preload = () => void loadSettingsDialog().catch(() => undefined);
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(preload, { timeout: 8000 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = window.setTimeout(preload, 4000);
    return () => window.clearTimeout(timer);
  }, []);

  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <SettingsDialog />
    </Suspense>
  );
}

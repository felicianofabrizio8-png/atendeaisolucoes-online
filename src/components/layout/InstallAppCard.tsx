import { useEffect, useState } from "react";
import { Download, Share, SquarePlus, X } from "lucide-react";
import { LumeLogo } from "@/components/brand/LumeLogo";

/**
 * Convite para instalar a Lume como app (ícone na tela inicial, abre em tela
 * cheia, atalhos no ícone). No Android/Chrome usa o pedido nativo do
 * navegador; no iPhone o Safari não tem esse pedido, então mostra os dois
 * toques (Compartilhar → Adicionar à Tela de Início). Some quando o app já
 * está instalado ou quando a pessoa dispensa.
 */

const DISMISS_KEY = "lume.install-card.dismissed";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// O pedido chega uma vez, às vezes antes da tela montar: guardado no módulo.
let deferred: InstallPromptEvent | null = null;
const waiting = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    waiting.forEach((notify) => notify());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    waiting.forEach((notify) => notify());
  });
}

function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos() {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}

export function InstallAppCard() {
  const [mode, setMode] = useState<"hidden" | "prompt" | "ios">("hidden");
  const [iosSteps, setIosSteps] = useState(false);

  useEffect(() => {
    const decide = () => {
      let dismissed = false;
      try {
        dismissed = window.localStorage.getItem(DISMISS_KEY) === "1";
      } catch {
        // Sem armazenamento: mostra normalmente.
      }
      if (dismissed || isStandalone()) return setMode("hidden");
      if (deferred) return setMode("prompt");
      setMode(isIos() ? "ios" : "hidden");
    };
    decide();
    waiting.add(decide);
    return () => {
      waiting.delete(decide);
    };
  }, []);

  if (mode === "hidden") return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Dispensa vale só nesta sessão.
    }
    setMode("hidden");
  };

  const install = async () => {
    if (mode === "ios") return setIosSteps((open) => !open);
    const event = deferred;
    if (!event) return;
    await event.prompt();
    const { outcome } = await event.userChoice;
    deferred = null;
    if (outcome === "accepted") setMode("hidden");
  };

  return (
    <section className="install-card" aria-label="Instalar o app">
      <button type="button" className="install-card-x" aria-label="Dispensar" onClick={dismiss}>
        <X className="h-4 w-4" aria-hidden />
      </button>
      <div className="flex items-center gap-3 pr-8">
        <span className="install-card-icon" aria-hidden>
          <LumeLogo variant="mark" aria-label="" className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold leading-tight">Lume na tela inicial</p>
          <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
            Abra em um toque, em tela cheia, e segure o ícone para criar um orçamento direto.
          </p>
        </div>
      </div>
      {iosSteps && (
        <ol className="install-card-steps">
          <li>
            <span>1</span>
            Toque em <Share
              className="inline h-4 w-4 -translate-y-px"
              aria-label="Compartilhar"
            />{" "}
            na barra do Safari
          </li>
          <li>
            <span>2</span>
            Escolha <SquarePlus className="inline h-4 w-4 -translate-y-px" aria-hidden />{" "}
            <b>Adicionar à Tela de Início</b>
          </li>
        </ol>
      )}
      <button type="button" className="install-card-cta" onClick={() => void install()}>
        <Download className="h-4 w-4" aria-hidden />
        {mode === "ios" ? (iosSteps ? "Entendi" : "Como instalar") : "Instalar o app"}
      </button>
    </section>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/auth/meta/callback")({
  component: MetaCallback,
});

function MetaCallback() {
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Finalizando login Meta…");

  useEffect(() => {
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const errorParam = url.searchParams.get("error");
    const errorDesc =
      url.searchParams.get("error_description") ?? url.searchParams.get("error_reason");

    const isPopup = !!window.opener && window.opener !== window;

    console.log("META_CALLBACK_PARAMS", {
      has_code: Boolean(code),
      error: errorParam,
      is_popup: isPopup,
    });

    const payload: { type: "META_OAUTH_RESULT"; code?: string; state?: string; error?: string } = {
      type: "META_OAUTH_RESULT",
    };
    if (errorParam) {
      payload.error = `Meta retornou erro: ${errorParam}${errorDesc ? ` — ${errorDesc}` : ""}`;
    } else if (!code) {
      payload.error = "Nenhum código de autorização recebido do Facebook.";
    } else {
      payload.code = code;
      if (state) payload.state = state;
    }

    if (isPopup) {
      try {
        window.opener.postMessage(payload, window.location.origin);
      } catch (e) {
        console.warn("META_CALLBACK_POSTMESSAGE_FAIL", e);
      }
      // Fecha o popup imediatamente para não renderizar o app completo.
      setTimeout(() => {
        try {
          window.close();
        } catch {
          /* ignore */
        }
      }, 30);
      return;
    }

    // Fallback (sem opener): grava o code e volta para /configuracoes via redirect limpo.
    if (payload.error) {
      setError(payload.error);
      return;
    }
    if (code) {
      try {
        window.sessionStorage.setItem("META_OAUTH_CODE", code);
        if (state) window.sessionStorage.setItem("META_OAUTH_STATE_RX", state);
      } catch {
        /* ignore */
      }
    }
    setStatus("Voltando para Configurações…");
    window.location.replace("/configuracoes?meta_connected=1");
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center p-6 bg-background text-foreground">
      <div className="max-w-md w-full rounded-lg border border-border bg-card p-6 text-center">
        {error ? (
          <>
            <h1 className="text-base font-semibold mb-2">Erro no login Meta</h1>
            <p className="text-sm text-[var(--status-urgent)]">{error}</p>
            <a
              href="/configuracoes"
              className="mt-4 inline-block text-xs font-semibold rounded-md bg-primary text-primary-foreground px-3 py-2"
            >
              Voltar para Configurações
            </a>
          </>
        ) : (
          <p className="text-sm">{status}</p>
        )}
      </div>
    </div>
  );
}

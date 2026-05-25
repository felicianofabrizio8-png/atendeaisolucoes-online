import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/auth/meta/callback")({
  component: MetaCallback,
});

function MetaCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Finalizando login Meta…");

  useEffect(() => {
    const isPopup =
      typeof window !== "undefined" && !!window.opener && window.opener !== window;

    const postToOpener = (payload: {
      code?: string;
      state?: string;
      error?: string;
    }) => {
      if (!isPopup) return false;
      try {
        window.opener.postMessage(
          { type: "META_OAUTH_RESULT", ...payload },
          window.location.origin,
        );
        // Pequeno delay para garantir entrega da mensagem antes de fechar.
        setTimeout(() => {
          try {
            window.close();
          } catch {
            /* ignore */
          }
        }, 50);
        return true;
      } catch {
        return false;
      }
    };

    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const errorParam = url.searchParams.get("error");
    const errorDesc =
      url.searchParams.get("error_description") ?? url.searchParams.get("error_reason");
    const state = url.searchParams.get("state");

    console.log("META_CALLBACK_PARAMS", {
      has_code: Boolean(code),
      error: errorParam,
      error_description: errorDesc,
      state,
      is_popup: isPopup,
    });

    if (errorParam) {
      const msg = `Meta retornou erro: ${errorParam}${errorDesc ? ` — ${errorDesc}` : ""}`;
      if (postToOpener({ error: msg })) return;
      setError(msg);
      return;
    }
    if (!code) {
      const msg = "Nenhum código de autorização recebido do Facebook.";
      if (postToOpener({ error: msg })) return;
      setError(msg);
      return;
    }

    // Popup: devolve o code para a janela principal fazer o exchange.
    // Isso fecha o popup em milissegundos, sem carregar a app inteira.
    if (postToOpener({ code, state: state ?? undefined })) return;

    // Fallback (sem popup): persiste o code e volta para /configuracoes.
    // A própria página de configurações faz o exchange via meta-connect.
    try {
      window.sessionStorage.setItem("META_OAUTH_CODE", code);
      if (state) window.sessionStorage.setItem("META_OAUTH_STATE_RX", state);
    } catch {
      /* ignore */
    }
    setStatus("Voltando para Configurações…");
    void navigate({ to: "/configuracoes" });
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md w-full rounded-lg border border-border bg-card p-6 text-center">
        {error ? (
          <>
            <h1 className="text-base font-semibold mb-2">Erro no login Meta</h1>
            <p className="text-sm text-[var(--status-urgent)]">{error}</p>
            <button
              onClick={() => navigate({ to: "/configuracoes" })}
              className="mt-4 text-xs font-semibold rounded-md bg-primary text-primary-foreground px-3 py-2"
            >
              Voltar para Configurações
            </button>
          </>
        ) : (
          <p className="text-sm inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> {status}
          </p>
        )}
      </div>
    </div>
  );
}

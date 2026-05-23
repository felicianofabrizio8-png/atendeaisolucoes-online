import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/auth/meta/callback")({
  component: MetaCallback,
});

function MetaCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Validando login Meta…");

  useEffect(() => {
    const isPopup = typeof window !== "undefined" && !!window.opener && window.opener !== window;

    const postToOpener = (payload: { access_token?: string; error?: string }) => {
      if (!isPopup) return false;
      try {
        window.opener.postMessage(
          { type: "META_OAUTH_RESULT", ...payload },
          window.location.origin,
        );
        window.close();
        return true;
      } catch {
        return false;
      }
    };

    const run = async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const errorParam = url.searchParams.get("error");
      const errorDesc =
        url.searchParams.get("error_description") ?? url.searchParams.get("error_reason");
      const state = url.searchParams.get("state");
      const expectedState = window.sessionStorage.getItem("META_OAUTH_STATE");
      window.sessionStorage.removeItem("META_OAUTH_STATE");

      console.log("META_CALLBACK_PARAMS", {
        has_code: Boolean(code),
        error: errorParam,
        error_description: errorDesc,
        state,
        state_match: state === expectedState,
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
      if (expectedState && state !== expectedState) {
        const msg = "State inválido. Reinicie o login Meta.";
        if (postToOpener({ error: msg })) return;
        setError(msg);
        return;
      }

      try {
        setStatus("Trocando código por token…");
        const { supabase } = await import("@/integrations/supabase/client");
        const { data, error: invokeErr } = await supabase.functions.invoke("meta-connect", {
          body: {
            mode: "exchange_code",
            code,
            redirectUri: "https://atendei-ai-concierge.lovable.app/auth/meta/callback",
          },
        });
        if (invokeErr) throw invokeErr;
        const res = data as { ok?: boolean; access_token?: string; error?: string };
        if (!res?.access_token) {
          throw new Error(res?.error ?? "Resposta sem access_token");
        }
        console.log("META_TOKEN_RECEIVED", {
          token_preview: `${res.access_token.slice(0, 12)}...${res.access_token.slice(-6)}`,
        });
        if (postToOpener({ access_token: res.access_token })) return;
        window.sessionStorage.setItem("META_OAUTH_TOKEN", res.access_token);
        await navigate({ to: "/configuracoes" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Falha ao trocar código por token";
        if (postToOpener({ error: msg })) return;
        setError(msg);
      }
    };
    void run();
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

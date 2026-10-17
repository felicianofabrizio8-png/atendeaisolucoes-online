import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import {
  cancelJoinRequest,
  clearPendingInvite,
  joinViaLink,
  linkInfo,
  myPendingJoin,
  readPendingInvite,
  type LinkInfo,
} from "@/lib/team/invite-link";
import { LumePopup } from "./LumePopup";

type View =
  | { kind: "none" }
  | { kind: "confirm"; token: string; info: LinkInfo }
  | { kind: "waiting"; company: string };

/**
 * Depois do login: se a pessoa abriu um link de convite, pergunta se quer entrar na
 * equipe; se já pediu e aguarda aprovação, mostra a espera. Fica acima de todo o app,
 * porque quem aguarda aprovação ainda não tem acesso às páginas.
 */
export function PendingInviteGate() {
  const { user, signOut } = useAuth();
  const [view, setView] = useState<View>({ kind: "none" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setView({ kind: "none" });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const pending = await myPendingJoin().catch(() => null);
        if (cancelled) return;
        if (pending?.state === "waiting") return setView({ kind: "waiting", company: pending.company });
        const token = readPendingInvite();
        if (!token) return;
        const info = await linkInfo(token);
        if (cancelled) return;
        if (!info.valid || info.alreadyMember) {
          clearPendingInvite();
          return;
        }
        setView({ kind: "confirm", token, info });
      } catch {
        /* sem rede: tenta de novo no próximo carregamento */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function confirm(token: string, info: LinkInfo) {
    setBusy(true);
    setError(null);
    try {
      const status = await joinViaLink(token);
      clearPendingInvite();
      if (status === "pending_approval") {
        setView({ kind: "waiting", company: info.company ?? "" });
      } else {
        window.location.reload();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível entrar na equipe.");
    } finally {
      setBusy(false);
    }
  }

  if (view.kind === "waiting") {
    return (
      <LumePopup
        open
        size="sm"
        title="Aguardando aprovação"
        description={`Seu pedido para entrar na equipe ${view.company} foi enviado.`}
        footer={
          <>
            <button
              type="button"
              className="lq-secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await cancelJoinRequest();
                  window.location.reload();
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : "Não foi possível cancelar.");
                  setBusy(false);
                }
              }}
            >
              Cancelar pedido
            </button>
            <button type="button" className="lq-secondary ml-auto" onClick={() => void signOut()}>
              Sair
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-white/70">
          Assim que o administrador liberar, recarregue a página para entrar. Se desistir, cancele o
          pedido e você volta para a sua própria equipe.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-[#ff9a9a]">
            {error}
          </p>
        )}
      </LumePopup>
    );
  }

  const confirming = view.kind === "confirm" ? view : null;
  const info = confirming?.info;
  const company = info?.company ?? "";
  const blocked = info?.canSwitch === false;
  const close = () => {
    clearPendingInvite();
    setView({ kind: "none" });
  };

  return (
    <LumePopup
      open={!!confirming}
      size="sm"
      title={company}
      description="Convite para a equipe"
      onClose={close}
      footer={
        blocked ? (
          <button type="button" className="lq-secondary ml-auto" onClick={close}>
            Fechar
          </button>
        ) : (
          <>
            <button type="button" className="lq-secondary" disabled={busy} onClick={close}>
              Agora não
            </button>
            <button
              type="button"
              className="lq-primary ml-auto"
              disabled={busy}
              onClick={() => confirming && void confirm(confirming.token, confirming.info)}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Entrar na equipe
            </button>
          </>
        )
      }
    >
      <div className="space-y-3 text-sm leading-relaxed text-white/75">
        <p className="text-[15px] text-white">
          Você foi convidado para fazer parte da equipe {company}. Deseja entrar?
        </p>
        {info?.requiresApproval && !blocked && (
          <p>Depois de confirmar, o administrador precisa aprovar seu acesso.</p>
        )}
        {blocked ? (
          <p>
            Sua conta faz parte de uma equipe com outras pessoas. Use outro e-mail para entrar
            nesta equipe.
          </p>
        ) : (
          info?.currentTeamHasData && (
            <p>
              Sua equipe atual “{info.currentTeam}” fica sem acesso ao entrar. Os dados dela ficam
              guardados.
            </p>
          )
        )}
        {error && (
          <p role="alert" className="text-[#ff9a9a]">
            {error}
          </p>
        )}
      </div>
    </LumePopup>
  );
}

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { linkInfo, savePendingInvite, type LinkInfo } from "@/lib/team/invite-link";
import { LumePopup } from "./LumePopup";

/**
 * Link aberto sem login: mostra o time e pede para criar conta (cadastro normal, com as
 * verificações) ou entrar. O token fica guardado; depois do login, o popup confirma.
 */
export function InviteLanding({
  token,
  onAuth,
}: {
  token: string;
  onAuth: (mode: "signup" | "signin") => void;
}) {
  const [info, setInfo] = useState<LinkInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    linkInfo(token)
      .then((result) => !cancelled && setInfo(result))
      .catch(() => !cancelled && setInfo({ valid: false, company: null, requiresApproval: false }));
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!info)
    return (
      <div className="grid min-h-dvh place-items-center bg-black">
        <Loader2 className="h-6 w-6 animate-spin text-white/60" />
      </div>
    );

  if (!info.valid)
    return (
      <div className="min-h-dvh bg-black">
        <LumePopup open size="sm" title="Convite indisponível">
          <p className="text-sm leading-relaxed text-white/75">
            Este link expirou, foi revogado ou atingiu o limite. Peça um novo ao administrador.
          </p>
        </LumePopup>
      </div>
    );

  const go = (mode: "signup" | "signin") => {
    savePendingInvite(token);
    onAuth(mode);
  };
  return (
    <div className="min-h-dvh bg-black">
      <LumePopup
        open
        size="sm"
        title={info.company ?? "Equipe"}
        description="Convite para a equipe"
        footer={
          <>
            <button type="button" className="lq-secondary" onClick={() => go("signin")}>
              Entrar
            </button>
            <button type="button" className="lq-primary ml-auto" onClick={() => go("signup")}>
              Criar conta
            </button>
          </>
        }
      >
        <div className="space-y-3 text-sm leading-relaxed text-white/75">
          <p className="text-[15px] text-white">
            Você foi convidado para fazer parte da equipe {info.company}.
          </p>
          <p>Crie sua conta ou entre para aceitar o convite.</p>
          {info.requiresApproval && (
            <p>Depois de confirmar, o administrador precisa aprovar seu acesso.</p>
          )}
        </div>
      </LumePopup>
    </div>
  );
}

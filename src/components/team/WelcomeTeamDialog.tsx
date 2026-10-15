import { useState } from "react";
import { Link2, Loader2 } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { useTeamAccess } from "@/hooks/useTeamAccess";
import { readPendingInvite } from "@/lib/team/invite-link";
import { renameTeam } from "@/lib/users.functions";
import { LumePopup } from "./LumePopup";

const DEFAULT_NAME = "Minha Empresa";
const seenKey = (company: string) => `lume.welcomeTeam.${company}`;

function seen(company: string) {
  try {
    return localStorage.getItem(seenKey(company)) === "1";
  } catch {
    return false;
  }
}
function markSeen(company: string) {
  try {
    localStorage.setItem(seenKey(company), "1");
  } catch {
    /* navegação privada */
  }
}

/**
 * Primeira entrada de quem criou a equipe (estilo Notion): dar nome à equipe e já
 * convidar as pessoas. Não aparece para quem chegou por convite.
 */
export function WelcomeTeamDialog() {
  const { company, refreshProfile } = useAuth();
  const { isAdmin } = useTeamAccess();
  const [step, setStep] = useState<"name" | "invite" | "closed">("name");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eligible =
    !!company &&
    isAdmin &&
    company.name === DEFAULT_NAME &&
    !readPendingInvite() &&
    !seen(company.id);
  if (!company || step === "closed" || (step === "name" && !eligible)) return null;

  const close = () => {
    markSeen(company.id);
    setStep("closed");
  };

  async function save() {
    if (!company) return;
    setBusy(true);
    setError(null);
    try {
      await renameTeam(name.trim());
      await refreshProfile?.();
      markSeen(company.id);
      setStep("invite");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar o nome.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "invite")
    return (
      <LumePopup
        open
        size="sm"
        title="Convide sua equipe"
        description="Gere um link e compartilhe com quem vai trabalhar com você."
        onClose={close}
        footer={
          <>
            <button type="button" className="lq-secondary" onClick={close}>
              Agora não
            </button>
            <a href="/configuracoes/usuarios" className="lq-primary ml-auto" onClick={close}>
              <Link2 className="h-4 w-4" />
              Gerar link de convite
            </a>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-white/75">
          Quem abrir o link cria a conta (ou entra) e confirma a entrada na equipe. Você define o
          perfil, a validade e se precisa da sua aprovação.
        </p>
      </LumePopup>
    );

  return (
    <LumePopup
      open
      size="sm"
      title="Crie sua equipe"
      description="Dê um nome para a equipe. Você será o administrador."
      onClose={close}
      footer={
        <button
          type="button"
          className="lq-primary ml-auto"
          disabled={busy || name.trim().length < 2}
          onClick={() => void save()}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Continuar
        </button>
      }
    >
      <label className="block min-w-0">
        <span className="lq-field-label">Nome da equipe</span>
        <input
          className="quote-form-input"
          value={name}
          maxLength={80}
          autoFocus
          placeholder="Ex.: Clínica Sol, Studio Norte…"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && name.trim().length >= 2) void save();
          }}
        />
      </label>
      {error && (
        <p role="alert" className="mt-3 text-sm text-[#ff9a9a]">
          {error}
        </p>
      )}
    </LumePopup>
  );
}

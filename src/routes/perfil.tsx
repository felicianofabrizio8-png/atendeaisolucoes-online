import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Settings } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { ProfileTab } from "@/components/settings/ProfileTab";
import { useHideMobileNav } from "@/components/layout/MobileBottomNav";
import { openSettings } from "@/lib/settings-dialog";

// Perfil como tela própria (o avatar do topo e da barra lateral levam aqui).
// No celular é uma tela de detalhe de app: voltar no topo, sem a barra
// inferior, e a barra de salvar fica presa embaixo.
export const Route = createFileRoute("/perfil")({
  ssr: false,
  component: ProfilePage,
});

function ProfilePage() {
  const { user } = useAuth();
  const router = useRouter();
  const navigate = useNavigate();
  useHideMobileNav(true);

  const back = () => {
    if (window.history.length > 1) router.history.back();
    else void navigate({ to: "/" });
  };

  return (
    <div className="profile-page">
      <header className="profile-page-head">
        <button type="button" onClick={back} aria-label="Voltar" className="profile-page-round">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </button>
        <h1>Perfil</h1>
        <button
          type="button"
          onClick={() => openSettings("conta")}
          aria-label="Conta e configurações"
          title="Conta e configurações"
          className="profile-page-round"
        >
          <Settings className="h-[18px] w-[18px]" aria-hidden />
        </button>
      </header>
      {user ? (
        <ProfileTab asPage />
      ) : (
        <p className="px-1 py-10 text-center text-sm text-muted-foreground">
          Entre na sua conta para editar o perfil.
        </p>
      )}
    </div>
  );
}

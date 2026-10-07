import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Loader2, ShieldAlert } from "lucide-react";
import type { useTeamAccess } from "@/hooks/useTeamAccess";
export function AccessDenied({ access }: { access: ReturnType<typeof useTeamAccess> }) {
  const navigate = useNavigate();
  const canAttend = access.canOpen("/atendimento");
  useEffect(() => {
    if (canAttend && window.location.pathname === "/")
      void navigate({ to: "/atendimento", replace: true });
  }, [canAttend, navigate]);
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 p-6 text-center">
      {access.isPending ? (
        <Loader2 className="animate-spin" />
      ) : (
        <>
          <ShieldAlert className="h-9 w-9 text-muted-foreground" />
          <h1 className="text-xl font-semibold">
            {access.isError ? "Não foi possível verificar seu acesso" : "Acesso restrito"}
          </h1>
          <p className="max-w-md text-sm text-muted-foreground">
            {access.isError
              ? "Verifique a conexão e se a atualização de equipe foi aplicada ao banco."
              : "Seu perfil não tem acesso a esta área. Peça ao administrador para revisar suas permissões."}
          </p>
          {access.isError && (
            <button
              className="rounded-full border border-border px-4 py-2"
              onClick={() => void access.refetch()}
            >
              Tentar novamente
            </button>
          )}
          {access.canOpen("/atendimento") && (
            <button
              className="rounded-full bg-primary px-4 py-2 text-primary-foreground"
              onClick={() => void navigate({ to: "/atendimento" })}
            >
              Ir para atendimento
            </button>
          )}
        </>
      )}
    </div>
  );
}

// Composição raiz: guard admin + shell. Extraído em função separada para
// permanecer estável mesmo se o TanStack auto code-splitter remover o
// componente da rota do escopo do módulo (o corpo é referenciado apenas
// pelo wrapper AdminPageBody, não pelo objeto Route).
import { useEffect } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Loader2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { InterpreterShell } from "./interpreter-shell";

export function AdminPageBody() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/login" });
  }, [authLoading, user, navigate]);

  // Guard "sem flash": mostra spinner enquanto qualquer sinal de auth/admin
  // estiver indeterminado. Só decide após ambos concluírem.
  if (authLoading || !user || adminLoading) {
    return (
      <div
        className="flex items-center justify-center h-full"
        data-testid="interpreter-guard-loading"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="sr-only">Verificando acesso…</span>
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto p-8">
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <h2 className="font-semibold">Acesso restrito</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Somente administradores podem acessar o console do Coach Interpreter.
            </p>
            <Link to="/configuracoes" className="text-sm text-primary underline mt-2 inline-block">
              Voltar para Configurações
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <InterpreterShell />;
}

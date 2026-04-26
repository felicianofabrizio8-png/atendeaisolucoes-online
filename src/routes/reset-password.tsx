import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles, Loader2, Eye, EyeOff, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [validRecovery, setValidRecovery] = useState<boolean | null>(null);

  useEffect(() => {
    // Supabase processa o hash automaticamente e dispara onAuthStateChange (PASSWORD_RECOVERY).
    // Verificamos se há uma sessão de recuperação válida.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setValidRecovery(true);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      // Se chegou aqui com sessão (vinda do link), permite trocar.
      if (session) setValidRecovery(true);
      else if (validRecovery === null) {
        // Aguarda evento PASSWORD_RECOVERY por um instante
        setTimeout(() => {
          if (validRecovery === null) setValidRecovery(false);
        }, 1500);
      }
    });

    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("A senha precisa ter ao menos 6 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("As senhas não conferem.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setSuccess(true);
      setTimeout(() => {
        supabase.auth.signOut().then(() => navigate({ to: "/login" }));
      }, 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao atualizar senha";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <div className="text-lg font-semibold">Atende Ai!</div>
            <div className="text-xs text-muted-foreground">Redefinir senha</div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
          {success ? (
            <div className="flex flex-col items-center text-center py-4">
              <CheckCircle2 className="h-10 w-10 text-primary mb-3" />
              <h2 className="text-sm font-semibold mb-1">Senha atualizada!</h2>
              <p className="text-xs text-muted-foreground">
                Redirecionando para o login...
              </p>
            </div>
          ) : validRecovery === false ? (
            <div className="text-center py-4">
              <h2 className="text-sm font-semibold mb-2">Link inválido ou expirado</h2>
              <p className="text-xs text-muted-foreground mb-4">
                Solicite um novo link de redefinição de senha.
              </p>
              <button
                type="button"
                onClick={() => navigate({ to: "/login" })}
                className="h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
              >
                Voltar para login
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold mb-1">Defina sua nova senha</h2>
                <p className="text-xs text-muted-foreground mb-3">
                  Use ao menos 6 caracteres.
                </p>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Nova senha
                </label>
                <div className="relative mt-1">
                  <input
                    type={show ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    minLength={6}
                    required
                    className="w-full h-10 rounded-md bg-input px-3 pr-10 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((v) => !v)}
                    aria-label={show ? "Ocultar senha" : "Mostrar senha"}
                    tabIndex={-1}
                    className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent"
                  >
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Confirmar senha
                </label>
                <div className="relative mt-1">
                  <input
                    type={showConfirm ? "text" : "password"}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    autoComplete="new-password"
                    minLength={6}
                    required
                    className="w-full h-10 rounded-md bg-input px-3 pr-10 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    aria-label={showConfirm ? "Ocultar senha" : "Mostrar senha"}
                    tabIndex={-1}
                    className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent"
                  >
                    {showConfirm ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive border border-destructive/20">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || validRecovery !== true}
                className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Atualizar senha
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { teamRpc } from "@/lib/team/client";
import { LumeLogo } from "@/components/brand/LumeLogo";

export const Route = createFileRoute("/convite")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : "",
  }),
  component: InvitePage,
});
function InvitePage() {
  const { token } = Route.useSearch();
  const { user, refreshProfile, signOut } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (user) {
        await teamRpc("team_accept_invite", { _token: token });
        await refreshProfile();
        setDone(true);
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: name, invite_token: token },
            emailRedirectTo: window.location.origin + "/convite?token=" + encodeURIComponent(token),
          },
        });
        if (error) throw error;
        setDone(true);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível aceitar o convite.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-5 text-foreground">
      <section className="w-full max-w-md space-y-6 rounded-3xl border border-border bg-card p-7">
        <LumeLogo className="h-10 w-36" />
        <h1 className="text-2xl font-semibold">Entre para a equipe</h1>
        {!token ? (
          <p>Este link de convite é inválido.</p>
        ) : done ? (
          <div className="space-y-4">
            <p>
              Cadastro recebido. Se necessário, confirme seu e-mail pelo link enviado pelo Lume
              antes de entrar.
            </p>
            <Link to="/" className="underline">
              Continuar
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Use o mesmo e-mail informado no convite. Sua conta terá os acessos definidos pelo
              administrador da empresa.
            </p>
            {user ? (
              <>
                <p className="text-sm">Conta atual: {user.email}</p>
                <button type="button" className="text-sm underline" onClick={() => void signOut()}>
                  Usar outra conta
                </button>
              </>
            ) : (
              <>
                <label className="block text-sm">
                  Nome
                  <input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1 w-full rounded-xl bg-input p-3"
                    autoComplete="name"
                  />
                </label>
                <label className="block text-sm">
                  E-mail do convite
                  <input
                    required
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1 w-full rounded-xl bg-input p-3"
                    autoComplete="email"
                  />
                </label>
                <label className="block text-sm">
                  Crie uma senha
                  <input
                    required
                    type="password"
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="mt-1 w-full rounded-xl bg-input p-3"
                    autoComplete="new-password"
                  />
                </label>
                <p className="text-xs text-muted-foreground">
                  Já possui conta nesta empresa?{" "}
                  <Link to="/" className="underline">
                    Entre
                  </Link>{" "}
                  e abra este convite novamente.
                </p>
              </>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <button
              disabled={busy}
              className="w-full rounded-full bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy ? "Aguarde…" : "Aceitar convite"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

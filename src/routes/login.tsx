import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useAuth } from "@/auth/AuthContext";
import { Sparkles, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

type Mode = "signin" | "signup";

function LoginPage() {
  const navigate = useNavigate();
  const { signIn, signUp, user } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  // Se já estiver logado, manda pra home.
  if (user) {
    setTimeout(() => navigate({ to: "/" }), 0);
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (mode === "signin") {
        await signIn(email, password);
        navigate({ to: "/" });
      } else {
        await signUp({
          email,
          password,
          displayName: displayName || email.split("@")[0],
          companyName: companyName || "Minha Empresa",
        });
        setInfo(
          "Conta criada! Se a confirmação por email estiver ativa, verifique sua caixa. Se não, já pode entrar.",
        );
        setMode("signin");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro inesperado";
      // Mensagens mais amigáveis
      if (msg.toLowerCase().includes("invalid login")) {
        setError("Email ou senha incorretos.");
      } else if (msg.toLowerCase().includes("already registered")) {
        setError("Esse email já está cadastrado. Entre em vez disso.");
      } else if (msg.toLowerCase().includes("password")) {
        setError("A senha precisa ter ao menos 6 caracteres.");
      } else {
        setError(msg);
      }
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
            <div className="text-xs text-muted-foreground">Vendas que não esperam</div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <div className="flex gap-1 p-1 bg-secondary rounded-md mb-5">
            {(["signin", "signup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setError(null);
                  setInfo(null);
                }}
                className={cn(
                  "flex-1 h-8 text-xs font-medium rounded transition-colors",
                  mode === m
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "signin" ? "Entrar" : "Criar conta"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-3">
            {mode === "signup" && (
              <>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Nome da empresa
                  </label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Ex.: Piscinas do Sul"
                    className="mt-1 w-full h-10 rounded-md bg-input px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Seu nome
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Como você quer ser chamado"
                    className="mt-1 w-full h-10 rounded-md bg-input px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </>
            )}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="mt-1 w-full h-10 rounded-md bg-input px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Senha</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                minLength={6}
                className="mt-1 w-full h-10 rounded-md bg-input px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                required
              />
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive border border-destructive/20">
                {error}
              </div>
            )}
            {info && (
              <div className="rounded-md bg-primary/10 px-3 py-2 text-xs text-primary border border-primary/20">
                {info}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === "signin" ? "Entrar" : "Criar conta"}
            </button>
          </form>
        </div>

        <div className="mt-4 text-center">
          <Link
            to="/"
            search={{ demo: true } as never}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            Continuar em modo demo (sem login)
          </Link>
        </div>
      </div>
    </div>
  );
}

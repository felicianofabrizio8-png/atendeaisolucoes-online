import { useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { LumeLogo } from "@/components/brand/LumeLogo";

export type AuthMode = "signin" | "signup" | "forgot";

type AuthFormProps = {
  initialMode?: AuthMode;
  onAuthenticated?: () => void;
};

const inputClass =
  "mt-1.5 h-12 w-full rounded-2xl border border-white/10 bg-white/[0.045] px-4 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-violet-300/60 focus:bg-white/[0.08] focus:ring-2 focus:ring-violet-300/15";

export function AuthForm({ initialMode = "signin", onAuthenticated }: AuthFormProps) {
  const navigate = useNavigate();
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const changeMode = (next: AuthMode) => {
    setMode(next);
    setError(null);
    setInfo(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);

    try {
      if (mode === "signin") {
        await signIn(email, password);
        onAuthenticated?.();
        await navigate({ to: "/" });
      } else if (mode === "signup") {
        await signUp({
          email,
          password,
          displayName: displayName || email.split("@")[0],
          companyName: companyName || "Minha Empresa",
        });
        setInfo(
          "Conta criada! Se a confirmação por email estiver ativa, verifique sua caixa. Caso contrário, já pode entrar.",
        );
        setMode("signin");
      } else {
        const redirectTo =
          typeof window !== "undefined" ? `${window.location.origin}/reset-password` : undefined;
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo,
        });
        if (resetError) throw resetError;
        setInfo("Se o email existir, você receberá um link para redefinir sua senha.");
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Erro inesperado";
      if (message.toLowerCase().includes("invalid login")) {
        setError("Email ou senha incorretos.");
      } else if (message.toLowerCase().includes("already registered")) {
        setError("Esse email já está cadastrado. Entre em vez disso.");
      } else if (message.toLowerCase().includes("password")) {
        setError("A senha precisa ter ao menos 6 caracteres.");
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="text-white">
      <div className="mb-7 flex flex-col items-center text-center">
        <LumeLogo variant="lockup" aria-label="Lume" className="mb-5 h-12 w-[164px] text-white" />
        <h2
          id="auth-form-title"
          className="text-balance text-[28px] font-semibold leading-tight tracking-[-0.045em] sm:text-[32px]"
        >
          {mode === "signup"
            ? "Comece a vender melhor."
            : mode === "forgot"
              ? "Recupere seu acesso."
              : "Bom ter você de volta."}
        </h2>
        <p className="mt-2 max-w-sm text-sm leading-6 text-white/55">
          {mode === "signup"
            ? "Crie sua conta e organize cada oportunidade em um só lugar."
            : mode === "forgot"
              ? "Informe seu email para receber um link de redefinição."
              : "Entre para continuar suas conversas e oportunidades."}
        </p>
      </div>

      {mode === "forgot" ? (
        <button
          type="button"
          onClick={() => changeMode("signin")}
          className="mb-5 inline-flex items-center gap-2 rounded-full text-sm font-medium text-white/65 transition hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Voltar para login
        </button>
      ) : (
        <div
          className="mb-6 grid grid-cols-2 rounded-full border border-white/10 bg-black/50 p-1"
          role="group"
          aria-label="Acesso à conta"
        >
          <button
            type="button"
            onClick={() => changeMode("signin")}
            aria-pressed={mode === "signin"}
            className={`min-h-10 rounded-full text-sm font-semibold transition ${mode === "signin" ? "bg-white text-[#14101a] shadow-md" : "text-white/55 hover:text-white"}`}
          >
            Entrar
          </button>
          <button
            type="button"
            onClick={() => changeMode("signup")}
            aria-pressed={mode === "signup"}
            className={`min-h-10 rounded-full text-sm font-semibold transition ${mode === "signup" ? "bg-white text-[#14101a] shadow-md" : "text-white/55 hover:text-white"}`}
          >
            Criar conta
          </button>
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        {mode === "signup" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs font-medium text-white/70">
              Nome da empresa
              <input
                type="text"
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                placeholder="Sua empresa"
                autoComplete="organization"
                required
                className={inputClass}
              />
            </label>
            <label className="block text-xs font-medium text-white/70">
              Seu nome
              <input
                type="text"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Como podemos chamar você?"
                autoComplete="name"
                className={inputClass}
              />
            </label>
          </div>
        )}

        <label className="block text-xs font-medium text-white/70">
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="voce@empresa.com"
            autoComplete="email"
            required
            className={inputClass}
          />
        </label>

        {mode !== "forgot" && (
          <div>
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="auth-password" className="text-xs font-medium text-white/70">
                Senha
              </label>
              {mode === "signin" && (
                <button
                  type="button"
                  onClick={() => changeMode("forgot")}
                  className="text-xs font-medium text-violet-200 transition hover:text-white"
                >
                  Esqueci minha senha
                </button>
              )}
            </div>
            <div className="relative">
              <input
                id="auth-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Mínimo de 6 caracteres"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                minLength={6}
                required
                className={`${inputClass} pr-12`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((show) => !show)}
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                className="absolute bottom-1 right-1 flex h-10 w-10 items-center justify-center rounded-full text-white/45 transition hover:bg-white/10 hover:text-white"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-2xl border border-red-300/20 bg-red-300/10 px-4 py-3 text-xs leading-5 text-red-100"
          >
            {error}
          </p>
        )}
        {info && (
          <p
            role="status"
            className="rounded-2xl border border-violet-300/20 bg-violet-300/10 px-4 py-3 text-xs leading-5 text-violet-100"
          >
            {info}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="group mt-1 flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-[#14101a] shadow-[0_12px_32px_rgba(0,0,0,0.3)] transition hover:bg-[#f5edfc] disabled:cursor-wait disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {mode === "signin"
            ? "Entrar na plataforma"
            : mode === "signup"
              ? "Criar minha conta"
              : "Enviar link de recuperação"}
          {!loading && (
            <ArrowRight
              className="h-4 w-4 transition-transform group-hover:translate-x-1"
              aria-hidden="true"
            />
          )}
        </button>
      </form>
    </div>
  );
}

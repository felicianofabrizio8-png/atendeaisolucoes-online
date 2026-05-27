import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Sparkles,
  MessageCircle,
  Check,
  ArrowRight,
  ArrowLeft,
  Phone,
  Send,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/onboarding/whatsapp")({
  head: () => ({
    meta: [
      { title: "Conectar WhatsApp — Assistente guiado" },
      {
        name: "description",
        content:
          "Conecte o WhatsApp Business API oficial da Meta em poucos passos.",
      },
    ],
  }),
  component: OnboardingWhatsApp,
});

type StepId = "welcome" | "connect" | "choose" | "test";

const STEPS: { id: StepId; title: string; subtitle: string }[] = [
  { id: "welcome", title: "Bem-vindo", subtitle: "Vamos conectar seu WhatsApp" },
  { id: "connect", title: "Conectar com Meta", subtitle: "Autorize o acesso oficial" },
  { id: "choose", title: "Escolher número", subtitle: "Selecione a linha WhatsApp" },
  { id: "test", title: "Teste de envio", subtitle: "Confirme que está funcionando" },
];

function OnboardingWhatsApp() {
  const [stepIndex, setStepIndex] = useState(0);
  const [selectedNumber, setSelectedNumber] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const isFirst = stepIndex === 0;

  const canAdvance =
    (step.id === "welcome") ||
    (step.id === "connect" && connected) ||
    (step.id === "choose" && !!selectedNumber) ||
    (step.id === "test");

  const handleConnect = () => {
    console.log("[onboarding] click Conectar com Meta (mock)");
    setConnecting(true);
    setTimeout(() => {
      setConnecting(false);
      setConnected(true);
    }, 900);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="border-b border-border/60 bg-card/40 backdrop-blur-sm">
        <div className="mx-auto max-w-3xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-primary/10 text-primary inline-flex items-center justify-center">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold">Assistente guiado</span>
          </div>
          <Link
            to="/configuracoes"
            className="text-xs text-muted-foreground hover:text-foreground transition"
          >
            Sair do assistente
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        {/* Stepper */}
        <ol className="flex items-center gap-2 mb-8">
          {STEPS.map((s, i) => {
            const done = i < stepIndex;
            const current = i === stepIndex;
            return (
              <li key={s.id} className="flex items-center gap-2 flex-1">
                <div
                  className={cn(
                    "h-7 w-7 rounded-full inline-flex items-center justify-center text-[11px] font-semibold border transition-colors",
                    done && "bg-primary text-primary-foreground border-primary",
                    current && "bg-primary/10 text-primary border-primary",
                    !done && !current &&
                      "bg-muted text-muted-foreground border-border",
                  )}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </div>
                <div className="hidden sm:block min-w-0">
                  <div
                    className={cn(
                      "text-[11px] font-medium truncate",
                      current ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {s.title}
                  </div>
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className={cn(
                      "h-px flex-1 mx-1",
                      done ? "bg-primary" : "bg-border",
                    )}
                  />
                )}
              </li>
            );
          })}
        </ol>

        <section className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="px-6 pt-6 pb-2">
            <h1 className="text-lg font-semibold">{step.title}</h1>
            <p className="text-sm text-muted-foreground">{step.subtitle}</p>
          </div>
          <div className="px-6 py-6">
            {step.id === "welcome" && <StepWelcome />}
            {step.id === "connect" && (
              <StepConnect
                connecting={connecting}
                connected={connected}
                onConnect={handleConnect}
              />
            )}
            {step.id === "choose" && (
              <StepChoose
                selected={selectedNumber}
                onSelect={(id) => {
                  console.log("[onboarding] selected number (mock)", id);
                  setSelectedNumber(id);
                }}
              />
            )}
            {step.id === "test" && (
              <StepTest
                phone={testPhone}
                onChange={setTestPhone}
                onSend={() =>
                  console.log("[onboarding] enviar teste (mock)", { testPhone })
                }
              />
            )}
          </div>

          {/* Footer nav */}
          <div className="px-6 py-4 border-t border-border flex items-center justify-between">
            <button
              type="button"
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
              disabled={isFirst}
              className={cn(
                "inline-flex items-center gap-1.5 text-xs font-medium rounded-md px-3 py-2 transition",
                isFirst
                  ? "text-muted-foreground/50 cursor-not-allowed"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Voltar
            </button>

            {isLast ? (
              <button
                type="button"
                onClick={() => {
                  console.log("[onboarding] concluir (mock)");
                }}
                className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground px-4 py-2 hover:opacity-90 transition"
              >
                Concluir <Check className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                disabled={!canAdvance}
                onClick={() => setStepIndex((i) => Math.min(STEPS.length - 1, i + 1))}
                className={cn(
                  "inline-flex items-center gap-1.5 text-xs font-semibold rounded-md px-4 py-2 transition",
                  canAdvance
                    ? "bg-primary text-primary-foreground hover:opacity-90"
                    : "bg-muted text-muted-foreground cursor-not-allowed",
                )}
              >
                Continuar <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </section>

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          Este assistente ainda está em modo demonstração — nenhum dado real é
          enviado ou salvo.
        </p>
      </main>
    </div>
  );
}

/* ---------------- Steps ---------------- */

function StepWelcome() {
  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-gradient-to-br from-primary/10 to-transparent border border-primary/20 p-5">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/15 text-primary inline-flex items-center justify-center shrink-0">
            <MessageCircle className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold mb-1">
              Conecte o WhatsApp oficial da Meta
            </h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Em poucos passos sua empresa estará pronta para receber e responder
              mensagens dentro do sistema, com a API oficial homologada pela Meta.
            </p>
          </div>
        </div>
      </div>

      <ul className="grid sm:grid-cols-3 gap-3">
        <Feature icon={<ShieldCheck className="h-4 w-4" />} title="Oficial e seguro" desc="Selo Business verificado." />
        <Feature icon={<MessageCircle className="h-4 w-4" />} title="Inbox unificado" desc="Conversas direto no app." />
        <Feature icon={<Sparkles className="h-4 w-4" />} title="Setup guiado" desc="Sem complicação técnica." />
      </ul>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <li className="rounded-lg border border-border bg-background p-3">
      <div className="h-7 w-7 rounded-md bg-muted text-foreground inline-flex items-center justify-center mb-2">
        {icon}
      </div>
      <div className="text-xs font-semibold">{title}</div>
      <div className="text-[11px] text-muted-foreground">{desc}</div>
    </li>
  );
}

function StepConnect({
  connecting,
  connected,
  onConnect,
}: {
  connecting: boolean;
  connected: boolean;
  onConnect: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-background p-5 text-center">
        <div className="mx-auto h-12 w-12 rounded-full bg-[#1877F2]/10 text-[#1877F2] inline-flex items-center justify-center mb-3">
          <MessageCircle className="h-6 w-6" />
        </div>
        <h3 className="text-sm font-semibold mb-1">Login com a Meta</h3>
        <p className="text-xs text-muted-foreground mb-4 max-w-sm mx-auto">
          Você será direcionado para autorizar nossa aplicação no Facebook
          Business. Tenha em mãos o acesso de administrador da sua página.
        </p>

        {connected ? (
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-[var(--status-ok)]/10 text-[var(--status-ok)] px-3 py-2">
            <Check className="h-3.5 w-3.5" /> Conta Meta conectada (mock)
          </div>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            disabled={connecting}
            className="inline-flex items-center gap-2 text-xs font-semibold rounded-md bg-[#1877F2] text-white px-4 py-2.5 hover:opacity-90 transition disabled:opacity-60"
          >
            {connecting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Conectando…
              </>
            ) : (
              <>Continuar com Meta</>
            )}
          </button>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground text-center">
        Não compartilhamos sua senha. A autorização acontece direto com a Meta.
      </p>
    </div>
  );
}

const MOCK_NUMBERS = [
  { id: "1", name: "Atendimento Principal", phone: "+55 11 98765-4321", verified: true },
  { id: "2", name: "Vendas SP", phone: "+55 11 97654-3210", verified: true },
  { id: "3", name: "Suporte", phone: "+55 11 96543-2109", verified: false },
];

function StepChoose({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Encontramos os números abaixo na sua conta Business. Selecione qual será
        usado neste app.
      </p>
      <ul className="space-y-2">
        {MOCK_NUMBERS.map((n) => {
          const isSelected = selected === n.id;
          return (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => onSelect(n.id)}
                className={cn(
                  "w-full text-left rounded-lg border p-3 flex items-center gap-3 transition",
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border bg-background hover:border-foreground/20",
                )}
              >
                <div
                  className={cn(
                    "h-9 w-9 rounded-md inline-flex items-center justify-center",
                    isSelected
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground",
                  )}
                >
                  <Phone className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{n.name}</div>
                  <div className="text-[11px] text-muted-foreground">{n.phone}</div>
                </div>
                {n.verified && (
                  <span className="text-[10px] font-semibold uppercase tracking-wide rounded bg-[var(--status-ok)]/10 text-[var(--status-ok)] px-1.5 py-0.5">
                    Verificado
                  </span>
                )}
                <div
                  className={cn(
                    "h-4 w-4 rounded-full border inline-flex items-center justify-center",
                    isSelected
                      ? "bg-primary border-primary text-primary-foreground"
                      : "border-border",
                  )}
                >
                  {isSelected && <Check className="h-3 w-3" />}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StepTest({
  phone,
  onChange,
  onSend,
}: {
  phone: string;
  onChange: (v: string) => void;
  onSend: () => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Vamos enviar uma mensagem de teste para confirmar que tudo está
        funcionando. Use o seu próprio número.
      </p>

      <div className="rounded-xl border border-border bg-background p-4 space-y-3">
        <label className="block">
          <span className="text-[11px] font-medium text-muted-foreground">
            Número de destino
          </span>
          <input
            type="tel"
            placeholder="+55 11 90000-0000"
            value={phone}
            onChange={(e) => onChange(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </label>

        <div className="rounded-md bg-muted/50 border border-dashed border-border p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            Pré-visualização
          </div>
          <div className="text-xs leading-relaxed">
            Olá! 👋 Esta é uma mensagem de teste enviada pelo seu novo WhatsApp
            conectado. Se você recebeu, está tudo certo!
          </div>
        </div>

        <button
          type="button"
          onClick={onSend}
          disabled={!phone.trim()}
          className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground px-3 py-2 hover:opacity-90 transition disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" /> Enviar teste
        </button>
      </div>
    </div>
  );
}

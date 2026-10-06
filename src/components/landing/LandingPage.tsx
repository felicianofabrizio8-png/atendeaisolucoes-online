import { useState } from "react";
import { ArrowRight, Check, ChevronRight, Menu, MessageCircle, X } from "lucide-react";
import FUIHeroWithBorders from "@/components/ui/herowith-logos";
import FUIBentoGridDark from "@/components/ui/bento";
import { AuthDialog } from "@/components/auth/AuthDialog";
import "./landing.css";

const navigation = [
  { label: "Vantagens", href: "#vantagens" },
  { label: "Como funciona", href: "#como-funciona" },
  { label: "Plataforma", href: "#plataforma" },
];

function LandingHeader({ onOpenAuth }: { onOpenAuth: (mode: "signin" | "signup") => void }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="absolute inset-x-0 top-0 z-30">
      <nav
        aria-label="Navegação principal"
        className="mx-auto flex h-[76px] max-w-7xl items-center justify-between gap-6 px-5 sm:px-8 lg:grid lg:grid-cols-[1fr_auto_1fr]"
      >
        <a
          href="#inicio"
          aria-label="Atende Ai! — voltar ao início"
          className="inline-flex shrink-0 items-center gap-2.5 rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-300 lg:justify-self-start"
        >
          <img
            src="/icon-64.png"
            alt=""
            width="39"
            height="39"
            className="h-10 w-10 object-contain"
          />
          <span className="text-[19px] font-bold tracking-tight text-white">
            Atende Ai<span className="text-violet-300">!</span>
          </span>
        </a>

        <div className="hidden items-center gap-8 lg:flex lg:justify-self-center">
          {navigation.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-sm font-medium text-white/65 transition hover:text-white focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-300"
            >
              {item.label}
            </a>
          ))}
        </div>

        <div className="hidden items-center gap-3 sm:flex lg:justify-self-end">
          <button
            type="button"
            onClick={() => onOpenAuth("signin")}
            className="rounded-full px-5 py-2.5 text-sm font-semibold text-white/85 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300"
          >
            Entrar
          </button>
          <button
            type="button"
            onClick={() => onOpenAuth("signup")}
            className="rounded-full border border-white/15 bg-white px-5 py-2.5 text-sm font-semibold text-[#14101a] transition hover:bg-[#f5edfc] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300"
          >
            Criar conta
          </button>
        </div>

        <button
          type="button"
          aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
          aria-expanded={menuOpen}
          aria-controls="landing-mobile-menu"
          onClick={() => setMenuOpen((open) => !open)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-white sm:hidden"
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </nav>

      {menuOpen && (
        <div id="landing-mobile-menu" className="bg-[#0d0814] px-5 pb-5 pt-3 sm:hidden">
          {navigation.map((item) => (
            <a
              key={item.href}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              className="block rounded-xl px-3 py-3 text-sm font-medium text-white/80 hover:bg-white/10"
            >
              {item.label}
            </a>
          ))}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onOpenAuth("signin");
              }}
              className="rounded-full border border-white/20 px-4 py-3 text-center text-sm font-semibold text-white"
            >
              Entrar
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onOpenAuth("signup");
              }}
              className="rounded-full bg-white px-4 py-3 text-center text-sm font-semibold text-[#14101a]"
            >
              Criar conta
            </button>
          </div>
        </div>
      )}
    </header>
  );
}

function ConversationPreview() {
  return (
    <div
      className="relative mx-auto w-full max-w-[680px]"
      aria-label="Ilustração da interface do Atendimento 2.0"
    >
      <div
        className="absolute -inset-8 rounded-[3rem] bg-[radial-gradient(ellipse,rgba(112,62,153,0.17),transparent_70%)] blur-2xl"
        aria-hidden="true"
      />
      <div className="relative overflow-hidden rounded-[24px] border border-white/10 bg-black shadow-[0_35px_100px_rgba(0,0,0,0.5)]">
        <div className="flex items-center justify-between gap-3 border-b border-[#292929] bg-[#0b0b0b] px-4 py-3.5 sm:px-5">
          <span className="text-xs font-semibold text-[#d9d9d9]">Atendimento 2.0</span>
          <span className="rounded-full border border-[#383838] px-2.5 py-1 text-[10px] font-medium text-[#a5a5a5]">
            Somente leitura
          </span>
        </div>
        <div className="grid min-h-[385px] grid-cols-[86px_1fr] sm:grid-cols-[210px_1fr]">
          <aside className="border-r border-[#292929] bg-[#111]">
            <div className="border-b border-[#292929] px-3 py-4 sm:px-4">
              <p className="hidden text-[10px] font-semibold uppercase tracking-[0.14em] text-[#aaa] sm:block">
                Atendimento 2.0
              </p>
              <p className="text-xs font-semibold text-white sm:mt-1 sm:text-sm">Conversas</p>
            </div>
            <div className="border-b border-[#292929] bg-[#242424] px-2.5 py-3 sm:px-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#333] text-xs font-semibold text-[#ededed]">
                  M
                </div>
                <div className="hidden min-w-0 sm:block">
                  <div className="truncate text-xs font-semibold text-white">Mariana Costa</div>
                  <div className="mt-0.5 text-[10px] text-[#aaa]">WhatsApp · Quente</div>
                  <div className="mt-1 truncate text-[10px] text-[#888]">
                    Gostaria de saber mais...
                  </div>
                </div>
              </div>
            </div>
            <div className="hidden items-center gap-2 border-b border-[#292929] px-4 py-3.5 text-[#999] sm:flex">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#242424] text-xs">
                RL
              </div>
              <div>
                <div className="text-xs">Rafael Lima</div>
                <div className="mt-0.5 text-[10px]">Instagram · Aguardando</div>
              </div>
            </div>
          </aside>
          <div className="flex min-w-0 flex-col bg-black">
            <div className="flex items-center justify-between gap-2 border-b border-[#292929] px-3 py-4 sm:px-5">
              <div>
                <p className="flex items-center gap-2 text-xs font-semibold text-white sm:text-sm">
                  <MessageCircle
                    className="hidden h-4 w-4 text-[#c9c9c9] sm:block"
                    aria-hidden="true"
                  />
                  Mariana Costa
                </p>
                <p className="mt-1 text-[10px] text-[#999]">WhatsApp · Quente</p>
              </div>
              <span className="hidden rounded-full border border-[#383838] px-2.5 py-1 text-[10px] text-[#aaa] sm:inline-flex">
                Histórico
              </span>
            </div>
            <div className="flex flex-1 flex-col justify-center gap-3 px-3 py-5 sm:px-5">
              <div className="max-w-[92%] self-start rounded-2xl rounded-bl-md border border-[#333] bg-[#191919] px-3 py-2.5 text-[11px] leading-5 text-white sm:max-w-[85%] sm:px-4 sm:text-xs">
                Olá! Gostaria de saber mais sobre as opções para minha casa.
                <span className="mt-1 block text-[10px] text-[#888]">agora</span>
              </div>
              <div className="max-w-[92%] self-end rounded-2xl rounded-br-md bg-[#dfdfdf] px-3 py-2.5 text-[11px] leading-5 text-[#141414] sm:max-w-[85%] sm:px-4 sm:text-xs">
                Claro, Mariana! Posso te ajudar a encontrar a melhor opção.
                <span className="mt-1 block text-[10px] text-[#666]">agora</span>
              </div>
            </div>
            <div className="border-t border-[#292929] px-3 py-3 text-[10px] leading-4 text-[#8f8f8f] sm:px-5">
              Prévia somente leitura do Atendimento 2.0.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LandingPage() {
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const openAuth = (mode: "signin" | "signup") => {
    setAuthMode(mode);
    setAuthOpen(true);
  };

  return (
    <div className="landing-page min-h-screen overflow-x-clip font-sans text-white [scroll-behavior:smooth]">
      <LandingHeader onOpenAuth={openAuth} />
      <main>
        <FUIHeroWithBorders onCreateAccount={() => openAuth("signup")} />

        <section id="vantagens" className="relative bg-black px-5 py-24 sm:px-8 sm:py-32">
          <FUIBentoGridDark />
        </section>

        <section id="plataforma" className="bg-[#170e22] px-5 py-24 sm:px-8 sm:py-32">
          <div className="mx-auto grid max-w-7xl items-center gap-16 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
            <div>
              <span className="text-xs font-semibold uppercase tracking-[0.24em] text-violet-300">
                Tudo em contexto
              </span>
              <h2 className="mt-5 text-balance text-3xl font-semibold tracking-[-0.04em] sm:text-5xl">
                Sua equipe sabe o que responder e o que fazer depois.
              </h2>
              <p className="mt-6 text-base leading-7 text-white/60">
                A central reúne conversas e informações do lead. A IA ajuda a identificar
                oportunidades e sugerir o próximo passo, enquanto sua equipe mantém o controle do
                atendimento.
              </p>
              <div className="mt-8 space-y-4">
                {[
                  "Histórico da conversa em um só lugar",
                  "Sugestões para a próxima resposta",
                  "Prioridades e ações visíveis",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3 text-sm text-white/80">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-300/15 text-violet-300">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                    {item}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => openAuth("signup")}
                className="group mt-9 inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Começar agora{" "}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </button>
            </div>
            <ConversationPreview />
          </div>
        </section>

        <section id="como-funciona" className="bg-black px-5 py-24 sm:px-8 sm:py-32">
          <div className="mx-auto max-w-7xl">
            <div className="mx-auto mb-14 max-w-2xl text-center">
              <span className="text-xs font-semibold uppercase tracking-[0.24em] text-violet-300">
                Uma rotina mais simples
              </span>
              <h2 className="mt-5 text-balance text-3xl font-semibold tracking-[-0.04em] sm:text-5xl">
                Do primeiro “oi” ao próximo negócio.
              </h2>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {[
                {
                  number: "01",
                  title: "Receba",
                  text: "Acompanhe os contatos e mantenha o histórico disponível para a equipe.",
                },
                {
                  number: "02",
                  title: "Entenda",
                  text: "Veja o contexto da conversa e identifique o interesse e a prioridade do lead.",
                },
                {
                  number: "03",
                  title: "Avance",
                  text: "Responda, prepare uma proposta e defina a próxima ação da venda.",
                },
              ].map((step) => (
                <article
                  key={step.number}
                  className="relative rounded-[28px] border border-white/10 bg-white/[0.035] p-7 sm:p-8"
                >
                  <span className="text-sm font-semibold text-violet-300">{step.number}</span>
                  <h3 className="mt-7 text-2xl font-semibold tracking-tight">{step.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-white/55">{step.text}</p>
                  <ChevronRight
                    className="absolute right-7 top-7 h-4 w-4 text-white/25"
                    aria-hidden="true"
                  />
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="px-5 pb-24 sm:px-8 sm:pb-32">
          <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[36px] bg-[radial-gradient(circle_at_85%_20%,rgba(144,82,180,0.18),transparent_35%),linear-gradient(120deg,#120b18,#2c183c_70%,#472760)] px-7 py-16 text-center sm:px-12 sm:py-20">
            <div className="relative">
              <h2 className="mx-auto max-w-3xl text-balance text-3xl font-semibold tracking-[-0.04em] sm:text-5xl">
                Dê à sua equipe um jeito melhor de atender.
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-white/70">
                Crie sua conta e comece a organizar as oportunidades que já chegam até você.
              </p>
              <button
                type="button"
                onClick={() => openAuth("signup")}
                className="group mt-8 inline-flex min-h-13 items-center justify-center gap-2 rounded-full bg-white px-7 py-3 text-sm font-semibold text-[#14101a] transition hover:-translate-y-0.5 hover:bg-[#f5edfc]"
              >
                Criar conta{" "}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 px-5 py-8 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-5 text-sm text-white/45 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <img
              src="/icon-64.png"
              alt=""
              width="28"
              height="28"
              className="h-7 w-7 object-contain"
            />
            <span className="font-semibold text-white/80">Atende Ai!</span>
            <span className="ml-2">Vendas que não esperam.</span>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <a href="/privacy" className="hover:text-white">
              Privacidade
            </a>
            <button type="button" onClick={() => openAuth("signin")} className="hover:text-white">
              Entrar
            </button>
            <a href="#inicio" className="hover:text-white">
              Voltar ao início
            </a>
          </div>
        </div>
      </footer>
      <AuthDialog open={authOpen} mode={authMode} onOpenChange={setAuthOpen} />
    </div>
  );
}

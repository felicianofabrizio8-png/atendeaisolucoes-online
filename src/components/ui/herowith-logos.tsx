import { ArrowDown, ArrowRight } from "lucide-react";

const capabilities = [
  "Atendimento com IA",
  "Conversas organizadas",
  "Leads priorizados",
  "Orçamentos",
  "Follow-up",
  "Visão de resultados",
];

function AnimatedCapabilityCloud() {
  return (
    <div
      className="landing-marquee mx-auto w-full max-w-6xl overflow-hidden py-7"
      aria-label={capabilities.join(", ")}
    >
      <div className="landing-marquee-track flex w-max gap-3">
        {[0, 1].map((copy) => (
          <div key={copy} aria-hidden={copy === 1} className="flex shrink-0 gap-3">
            {capabilities.map((item) => (
              <span
                key={`${copy}-${item}`}
                className="flex h-11 shrink-0 items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-5 text-sm font-medium text-white/75 backdrop-blur-md"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-violet-300" />
                {item}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function FUIHeroWithBorders({ onCreateAccount }: { onCreateAccount: () => void }) {
  return (
    <section
      id="inicio"
      aria-labelledby="landing-title"
      className="relative isolate flex min-h-[820px] flex-col overflow-clip bg-[linear-gradient(180deg,#09060e_0%,#20112d_31%,#61318f_72%,#a06bda_100%)] pt-40 text-white sm:min-h-[850px] sm:pt-48"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[16%] z-0 h-[420px] w-[640px] -translate-x-1/2 rounded-full bg-violet-500/10 blur-[130px]"
      />
      <div
        aria-hidden="true"
        className="landing-horizon pointer-events-none absolute bottom-[-390px] left-1/2 z-0 h-[560px] w-[145%] -translate-x-1/2 rounded-[50%] sm:bottom-[-480px] sm:h-[650px]"
      />

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col items-center px-5 text-center sm:px-8">
        <h1
          id="landing-title"
          className="max-w-5xl text-balance text-[clamp(3rem,7.3vw,6.2rem)] font-semibold leading-[1.02] tracking-[-0.055em]"
        >
          Cada conversa pode virar <span className="landing-heading-gradient">uma venda.</span>
        </h1>
        <p className="mt-7 max-w-2xl text-pretty text-base leading-7 text-white/72 sm:text-lg sm:leading-8">
          Responda mais rápido, organize seus leads e saiba qual é a próxima ação. Uma central de
          atendimento e vendas com IA para sua equipe trabalhar no momento certo.
        </p>

        <div className="mt-10 flex w-full max-w-[410px] flex-col gap-3">
          <button
            type="button"
            onClick={onCreateAccount}
            className="group flex min-h-14 items-center justify-center gap-2 rounded-full bg-white px-7 text-sm font-semibold text-[#14101a] shadow-[0_16px_45px_rgba(8,3,13,0.22)] transition hover:-translate-y-0.5 hover:bg-[#f5edfc] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white sm:text-base"
          >
            Criar minha conta
            <ArrowRight
              className="h-4 w-4 transition-transform group-hover:translate-x-1"
              aria-hidden="true"
            />
          </button>
          <a
            href="#vantagens"
            className="group flex min-h-14 items-center justify-center gap-2 rounded-full border border-white/25 bg-white/[0.07] px-7 text-sm font-semibold text-white backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-white/[0.14] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white sm:text-base"
          >
            Conhecer a plataforma
            <ArrowDown
              className="h-4 w-4 transition-transform group-hover:translate-y-1"
              aria-hidden="true"
            />
          </a>
        </div>

        <div className="mt-auto w-full pt-16 sm:pt-24">
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-white/55">
            Tudo conectado à sua operação
          </p>
          <AnimatedCapabilityCloud />
        </div>
      </div>
    </section>
  );
}

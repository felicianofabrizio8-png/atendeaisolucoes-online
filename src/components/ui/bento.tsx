"use client";

import type { ReactNode } from "react";
import { clsx } from "clsx";
import { motion } from "framer-motion";

type BentoCardProps = {
  className?: string;
  eyebrow: string;
  title: string;
  description: string;
  graphic: ReactNode;
};

export function BentoCard({ className, eyebrow, title, description, graphic }: BentoCardProps) {
  return (
    <motion.article
      initial="idle"
      whileHover="active"
      variants={{ idle: {}, active: {} }}
      className={clsx(
        "group relative flex flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-black shadow-sm ring-1 ring-white/5 [box-shadow:0_-20px_80px_-20px_rgba(134,134,240,0.13)_inset]",
        className,
      )}
    >
      <div className="relative h-[26rem] shrink-0 sm:h-[29rem]" aria-hidden="true">
        {graphic}
        <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/75 to-transparent" />
      </div>
      <div className="relative z-10 -mt-[110px] min-h-[14rem] bg-black/35 px-7 pb-9 pt-8 text-white backdrop-blur-xl sm:px-10">
        <p className="text-sm font-medium text-white/85">{eyebrow}</p>
        <h3 className="mt-1 text-2xl font-medium leading-8 tracking-tight text-white">{title}</h3>
        <p className="mt-2 max-w-[600px] text-sm leading-6 text-white/70">{description}</p>
      </div>
    </motion.article>
  );
}

function BentoGraphic({ src, position = "center" }: { src: string; position?: string }) {
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.035]"
      style={{ objectPosition: position }}
    />
  );
}

export default function FUIBentoGridDark() {
  return (
    <div className="mx-auto max-w-7xl font-sans">
      <div className="max-w-3xl">
        <p className="text-3xl font-semibold tracking-tight text-white sm:text-5xl">Vendas</p>
        <h2 className="mt-2 bg-gradient-to-br from-white via-white/80 to-white/40 bg-clip-text text-2xl font-medium leading-8 tracking-tight text-transparent sm:text-[2rem] sm:leading-10">
          Saiba o que cada cliente precisa. Responda no momento certo.
        </h2>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-4 sm:mt-16 lg:grid-cols-6">
        <BentoCard
          eyebrow="Contexto"
          title="Uma conversa, todo o histórico"
          description="Veja o que já foi dito e registrado sobre cada lead antes de continuar o atendimento."
          graphic={<BentoGraphic src="/landing/bento-context.png" position="center 35%" />}
          className="lg:col-span-3 lg:rounded-tl-[2rem]"
        />
        <BentoCard
          eyebrow="Prioridade"
          title="Encontre as oportunidades certas"
          description="Identifique o interesse de cada lead e concentre sua equipe nas conversas que precisam avançar."
          graphic={<BentoGraphic src="/landing/bento-insights.png" />}
          className="lg:col-span-3 lg:rounded-tr-[2rem]"
        />
        <BentoCard
          eyebrow="Canais"
          title="Atenda em um só lugar"
          description="Acompanhe contatos do WhatsApp, Instagram e Facebook sem perder o fio da conversa."
          graphic={<BentoGraphic src="/landing/bento-channels.png" />}
          className="lg:col-span-2 lg:rounded-bl-[2rem]"
        />
        <BentoCard
          eyebrow="Próximo passo"
          title="Da conversa à proposta"
          description="Crie orçamentos com seus produtos e organize retornos para manter a negociação em movimento."
          graphic={<BentoGraphic src="/landing/bento-quotes.png" />}
          className="lg:col-span-2"
        />
        <BentoCard
          eyebrow="Inteligência"
          title="IA ao lado da sua equipe"
          description="Receba sugestões de resposta e informações úteis para atender com mais contexto e controle."
          graphic={<BentoGraphic src="/landing/bento-ai.png" />}
          className="lg:col-span-2 lg:rounded-br-[2rem]"
        />
      </div>
    </div>
  );
}

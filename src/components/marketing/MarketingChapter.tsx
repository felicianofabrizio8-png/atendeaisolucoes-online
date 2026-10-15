import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MarketingSection } from "./MarketingWorkspace";

const chapters = {
  generator: {
    title: "Sua ideia merece ganhar forma.",
    steps: ["Conte sua ideia", "Escolha as imagens", "Dê o seu toque"],
  },
  approvals: {
    title: "O último toque é seu.",
    steps: ["Leia a mensagem", "Ajuste os detalhes", "Aprove para agendar"],
  },
  schedule: {
    title: "Presença tem seu tempo.",
    steps: ["Veja as datas", "Confira os canais", "Organize os próximos passos"],
  },
  publisher: {
    title: "Suas ideias, lá fora.",
    steps: ["Acompanhe a fila", "Confira os envios", "Consulte o histórico"],
  },
  library: {
    title: "Tudo começa com um olhar.",
    steps: ["Envie suas mídias", "Encontre seus produtos", "Use nas campanhas"],
  },
  videos: {
    title: "Dê play no que você criou.",
    steps: ["Acompanhe a criação", "Veja seus vídeos", "Reproduza quando quiser"],
  },
  audio: {
    title: "Encontre o seu ritmo.",
    steps: ["Explore as trilhas", "Ouça antes de escolher", "Adicione sua música"],
  },
  promotions: {
    title: "Uma boa oferta pede destaque.",
    steps: ["Defina o benefício", "Conte as condições", "Use ao criar"],
  },
  knowledge: {
    title: "O que faz você ser você?",
    steps: ["Apresente sua marca", "Encontre sua voz", "Ensine à Lume"],
  },
} as const;

export function MarketingChapter({
  section,
  description,
  onBack,
}: {
  section: Exclude<MarketingSection, "dashboard">;
  description: string;
  onBack: () => void;
}) {
  const chapter = chapters[section];
  return (
    <header className="mkt-chapter">
      <div className="mkt-chapter-copy">
        <Button size="sm" variant="ghost" className="mkt-back" onClick={onBack}>
          <ArrowLeft /> Visão geral
        </Button>
        <h2>{chapter.title}</h2>
        <p>{description}</p>
      </div>
      <ol className="mkt-chapter-flow" aria-label="Como funciona">
        {chapter.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </header>
  );
}

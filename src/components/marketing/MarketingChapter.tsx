import { ArrowLeft, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketingArtwork } from "./MarketingArtwork";
import type { MarketingSection } from "./MarketingWorkspace";

const chapters = {
  generator: {
    n: "01",
    label: "CRIAÇÃO",
    title: "Sua ideia merece ganhar forma.",
    steps: ["Conte sua ideia", "Escolha as imagens", "Dê o seu toque"],
    art: "capsule",
  },
  approvals: {
    n: "02",
    label: "CURADORIA",
    title: "O último toque é seu.",
    steps: ["Leia a mensagem", "Ajuste os detalhes", "Aprove para agendar"],
    art: "prism",
  },
  schedule: {
    n: "03",
    label: "AGENDA EDITORIAL",
    title: "Presença tem seu tempo.",
    steps: ["Veja as datas", "Confira os canais", "Organize os próximos passos"],
    art: "orbit",
  },
  publisher: {
    n: "04",
    label: "PUBLICAÇÃO",
    title: "Suas ideias, lá fora.",
    steps: ["Acompanhe a fila", "Confira os envios", "Consulte o histórico"],
    art: "wave",
  },
  library: {
    n: "05",
    label: "ACERVO VISUAL",
    title: "Tudo começa com um olhar.",
    steps: ["Envie suas mídias", "Encontre seus produtos", "Use nas campanhas"],
    art: "bloom",
  },
  videos: {
    n: "06",
    label: "SALA DE EXIBIÇÃO",
    title: "Dê play no que você criou.",
    steps: ["Acompanhe a criação", "Veja seus vídeos", "Reproduza quando quiser"],
    art: "ribbon",
  },
  audio: {
    n: "07",
    label: "IDENTIDADE SONORA",
    title: "Encontre o seu ritmo.",
    steps: ["Explore as trilhas", "Ouça antes de escolher", "Adicione sua música"],
    art: "wave",
  },
  promotions: {
    n: "08",
    label: "VITRINE DE OFERTAS",
    title: "Uma boa oferta pede destaque.",
    steps: ["Defina o benefício", "Conte as condições", "Use ao criar"],
    art: "orbit",
  },
  knowledge: {
    n: "09",
    label: "DNA DA MARCA",
    title: "O que faz você ser você?",
    steps: ["Apresente sua marca", "Encontre sua voz", "Ensine à Lume"],
    art: "bloom",
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
        <div className="mkt-chapter-top">
          <span className="mkt-eyebrow">
            {chapter.n} / {chapter.label}
          </span>
          <Button size="sm" variant="ghost" onClick={onBack}>
            <ArrowLeft /> Visão geral
          </Button>
        </div>
        <h2>{chapter.title}</h2>
        <p>{description}</p>
        <ol>
          {chapter.steps.map((step, i) => (
            <li key={step}>
              <span>0{i + 1}</span>
              {step}
            </li>
          ))}
        </ol>
      </div>
      <div className="mkt-chapter-art">
        <MarketingArtwork kind={chapter.art} />
        <span>
          {chapter.label}
          <b>
            <Sparkles aria-hidden />
          </b>
        </span>
      </div>
    </header>
  );
}

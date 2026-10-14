import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Sparkles, Heart, Bookmark, MoreHorizontal, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketingArtwork } from "./MarketingArtwork";

export function MarketingHero({ onCreate }: { onCreate: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <section
      ref={ref}
      data-visible={visible}
      className="mkt-hero mkt-card"
      data-lume-light
      aria-label="Inspiração para suas campanhas"
    >
      <div className="lume-aurora" aria-hidden>
        <i />
        <i />
      </div>
      <div className="mkt-hero-copy">
        <span className="mkt-eyebrow">
          <span className="mkt-live-dot" /> CRIATIVIDADE, EM OUTRA FREQUÊNCIA
        </span>
        <h2>
          DÊ LUZ À SUA
          <br />
          <em>
            PRÓXIMA
            <br />
            IDEIA.
          </em>
        </h2>
        <p>
          Da primeira ideia ao próximo post. Crie com Lume, dê seu toque e faça sua mensagem
          encontrar o mundo.
        </p>
        <Button className="mkt-primary mkt-hero-button" onClick={onCreate}>
          <Sparkles /> Criar com Lume <ArrowUpRight />
        </Button>
        <span className="mkt-hero-note">Sua ideia. Sua voz. A decisão continua sendo sua.</span>
      </div>
      <div className="mkt-poster-composition" aria-hidden="true">
        <div className="mkt-inspiration-card mkt-inspiration-lime">
          <div className="mkt-poster-label">
            <span>01 / DESPERTAR</span>
            <MoreHorizontal />
          </div>
          <div className="lume-poster-optics lume-fluted" />
          <strong>
            Além
            <br />
            do
            <br />
            <em>óbvio.</em>
          </strong>
          <small>UMA IDEIA MUDA TUDO.</small>
          <div className="lume-social-footer">
            <Heart />
            <Send />
            <Bookmark />
          </div>
        </div>
        <div className="mkt-inspiration-card mkt-inspiration-violet">
          <div className="mkt-poster-label">
            <span>02 / CONECTAR</span>
            <MoreHorizontal />
          </div>
          <MarketingArtwork kind="signal" />
          <strong>
            Não passe.
            <br />
            <em>Marque.</em>
          </strong>
          <small>FAÇA SUA MENSAGEM FICAR.</small>
          <div className="lume-social-footer">
            <Heart />
            <Send />
            <Bookmark />
          </div>
        </div>
        <div className="mkt-inspiration-card mkt-inspiration-coral">
          <div className="mkt-poster-label">
            <span>03 / MOVER</span>
            <MoreHorizontal />
          </div>
          <MarketingArtwork kind="ribbon" />
          <strong>
            Feito
            <br />
            para
            <br />
            <em>sentir.</em>
          </strong>
          <small>O PRÓXIMO MOVIMENTO É SEU.</small>
          <div className="lume-social-footer">
            <Heart />
            <Send />
            <Bookmark />
          </div>
        </div>
        <div className="mkt-gallery-caption">
          <span>ESTUDOS DE LUZ / POSSIBILIDADES REAIS</span>
          <span>01 — 03</span>
        </div>
      </div>
    </section>
  );
}

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion";
import {
  ArrowUpRight,
  Bookmark,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Play,
  Send,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketingArtwork } from "./MarketingArtwork";
import { lumeEase } from "./MarketingMotion";

const headline = ["Dê", "luz", "à", "sua", "próxima", "ideia."];

export function MarketingHero({ onCreate }: { onCreate: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [finePointer, setFinePointer] = useState(false);
  const reduce = useReducedMotion() ?? false;
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 110, damping: 20, mass: 0.7 });
  const sy = useSpring(py, { stiffness: 110, damping: 20, mass: 0.7 });

  useEffect(() => {
    if (typeof matchMedia !== "undefined") {
      setFinePointer(matchMedia("(hover: hover) and (pointer: fine)").matches);
    }
    if (!ref.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  const tilt = finePointer && !reduce;
  function move(event: PointerEvent<HTMLElement>) {
    if (!tilt || event.pointerType !== "mouse") return;
    const rect = event.currentTarget.getBoundingClientRect();
    px.set((event.clientX - rect.left) / rect.width - 0.5);
    py.set((event.clientY - rect.top) / rect.height - 0.5);
  }
  function leave() {
    px.set(0);
    py.set(0);
  }

  return (
    <section
      ref={ref}
      data-visible={visible}
      className="mkt-hero"
      aria-label="Criar com a Lume"
      onPointerMove={move}
      onPointerLeave={leave}
    >
      <div className="mkt-aura" aria-hidden>
        <i className="mkt-aura-haze" />
        <i className="mkt-aura-columns" />
        <i className="mkt-aura-arc" />
        <i className="mkt-aura-flutes" />
      </div>
      <div className="mkt-hero-copy">
        <h2>
          <span className="sr-only">{headline.join(" ")}</span>
          {headline.map((word, index) => (
            <motion.span
              aria-hidden
              key={word}
              className={index >= 4 ? "mkt-hero-soft" : undefined}
              initial={reduce ? false : { opacity: 0, y: 18, filter: "blur(8px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 0.9, ease: lumeEase, delay: 0.05 + index * 0.06 }}
            >
              {word}{" "}
            </motion.span>
          ))}
        </h2>
        <motion.p
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: lumeEase, delay: 0.45 }}
        >
          Conte o que você quer divulgar. A Lume sugere textos e vídeos, e você decide o que vai ao
          ar.
        </motion.p>
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: lumeEase, delay: 0.55 }}
        >
          <Button className="mkt-primary mkt-hero-button" onClick={onCreate}>
            <Sparkles /> Criar com Lume <ArrowUpRight />
          </Button>
        </motion.div>
      </div>
      <div className="mkt-posts" aria-hidden="true">
        <PostSlot index={0} sx={sx} sy={sy} reduce={reduce}>
          <span className="mkt-post-drip" />
          <div className="mkt-post-progress">
            <i data-done />
            <i data-live />
            <i />
          </div>
          <strong className="mkt-post-type">
            Além do <span>óbvio.</span>
          </strong>
          <PostFooter />
        </PostSlot>
        <PostSlot index={1} sx={sx} sy={sy} reduce={reduce}>
          <div className="mkt-post-head">
            <span className="mkt-post-avatar" />
            <MoreHorizontal />
          </div>
          <MarketingArtwork kind="lens" tone="dark" className="mkt-post-object" />
          <strong className="mkt-post-type">
            Feito para <span>ficar.</span>
          </strong>
          <PostFooter />
        </PostSlot>
        <PostSlot index={2} sx={sx} sy={sy} reduce={reduce}>
          <span className="mkt-post-bands">
            <i />
            <i />
            <i />
          </span>
          <div className="mkt-post-head">
            <span className="mkt-post-avatar" />
            <MoreHorizontal />
          </div>
          <span className="mkt-post-play">
            <Play />
          </span>
          <strong className="mkt-post-type">
            Sua voz,
            <br />
            <span>em movimento.</span>
          </strong>
          <div className="mkt-post-reel">
            <i />
          </div>
        </PostSlot>
      </div>
    </section>
  );
}

/** Pointer depth per card: the front card moves most, so the trio reads as layered. */
const depth = [9, 16, 7];

function PostSlot({
  index,
  sx,
  sy,
  reduce,
  children,
}: {
  index: number;
  sx: MotionValue<number>;
  sy: MotionValue<number>;
  reduce: boolean;
  children: ReactNode;
}) {
  const d = depth[index];
  // Só deslocamento 2D, em pixels inteiros: inclinação 3D, escala e desfoque fazem o
  // navegador rasterizar o card como textura e reamostrar o texto, que fica borrado.
  const x = useTransform(sx, (v) => Math.round(v * d * 1.6));
  const y = useTransform(sy, (v) => Math.round(v * d * 1.1));
  return (
    <motion.div className={`mkt-post-slot mkt-post-slot-${index}`} style={{ x, y }}>
      {/* A flutuação envolve a inclinação: o card é pintado já inclinado, com nitidez. */}
      <div className="mkt-post-float">
        <div className="mkt-post-base">
          <motion.div
            className="mkt-post-enter"
            initial={reduce ? false : { opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              type: "spring",
              stiffness: 90,
              damping: 17,
              mass: 0.9,
              delay: reduce ? 0 : 0.18 + [1, 0, 2][index] * 0.13,
            }}
          >
            <motion.article
              className="mkt-post"
              whileHover={reduce ? undefined : { y: -10 }}
              transition={{ type: "spring", stiffness: 260, damping: 24 }}
            >
              <span className="mkt-post-glow" />
              {children}
            </motion.article>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}

function PostFooter() {
  return (
    <div className="mkt-post-footer">
      <Heart />
      <MessageCircle />
      <Send />
      <Bookmark />
    </div>
  );
}

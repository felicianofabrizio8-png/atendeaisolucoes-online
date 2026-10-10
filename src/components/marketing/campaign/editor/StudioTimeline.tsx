// Timeline compacta do estúdio: uma faixa por cena, com largura proporcional
// ao tempo dela (o mesmo do render), agulha de reprodução e marcação do
// encerramento da marca.

import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TRANSITIONS } from "@/lib/marketing/video-editor/scenes/registry";
import type { TransitionId } from "@/lib/marketing/video-editor/layout.types";
import type { StudioScene } from "./StudioPanels";

interface Props {
  scenes: StudioScene[];
  /** Segundos de cada cena (mesma ordem de `scenes`). */
  durations: number[];
  duration: number;
  time: number;
  playing: boolean;
  selectedIndex: number;
  transition: TransitionId;
  /** Segundos finais em que o worker mostra a tela da marca (0 = não há). */
  outroSeconds: number;
  onTogglePlay: () => void;
  onSelectScene: (index: number) => void;
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function StudioTimeline({
  scenes,
  durations,
  duration,
  time,
  playing,
  selectedIndex,
  transition,
  outroSeconds,
  onTogglePlay,
  onSelectScene,
}: Props) {
  const secondsOf = (i: number) => durations[i] ?? duration / scenes.length;
  return (
    <div className="flex shrink-0 items-center gap-3 border-t bg-muted/30 px-3 py-1.5">
      <Button size="icon" variant="outline" className="h-9 w-9 shrink-0 rounded-full" aria-label={playing ? "Pausar prévia" : "Reproduzir prévia"} onClick={onTogglePlay}>
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>
      <div className="w-[76px] shrink-0 text-xs tabular-nums text-muted-foreground">
        {clock(time)} / {clock(duration)}
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex h-11 gap-0.5 overflow-hidden rounded-md" role="group" aria-label="Cenas do vídeo">
          {scenes.map((scene, i) => (
            <button
              key={scene.key}
              type="button"
              aria-pressed={i === selectedIndex}
              aria-label={`Cena ${i + 1}, ${secondsOf(i).toFixed(1)} segundos`}
              onClick={() => onSelectScene(i)}
              className={`relative min-w-0 overflow-hidden bg-muted text-left ${i === selectedIndex ? "ring-2 ring-inset ring-primary" : ""}`}
              style={{ flex: `${secondsOf(i)} 1 0%` }}
            >
              {/* Miniatura inteira (não um recorte) à esquerda; rótulo ao lado. */}
              <span className="absolute inset-0 flex items-center gap-1.5 px-1">
                {scene.url && (
                  <img
                    src={scene.url}
                    alt=""
                    loading="lazy"
                    className="h-9 w-9 shrink-0 rounded-sm bg-black/30 object-contain"
                    onError={(e) => {
                      e.currentTarget.style.visibility = "hidden";
                    }}
                  />
                )}
                <span className="min-w-0 truncate text-[11px] leading-tight">
                  <span className="font-medium">Cena {i + 1}</span>
                  <span className="text-muted-foreground"> · {secondsOf(i).toFixed(1)} s</span>
                </span>
              </span>
            </button>
          ))}
        </div>
        {outroSeconds > 0 && (
          <div
            className="pointer-events-none absolute inset-y-0 right-0 rounded-r-md border-l-2 border-dashed border-foreground/60"
            style={{
              width: `${Math.min(100, (outroSeconds / duration) * 100)}%`,
              // Hachura: marca o trecho sem cobrir o rótulo da cena.
              background: "repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, currentColor 22%, transparent) 5px 7px)",
            }}
            role="img"
            aria-label={`Encerramento com a marca: últimos ${outroSeconds} segundos`}
            title="Nos segundos finais o vídeo mostra a tela de encerramento com a marca."
          />
        )}
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-primary"
          style={{ left: `${Math.min(100, (time / duration) * 100)}%` }}
        />
      </div>
      <div className="hidden shrink-0 text-xs text-muted-foreground xl:block">
        {scenes.length > 1 ? `Transição: ${TRANSITIONS[transition]}` : "1 cena"}
      </div>
    </div>
  );
}

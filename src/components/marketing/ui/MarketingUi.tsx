// Peças visuais compartilhadas do Marketing IA: chips, miniaturas de mídia
// real e a prévia em formato de celular.

import type { ReactNode } from "react";
import { Image as ImageIcon, Play } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MediaPreview {
  url: string;
  kind: "image" | "video";
}

export function Chip({
  active,
  onClick,
  children,
  count,
  tone,
  className,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  count?: number | null;
  tone?: "danger";
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm transition-colors",
        active ? "border-foreground bg-foreground text-background font-medium" : "bg-card text-foreground hover:bg-muted",
        className,
      )}
    >
      {children}
      {typeof count === "number" && (
        <span
          className={cn(
            "rounded-full px-1.5 text-xs tabular-nums",
            active ? "bg-background/20" : tone === "danger" && count > 0 ? "bg-destructive/20 text-destructive" : "bg-muted text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export function ChipRow({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <div role="group" aria-label={label} className={cn("flex min-w-0 max-w-full gap-2 overflow-x-auto pb-1", className)}>
      {children}
    </div>
  );
}

/** Miniatura de uma mídia real (foto ou primeiro quadro do vídeo). */
export function MediaThumb({
  preview,
  alt = "",
  className,
  children,
}: {
  preview: MediaPreview | null | undefined;
  alt?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("relative overflow-hidden rounded-xl bg-muted", className)}>
      {!preview?.url ? (
        <div className="absolute inset-0 grid place-items-center text-muted-foreground">
          <ImageIcon className="h-6 w-6" aria-hidden />
        </div>
      ) : preview.kind === "video" ? (
        <>
          <video src={`${preview.url}#t=0.1`} className="absolute inset-0 h-full w-full object-cover" muted playsInline preload="metadata" />
          <span className="absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white">
            <Play className="h-3 w-3 fill-current" aria-hidden />
          </span>
        </>
      ) : (
        <img src={preview.url} alt={alt} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
      )}
      {children}
    </div>
  );
}

/** Moldura de celular para a prévia de Feed (4:5) ou Story (9:16). */
export function PhonePreview({
  format,
  account,
  caption,
  children,
}: {
  format: "feed" | "story";
  account: string;
  caption?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[280px] overflow-hidden rounded-[28px] border-[6px] border-foreground/90 bg-black text-white shadow-lg">
      <div className="flex items-center gap-2 bg-neutral-900 px-3 py-2 text-xs font-semibold">
        <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
        <span className="truncate">{account}</span>
      </div>
      <div className="relative w-full overflow-hidden bg-neutral-800" style={{ aspectRatio: format === "story" ? "9 / 16" : "4 / 5" }}>
        {children}
      </div>
      {format === "feed" && (
        <div className="max-h-28 overflow-hidden whitespace-pre-wrap bg-neutral-900 px-3 py-2 text-xs leading-snug">
          {caption?.trim() ? caption : <span className="text-white/50">A legenda aparece aqui.</span>}
        </div>
      )}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">{children}</div>;
}

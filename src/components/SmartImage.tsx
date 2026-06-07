// SmartImage — renderização segura e padronizada de imagens do storage.
//
// Resolve automaticamente paths/URLs do bucket product-images para signed URLs
// (com cache via getSignedImageUrl) e mantém compatibilidade com:
//   - URLs públicas legadas (https://.../object/public/product-images/...)
//   - URLs externas (https://...) — passa direto
//   - blob:/data: URLs (previews locais) — passa direto
//   - paths puros ("companyId/foo.jpg")
//
// UX:
//   - skeleton shimmer enquanto resolve/baixa
//   - fade-in suave ao carregar
//   - placeholder elegante em erro
//   - aspectRatio para evitar layout shift
//   - retry simples (1x) em erro de rede
//
// Não impacta inbox/WhatsApp/Meta — uso apenas opt-in nos componentes migrados.

import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSignedImageUrl, getSignedImageThumbUrl } from "@/lib/storage";

export interface SmartImageProps {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  /** Classe aplicada ao wrapper (controla aspect-ratio, rounded, etc). */
  wrapperClassName?: string;
  /** CSS aspect-ratio para evitar layout shift. Ex: "1/1", "16/9". */
  aspectRatio?: string;
  /** Conteúdo customizado quando não há src ou ocorre erro. */
  fallback?: React.ReactNode;
  /** Se true, força carregamento imediato (sem lazy). */
  priority?: boolean;
  /** Largura desejada para thumbnail (px). Quando setado, usa Image Transform do Storage. */
  thumbWidth?: number;
  /** Qualidade jpeg/webp (1-100). Default 70 quando thumbWidth é setado. */
  thumbQuality?: number;
  onClick?: () => void;
}

function needsResolution(src: string): boolean {
  if (src.startsWith("blob:") || src.startsWith("data:")) return false;
  // URLs externas (não-supabase) passam direto
  if (src.startsWith("http") && !src.includes("/product-images/")) return false;
  return true;
}

export function SmartImage({
  src,
  alt = "",
  className,
  wrapperClassName,
  aspectRatio,
  fallback,
  priority,
  thumbWidth,
  thumbQuality,
  onClick,
}: SmartImageProps) {
  const [resolved, setResolved] = useState<string | null>(() => {
    if (!src) return null;
    return needsResolution(src) ? null : src;
  });
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const retriedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setErrored(false);
    retriedRef.current = false;
    if (!src) {
      setResolved(null);
      return;
    }
    if (!needsResolution(src)) {
      setResolved(src);
      return;
    }
    setResolved(null);
    (async () => {
      try {
        const url = thumbWidth
          ? await getSignedImageThumbUrl(src, { width: thumbWidth, quality: thumbQuality })
          : await getSignedImageUrl(src);
        if (!cancelled) setResolved(url);
      } catch {
        if (!cancelled) {
          setResolved(src);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src, thumbWidth, thumbQuality]);

  const handleError = async () => {
    if (!retriedRef.current && src && needsResolution(src)) {
      retriedRef.current = true;
      try {
        const url = await getSignedImageUrl(src);
        setResolved(url + (url.includes("?") ? "&" : "?") + "_r=" + Date.now());
        return;
      } catch {
        /* fallthrough */
      }
    }
    setErrored(true);
  };

  const showSkeleton = !!src && !errored && (!resolved || !loaded);
  const showFallback = !src || errored;

  return (
    <div
      className={cn("relative overflow-hidden bg-muted/40", wrapperClassName)}
      style={aspectRatio ? { aspectRatio } : undefined}
      onClick={onClick}
    >
      {showSkeleton && (
        <div className="absolute inset-0 bg-gradient-to-r from-muted/40 via-muted/70 to-muted/40 bg-[length:200%_100%] animate-[smart-img-shimmer_1.4s_ease-in-out_infinite]" />
      )}

      {showFallback ? (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          {fallback ?? <ImageIcon className="h-6 w-6 opacity-60" />}
        </div>
      ) : resolved ? (
        <img
          src={resolved}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={handleError}
          className={cn(
            "w-full h-full object-cover transition-opacity duration-300",
            loaded ? "opacity-100" : "opacity-0",
            className,
          )}
        />
      ) : null}
    </div>
  );
}

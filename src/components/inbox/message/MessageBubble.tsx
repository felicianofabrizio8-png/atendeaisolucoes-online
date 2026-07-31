import { getUnsupportedPlaceholder } from "@/lib/inbox/unsupported-placeholder";
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { timeAgo, type Message } from "@/data/mock";
import { editMessage, deleteMessage } from "@/data/leadRepo";
import { cn } from "@/lib/utils";
import { FileText, Loader2, X, MoreVertical, Pencil, Trash2, Check, Copy, Eye, Download, Play, Pause, Mic, Forward, Reply } from "lucide-react";
import { ForwardMessageDialog, type ForwardMessageTarget } from "@/components/ForwardMessageDialog";
import { getSignedImageUrl, getSignedWaMediaUrl, getSignedMediaUrl } from "@/lib/storage";
import { toast } from "sonner";
import { MessagesContext, VirtuosoScrollContext, ReplyComposeContext } from "@/lib/inbox/contexts";
import { markInboxScrollIntent, traceInboxScroll } from "@/lib/inbox/scroll-trace";

const IMAGE_URL_RE = /(https?:\/\/[^\s]+?\.(?:jpg|jpeg|png|webp|gif)(?:\?[^\s]*)?)/gi;

type MediaKind = "image" | "video" | "audio" | "document" | "sticker";

function useResolvedMediaSrc(opts: {
  path?: string | null;
  url?: string | null;
  bucket?: string | null;
}): string | null {
  const { path, url, bucket } = opts;
  const [resolved, setResolved] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (path) {
        // Quando um bucket explícito é informado (mídia do agente em
        // `product-images`, por exemplo), assinamos contra esse bucket.
        // Default mantém o comportamento atual (whatsapp-media).
        const r = bucket
          ? await getSignedMediaUrl(bucket, path)
          : await getSignedWaMediaUrl(path);
        if (!cancelled) setResolved(r);
        return;
      }
      if (!url) {
        setResolved(null);
        return;
      }
      if (url.startsWith("blob:") || url.startsWith("data:")) {
        setResolved(url);
        return;
      }
      const r = await getSignedImageUrl(url);
      if (!cancelled) setResolved(r);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [path, url, bucket]);
  return resolved;
}

function DownloadButton({
  href,
  filename,
  className,
}: {
  href: string | null;
  filename?: string | null;
  className?: string;
}) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      download={filename ?? true}
      className={cn(
        "inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline",
        className,
      )}
      aria-label="Baixar mídia"
    >
      <Download className="size-3.5" />
      Baixar
    </a>
  );
}

function ImagePreview({
  path,
  url,
  filename,
  bucket,
}: {
  path?: string | null;
  url?: string | null;
  filename?: string | null;
  bucket?: string | null;
}) {
  const [error, setError] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const display = useResolvedMediaSrc({ path, url, bucket });
  if (error) {
    return <span className="text-xs italic opacity-70">Imagem indisponível</span>;
  }
  if (!display) {
    // Placeholder com aspect-ratio 4/3 reservado — evita layout shift quando a URL
    // resolve depois. Mesmo tamanho da reserva pós-load (240×180).
    return (
      <div
        className="rounded-md bg-muted animate-pulse"
        style={{ width: 240, aspectRatio: "4 / 3", maxWidth: "100%" }}
      />
    );
  }
  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setLightbox(true)}
        className="block focus:outline-none focus:ring-2 focus:ring-ring rounded-md"
      >
        {/* width/height atributos reservam aspect-ratio antes do decode
            (browsers usam ratio como hint); w-auto/h-auto ajustam para a
            proporção natural após onLoad. Elimina shift de altura no bubble. */}
        <img
          src={display}
          alt={filename ?? "Imagem"}
          width={240}
          height={180}
          onLoad={(event) => {
            const img = event.currentTarget;
            traceInboxScroll("IMAGE_DECODE", "IMAGE_LOAD", {
              src: display,
              naturalWidth: img.naturalWidth,
              naturalHeight: img.naturalHeight,
              renderedWidth: img.clientWidth,
              renderedHeight: img.clientHeight,
            });
          }}
          onError={() => setError(true)}
          className="rounded-md max-w-full md:max-w-[240px] w-auto h-auto max-h-[50vh] md:max-h-none object-contain cursor-zoom-in bg-muted/40"
          loading="lazy"
          decoding="async"
        />
      </button>
      <DownloadButton href={display} filename={filename} />
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          onClick={() => setLightbox(false)}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setLightbox(false);
            }}
            className="absolute top-4 right-4 text-white/90 hover:text-white"
            aria-label="Fechar"
          >
            <X className="size-6" />
          </button>
          <img
            src={display}
            alt={filename ?? "Imagem ampliada"}
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

function VideoPreview({
  path,
  url,
  filename,
  bucket,
}: {
  path?: string | null;
  url?: string | null;
  filename?: string | null;
  bucket?: string | null;
}) {
  const display = useResolvedMediaSrc({ path, url, bucket });
  if (!display) {
    // Reserva aspect 16/9 (280×158) — evita mudança de altura ao carregar metadata.
    return (
      <div
        className="rounded-md bg-muted animate-pulse"
        style={{ width: 280, aspectRatio: "16 / 9", maxWidth: "100%" }}
      />
    );
  }
  return (
    <div className="space-y-1">
      <video
        src={display}
        controls
        width={280}
        height={158}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          traceInboxScroll("IMAGE_DECODE", "VIDEO_METADATA", {
            src: display,
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            renderedWidth: video.clientWidth,
            renderedHeight: video.clientHeight,
          });
        }}
        className="rounded-md max-w-full md:max-w-[280px] w-auto h-auto max-h-[50vh] bg-black"
        preload="metadata"
      />
      <DownloadButton href={display} filename={filename} />
    </div>
  );
}

// ============================================================================
// WhatsApp-like audio bubble
// ============================================================================
const WA_AUDIO_PLAYED_KEY = "wa-audio-played-v1";

function readPlayedSet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(WA_AUDIO_PLAYED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function markPlayed(id: string) {
  if (typeof window === "undefined") return;
  try {
    const s = readPlayedSet();
    if (s.has(id)) return;
    s.add(id);
    const arr = Array.from(s).slice(-500);
    window.localStorage.setItem(WA_AUDIO_PLAYED_KEY, JSON.stringify(arr));
  } catch {
    /* ignore */
  }
}

// Gera barras deterministicas a partir do id (pseudo-waveform)
function buildWaveform(seed: string, bars = 40): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    const v = Math.abs(h % 100) / 100; // 0..1
    out.push(0.25 + v * 0.75); // 0.25..1
  }
  return out;
}

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const SPEEDS = [1, 1.5, 2] as const;

function WhatsAppAudio({
  path,
  mime,
  filename,
  bucket,
  isAgent,
  messageId,
}: {
  path?: string | null;
  mime?: string | null;
  filename?: string | null;
  bucket?: string | null;
  isAgent: boolean;
  messageId: string;
}) {
  const display = useResolvedMediaSrc({ path, bucket });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [played, setPlayed] = useState<boolean>(() =>
    isAgent ? false : readPlayedSet().has(messageId),
  );

  const waveform = useMemo(() => buildWaveform(messageId), [messageId]);
  const progress = duration > 0 ? Math.min(1, current / duration) : 0;

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.playbackRate = speed;
  }, [speed]);

  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      void a.play().catch(() => {
        /* ignore autoplay errors */
      });
    } else {
      a.pause();
    }
  }, []);

  const onSeek = useCallback(
    (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
      const a = audioRef.current;
      const bar = barRef.current;
      if (!a || !bar || !duration) return;
      const rect = bar.getBoundingClientRect();
      const clientX =
        "touches" in e ? e.touches[0]?.clientX ?? 0 : (e as React.MouseEvent).clientX;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      a.currentTime = ratio * duration;
      setCurrent(a.currentTime);
    },
    [duration],
  );

  const cycleSpeed = useCallback(() => {
    setSpeed((s) => {
      const i = SPEEDS.indexOf(s);
      return SPEEDS[(i + 1) % SPEEDS.length];
    });
  }, []);

  if (!display) {
    return <div className="h-14 w-64 rounded-2xl bg-muted/60 animate-pulse" />;
  }

  // Cores conforme bolha (enviado: primary; recebido: card)
  const trackBg = isAgent ? "bg-primary-foreground/25" : "bg-foreground/15";
  const trackFill = isAgent ? "bg-primary-foreground" : "bg-primary";
  const subText = isAgent ? "text-primary-foreground/75" : "text-muted-foreground";
  const iconBtn = isAgent
    ? "bg-primary-foreground text-primary hover:bg-primary-foreground/90"
    : "bg-primary text-primary-foreground hover:bg-primary/90";
  const speedBtn = isAgent
    ? "bg-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/30"
    : "bg-foreground/10 text-foreground hover:bg-foreground/15";
  const playedDotClass = played
    ? "bg-transparent"
    : isAgent
      ? "bg-primary-foreground"
      : "bg-[var(--status-urgent,theme(colors.red.500))]";

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl px-2.5 py-2 min-w-[240px] md:min-w-[280px] max-w-[320px] transition-shadow",
        playing && "shadow-[0_0_0_2px_rgba(0,0,0,0.04)]",
      )}
    >
      <button
        type="button"
        onClick={togglePlay}
        aria-label={playing ? "Pausar" : "Reproduzir"}
        className={cn(
          "shrink-0 h-10 w-10 rounded-full inline-flex items-center justify-center transition-transform active:scale-95",
          iconBtn,
        )}
      >
        {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
      </button>

      <div className="flex-1 min-w-0">
        <div
          ref={barRef}
          onClick={onSeek}
          onTouchStart={onSeek}
          className="relative h-7 cursor-pointer select-none"
        >
          {/* Waveform */}
          <div className={cn("absolute inset-0 flex items-center gap-[2px]")}>
            {waveform.map((v, i) => {
              const active = i / waveform.length < progress;
              return (
                <div
                  key={i}
                  className={cn(
                    "flex-1 rounded-full transition-colors",
                    active ? trackFill : trackBg,
                    playing && active && "animate-pulse",
                  )}
                  style={{ height: `${Math.round(v * 100)}%` }}
                />
              );
            })}
          </div>
          {/* Knob */}
          {duration > 0 && (
            <div
              className={cn(
                "absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full shadow",
                trackFill,
              )}
              style={{ left: `calc(${progress * 100}% - 6px)` }}
            />
          )}
        </div>

        <div className={cn("flex items-center justify-between mt-1 text-[10px]", subText)}>
          <span className="inline-flex items-center gap-1">
            <Mic className="h-3 w-3" />
            {fmtTime(playing || current > 0 ? current : duration)}
          </span>
          <span className="inline-flex items-center gap-2">
            <button
              type="button"
              onClick={cycleSpeed}
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                speedBtn,
              )}
              title="Velocidade"
            >
              {speed}x
            </button>
            {!isAgent && (
              <span
                className={cn("h-2 w-2 rounded-full", playedDotClass)}
                title={played ? "Reproduzido" : "Não reproduzido"}
              />
            )}
          </span>
        </div>
      </div>

      <audio
        ref={audioRef}
        src={display}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (isFinite(d)) setDuration(d);
        }}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          if (isFinite(d)) setDuration(d);
        }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onPlay={() => {
          setPlaying(true);
          if (!isAgent && !played) {
            setPlayed(true);
            markPlayed(messageId);
          }
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
      >
        {mime ? <source src={display} type={mime} /> : null}
      </audio>

      <DownloadButton href={display} filename={filename ?? "audio"} />
    </div>
  );
}

// Wrapper outer container for WhatsAppAudio so the download button stacks below

function DocumentPreview({
  path,
  filename,
  mime,
  size,
  bucket,
}: {
  path?: string | null;
  filename?: string | null;
  mime?: string | null;
  size?: number | null;
  bucket?: string | null;
}) {
  const display = useResolvedMediaSrc({ path, bucket });
  const sizeLabel =
    typeof size === "number" && size > 0
      ? size > 1024 * 1024
        ? `${(size / (1024 * 1024)).toFixed(1)} MB`
        : `${Math.max(1, Math.round(size / 1024))} KB`
      : null;
  return (
    <div className="rounded-md border bg-background/60 px-3 py-2 flex items-center gap-3 max-w-full md:max-w-[300px]">
      <FileText className="size-6 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{filename ?? "Documento"}</div>
        <div className="text-[11px] text-muted-foreground truncate">
          {[mime, sizeLabel].filter(Boolean).join(" • ") || "Arquivo"}
        </div>
      </div>
      <DownloadButton href={display} filename={filename} className="shrink-0" />
    </div>
  );
}

function StickerPreview({
  path,
  filename,
  bucket,
}: {
  path?: string | null;
  filename?: string | null;
  bucket?: string | null;
}) {
  const display = useResolvedMediaSrc({ path, bucket });
  if (!display) {
    return <div className="h-24 w-24 rounded-md bg-muted animate-pulse" />;
  }
  return (
    <img
      src={display}
      alt={filename ?? "Sticker"}
      className="rounded-md w-24 h-24 object-contain bg-transparent"
      loading="lazy"
    />
  );
}

type MediaInfo = {
  path?: string | null;
  url?: string | null;
  kind: MediaKind;
  mime?: string | null;
  filename?: string | null;
  size?: number | null;
  bucket?: string | null;
};

function getMediaInfo(m: Message): MediaInfo | null {
  const meta = m.sourceMetadata as Record<string, unknown> | undefined;
  const path = (meta?.media_path as string | undefined) ?? null;
  const url =
    (meta?.media_url as string | undefined) ??
    (meta?.mediaUrl as string | undefined) ??
    (meta?.image_url as string | undefined) ??
    null;
  const mime = (meta?.media_mime as string | undefined) ?? null;
  const filename = (meta?.media_filename as string | undefined) ?? null;
  const size = (meta?.media_size as number | undefined) ?? null;
  const bucket = (meta?.media_bucket as string | undefined) ?? null;
  const t =
    (meta?.media_kind as string | undefined) ??
    (meta?.type as string | undefined) ??
    m.sourceSubtype ??
    "";

  function kindFor(): MediaKind | null {
    if (t === "sticker") return "sticker";
    if (t === "image") return "image";
    if (t === "video") return "video";
    if (t === "audio") return "audio";
    if (t === "document") return "document";
    const ref = (path ?? url ?? "").toLowerCase();
    if (/\.(jpe?g|png|webp|gif)(\?|$)/.test(ref)) return "image";
    if (/\.(mp4|webm|mov|3gp)(\?|$)/.test(ref)) return "video";
    if (/\.(mp3|ogg|m4a|wav|aac|opus)(\?|$)/.test(ref)) return "audio";
    if (/\.(pdf|docx?|xlsx?|pptx?|txt|csv)(\?|$)/.test(ref)) return "document";
    return null;
  }

  if (path || url) {
    const kind = kindFor();
    if (kind) return { path, url, kind, mime, filename, size, bucket };
  }

  IMAGE_URL_RE.lastIndex = 0;
  const match = IMAGE_URL_RE.exec(m.text ?? "");
  if (match) return { url: match[1], kind: "image", mime, filename, size, bucket };
  return null;
}

function deletedLabelFor(kind: MediaKind | null): string {
  switch (kind) {
    case "image":
      return "🗑️ Imagem removida";
    case "video":
      return "🗑️ Vídeo removido";
    case "audio":
      return "🗑️ Áudio removido";
    case "document":
      return "🗑️ Arquivo removido";
    case "sticker":
      return "🗑️ Sticker removido";
    default:
      return "🗑️ Mensagem removida";
  }
}

// getUnsupportedPlaceholder e mapas foram extraídos para
// src/lib/inbox/unsupported-placeholder.ts (testável isoladamente).


function UnsupportedPlaceholder({ label, rawType }: { label: string; rawType: string }) {
  return (
    <div
      data-unsupported-type={rawType}
      className="flex items-center gap-2 rounded-md border border-dashed border-border/60 bg-muted/40 px-3 text-sm text-muted-foreground"
      style={{ height: 44, minHeight: 44 }}
      title={`Tipo original: ${rawType}`}
    >
      <span className="truncate">{label}</span>
    </div>
  );
}

type ReplyToMeta = {
  message_id?: string | null;
  external_id?: string | null;
  type?: string | null;
  preview?: string | null;
  media_path?: string | null;
  media_mime?: string | null;
  role?: string | null;
};

function getReplyTo(m: Message): ReplyToMeta | null {
  const meta = m.sourceMetadata as Record<string, unknown> | undefined;
  const r = meta?.reply_to as ReplyToMeta | undefined;
  if (!r || (typeof r !== "object")) return null;
  if (!r.preview && !r.message_id && !r.external_id) return null;
  return r;
}

// Serializa uma mensagem incluindo o contexto da resposta (reply_to) para a IA
// entender a qual mensagem o cliente está respondendo.
export function messageForAi(m: Message): { role: Message["role"]; text: string } {
  const reply = getReplyTo(m);
  if (!reply) return { role: m.role, text: m.text };
  const ctx = (reply.preview ?? "[mensagem anterior]").replace(/\s+/g, " ").slice(0, 200);
  return { role: m.role, text: `[em resposta a: ${ctx}] ${m.text}` };
}



function ReplyPreview({ reply }: { reply: ReplyToMeta }) {
  const kind = (reply.type ?? "text").toLowerCase();
  const allMessages = useContext(MessagesContext);

  // Resolve a mensagem original (por id local ou external_id) para extrair
  // media_path/bucket quando o reply_to não traz — necessário p/ thumb de
  // resposta a imagens enviadas pelo agente (bucket product-images).
  const original = useMemo(() => {
    if (!allMessages.length) return null;
    if (reply.message_id) {
      const byId = allMessages.find((m) => m.id === reply.message_id);
      if (byId) return byId;
    }
    if (reply.external_id) {
      const byExt = allMessages.find(
        (m) =>
          (m.sourceMetadata as Record<string, unknown> | undefined)?.external_id ===
            reply.external_id ||
          // alguns repos guardam external_id em coluna dedicada, exposta como any
          (m as unknown as { external_id?: string }).external_id === reply.external_id,
      );
      if (byExt) return byExt;
    }
    return null;
  }, [allMessages, reply.message_id, reply.external_id]);

  const fallbackInfo = original ? getMediaInfo(original) : null;
  const path = reply.media_path ?? fallbackInfo?.path ?? null;
  const bucket = fallbackInfo?.bucket ?? null;

  const thumb = useResolvedMediaSrc({ path, bucket });
  const isImage = kind === "image" || kind === "sticker";
  const isAudio = kind === "audio";
  const label =
    reply.preview ??
    (isImage ? "📷 Foto" : isAudio ? "🎤 Mensagem de voz" : "[mensagem]");

  const virtuoso = useContext(VirtuosoScrollContext);

  function highlight(el: HTMLElement) {
    markInboxScrollIntent("USER_SCROLL", "scrollIntoView_CALL", {
      source: "reply_preview",
      targetId: el.id,
      behavior: "smooth",
      block: "center",
    });
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-primary/60", "transition");
    setTimeout(() => el.classList.remove("ring-2", "ring-primary/60"), 1400);
  }

  function scrollToOriginal() {
    if (!reply.message_id) return;
    const el = document.getElementById(`msg-${reply.message_id}`);
    if (el) {
      highlight(el);
      return;
    }
    // Mensagem está fora da janela virtualizada: pede ao Virtuoso para montá-la.
    if (!virtuoso) return;
    const idx = virtuoso.items.findIndex((m) => m.id === reply.message_id);
    if (idx < 0) return;
    markInboxScrollIntent("USER_SCROLL", "scrollToIndex_CALL", {
      source: "reply_preview",
      index: idx,
      align: "center",
      behavior: "smooth",
    });
    virtuoso.ref.current?.scrollToIndex({ index: idx, align: "center", behavior: "smooth" });
    // Aguarda o item entrar no DOM antes de aplicar o highlight.
    const start = Date.now();
    const tryHighlight = () => {
      const node = document.getElementById(`msg-${reply.message_id}`);
      if (node) highlight(node);
      else if (Date.now() - start < 1200) requestAnimationFrame(tryHighlight);
    };
    requestAnimationFrame(tryHighlight);
  }


  return (
    <button
      type="button"
      onClick={scrollToOriginal}
      className="flex items-stretch gap-2 mb-1.5 w-full text-left rounded-md bg-background/40 border-l-2 border-primary/70 px-2 py-1.5 hover:bg-background/60 transition"
    >
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-semibold text-primary/90 uppercase tracking-wide">
          {reply.role === "agent" ? "Você" : "Cliente"}
        </div>
        <div className="text-xs truncate opacity-90">{label}</div>
      </div>
      {isImage && thumb ? (
        <img
          src={thumb}
          alt=""
          className="h-10 w-10 rounded object-cover shrink-0"
        />
      ) : null}
    </button>
  );
}

function AudioMimeDebug({ message, declaredMime }: { message: Message; declaredMime?: string | null }) {
  const meta = message.sourceMetadata as Record<string, unknown> | undefined;
  const detected = (meta?.detected_audio as string | undefined) ?? null;
  const clientDebug = (meta?.client_debug as Record<string, unknown> | undefined) ?? null;
  if (!declaredMime && !detected && !clientDebug) return null;
  return (
    <div
      className="text-[10px] leading-snug text-muted-foreground/80 font-mono"
      title={clientDebug ? JSON.stringify(clientDebug, null, 2) : undefined}
    >
      mime: {declaredMime ?? "—"} · detectado: {detected ?? "—"}
    </div>
  );
}

function MediaAiNote({ message, kind }: { message: Message; kind: MediaKind }) {
  const meta = message.sourceMetadata as Record<string, unknown> | undefined;
  if (!meta) return null;
  const transcription = (meta.transcription_text as string | undefined) ?? null;
  const vision = (meta.vision_summary as string | undefined) ?? null;
  const docSummary = (meta.document_summary as string | undefined) ?? null;
  const extracted = (meta.extracted_text as string | undefined) ?? null;
  const err = (meta.ai_media_error as string | undefined) ?? null;

  const items: Array<{ label: string; value: string }> = [];
  if (kind === "audio" && transcription)
    items.push({ label: "Transcrição do áudio", value: transcription });
  if (kind === "image" && vision)
    items.push({ label: "IA identificou", value: vision });
  if (kind === "document") {
    if (extracted && extracted !== docSummary)
      items.push({ label: "Texto extraído", value: extracted });
    if (docSummary)
      items.push({ label: "Resumo do documento", value: docSummary });
  }

  if (items.length === 0 && !err) return null;
  return (
    <div className="mt-1.5 space-y-1">
      {items.map((it, i) => (
        <div
          key={i}
          className="text-[11px] leading-snug rounded-md bg-muted/40 border border-border/60 px-2 py-1"
        >
          <span className="font-semibold opacity-80">{it.label}:</span>{" "}
          <span className="opacity-90 whitespace-pre-wrap">{it.value}</span>
        </div>
      ))}
      {err && (
        <div
          className="text-[10px] leading-snug rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 px-2 py-1"
          title="Visível apenas para a equipe — a mídia continua disponível para resposta humana."
        >
          ⚠️ IA não conseguiu analisar a mídia: {err}
        </div>
      )}
    </div>
  );
}

function MessageContent({ message, isAgent = false }: { message: Message; isAgent?: boolean }) {
  const info = getMediaInfo(message);
  const reply = getReplyTo(message);
  const replyNode = reply ? <ReplyPreview reply={reply} /> : null;

  if (info) {
    const trimmed = (message.text ?? "").trim();
    const showCaption =
      trimmed.length > 0 && !/^\[/.test(trimmed) && !/^https?:\/\//.test(trimmed);
    const caption = showCaption ? <div>{trimmed}</div> : null;
    const aiNote = <MediaAiNote message={message} kind={info.kind} />;

    switch (info.kind) {
      case "image":
        return (
          <div className="space-y-1">
            {replyNode}
            <ImagePreview path={info.path} url={info.url} filename={info.filename} bucket={info.bucket} />
            {caption}
            {aiNote}
          </div>
        );
      case "video":
        return (
          <div className="space-y-1">
            {replyNode}
            <VideoPreview path={info.path} url={info.url} filename={info.filename} bucket={info.bucket} />
            {caption}
          </div>
        );
      case "audio":
        return (
          <div className="space-y-1">
            {replyNode}
            <WhatsAppAudio
              path={info.path}
              mime={info.mime}
              filename={info.filename}
              bucket={info.bucket}
              isAgent={isAgent}
              messageId={message.id}
            />
            <AudioMimeDebug message={message} declaredMime={info.mime} />
            {caption}
            {aiNote}
          </div>
        );
      case "document":
        return (
          <div className="space-y-1">
            {replyNode}
            <DocumentPreview
              path={info.path}
              filename={info.filename}
              mime={info.mime}
              size={info.size}
              bucket={info.bucket}
            />
            {caption}
            {aiNote}
          </div>
        );
      case "sticker":
        return (
          <div className="space-y-1">
            {replyNode}
            <StickerPreview path={info.path} filename={info.filename} bucket={info.bucket} />
          </div>
        );
    }
  }

  const text = message.text ?? "";

  // Placeholder amigável para tipos ainda não renderizados nativamente
  // (documentos sem download, localização, contatos, enquetes, stickers legados,
  // reações, pedidos, etc.). Nunca deixa "[unsupported]" ou "[qualquer_coisa]" visível.
  const placeholder = getUnsupportedPlaceholder(message, text);
  if (placeholder) {
    return (
      <>
        {replyNode}
        <UnsupportedPlaceholder label={placeholder.label} rawType={placeholder.rawType} />
      </>
    );
  }

  IMAGE_URL_RE.lastIndex = 0;
  if (!IMAGE_URL_RE.test(text)) {
    return (
      <>
        {replyNode}
        {text}
      </>
    );
  }
  IMAGE_URL_RE.lastIndex = 0;
  const parts: Array<{ type: "text" | "image"; value: string }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IMAGE_URL_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: "image", value: match[1] });
    lastIndex = match.index + match[1].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", value: text.slice(lastIndex) });
  }
  return (
    <div className="space-y-1">
      {replyNode}
      {parts.map((p, i) =>
        p.type === "image" ? (
          <ImagePreview key={i} url={p.value} />
        ) : (
          p.value.trim() ? <div key={i}>{p.value}</div> : null
        ),
      )}
    </div>
  );
}

function MessageBubbleImpl({
  m,
  canManage,
}: {
  m: Message;
  canManage: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.text);
  const [confirmDelete, setConfirmDelete] = useState<null | "me" | "everyone">(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [forwardTarget, setForwardTarget] = useState<ForwardMessageTarget | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tplMeta = m.sourceMetadata as
    | { template_name?: string; category?: string }
    | undefined;
  const isTemplate = m.role === "agent" && !!tplMeta?.template_name;
  const isAgent = m.role === "agent";
  const isDeleted = !!m.deletedAt;
  const externalId = (m.sourceMetadata as { external_id?: string } | undefined)
    ?.external_id;
  // Reply nativo só é usado quando há external_id no snapshot (lido no composer);
  // sem ele, o composer prefixa a citação no texto e envia pelo fluxo normal.
  const replyCtx = useContext(ReplyComposeContext);
  const mediaInfo = getMediaInfo(m);
  const hasText = !!m.text && m.text.trim().length > 0;
  const canForwardMedia = !!mediaInfo?.path && (mediaInfo.kind === "image" || mediaInfo.kind === "video");


  function startLongPress() {
    if (isDeleted || editing) return;
    cancelLongPress();
    longPressTimer.current = setTimeout(() => setMenuOpen(true), 500);
  }
  function cancelLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(m.text ?? "");
      toast.success("Texto copiado");
    } catch {
      toast.error("Não foi possível copiar");
    }
  }

  async function downloadMedia(url: string) {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = url.split("/").pop()?.split("?")[0] ?? "midia";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      // fallback: abrir em nova aba
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }


  async function commitEdit() {
    const next = draft.trim();
    if (!next || next === m.text) {
      setEditing(false);
      setDraft(m.text);
      return;
    }
    try {
      setBusy(true);
      await editMessage(m.id, next);
      toast.success("Mensagem editada");
      setEditing(false);
    } catch (e) {
      toast.error("Falha ao editar", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  async function commitDelete(scope: "me" | "everyone") {
    try {
      setBusy(true);
      await deleteMessage(m.id, scope);
      toast.success(scope === "me" ? "Apagada para você" : "Mensagem apagada");
      setConfirmDelete(null);
    } catch (e) {
      toast.error("Falha ao apagar", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      id={`msg-${m.id}`}
      className={cn(
        // Mobile usa 92% da largura (Fase 5.2): em 320–390px os 85% antigos
        // desperdiçavam uma coluna inteira e quebravam frases curtas em duas
        // linhas. No desktop a leitura continua confortável em 70%.
        "group flex flex-col w-fit max-w-[min(92%,calc(100%-0.75rem))] md:max-w-[min(70%,calc(100%-2rem))] min-w-0 relative",

        isAgent ? "ml-auto items-end" : "items-start",
      )}
    >
      <div className="flex items-end gap-1 min-w-0 max-w-full">

        {isAgent && canManage && !isDeleted && !editing && (
          <div className="relative md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground"
              aria-label="Opções da mensagem"
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {menuOpen && !isDeleted && !editing && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setMenuOpen(false)}
            />
            <div className="fixed left-1/2 -translate-x-1/2 bottom-6 md:absolute md:left-auto md:right-0 md:bottom-8 md:translate-x-0 z-50 min-w-[220px] rounded-md border border-border bg-popover shadow-lg p-1 text-sm animate-in fade-in zoom-in-95">
              {(hasText || mediaInfo) && (
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); replyCtx.start(m); }}
                  className="w-full text-left px-2.5 py-1.5 rounded hover:bg-accent inline-flex items-center gap-2"
                >
                  <Reply className="h-3.5 w-3.5" /> Responder
                </button>
              )}
              {canForwardMedia && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setForwardTarget({
                      messageId: m.id,
                      kind: mediaInfo!.kind as "image" | "video",
                      preview: { filename: mediaInfo!.filename ?? null },
                    });
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded hover:bg-accent inline-flex items-center gap-2"
                >
                  <Forward className="h-3.5 w-3.5" /> Encaminhar
                </button>
              )}
              {hasText && (
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); void copyText(); }}
                  className="w-full text-left px-2.5 py-1.5 rounded hover:bg-accent inline-flex items-center gap-2"
                >
                  <Copy className="h-3.5 w-3.5" /> Copiar texto
                </button>
              )}
              {isAgent && canManage && mediaInfo?.url && (
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); window.open(mediaInfo.url!, "_blank", "noopener,noreferrer"); }}
                  className="w-full text-left px-2.5 py-1.5 rounded hover:bg-accent inline-flex items-center gap-2"
                >
                  <Eye className="h-3.5 w-3.5" /> Visualizar
                </button>
              )}
              {isAgent && canManage && mediaInfo?.url && (
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); void downloadMedia(mediaInfo.url!); }}
                  className="w-full text-left px-2.5 py-1.5 rounded hover:bg-accent inline-flex items-center gap-2"
                >
                  <Download className="h-3.5 w-3.5" /> Baixar
                </button>
              )}
              {isAgent && canManage && !mediaInfo && hasText && (
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); setDraft(m.text); setEditing(true); }}
                  className="w-full text-left px-2.5 py-1.5 rounded hover:bg-accent inline-flex items-center gap-2"
                >
                  <Pencil className="h-3.5 w-3.5" /> Editar mensagem
                </button>
              )}
              {isAgent && canManage && (
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); setConfirmDelete("me"); }}
                  className="w-full text-left px-2.5 py-1.5 rounded hover:bg-accent inline-flex items-center gap-2"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {mediaInfo ? "Ocultar para mim" : "Apagar para mim"}
                </button>
              )}
              {isAgent && canManage && !externalId && (
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); setConfirmDelete("everyone"); }}
                  className="w-full text-left px-2.5 py-1.5 rounded hover:bg-accent inline-flex items-center gap-2 text-[var(--status-urgent)]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {mediaInfo ? "Excluir mídia" : "Excluir mensagem"}
                </button>
              )}
            </div>
          </>
        )}

        <div
          onTouchStart={startLongPress}
          onTouchEnd={cancelLongPress}
          onTouchMove={cancelLongPress}
          onTouchCancel={cancelLongPress}
          onContextMenu={(e) => {
            if (!isDeleted && !editing) {
              e.preventDefault();
              setMenuOpen(true);
            }
          }}
          className={cn(
            "rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] min-w-0 max-w-full select-none md:select-text transition-transform active:scale-[0.99]",
            isAgent
              ? "bg-primary text-primary-foreground rounded-br-sm"
              : "bg-card border border-border rounded-bl-sm",
            isDeleted && "italic opacity-70",
          )}
        >
          {isDeleted ? (
            <span>{deletedLabelFor(mediaInfo?.kind ?? null)}</span>
          ) : editing ? (
            <div className="flex flex-col gap-2 min-w-[220px]">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck
                autoCapitalize="sentences"
                autoCorrect="on"
                rows={Math.min(6, Math.max(1, draft.split("\n").length))}
                className="resize-none rounded-md bg-background text-foreground px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring border border-border"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void commitEdit();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setEditing(false);
                    setDraft(m.text);
                  }
                }}
                autoFocus
              />
              <div className="flex items-center gap-1.5 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setDraft(m.text);
                  }}
                  className="text-xs px-2 py-1 rounded bg-background/20 hover:bg-background/30"
                  disabled={busy}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void commitEdit()}
                  disabled={busy || !draft.trim()}
                  className="text-xs px-2 py-1 rounded bg-background text-foreground hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1"
                >
                  <Check className="h-3 w-3" /> Salvar
                </button>
              </div>
            </div>
          ) : (
            <MessageContent message={m} isAgent={isAgent} />
          )}
        </div>
        {!isDeleted && !editing && (hasText || mediaInfo) && (
          <button
            type="button"
            onClick={() => replyCtx.start(m)}
            className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-full border border-border bg-background/90 backdrop-blur shadow-sm text-foreground hover:bg-accent hover:text-accent-foreground transition-all md:opacity-60 md:group-hover:opacity-100 active:scale-95"
            aria-label="Responder mensagem"
            title="Responder mensagem"
          >
            <Reply className="h-4 w-4" />
          </button>
        )}
        {!isAgent && !isDeleted && mediaInfo?.path && (mediaInfo.kind === "image" || mediaInfo.kind === "video") && (
          <button
            type="button"
            onClick={() =>
              setForwardTarget({
                messageId: m.id,
                kind: mediaInfo.kind as "image" | "video",
                preview: { filename: mediaInfo.filename ?? null },
              })
            }
            className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground md:opacity-0 md:group-hover:opacity-100 transition-opacity"
            aria-label="Encaminhar mídia"
            title="Encaminhar"
          >
            <Forward className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <ForwardMessageDialog
        open={forwardTarget !== null}
        target={forwardTarget}
        currentConversationId={m.conversationId}
        onClose={() => setForwardTarget(null)}
      />

      {isTemplate && !isDeleted && (
        <span className="text-[10px] mt-1 px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary">
          Enviado via template Utility
          {tplMeta?.template_name ? ` · ${tplMeta.template_name}` : ""}
        </span>
      )}
      <span className="text-[10px] text-muted-foreground mt-1 px-1 inline-flex items-center gap-1">
        {timeAgo(m.at)}
        {m.editedAt && !isDeleted ? " · editada" : ""}
        {isAgent && !isDeleted && m.deliveryStatus ? (
          <span
            className={cn(
              "ml-1",
              m.deliveryStatus === "failed"
                ? "text-destructive"
                : m.deliveryStatus === "read"
                  ? "text-primary"
                  : "text-muted-foreground",
            )}
            title={
              m.deliveryStatus === "failed"
                ? `Falhou${m.deliveryErrorCode ? ` (${m.deliveryErrorCode})` : ""}: ${m.deliveryErrorMessage ?? "erro desconhecido"}`
                : m.deliveryStatus
            }
          >
            {m.deliveryStatus === "sent"
              ? "· enviado ✓"
              : m.deliveryStatus === "delivered"
                ? "· entregue ✓✓"
                : m.deliveryStatus === "read"
                  ? "· lido ✓✓"
                  : `· falhou${m.deliveryErrorMessage ? `: ${m.deliveryErrorMessage}` : ""}`}
          </span>
        ) : null}
      </span>

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !busy && setConfirmDelete(null)}
        >
          <div
            className="bg-card border border-border rounded-lg shadow-lg max-w-sm w-full p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-semibold mb-1">
              {confirmDelete === "me"
                ? "Apagar para mim?"
                : "Apagar da conversa?"}
            </div>
            <div className="text-sm text-muted-foreground mb-3">
              {confirmDelete === "me"
                ? "A mensagem ficará oculta apenas para você. O cliente continua vendo."
                : "A mensagem será marcada como apagada. Esta ação não pode ser desfeita."}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                disabled={busy}
                className="text-sm px-3 py-1.5 rounded-md hover:bg-accent"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void commitDelete(confirmDelete)}
                disabled={busy}
                className="text-sm px-3 py-1.5 rounded-md bg-[var(--status-urgent)] text-white hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Apagar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function messageBubbleEqual(
  prev: { m: Message; canManage: boolean },
  next: { m: Message; canManage: boolean },
): boolean {
  if (prev.canManage !== next.canManage) return false;
  const a = prev.m;
  const b = next.m;
  if (a === b) return true;
  return (
    a.id === b.id &&
    a.text === b.text &&
    a.role === b.role &&
    a.at === b.at &&
    a.sourceSubtype === b.sourceSubtype &&
    a.editedAt === b.editedAt &&
    a.deletedAt === b.deletedAt &&
    a.deletedFor === b.deletedFor &&
    a.deliveryStatus === b.deliveryStatus &&
    a.statusUpdatedAt === b.statusUpdatedAt &&
    a.sourceMetadata === b.sourceMetadata
  );
}

export const MessageBubble = memo(MessageBubbleImpl, messageBubbleEqual);

import { Link, useNavigate, createLazyFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { runFollowupNowForConversation, type ManualFollowupResult } from "@/lib/manual-followup.functions";
import { Zap } from "lucide-react";
import { getUnsupportedPlaceholder } from "@/lib/inbox/unsupported-placeholder";
import { createContext, forwardRef, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentPropsWithoutRef } from "react";
import { createPortal } from "react-dom";
import { Virtuoso, type ItemProps, type ListItem, type ListRange, type VirtuosoHandle } from "react-virtuoso";

import { timeAgo, formatBRL, type Message } from "@/data/mock";
import {
  getConversationById,
  getLeadById,
  getMessagesFor,
  appendMessage,
  markLeadLost,
  markLeadWon,
  updateLeadNextAction,
  refetchConversationMessages,
  subscribeRepo,
  editMessage,
  deleteMessage,
  loadConversationRecent,
  loadConversationOlder,
  hasMoreOlderMessages,
  getRepoMode,
  getRepoVersion,
  resetConversationRecentLoaded,
} from "@/data/leadRepo";
import { recordAudit } from "@/lib/audit";
import { useAuth } from "@/auth/AuthContext";
import { ChannelBadge, StatusBadge } from "@/components/Badges";
import { OriginBadge, getConversationOrigin } from "./inbox.index";
import { AudioRecorder } from "@/components/AudioRecorder";
import { CoachPanel } from "@/components/coach/CoachPanel";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Sparkles,
  FileText,
  Calendar,
  Target,
  CheckCircle2,
  XCircle,
  Send,
  Loader2,
  Tag,
  Clock,
  Flame,
  X,
  DollarSign,
  MessageSquare,
  MoreVertical,
  Pencil,
  Trash2,
  Check,
  Copy,
  Eye,
  Download,
  Plus,
  Image as ImageIcon,
  Video as VideoIcon,
  Library as LibraryIcon,
  Play,
  Pause,
  Mic,
  Forward,
  Smile,
  MapPin,
  Reply,
} from "lucide-react";
import EmojiPicker, { EmojiStyle, Theme as EmojiTheme } from "emoji-picker-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SendLocationDialog } from "@/components/SendLocationDialog";
import { ForwardMessageDialog, type ForwardMessageTarget } from "@/components/ForwardMessageDialog";
import { listProducts, subscribeProducts, type Product } from "@/data/products";
import { productMatches } from "@/lib/product-search";
import {
  buildProductCaption,
  buildProductCardSubtitle,
} from "@/lib/product-caption";


type LibraryPick = { path: string; caption: string; productId: string };

import { listQuickReplies, ensureDefaultQuickReplies, updateQuickReply, type QuickReply } from "@/data/quickReplies";
import { getSignedImageUrl, getSignedWaMediaUrl, getSignedMediaUrl } from "@/lib/storage";
import { SmartImage } from "@/components/SmartImage";
import { getQuote, markQuoteSent, type Quote } from "@/data/quotes";
import { getSettings, subscribeSettings } from "@/data/settings";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { QualificationPanel, TempBadge } from "@/components/QualificationBadges";
import { AlertTriangle } from "lucide-react";
import { AITimeline } from "@/components/AITimeline";
import { WhatsappWindowAlert } from "@/components/WhatsappWindowAlert";
import { MetaTemplatesModal } from "@/components/MetaTemplatesModal";

// Contexto leve com as mensagens da conversa atual.
// Usado pelo ReplyPreview para localizar a mensagem original e reconstruir
// a miniatura quando o reply_to (vindo do webhook) não traz media_path —
// caso típico de respostas a imagens enviadas pelo próprio agente.
const MessagesContext = createContext<Message[]>([]);

// Onda 2.4: dá ao ReplyPreview acesso à lista virtualizada para localizar a
// mensagem original via scrollToIndex (caso esteja fora do viewport montado).
const VirtuosoScrollContext = createContext<{
  ref: React.RefObject<VirtuosoHandle | null>;
  items: Message[];
} | null>(null);

type InboxScrollTraceReason =
  | "INITIAL_LOAD"
  | "VIRTUOSO_RESTORE"
  | "IMAGE_DECODE"
  | "RESIZE_OBSERVER"
  | "FOLLOW_OUTPUT"
  | "REALTIME"
  | "USER_SCROLL"
  | "SCROLL_CONTROLLER"
  | "RESTORE_POSITION"
  | "OUTRO";

interface InboxScrollVirtualSnapshot {
  totalItems: number;
  renderedItems: number | null;
  virtualizedItems: number | null;
  firstItemIndex: number | null;
  lastItemIndex: number | null;
  rangeStartIndex: number | null;
  rangeEndIndex: number | null;
}

interface InboxScrollMetrics extends InboxScrollVirtualSnapshot {
  timestamp: string;
  elapsedMs: number;
  conversationId: string | null;
  scrollTop: number | null;
  scrollHeight: number | null;
  clientHeight: number | null;
  distanceToEnd: number | null;
}

interface InboxScrollTraceEntry extends InboxScrollMetrics {
  seq: number;
  reason: InboxScrollTraceReason;
  event: string;
  details?: Record<string, unknown>;
}

interface InboxScrollTraceState {
  active: boolean;
  conversationId: string | null;
  startedAt: number;
  seq: number;
  scroller: HTMLElement | null;
  getSnapshot: (() => InboxScrollVirtualSnapshot) | null;
  pendingReason: InboxScrollTraceReason | null;
  pendingReasonUntil: number;
  lastUserInputAt: number;
  restoreScrollTopPatch: (() => void) | null;
  restoreScrollToPatch: (() => void) | null;
  restoreScrollIntoViewPatch: (() => void) | null;
}

declare global {
  interface Window {
    __INBOX_SCROLL_TRACE__?: InboxScrollTraceEntry[];
  }
}

const INBOX_SCROLL_TRACE_WINDOW_MS = 3000;
const INBOX_SCROLL_TRACE_SELECTOR = "[data-inbox-virtual-item='true']";
const inboxScrollTraceState: InboxScrollTraceState = {
  active: false,
  conversationId: null,
  startedAt: 0,
  seq: 0,
  scroller: null,
  getSnapshot: null,
  pendingReason: null,
  pendingReasonUntil: 0,
  lastUserInputAt: 0,
  restoreScrollTopPatch: null,
  restoreScrollToPatch: null,
  restoreScrollIntoViewPatch: null,
};

function inboxTraceNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function isInboxScrollTraceActive(): boolean {
  if (typeof window === "undefined") return false;
  if (!inboxScrollTraceState.active) return false;
  return inboxTraceNow() - inboxScrollTraceState.startedAt <= INBOX_SCROLL_TRACE_WINDOW_MS;
}

function readInboxScrollMetrics(): Omit<InboxScrollMetrics, keyof InboxScrollVirtualSnapshot> {
  const scroller = inboxScrollTraceState.scroller;
  const elapsedMs = Math.round(inboxTraceNow() - inboxScrollTraceState.startedAt);
  if (!scroller) {
    return {
      timestamp: new Date().toISOString(),
      elapsedMs,
      conversationId: inboxScrollTraceState.conversationId,
      scrollTop: null,
      scrollHeight: null,
      clientHeight: null,
      distanceToEnd: null,
    };
  }
  const distanceToEnd = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  return {
    timestamp: new Date().toISOString(),
    elapsedMs,
    conversationId: inboxScrollTraceState.conversationId,
    scrollTop: Math.round(scroller.scrollTop),
    scrollHeight: scroller.scrollHeight,
    clientHeight: scroller.clientHeight,
    distanceToEnd: Math.round(distanceToEnd),
  };
}

function getInboxVirtualSnapshot(): InboxScrollVirtualSnapshot {
  return (
    inboxScrollTraceState.getSnapshot?.() ?? {
      totalItems: 0,
      renderedItems: null,
      virtualizedItems: null,
      firstItemIndex: null,
      lastItemIndex: null,
      rangeStartIndex: null,
      rangeEndIndex: null,
    }
  );
}

function traceInboxScroll(
  reason: InboxScrollTraceReason,
  event: string,
  details?: Record<string, unknown>,
) {
  if (!isInboxScrollTraceActive()) return;
  const entry: InboxScrollTraceEntry = {
    seq: ++inboxScrollTraceState.seq,
    reason,
    event,
    ...readInboxScrollMetrics(),
    ...getInboxVirtualSnapshot(),
    ...(details ? { details } : {}),
  };
  window.__INBOX_SCROLL_TRACE__ = window.__INBOX_SCROLL_TRACE__ ?? [];
  window.__INBOX_SCROLL_TRACE__.push(entry);
  // eslint-disable-next-line no-console
  console.debug("[inbox-scroll-trace]", entry);
}

function markInboxScrollIntent(
  reason: InboxScrollTraceReason,
  event: string,
  details?: Record<string, unknown>,
) {
  inboxScrollTraceState.pendingReason = reason;
  inboxScrollTraceState.pendingReasonUntil = inboxTraceNow() + 1200;
  traceInboxScroll(reason, event, details);
}

function inferInboxScrollReason(): InboxScrollTraceReason {
  const now = inboxTraceNow();
  if (
    inboxScrollTraceState.pendingReason &&
    now <= inboxScrollTraceState.pendingReasonUntil
  ) {
    return inboxScrollTraceState.pendingReason;
  }
  if (now - inboxScrollTraceState.lastUserInputAt <= 500) return "USER_SCROLL";
  if (now - inboxScrollTraceState.startedAt <= 700) return "INITIAL_LOAD";
  return "OUTRO";
}

// Callback registrado pelo componente para cancelar o bottom-lock inicial
// assim que o usuário interage. Vive no escopo do módulo porque
// `markInboxUserInput` é chamado por wrappers estáticos do scroller.
let inboxBottomLockCancelHandler: ((reason: string) => void) | null = null;

function setInboxBottomLockCancelHandler(fn: ((reason: string) => void) | null) {
  inboxBottomLockCancelHandler = fn;
}

function markInboxUserInput(source: string) {
  inboxScrollTraceState.lastUserInputAt = inboxTraceNow();
  traceInboxScroll("USER_SCROLL", "USER_INPUT", { source });
  inboxBottomLockCancelHandler?.(source);
}

function patchInboxScrollerScrollTop(scroller: HTMLElement) {
  inboxScrollTraceState.restoreScrollTopPatch?.();
  inboxScrollTraceState.restoreScrollToPatch?.();
  const descriptor =
    Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop") ??
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTop");
  if (!descriptor?.get || !descriptor.set) {
    inboxScrollTraceState.restoreScrollTopPatch = null;
    return;
  }
  Object.defineProperty(scroller, "scrollTop", {
    configurable: true,
    enumerable: false,
    get() {
      return descriptor.get?.call(this) ?? 0;
    },
    set(value: number) {
      const before = descriptor.get?.call(this) ?? 0;
      descriptor.set?.call(this, value);
      const after = descriptor.get?.call(this) ?? value;
      traceInboxScroll(inferInboxScrollReason(), "scrollTop_SET", {
        before: Math.round(before),
        assigned: Math.round(value),
        after: Math.round(after),
      });
    },
  });
  inboxScrollTraceState.restoreScrollTopPatch = () => {
    delete (scroller as { scrollTop?: number }).scrollTop;
  };
  const originalScrollTo = scroller.scrollTo.bind(scroller);
  scroller.scrollTo = ((...args: Parameters<HTMLElement["scrollTo"]>) => {
    const before = scroller.scrollTop;
    traceInboxScroll(inferInboxScrollReason(), "scrollTo_CALL", {
      before: Math.round(before),
      args,
    });
    originalScrollTo(...args);
    traceInboxScroll(inferInboxScrollReason(), "scrollTo_AFTER", {
      before: Math.round(before),
      after: Math.round(scroller.scrollTop),
    });
  }) as HTMLElement["scrollTo"];
  inboxScrollTraceState.restoreScrollToPatch = () => {
    scroller.scrollTo = originalScrollTo;
  };
}

function patchInboxScrollIntoView() {
  if (inboxScrollTraceState.restoreScrollIntoViewPatch) return;
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = function patchedScrollIntoView(
    arg?: boolean | ScrollIntoViewOptions,
  ) {
    const element = this as HTMLElement;
    markInboxScrollIntent("USER_SCROLL", "scrollIntoView_CALL", {
      targetId: element.id || null,
      targetTagName: element.tagName,
      targetClassName: element.className || null,
      arg: typeof arg === "boolean" ? arg : arg ? { ...arg } : undefined,
    });
    return originalScrollIntoView.call(this, arg as ScrollIntoViewOptions);
  };
  inboxScrollTraceState.restoreScrollIntoViewPatch = () => {
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  };
}

function setInboxScrollTraceScroller(scroller: HTMLElement | null) {
  if (inboxScrollTraceState.scroller === scroller) return;
  inboxScrollTraceState.restoreScrollTopPatch?.();
  inboxScrollTraceState.restoreScrollToPatch?.();
  inboxScrollTraceState.restoreScrollTopPatch = null;
  inboxScrollTraceState.restoreScrollToPatch = null;
  inboxScrollTraceState.scroller = scroller;
  if (scroller) {
    patchInboxScrollerScrollTop(scroller);
    traceInboxScroll("INITIAL_LOAD", "SCROLLER_ATTACHED");
  } else {
    traceInboxScroll("OUTRO", "SCROLLER_DETACHED");
  }
}

function startInboxScrollTrace(
  conversationId: string,
  getSnapshot: () => InboxScrollVirtualSnapshot,
) {
  if (typeof window === "undefined") return;
  inboxScrollTraceState.active = true;
  inboxScrollTraceState.conversationId = conversationId;
  inboxScrollTraceState.startedAt = inboxTraceNow();
  inboxScrollTraceState.seq = 0;
  inboxScrollTraceState.getSnapshot = getSnapshot;
  inboxScrollTraceState.pendingReason = null;
  inboxScrollTraceState.pendingReasonUntil = 0;
  inboxScrollTraceState.lastUserInputAt = 0;
  window.__INBOX_SCROLL_TRACE__ = [];
  patchInboxScrollIntoView();
  traceInboxScroll("INITIAL_LOAD", "TRACE_START", {
    windowMs: INBOX_SCROLL_TRACE_WINDOW_MS,
    restoreStateFromConfigured: false,
  });
  window.setTimeout(() => {
    if (inboxScrollTraceState.conversationId !== conversationId) return;
    traceInboxScroll("OUTRO", "TRACE_END");
    inboxScrollTraceState.active = false;
    inboxScrollTraceState.restoreScrollIntoViewPatch?.();
    inboxScrollTraceState.restoreScrollIntoViewPatch = null;
  }, INBOX_SCROLL_TRACE_WINDOW_MS);
}

function stopInboxScrollTrace(conversationId: string) {
  if (inboxScrollTraceState.conversationId !== conversationId) return;
  traceInboxScroll("OUTRO", "TRACE_STOP");
  inboxScrollTraceState.active = false;
  inboxScrollTraceState.restoreScrollIntoViewPatch?.();
  inboxScrollTraceState.restoreScrollIntoViewPatch = null;
}

const TracedVirtuosoScroller = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<"div">>(
  function TracedVirtuosoScroller(props, forwardedRef) {
    const resizeObserverRef = useRef<ResizeObserver | null>(null);

    const setRef = useCallback(
      (node: HTMLDivElement | null) => {
        resizeObserverRef.current?.disconnect();
        resizeObserverRef.current = null;
        setInboxScrollTraceScroller(node);
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
        if (!node || typeof ResizeObserver === "undefined") return;
        resizeObserverRef.current = new ResizeObserver((entries) => {
          for (const entry of entries) {
            traceInboxScroll("RESIZE_OBSERVER", "SCROLLER_RESIZE", {
              width: Math.round(entry.contentRect.width),
              height: Math.round(entry.contentRect.height),
            });
          }
        });
        resizeObserverRef.current.observe(node);
      },
      [forwardedRef],
    );

    return (
      <div
        {...props}
        ref={setRef}
        onWheel={(event) => {
          markInboxUserInput("wheel");
          props.onWheel?.(event);
        }}
        onTouchMove={(event) => {
          markInboxUserInput("touchmove");
          props.onTouchMove?.(event);
        }}
        onPointerDown={(event) => {
          markInboxUserInput("pointerdown");
          props.onPointerDown?.(event);
        }}
        onScroll={(event) => {
          traceInboxScroll(inferInboxScrollReason(), "SCROLL_EVENT", {
            targetClassName: (event.currentTarget as HTMLElement).className,
          });
          props.onScroll?.(event);
        }}
      />
    );
  },
);

function TracedVirtuosoItem({ children, context: _context, ...props }: ItemProps<Message> & { context?: unknown }) {
  return (
    <div {...props} data-inbox-virtual-item="true">
      {children}
    </div>
  );
}

// Feature 3 — Reply: permite que a MessageBubble (filha) dispare o estado de
// "respondendo a esta mensagem" no composer da ConversationPage (pai), sem
// acoplar via props.
const ReplyComposeContext = createContext<{ start: (m: Message) => void }>({
  start: () => { /* no-op por padrão */ },
});


export const Route = createLazyFileRoute("/inbox/$conversationId")({
  component: ConversationPage,
});

interface AISuggestion {
  classification: "frio" | "morno" | "quente";
  intent: string;
  objection?: string | null;
  nextAction: string;
  suggestedReply: string;
  lowConfidence?: boolean;
  logId?: string;
  fallbackMessage?: string;
}

type MetaSendPayload = {
  ok?: boolean;
  id?: string;
  at?: string;
  error?: string;
  metaError?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  } | null;
  status?: number;
  dbError?: unknown;
};

type SendTextResult = Pick<MetaSendPayload, "id" | "at"> & {
  externalId?: string | null;
  messageId?: string | null;
};

async function readFunctionError(
  error: unknown,
  data: unknown,
): Promise<{ message: string; full: unknown }> {
  const payload = data as MetaSendPayload | null;
  if (payload?.metaError || payload?.error) {
    const meta = payload.metaError;
    const parts = [
      meta?.message ?? payload.error,
      meta?.code ? `code ${meta.code}` : null,
      meta?.error_subcode ? `subcode ${meta.error_subcode}` : null,
      meta?.fbtrace_id ? `fbtrace ${meta.fbtrace_id}` : null,
    ].filter(Boolean);
    return { message: parts.join(" • "), full: payload };
  }

  const context = error as { message?: string; context?: { response?: Response } } | null;
  const response = context?.context?.response;
  if (response) {
    const raw = await response
      .clone()
      .text()
      .catch(() => "");
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as MetaSendPayload;
        const meta = parsed.metaError;
        const parts = [
          meta?.message ?? parsed.error ?? raw,
          meta?.code ? `code ${meta.code}` : null,
          meta?.error_subcode ? `subcode ${meta.error_subcode}` : null,
          meta?.fbtrace_id ? `fbtrace ${meta.fbtrace_id}` : null,
        ].filter(Boolean);
        return { message: parts.join(" • "), full: parsed };
      } catch {
        return { message: raw, full: raw };
      }
    }
  }

  const fallback = context?.message ?? "Falha ao enviar mensagem";
  return { message: fallback, full: error };
}

// Considera "cliente quente parado" quando o lead é quente e há mensagem do cliente
// aguardando resposta há pelo menos o tempo de SLA configurado em /configuracoes.

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
function messageForAi(m: Message): { role: Message["role"]; text: string } {
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
        "group flex flex-col w-fit max-w-[min(85%,calc(100%-1rem))] md:max-w-[min(70%,calc(100%-2rem))] min-w-0 relative",
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

const MessageBubble = memo(MessageBubbleImpl, messageBubbleEqual);

// ============================================================================
// MediaSendPanel — botão "+" do composer (foto / vídeo / biblioteca de produtos)
// ============================================================================
type PendingMedia = {
  kind: "image" | "video";
  // Path no bucket product-images (para mídias já carregadas via produto)
  // ou null quando ainda precisamos fazer upload de um File local.
  path: string | null;
  // URL local (blob:) ou signed URL para pré-visualização.
  previewUrl: string;
  file?: File;
  fileName?: string;
};

// ============================================================================
// PlusMenuPortal — menu do "+" renderizado em portal (acima de tudo)
// Desktop: popover ancorado acima do botão. Mobile: bottom sheet.
// ============================================================================
function PlusMenuPortal({
  anchorRef,
  panelRef,
  onClose,
  onPickImage,
  onPickVideo,
  onOpenLibrary,
  onPickLocation,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  panelRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onPickImage: () => void;
  onPickVideo: () => void;
  onOpenLibrary: () => void;
  onPickLocation: () => void;
}) {

  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < 768 : false,
  );
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Calcula posição do popover desktop ancorado acima do botão "+"
  useEffect(() => {
    if (isMobile) return;
    const compute = () => {
      const btn = anchorRef.current;
      const panel = panelRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const panelW = panel?.offsetWidth ?? 224;
      const panelH = panel?.offsetHeight ?? 320;
      const margin = 8;
      // Acima do botão por padrão; se não couber, abre embaixo
      let top = rect.top - panelH - margin;
      if (top < margin) top = rect.bottom + margin;
      let left = rect.right - panelW;
      if (left < margin) left = margin;
      if (left + panelW > window.innerWidth - margin) {
        left = window.innerWidth - panelW - margin;
      }
      setPos({ top, left });
    };
    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [isMobile, anchorRef, panelRef]);

  // Fecha com ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const items = (
    <>
      <button
        type="button"
        onClick={onPickImage}
        className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent text-left"
      >
        <ImageIcon className="h-5 w-5 text-primary" /> Foto
      </button>
      <button
        type="button"
        onClick={onPickVideo}
        className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent text-left"
      >
        <VideoIcon className="h-5 w-5 text-primary" /> Vídeo
      </button>
      <button
        type="button"
        onClick={onOpenLibrary}
        className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent text-left border-t border-border"
      >
        <LibraryIcon className="h-5 w-5 text-primary" /> Biblioteca de Produtos
      </button>
      <button
        type="button"
        onClick={onPickLocation}
        className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent text-left border-t border-border"
      >
        <MapPin className="h-5 w-5 text-primary" /> Localização
      </button>
    </>
  );


  if (isMobile) {
    return (
      <div
        className="fixed inset-0 z-[9999] bg-black/40 flex items-end"
        onClick={onClose}
      >
        <div
          ref={panelRef}
          className="w-full bg-popover rounded-t-2xl border-t border-border shadow-2xl max-h-[75vh] overflow-y-auto"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-center pt-2 pb-1">
            <div className="h-1.5 w-10 rounded-full bg-muted-foreground/30" />
          </div>
          {items}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      className="fixed z-[9999] w-56 rounded-md border border-border bg-popover shadow-2xl overflow-hidden max-h-[70vh] overflow-y-auto"
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {items}
    </div>
  );
}


// ============================================================================
// QuickRepliesButton — botão dedicado "Respostas Rápidas" ao lado do "+".
// Carrega itens cadastrados em Configurações > Respostas Rápidas.
// Ao clicar em uma resposta, PREENCHE a caixa de mensagem (não envia).
// ============================================================================
function QuickRepliesButton({
  companyId,
  disabled,
  onPick,
}: {
  companyId: string | null;
  disabled: boolean;
  onPick: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<QuickReply[]>([]);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < 768 : false,
  );
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    ensureDefaultQuickReplies(companyId)
      .then((rows) => {
        if (cancelled) return;
        setItems(rows.filter((r) => r.active));
      })
      .catch(() => {
        listQuickReplies(companyId, { activeOnly: true })
          .then((rows) => !cancelled && setItems(rows))
          .catch(() => {});
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, open]);

  useEffect(() => {
    if (!open || isMobile) return;
    const compute = () => {
      const btn = btnRef.current;
      const panel = panelRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const panelW = panel?.offsetWidth ?? 320;
      const panelH = panel?.offsetHeight ?? 380;
      const margin = 8;
      let top = rect.top - panelH - margin;
      if (top < margin) top = rect.bottom + margin;
      let left = rect.right - panelW;
      if (left < margin) left = margin;
      if (left + panelW > window.innerWidth - margin) {
        left = window.innerWidth - panelW - margin;
      }
      setPos({ top, left });
    };
    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [open, isMobile, items.length]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const normalize = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const q = normalize(query.trim());
  const filtered = q
    ? items.filter(
        (it) =>
          normalize(it.name).includes(q) ||
          normalize(it.category ?? "").includes(q) ||
          normalize(it.content).includes(q),
      )
    : items;

  const panel = (
    <div
      ref={panelRef}
      className={
        isMobile
          ? "w-full bg-popover rounded-t-2xl border-t border-border shadow-2xl max-h-[75vh] flex flex-col"
          : "fixed z-[9999] w-80 rounded-md border border-border bg-popover shadow-2xl overflow-hidden flex flex-col max-h-[70vh]"
      }
      style={
        isMobile
          ? { paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)" }
          : { top: pos?.top ?? -9999, left: pos?.left ?? -9999 }
      }
      onClick={(e) => e.stopPropagation()}
    >
      {isMobile && (
        <div className="flex justify-center pt-2 pb-1">
          <div className="h-1.5 w-10 rounded-full bg-muted-foreground/30" />
        </div>
      )}
      <div className="px-3 py-2 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Respostas Rápidas
          </div>
          <Link
            to="/configuracoes/respostas-rapidas"
            className="text-[10px] text-primary hover:underline"
            onClick={() => setOpen(false)}
          >
            Gerenciar
          </Link>
        </div>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Pesquisar resposta…"
          className="w-full rounded-md bg-input px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div className="overflow-y-auto flex-1">
        {filtered.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            {items.length === 0
              ? "Nenhuma resposta cadastrada. Cadastre em Configurações > Respostas Rápidas."
              : "Nenhuma resposta encontrada."}
          </div>
        ) : (
          filtered.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => {
                onPick(it.content);
                setOpen(false);
                setQuery("");
              }}
              className="w-full flex items-start gap-3 px-3 py-2.5 text-sm hover:bg-accent text-left border-b border-border/40 last:border-b-0"
              title={it.category ?? undefined}
            >
              <span className="text-lg w-6 text-center shrink-0">{it.icon || "💬"}</span>
              <span className="flex-1 min-w-0">
                <span className="block font-medium truncate">{it.name}</span>
                <span className="block text-[11px] text-muted-foreground line-clamp-2">
                  {it.content}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="h-9 w-9 inline-flex items-center justify-center rounded-md bg-muted hover:bg-muted/80 text-foreground disabled:opacity-40 shrink-0"
        title="Respostas Rápidas — mensagens internas cadastradas pela sua empresa. Ao clicar, o texto é preenchido na caixa de mensagem (não envia automaticamente)."
        aria-label="Respostas Rápidas"
      >
        <Zap className="h-4 w-4" />
      </button>
      {open && typeof document !== "undefined" && createPortal(
        isMobile ? (
          <div
            className="fixed inset-0 z-[9999] bg-black/40 flex items-end"
            onClick={() => setOpen(false)}
          >
            {panel}
          </div>
        ) : (
          panel
        ),
        document.body,
      )}
    </>
  );
}






function MediaSendPanel({
  conversationId,
  channel,
  disabled,
  companyId,
  leadId,
  onSent,
  onSendText,
  onInsertText,
}: {
  conversationId: string;
  channel: string | undefined;
  disabled: boolean;
  companyId: string | null;
  leadId?: string | null;
  onSent: () => void;
  onSendText: (text: string) => void;
  onInsertText: (text: string) => void;
}) {

  const [menuOpen, setMenuOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [pending, setPending] = useState<PendingMedia | null>(null);
  const [caption, setCaption] = useState("");
  const [sending, setSending] = useState(false);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const vidInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const isWhats = channel === "whatsapp";

  // Quick replies (respostas rápidas configuráveis)
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [activeReply, setActiveReply] = useState<QuickReply | null>(null);
  const [replyText, setReplyText] = useState("");

  const [savingReply, setSavingReply] = useState(false);
  const [multiSendProgress, setMultiSendProgress] = useState<{ current: number; total: number } | null>(null);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    ensureDefaultQuickReplies(companyId)
      .then((rows) => {
        if (cancelled) return;
        setQuickReplies(rows.filter((r) => r.active));
      })
      .catch((e) => {
        console.error("[quick_replies load]", e);
        // Fallback: tenta apenas listar sem semear
        listQuickReplies(companyId, { activeOnly: true })
          .then((rows) => !cancelled && setQuickReplies(rows))
          .catch(() => {});
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, menuOpen]);

  // Fecha menu ao clicar fora (considera portal — checa botão E painel)
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuButtonRef.current?.contains(target)) return;
      if (menuPanelRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const pickFile = (kind: "image" | "video") => {
    setMenuOpen(false);
    (kind === "image" ? imgInputRef : vidInputRef).current?.click();
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>, kind: "image" | "video") => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setPending({
      kind,
      path: null,
      previewUrl: URL.createObjectURL(f),
      file: f,
      fileName: f.name,
    });
    setCaption("");
  };

  const cancelPending = () => {
    if (pending?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(pending.previewUrl);
    setPending(null);
    setCaption("");
  };

  const send = async () => {
    if (!pending || sending) return;
    if (!isWhats) {
      toast.error("Envio de mídia disponível apenas para WhatsApp.");
      return;
    }
    if (!companyId) {
      toast.error("Perfil ainda carregando. Tente novamente em instantes.");
      return;
    }
    setSending(true);
    const fileName = pending.file?.name ?? pending.fileName ?? null;
    const fileType = pending.file?.type ?? pending.kind;
    try {
      let path = pending.path;
      // Upload se for arquivo local
      if (!path && pending.file) {
        const ext = (pending.file.name.split(".").pop() ?? "bin").toLowerCase().slice(0, 6);
        const uploadPath = `${companyId}/inbox/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("product-images")
          .upload(uploadPath, pending.file, {
            cacheControl: "3600",
            upsert: false,
            contentType: pending.file.type || undefined,
          });
        if (upErr) {
          console.error("[media upload]", upErr);
          throw new Error(`Falha no upload: ${upErr.message}`);
        }
        path = uploadPath;
      }
      if (!path) throw new Error("Arquivo inválido");

      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sessão expirada. Faça login novamente.");

      const res = await fetch("/api/whatsapp/send-media", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          conversationId,
          mediaPath: path,
          kind: pending.kind,
          caption: caption.trim() || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; id?: string };
      if (!res.ok) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      toast.success(`${pending.kind === "video" ? "Vídeo" : "Foto"} enviado(a)`);
      cancelPending();
      onSent();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao enviar";
      console.error("MEDIA_SEND_ERROR", {
        conversation_id: conversationId,
        lead_id: leadId ?? null,
        company_id: companyId,
        file_name: fileName,
        file_type: fileType,
        error: msg,
      });
      toast.error(msg);
      // Mantém o modal aberto para o usuário tentar novamente
    } finally {
      setSending(false);
    }
  };

  const sendMediaPath = useCallback(
    async (path: string, kind: "image" | "video", captionText?: string) => {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sessão expirada. Faça login novamente.");
      const res = await fetch("/api/whatsapp/send-media", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          conversationId,
          mediaPath: path,
          kind,
          caption: captionText?.trim() || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
    },
    [conversationId],
  );

  const sendLibraryBatch = useCallback(
    async (items: LibraryPick[]) => {
      if (items.length === 0) return;
      if (!isWhats) {
        toast.error("Envio de mídia disponível apenas para WhatsApp.");
        return;
      }
      setMultiSendProgress({ current: 0, total: items.length });
      let ok = 0;
      for (let i = 0; i < items.length; i++) {
        try {
          await sendMediaPath(items[i].path, "image", items[i].caption);
          ok++;
          onSent();
        } catch (e) {
          console.error("MULTI_MEDIA_SEND_ERROR", { path: items[i].path, error: e });
          toast.error(
            `Falha ao enviar ${i + 1}/${items.length}: ${
              e instanceof Error ? e.message : "erro"
            }`,
          );
        }
        setMultiSendProgress({ current: i + 1, total: items.length });
      }
      setMultiSendProgress(null);
      if (ok > 0) toast.success(`${ok} foto(s) enviada(s)`);
    },
    [isWhats, onSent, sendMediaPath],
  );

  const selectFromLibrary = (items: LibraryPick[]) => {
    setLibraryOpen(false);
    if (items.length === 0) return;
    if (items.length === 1) {
      const { path, caption: cap } = items[0];
      setPending({ kind: "image", path, previewUrl: path });
      setCaption(cap ?? "");
      return;
    }
    void sendLibraryBatch(items);
  };


  return (
    <>
      <input
        ref={imgInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onFile(e, "image")}
      />
      <input
        ref={vidInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => onFile(e, "video")}
      />

      <div className="relative" ref={menuRef}>
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          disabled={disabled}
          className="h-9 w-9 inline-flex items-center justify-center rounded-md bg-muted hover:bg-muted/80 text-foreground disabled:opacity-40 shrink-0"
          title="Anexar mídia"
          aria-label="Anexar mídia"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {menuOpen && typeof document !== "undefined" && createPortal(
        <PlusMenuPortal
          anchorRef={menuButtonRef}
          panelRef={menuPanelRef}
          onClose={() => setMenuOpen(false)}
          onPickImage={() => pickFile("image")}
          onPickVideo={() => pickFile("video")}
          onOpenLibrary={() => {
            setMenuOpen(false);
            setLibraryOpen(true);
          }}
          onPickLocation={() => {
            setMenuOpen(false);
            setLocationOpen(true);
          }}


        />,
        document.body,
      )}

      <SendLocationDialog
        open={locationOpen}
        onOpenChange={setLocationOpen}
        conversationId={conversationId}
        companyId={companyId}
        disabled={disabled || !isWhats}
        onSent={onSent}
      />

      {/* Modal: editar/enviar resposta rápida */}
      {activeReply && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setActiveReply(null)}
        >
          <div
            className="bg-card rounded-lg border border-border max-w-lg w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div className="font-semibold text-sm flex items-center gap-2">
                <span className="text-lg">{activeReply.icon || "💬"}</span>
                {activeReply.name}
              </div>
              <button onClick={() => setActiveReply(null)} className="p-1 hover:bg-muted rounded">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4">
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                rows={10}
                className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring resize-y"
              />
              <p className="mt-2 text-[11px] text-muted-foreground">
                Edite e clique em "Salvar como padrão" para que o texto fique salvo para a empresa em todos os atendimentos.
              </p>
            </div>
            <div className="p-4 border-t border-border flex items-center justify-end gap-2 flex-wrap">
              <button
                onClick={() => setActiveReply(null)}
                className="h-9 px-3 rounded-md text-sm hover:bg-muted"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  navigator.clipboard
                    ?.writeText(replyText)
                    .then(() => toast.success("Copiado"))
                    .catch(() => toast.error("Falha ao copiar"));
                }}
                className="h-9 px-3 inline-flex items-center gap-1.5 rounded-md text-sm border border-border hover:bg-muted"
              >
                <Copy className="h-4 w-4" /> Copiar
              </button>
              <button
                type="button"
                disabled={savingReply || !companyId || !activeReply}
                onClick={async () => {
                  if (!companyId || !activeReply) return;
                  setSavingReply(true);
                  try {
                    const saved = await updateQuickReply(companyId, activeReply.id, {
                      content: replyText,
                    });
                    setQuickReplies((prev) =>
                      prev.map((r) => (r.id === saved.id ? (saved as QuickReply) : r)),
                    );
                    setActiveReply(saved as QuickReply);
                    toast.success("Texto padrão atualizado para a empresa");
                  } catch (e) {
                    const msg = e instanceof Error ? e.message : "Falha ao salvar";
                    toast.error(msg);
                  } finally {
                    setSavingReply(false);
                  }
                }}
                className="h-9 px-3 inline-flex items-center gap-1.5 rounded-md text-sm border border-primary text-primary hover:bg-primary/10 disabled:opacity-50"
              >
                {savingReply ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Salvar como padrão
              </button>
              <button
                type="button"
                onClick={async () => {
                  const t = replyText.trim();
                  if (!t) {
                    toast.error("Mensagem vazia");
                    return;
                  }
                  // Auto-salva se o texto foi alterado em relação ao salvo
                  if (companyId && activeReply && replyText !== activeReply.content) {
                    try {
                      const saved = await updateQuickReply(companyId, activeReply.id, {
                        content: replyText,
                      });
                      setQuickReplies((prev) =>
                        prev.map((r) => (r.id === saved.id ? (saved as QuickReply) : r)),
                      );
                    } catch (e) {
                      console.warn("[quick_reply auto-save]", e);
                    }
                  }
                  onSendText(t);
                  setActiveReply(null);
                }}
                className="h-9 px-4 inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground text-sm font-medium"
              >
                <Send className="h-4 w-4" /> Enviar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: preview + caption */}
      {pending && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={cancelPending}
        >
          <div
            className="bg-card rounded-lg border border-border max-w-lg w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div className="font-semibold text-sm">
                Enviar {pending.kind === "video" ? "vídeo" : "foto"}
                {pending.fileName ? ` · ${pending.fileName}` : ""}
              </div>
              <button onClick={cancelPending} className="p-1 hover:bg-muted rounded">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 max-h-[60vh] overflow-auto flex items-center justify-center bg-muted/30">
              {pending.kind === "video" ? (
                <video
                  src={pending.previewUrl}
                  controls
                  className="max-h-[55vh] max-w-full rounded"
                />
              ) : pending.path ? (
                <SmartImage
                  src={pending.previewUrl}
                  alt="Pré-visualização"
                  wrapperClassName="rounded max-h-[55vh] max-w-full"
                  className="object-contain"
                />
              ) : (
                <img
                  src={pending.previewUrl}
                  alt="Pré-visualização"
                  className="max-h-[55vh] max-w-full rounded object-contain"
                />
              )}
            </div>
            <div className="p-4 space-y-3 border-t border-border">
              {caption.trim() && (
                <div className="rounded-md bg-muted/40 border border-border px-3 py-2 text-xs text-foreground whitespace-pre-wrap leading-snug">
                  {caption}
                </div>
              )}
              <input
                type="text"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Legenda (opcional)"
                maxLength={1024}
                className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />

              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={cancelPending}
                  className="h-9 px-3 rounded-md text-sm hover:bg-muted"
                  disabled={sending}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void send();
                  }}
                  disabled={sending}
                  className="h-9 px-4 inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {sending ? "Enviando..." : "Enviar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {libraryOpen && (
        <ProductsLibraryModal
          onClose={() => setLibraryOpen(false)}
          onPick={selectFromLibrary}
        />
      )}

      {multiSendProgress && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] bg-card border border-border rounded-full shadow-lg px-4 py-2 text-sm flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Enviando fotos {multiSendProgress.current}/{multiSendProgress.total}…
        </div>
      )}
    </>
  );
}

function ProductsLibraryModal({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (items: LibraryPick[]) => void;
}) {
  const [, force] = useState(0);
  useEffect(() => subscribeProducts(() => force((n) => n + 1)), []);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const all = listProducts();
  const filtered = useMemo<Product[]>(
    () => all.filter((p) => productMatches(p, query)),
    [all, query],
  );
  const byCategory = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of filtered) {
      if (!p.images || p.images.length === 0) continue;
      const list = map.get(p.category) ?? [];
      list.push(p);
      map.set(p.category, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  // path → product (para preservar a associação imagem → produto na seleção
  // e ao montar a legenda). Prioriza o primeiro produto que declara a imagem.
  const imageToProduct = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of all) {
      for (const img of p.images ?? []) {
        if (!map.has(img)) map.set(img, p);
      }
    }
    return map;
  }, [all]);

  const toggle = (img: string) => {
    setSelected((prev) =>
      prev.includes(img) ? prev.filter((p) => p !== img) : [...prev, img],
    );
  };
  const clearSelection = () => setSelected([]);
  const confirmSend = () => {
    if (selected.length === 0) return;
    const items: LibraryPick[] = selected.map((path) => {
      const p = imageToProduct.get(path);
      return {
        path,
        productId: p?.id ?? "",
        caption: p ? buildProductCaption(p) : "",
      };
    });
    onPick(items);
  };


  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-lg border border-border max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
          <div className="font-semibold text-sm flex items-center gap-2">
            <LibraryIcon className="h-4 w-4" /> Biblioteca de Produtos
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar produto ou categoria…"
            className="flex-1 min-w-[180px] max-w-xs rounded-md bg-input px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <button onClick={onClose} className="p-1 hover:bg-muted rounded">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-4 py-2 border-b border-border text-[11px] text-muted-foreground">
          Toque nas fotos para selecionar várias. Toque novamente para desmarcar.
        </div>
        <div className="overflow-y-auto p-4 space-y-6 flex-1">
          {byCategory.length === 0 && (
            <div className="text-center text-sm text-muted-foreground py-12">
              Nenhuma foto disponível. Adicione fotos aos seus produtos em /produtos.
            </div>
          )}
          {byCategory.map(([cat, items]) => (
            <div key={cat}>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                {cat}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {items.flatMap((p) => {
                  const subtitle = buildProductCardSubtitle(p);
                  return (p.images ?? []).map((img, i) => {
                    const isSel = selected.includes(img);
                    const selIndex = isSel ? selected.indexOf(img) + 1 : 0;
                    return (
                      <button
                        key={`${p.id}-${i}`}
                        type="button"
                        onClick={() => toggle(img)}
                        className={cn(
                          "group relative rounded-md overflow-hidden border focus:outline-none focus:ring-2 focus:ring-ring transition text-left bg-background",
                          isSel
                            ? "border-primary ring-2 ring-primary"
                            : "border-border hover:border-primary",
                        )}
                        title={p.name}
                      >
                        <div className="relative">
                          <SmartImage
                            src={img}
                            alt={p.name}
                            aspectRatio="1/1"
                            wrapperClassName="w-full"
                            thumbWidth={320}
                            thumbQuality={72}
                          />
                          {isSel && (
                            <div className="absolute top-1 right-1 h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center shadow">
                              {selIndex}
                            </div>
                          )}
                        </div>
                        <div className="p-2 space-y-0.5">
                          <div className="text-xs font-semibold text-foreground line-clamp-2 leading-snug">
                            {p.name}
                          </div>
                          {subtitle && (
                            <div className="text-[11px] text-muted-foreground line-clamp-2 leading-snug">
                              {subtitle}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  });
                })}
              </div>
            </div>

          ))}
        </div>
        <div className="p-3 border-t border-border flex items-center justify-between gap-2 bg-card">
          <div className="text-xs text-muted-foreground">
            {selected.length === 0
              ? "Nenhuma foto selecionada"
              : `${selected.length} foto${selected.length > 1 ? "s" : ""} selecionada${selected.length > 1 ? "s" : ""}`}
          </div>
          <div className="flex items-center gap-2">
            {selected.length > 0 && (
              <button
                onClick={clearSelection}
                className="h-9 px-3 rounded-md text-sm hover:bg-muted"
              >
                Limpar
              </button>
            )}
            <button
              type="button"
              disabled={selected.length === 0}
              onClick={confirmSend}
              className="h-9 px-4 inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="h-4 w-4" />
              {selected.length > 1 ? `Enviar ${selected.length} selecionadas` : "Enviar selecionada"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConversationPage() {

  const { conversationId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [templatesModalOpen, setTemplatesModalOpen] = useState(false);
  // P3 — external store: re-render disparado apenas quando a versão do repo
  // muda. Substitui o `useState + useEffect(subscribeRepo)` que rerenderizava
  // com referências instáveis a cada notify().
  useSyncExternalStore(subscribeRepo, getRepoVersion, getRepoVersion);
  const conversation = getConversationById(conversationId);
  const lead = conversation ? getLeadById(conversation.leadId) : undefined;
  const repoMessages = conversation ? getMessagesFor(conversationId) : [];

  // `localMessages` guarda apenas adições otimistas (envios ainda não confirmados
  // pelo backend) e mensagens de sistema locais (ex.: "Venda fechada"). O Realtime
  // do leadRepo atualiza `repoMessages` automaticamente — não usamos useState para
  // a lista principal, senão mensagens novas só apareceriam ao reabrir a conversa.
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const messages = useMemo<Message[]>(() => {
    const ids = new Set(repoMessages.map((m) => m.id));
    const confirmedTextKeys = new Set(
      repoMessages
        .filter((m) => m.role === "agent")
        .map((m) => `${m.conversationId}\n${m.text.trim()}\n${m.at.slice(0, 16)}`),
    );
    const extras = localMessages.filter(
      (m) =>
        !ids.has(m.id) &&
        !(
          m.role === "agent" &&
          confirmedTextKeys.has(`${m.conversationId}\n${m.text.trim()}\n${m.at.slice(0, 16)}`)
        ),
    );
    return [...repoMessages, ...extras].sort(
      (a, b) => +new Date(a.at) - +new Date(b.at),
    );
  }, [repoMessages, localMessages]);

  // Onda 2.4: pré-filtra mensagens "apagadas só para mim" antes de passar para
  // o Virtuoso (a lista virtual não tolera itens null).
  const visibleMessages = useMemo<Message[]>(
    () => messages.filter((m) => !(m.deletedAt && m.deletedFor === "me")),
    [messages],
  );


  // Limpa otimistas que já foram absorvidos pelo repo (evita memória crescendo).
  useEffect(() => {
    if (localMessages.length === 0) return;
    const ids = new Set(repoMessages.map((m) => m.id));
    const confirmedTextKeys = new Set(
      repoMessages
        .filter((m) => m.role === "agent")
        .map((m) => `${m.conversationId}\n${m.text.trim()}\n${m.at.slice(0, 16)}`),
    );
    const shouldRemove = (m: Message) =>
      ids.has(m.id) ||
      (m.role === "agent" &&
        confirmedTextKeys.has(`${m.conversationId}\n${m.text.trim()}\n${m.at.slice(0, 16)}`));
    if (localMessages.some(shouldRemove)) {
      setLocalMessages((prev) => prev.filter((m) => !shouldRemove(m)));
    }
  }, [repoMessages, localMessages]);
  const [input, setInput] = useState("");
  const [audioState, setAudioState] = useState<"idle" | "recording" | "locked" | "processing" | "sending">("idle");
  const audioActive = audioState === "locked" || audioState === "processing" || audioState === "sending";
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const pendingTextSendsRef = useRef<Set<string>>(new Set());
  // Feature 3 — Reply V1: mensagem que o composer está citando (botão Responder).
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const replyComposeValue = useMemo(
    () => ({
      start: (m: Message) => {
        setReplyingTo(m);
        requestAnimationFrame(() => composerRef.current?.focus());
      },
    }),
    [],
  );

  // Auto-resize do textarea conforme o conteúdo (cap em max-h via CSS).
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);
  const [aiLoading, setAiLoading] = useState(false);
  const [ai, setAi] = useState<AISuggestion | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [nextActionOpen, setNextActionOpen] = useState(false);
  const [visitOpen, setVisitOpen] = useState(false);
  const [closedInfo, setClosedInfo] = useState<{ value: number; at: string } | null>(null);
  const [pendingQuote, setPendingQuote] = useState<Quote | null>(null);
  const [quoteSuggesting, setQuoteSuggesting] = useState(false);
  const [sendErrorState, setSendErrorState] = useState<{
    message: string;
    conversationId: string;
    at: number;
  } | null>(null);
  const sendError =
    sendErrorState && sendErrorState.conversationId === conversationId
      ? sendErrorState.message
      : null;
  const setSendError = useCallback(
    (msg: string | null) => {
      if (!msg) {
        setSendErrorState(null);
        return;
      }
      setSendErrorState({ message: msg, conversationId, at: Date.now() });
    },
    [conversationId],
  );
  // Limpa erro ao trocar de conversa e expira erro antigo (>15s) automaticamente.
  useEffect(() => {
    setSendErrorState((prev) =>
      prev && prev.conversationId !== conversationId ? null : prev,
    );
  }, [conversationId]);
  useEffect(() => {
    if (!sendErrorState) return;
    const remaining = 15000 - (Date.now() - sendErrorState.at);
    if (remaining <= 0) {
      setSendErrorState(null);
      return;
    }
    const t = setTimeout(() => setSendErrorState(null), remaining);
    return () => clearTimeout(t);
  }, [sendErrorState]);
  const [aiState, setAiState] = useState<{ ai_status: string | null; ai_handling: boolean } | null>(null);
  const [aiHandoffReason, setAiHandoffReason] = useState<string | null>(null);
  const [takingOver, setTakingOver] = useState(false);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const latestVisibleMessagesLengthRef = useRef(0);
  const renderedWindowRef = useRef<{
    renderedItems: number | null;
    firstItemIndex: number | null;
    lastItemIndex: number | null;
  }>({ renderedItems: null, firstItemIndex: null, lastItemIndex: null });
  const visibleRangeRef = useRef<{
    rangeStartIndex: number | null;
    rangeEndIndex: number | null;
  }>({ rangeStartIndex: null, rangeEndIndex: null });
  const readScrollVirtualSnapshot = useCallback((): InboxScrollVirtualSnapshot => {
    const totalItems = latestVisibleMessagesLengthRef.current;
    const domRenderedItems =
      inboxScrollTraceState.scroller?.querySelectorAll(INBOX_SCROLL_TRACE_SELECTOR).length ??
      null;
    const renderedItems = renderedWindowRef.current.renderedItems ?? domRenderedItems;
    return {
      totalItems,
      renderedItems,
      virtualizedItems:
        renderedItems === null ? null : Math.max(totalItems - renderedItems, 0),
      firstItemIndex: renderedWindowRef.current.firstItemIndex,
      lastItemIndex: renderedWindowRef.current.lastItemIndex,
      rangeStartIndex: visibleRangeRef.current.rangeStartIndex,
      rangeEndIndex: visibleRangeRef.current.rangeEndIndex,
    };
  }, []);
  // Controlador único de scroll da conversa. Uma única execução de
  // scrollToIndex por conversationId, disparada somente após threadLoad READY
  // e dois rAFs. Depois, mantém um "bottom lock" ativo enquanto o Virtuoso
  // recalibra alturas de itens virtualizados — a lista permanece ancorada
  // no último índice até que a altura total fique estável (debounce curto)
  // ou até o safety timeout, sem interferir se o usuário rolar manualmente.
  const initialScrollRef = useRef<{ cid: string | null; done: boolean }>({
    cid: null,
    done: false,
  });
  const lastMsgIdRef = useRef<string | null>(null);
  const cancelableR2Ref = useRef<number | null>(null);
  const userScrolledRef = useRef(false);
  const silentCorrectionDoneRef = useRef(false);
  const silentCorrectionTimerRef = useRef<number | null>(null);
  const atBottomRef = useRef(true);

  // ---- Bottom lock (hotfix: Virtuoso perde ancoragem ao recalibrar) ------
  const BOTTOM_LOCK_TOLERANCE_PX = 8;
  const BOTTOM_LOCK_STABLE_MS = 300;
  const BOTTOM_LOCK_SAFETY_MS = 2500;
  const bottomLockRef = useRef<{
    cid: string | null;
    active: boolean;
    lastHeight: number | null;
    correctionCount: number;
    stableTimer: number | null;
    safetyTimer: number | null;
  }>({
    cid: null,
    active: false,
    lastHeight: null,
    correctionCount: 0,
    stableTimer: null,
    safetyTimer: null,
  });

  const clearBottomLockTimers = useCallback(() => {
    const s = bottomLockRef.current;
    if (s.stableTimer !== null) {
      window.clearTimeout(s.stableTimer);
      s.stableTimer = null;
    }
    if (s.safetyTimer !== null) {
      window.clearTimeout(s.safetyTimer);
      s.safetyTimer = null;
    }
  }, []);

  const releaseBottomLock = useCallback(
    (reason: string, event: "BOTTOM_LOCK_STABLE" | "BOTTOM_LOCK_TIMEOUT" | "BOTTOM_LOCK_CANCELLED_BY_USER") => {
      const s = bottomLockRef.current;
      if (!s.active) return;
      s.active = false;
      clearBottomLockTimers();
      traceInboxScroll(event === "BOTTOM_LOCK_CANCELLED_BY_USER" ? "USER_SCROLL" : "SCROLL_CONTROLLER", event, {
        reason,
        corrections: s.correctionCount,
        lastHeight: s.lastHeight,
      });
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.debug(`[inbox-scroll] ${event}`, { reason, corrections: s.correctionCount });
      }
    },
    [clearBottomLockTimers],
  );

  const cancelBottomLockByUser = useCallback(
    (source: string) => {
      const s = bottomLockRef.current;
      if (!s.active) return;
      userScrolledRef.current = true;
      releaseBottomLock(source, "BOTTOM_LOCK_CANCELLED_BY_USER");
    },
    [releaseBottomLock],
  );

  const anchorLastAuto = useCallback((source: string) => {
    const last = latestVisibleMessagesLengthRef.current - 1;
    if (last < 0) return;
    markInboxScrollIntent("SCROLL_CONTROLLER", "scrollToIndex_CALL", {
      source,
      index: last,
      align: "end",
      behavior: "auto",
    });
    virtuosoRef.current?.scrollToIndex({ index: last, align: "end", behavior: "auto" });
  }, []);

  const scheduleBottomLockStability = useCallback(() => {
    const s = bottomLockRef.current;
    if (!s.active) return;
    if (s.stableTimer !== null) window.clearTimeout(s.stableTimer);
    s.stableTimer = window.setTimeout(() => {
      s.stableTimer = null;
      if (!bottomLockRef.current.active) return;
      const scroller = inboxScrollTraceState.scroller;
      const totalItems = latestVisibleMessagesLengthRef.current;
      const lastIdx = renderedWindowRef.current.lastItemIndex;
      const distance =
        scroller ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight : null;
      const nearBottom = distance !== null && distance <= BOTTOM_LOCK_TOLERANCE_PX;
      const lastRendered = lastIdx !== null && lastIdx >= totalItems - 1;
      if (nearBottom && lastRendered) {
        releaseBottomLock("stable", "BOTTOM_LOCK_STABLE");
      } else {
        // Ainda instável — corrige e reagenda.
        if (!userScrolledRef.current && distance !== null && distance > BOTTOM_LOCK_TOLERANCE_PX) {
          bottomLockRef.current.correctionCount += 1;
          traceInboxScroll("SCROLL_CONTROLLER", "BOTTOM_LOCK_CORRECTION", {
            trigger: "stability_recheck",
            distance,
            corrections: bottomLockRef.current.correctionCount,
          });
          anchorLastAuto("bottom_lock_stability_recheck");
        }
        scheduleBottomLockStability();
      }
    }, BOTTOM_LOCK_STABLE_MS);
  }, [anchorLastAuto, releaseBottomLock]);

  const startBottomLock = useCallback(
    (cid: string) => {
      const s = bottomLockRef.current;
      clearBottomLockTimers();
      s.cid = cid;
      s.active = true;
      s.lastHeight = inboxScrollTraceState.scroller?.scrollHeight ?? null;
      s.correctionCount = 0;
      traceInboxScroll("SCROLL_CONTROLLER", "BOTTOM_LOCK_START", {
        cid,
        initialHeight: s.lastHeight,
      });
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.debug("[inbox-scroll] BOTTOM_LOCK_START", cid);
      }
      s.safetyTimer = window.setTimeout(() => {
        releaseBottomLock("safety_timeout", "BOTTOM_LOCK_TIMEOUT");
      }, BOTTOM_LOCK_SAFETY_MS);
      scheduleBottomLockStability();
    },
    [clearBottomLockTimers, releaseBottomLock, scheduleBottomLockStability],
  );

  const reanchorIfLocked = useCallback(
    (trigger: string, extra?: Record<string, unknown>) => {
      const s = bottomLockRef.current;
      if (!s.active) return;
      if (userScrolledRef.current) {
        releaseBottomLock("user_scrolled", "BOTTOM_LOCK_CANCELLED_BY_USER");
        return;
      }
      const scroller = inboxScrollTraceState.scroller;
      const distance = scroller
        ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
        : null;
      // Guard idempotência: já está no fundo, apenas reagenda estabilidade.
      if (distance !== null && distance <= BOTTOM_LOCK_TOLERANCE_PX) {
        scheduleBottomLockStability();
        return;
      }
      s.correctionCount += 1;
      traceInboxScroll("SCROLL_CONTROLLER", "BOTTOM_LOCK_CORRECTION", {
        trigger,
        distance,
        corrections: s.correctionCount,
        ...(extra ?? {}),
      });
      anchorLastAuto(`bottom_lock_${trigger}`);
      scheduleBottomLockStability();
    },
    [anchorLastAuto, releaseBottomLock, scheduleBottomLockStability],
  );

  // Registra o cancelador para wrappers estáticos do scroller (wheel/touch/pointer).
  useEffect(() => {
    setInboxBottomLockCancelHandler(cancelBottomLockByUser);
    return () => setInboxBottomLockCancelHandler(null);
  }, [cancelBottomLockByUser]);

  const [atBottom, _setAtBottom] = useState(true);
  const setAtBottom = useCallback((v: boolean) => {
    atBottomRef.current = v;
    _setAtBottom(v);
    traceInboxScroll("OUTRO", "AT_BOTTOM_STATE_CHANGE", { atBottom: v });
    // Após o scroll inicial, sair do fim = interação manual do usuário.
    if (!v && initialScrollRef.current.done) {
      // Se o bottom lock ainda estiver ativo, este "false" pode ser
      // consequência da própria recalibração — só cancelamos se o usuário
      // já for a origem conhecida (userScrolledRef) ou se o lock já saiu.
      if (!bottomLockRef.current.active) {
        if (!userScrolledRef.current && import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.debug("[inbox-scroll] USER_CANCELLED_AUTOSCROLL");
        }
        userScrolledRef.current = true;
      }
    }
  }, []);
  const [newSinceCount, setNewSinceCount] = useState(0);

  useEffect(() => {
    latestVisibleMessagesLengthRef.current = visibleMessages.length;
    if (import.meta.env.DEV) {
      const first = visibleMessages[0];
      const last = visibleMessages[visibleMessages.length - 1];
      // Instrumentação da regressão "só última mensagem": auditoria dos
      // números que chegam ao Virtuoso em cada notify() do repo.
      // eslint-disable-next-line no-console
      console.debug("[inbox-data]", {
        conversationId,
        repoMessages: repoMessages.length,
        localMessages: localMessages.length,
        visible: visibleMessages.length,
        firstId: first?.id?.slice(0, 8) ?? null,
        lastId: last?.id?.slice(0, 8) ?? null,
        firstAt: first?.at ?? null,
        lastAt: last?.at ?? null,
      });
    }
  }, [visibleMessages, conversationId, repoMessages.length, localMessages.length]);



  // Reset por conversa: novo controlador, sem contagens antigas.
  useEffect(() => {
    initialScrollRef.current = { cid: conversationId, done: false };
    lastMsgIdRef.current = null;
    renderedWindowRef.current = {
      renderedItems: null,
      firstItemIndex: null,
      lastItemIndex: null,
    };
    visibleRangeRef.current = {
      rangeStartIndex: null,
      rangeEndIndex: null,
    };
    userScrolledRef.current = false;
    silentCorrectionDoneRef.current = false;
    if (silentCorrectionTimerRef.current) {
      window.clearTimeout(silentCorrectionTimerRef.current);
      silentCorrectionTimerRef.current = null;
    }
    // Cancela lock da conversa anterior (se houver) antes de abrir a nova.
    if (bottomLockRef.current.active) {
      releaseBottomLock("conversation_switch", "BOTTOM_LOCK_CANCELLED_BY_USER");
    }
    clearBottomLockTimers();
    bottomLockRef.current = {
      cid: conversationId,
      active: false,
      lastHeight: null,
      correctionCount: 0,
      stableTimer: null,
      safetyTimer: null,
    };
    atBottomRef.current = true;
    _setAtBottom(true);
    setNewSinceCount(0);
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug("[inbox-scroll] OPEN", conversationId);
    }
    startInboxScrollTrace(conversationId, readScrollVirtualSnapshot);
    return () => stopInboxScrollTrace(conversationId);
  }, [conversationId, readScrollVirtualSnapshot, clearBottomLockTimers, releaseBottomLock]);




  // ---- Manual follow-up (admin only) ----
  const { profile: authProfile } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (!authProfile?.id || !authProfile.company_id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc("has_role", {
        _user_id: authProfile.id,
        _company_id: authProfile.company_id,
        _role: "admin",
      });
      if (!cancelled) setIsAdmin(Boolean(data));
    })();
    return () => {
      cancelled = true;
    };
  }, [authProfile?.id, authProfile?.company_id]);
  const [manualRunning, setManualRunning] = useState(false);
  const [manualResult, setManualResult] = useState<ManualFollowupResult | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const runManualFollowup = useServerFn(runFollowupNowForConversation);
  const handleManualFollowup = useCallback(async () => {
    if (manualRunning) return;
    setManualRunning(true);
    setManualError(null);
    setManualResult(null);
    try {
      const res = await runManualFollowup({ data: { conversationId } });
      setManualResult(res);
      if (res.sendStatus === "sent") toast.success("Follow-up enviado");
      else if (res.sendStatus === "failed") toast.error("Falha ao enviar follow-up");
      else if (!res.eligible) toast.message("Follow-up bloqueado", { description: res.blockedReason });
    } catch (e) {
      setManualError(e instanceof Error ? e.message : String(e));
      toast.error("Erro ao executar follow-up");
    } finally {
      setManualRunning(false);
    }
  }, [conversationId, manualRunning, runManualFollowup]);



  // P3 — `aiState` deriva do objeto `conversation` do leadRepo, que já
  // assina `conversations *` via Realtime global. A subscription duplicada
  // `conv-ai-${conversationId}` foi removida (double-render, listener órfão
  // e crescimento de canais ao trocar de conversa).
  useEffect(() => {
    if (!conversation) return;
    setAiState({
      ai_status: conversation.aiStatus ?? null,
      ai_handling: conversation.aiHandling ?? false,
    });
  }, [conversation]);

  // Motivo do último handoff — vive em `ai_flow_events` (não no repo).
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("ai_flow_events")
        .select("payload, event_type, created_at")
        .eq("conversation_id", conversationId)
        .in("event_type", ["handoff_requested", "handoff_safety_block"])
        .order("created_at", { ascending: false })
        .limit(1);
      if (!cancelled && data && data[0]) {
        const p = (data[0].payload ?? {}) as { reason?: string };
        setAiHandoffReason(p.reason ?? data[0].event_type);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const handleTakeover = async () => {
    if (takingOver) return;
    setTakingOver(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const res = await fetch("/api/ai/agent-takeover", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Falha ao assumir");
      setAiState({ ai_status: "assumido_humano", ai_handling: false });
      toast.success("Você assumiu o atendimento. IA pausada para esta conversa.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao assumir atendimento");
    } finally {
      setTakingOver(false);
    }
  };

  // Quando voltamos da tela de orçamentos com ?quote=<id>, carrega o orçamento
  // pronto para envio acima do campo de mensagem.
  useEffect(() => {
    if (search.quote) {
      const q = getQuote(search.quote);
      if (q) setPendingQuote(q);
      navigate({
        to: "/inbox/$conversationId",
        params: { conversationId },
        search: {},
        replace: true,
      });
    }
  }, [search.quote, conversationId, navigate]);

  // P3 — carregamento resiliente da conversa. Substitui o `void loadConversationRecent`
  // silencioso por estados explícitos + retry, evitando loading eterno e F5.
  // Usa request token para descartar respostas atrasadas de conversas anteriores.
  const repoMode = useSyncExternalStore(subscribeRepo, getRepoMode, getRepoMode);
  const [threadLoad, setThreadLoad] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    error?: string;
  }>({ status: "idle" });
  const threadTokenRef = useRef(0);

  const loadThread = useCallback(async () => {
    if (!conversationId) return;
    const token = ++threadTokenRef.current;
    setThreadLoad({ status: "loading" });
    const timeoutMs = 15000;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      if (threadTokenRef.current === token) {
        setThreadLoad({ status: "error", error: "Tempo de carregamento excedido" });
      }
    }, timeoutMs);
    try {
      traceInboxScroll("INITIAL_LOAD", "LOAD_RECENT_START", { limit: 100 });
      const res = await loadConversationRecent(conversationId, 100);
      if (threadTokenRef.current !== token || timedOut) return;
      window.clearTimeout(timeoutId);
      traceInboxScroll(res.ok ? "INITIAL_LOAD" : "OUTRO", "LOAD_RECENT_DONE", {
        ok: res.ok,
        error: res.error ?? null,
      });
      setThreadLoad(
        res.ok
          ? { status: "ready" }
          : { status: "error", error: res.error ?? "Falha ao carregar" },
      );
    } catch (e) {
      if (threadTokenRef.current !== token) return;
      window.clearTimeout(timeoutId);
      setThreadLoad({
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }, [conversationId]);

  useEffect(() => {
    void loadThread();
  }, [loadThread, repoMode]);

  const retryLoadThread = useCallback(() => {
    resetConversationRecentLoaded(conversationId);
    void loadThread();
  }, [conversationId, loadThread]);

  // ---- Scroll controller (hotfix) --------------------------------------
  // Um único scroll automático por conversationId, disparado somente
  // após threadLoad READY + 2 rAFs (layout estabilizado).
  useEffect(() => {
    if (threadLoad.status !== "ready") return;
    if (visibleMessages.length === 0) return;
    const state = initialScrollRef.current;
    if (state.cid !== conversationId || state.done) return;
    state.done = true;
    const r1 = requestAnimationFrame(() => {
      const r2 = requestAnimationFrame(() => {
        if (initialScrollRef.current.cid !== conversationId) return;
        const last = latestVisibleMessagesLengthRef.current - 1;
        if (last < 0) return;
        markInboxScrollIntent("SCROLL_CONTROLLER", "scrollToIndex_CALL", {
          source: "initial_position",
          index: last,
          align: "end",
          behavior: "auto",
        });
        virtuosoRef.current?.scrollToIndex({
          index: last,
          align: "end",
          behavior: "auto",
        });
        lastMsgIdRef.current =
          visibleMessages[visibleMessages.length - 1]?.id ?? null;
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.debug("[inbox-scroll] INITIAL_POSITION", conversationId, last);
        }
        // Ativa o bottom lock: qualquer recalibração de altura/range
        // enquanto o usuário não interagir reancorará no último item.
        startBottomLock(conversationId);
        // Correção silenciosa única: absorve mudanças de altura por decode
        // de imagens/vídeos após o primeiro posicionamento. Cancelada por
        // qualquer scroll manual do usuário.
        if (silentCorrectionTimerRef.current) {
          window.clearTimeout(silentCorrectionTimerRef.current);
        }
        silentCorrectionTimerRef.current = window.setTimeout(() => {
          silentCorrectionTimerRef.current = null;
          if (initialScrollRef.current.cid !== conversationId) return;
          if (silentCorrectionDoneRef.current) return;
          if (userScrolledRef.current) return;
          if (!atBottomRef.current) return;
          const lastIdx = latestVisibleMessagesLengthRef.current - 1;
          if (lastIdx < 0) return;
          silentCorrectionDoneRef.current = true;
          markInboxScrollIntent("SCROLL_CONTROLLER", "scrollToIndex_CALL", {
            source: "final_correction",
            index: lastIdx,
            align: "end",
            behavior: "auto",
          });
          virtuosoRef.current?.scrollToIndex({
            index: lastIdx,
            align: "end",
            behavior: "auto",
          });
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.debug("[inbox-scroll] FINAL_CORRECTION", conversationId, lastIdx);
          }
        }, 800);
      });
      cancelableR2Ref.current = r2;
    });
    return () => {
      cancelAnimationFrame(r1);
      if (cancelableR2Ref.current) cancelAnimationFrame(cancelableR2Ref.current);
    };
  }, [threadLoad.status, conversationId, visibleMessages.length, startBottomLock]);

  // Detecta chegada de nova mensagem após o scroll inicial. Se o usuário
  // não estiver próximo do fim, incrementa contador para o pill "Novas
  // mensagens" — nunca move a tela.
  useEffect(() => {
    if (!initialScrollRef.current.done) return;
    const last = visibleMessages[visibleMessages.length - 1];
    if (!last) return;
    if (lastMsgIdRef.current === last.id) return;
    const isRealNew = lastMsgIdRef.current !== null;
    lastMsgIdRef.current = last.id;
    if (isRealNew) {
      traceInboxScroll("REALTIME", "LAST_MESSAGE_CHANGED", {
        messageId: last.id,
        atBottom,
      });
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.debug("[inbox-scroll] NEW_MESSAGE", last.id, { atBottom });
      }
      if (!atBottom) setNewSinceCount((n) => n + 1);
    }
  }, [visibleMessages, atBottom]);

  // Zera o contador quando o usuário volta ao fim.
  useEffect(() => {
    if (atBottom && newSinceCount > 0) setNewSinceCount(0);
  }, [atBottom, newSinceCount]);

  const scrollToBottomManual = useCallback(() => {
    const last = latestVisibleMessagesLengthRef.current - 1;
    if (last < 0) return;
    markInboxScrollIntent("USER_SCROLL", "scrollToIndex_CALL", {
      source: "manual_bottom_button",
      index: last,
      align: "end",
      behavior: "smooth",
    });
    virtuosoRef.current?.scrollToIndex({
      index: last,
      align: "end",
      behavior: "smooth",
    });
    setNewSinceCount(0);
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug("[inbox-scroll] USER_SCROLL → bottom");
    }
  }, []);

  const handleVirtuosoItemsRendered = useCallback((items: ListItem<Message>[]) => {
    const indexes = items.map((item) => item.index);
    renderedWindowRef.current = {
      renderedItems: items.length,
      firstItemIndex: indexes.length ? Math.min(...indexes) : null,
      lastItemIndex: indexes.length ? Math.max(...indexes) : null,
    };
    traceInboxScroll("OUTRO", "ITEMS_RENDERED", {
      indexes,
      itemIds: items
        .map((item) => item.data?.id)
        .filter((id): id is string => typeof id === "string"),
    });
    reanchorIfLocked("items_rendered");
  }, [reanchorIfLocked]);

  const handleVirtuosoRangeChanged = useCallback((range: ListRange) => {
    visibleRangeRef.current = {
      rangeStartIndex: range.startIndex,
      rangeEndIndex: range.endIndex,
    };
    traceInboxScroll("OUTRO", "RANGE_CHANGED", {
      startIndex: range.startIndex,
      endIndex: range.endIndex,
    });
    reanchorIfLocked("range_changed", {
      startIndex: range.startIndex,
      endIndex: range.endIndex,
    });
  }, [reanchorIfLocked]);

  const handleVirtuosoTotalListHeightChanged = useCallback((height: number) => {
    const s = bottomLockRef.current;
    const prev = s.lastHeight;
    s.lastHeight = height;
    traceInboxScroll("OUTRO", "TOTAL_HEIGHT_CHANGED", {
      previous: prev,
      next: height,
      locked: s.active,
    });
    reanchorIfLocked("total_height_changed", { previous: prev, next: height });
  }, [reanchorIfLocked]);

  const handleVirtuosoFollowOutput = useCallback((isAtBottom: boolean) => {
    const decision = isAtBottom ? "auto" : false;
    if (decision === "auto") {
      markInboxScrollIntent("FOLLOW_OUTPUT", "FOLLOW_OUTPUT", {
        isAtBottom,
        decision,
      });
    } else {
      traceInboxScroll("FOLLOW_OUTPUT", "FOLLOW_OUTPUT", {
        isAtBottom,
        decision,
      });
    }
    return decision;
  }, []);


  // Onda 2.4: paginação de histórico via Virtuoso (`startReached`).
  const olderLoadingRef = useRef(false);
  const [hasMoreOlder, setHasMoreOlder] = useState<boolean>(() =>
    hasMoreOlderMessages(conversationId),
  );
  useEffect(() => {
    setHasMoreOlder(hasMoreOlderMessages(conversationId));
  }, [conversationId]);

  const loadOlder = useCallback(() => {
    traceInboxScroll("USER_SCROLL", "START_REACHED", {
      conversationId,
      hasMoreOlder: hasMoreOlderMessages(conversationId),
    });
    // Carregar histórico antigo é uma navegação intencional para cima:
    // cancela o bottom lock imediatamente para não puxar a lista de volta.
    cancelBottomLockByUser("start_reached_load_older");
    if (olderLoadingRef.current) return;
    if (!hasMoreOlderMessages(conversationId)) {
      setHasMoreOlder(false);
      return;
    }
    const oldest = messages.find((m) => m.role !== "system");
    if (!oldest) return;
    olderLoadingRef.current = true;
    void loadConversationOlder(conversationId, oldest.at, oldest.id, 50)
      .then((res) => {
        setHasMoreOlder(res.hasMore);
      })
      .finally(() => {
        olderLoadingRef.current = false;
      });
  }, [conversationId, messages, cancelBottomLockByUser]);








  const settings = useSyncExternalStore(subscribeSettings, getSettings, getSettings);

  const isHotStale = useMemo(() => {
    if (!lead || !conversation) return false;
    if (closedInfo) return false;
    if (lead.status !== "quente") return false;
    if (!conversation.awaitingReply) return false;
    const lastLead = [...messages].reverse().find((m) => m.role === "lead");
    const ref = lastLead?.at ?? conversation.lastMessageAt;
    const minutes = (Date.now() - new Date(ref).getTime()) / 60_000;
    return minutes >= settings.slaMinutes;
  }, [lead, conversation, messages, closedInfo, settings.slaMinutes]);

  if (!conversation || !lead) {
    return (
      <div className="flex-1 p-8">
        <p>Conversa não encontrada.</p>
        <Link to="/inbox" className="text-primary hover:underline">
          Voltar
        </Link>
      </div>
    );
  }

  const lastIncoming = [...messages].reverse().find((m) => m.role === "lead");
  const origin = getConversationOrigin(
    lead,
    lastIncoming ?? messages[messages.length - 1],
    conversation,
  );
  const isComment =
    conversation.interactionType === "comment" ||
    origin === "instagram_comment" ||
    origin === "facebook_comment" ||
    origin === "comment";
  const commentMeta = (lastIncoming?.sourceMetadata ?? {}) as {
    comment_id?: string;
    post_id?: string;
    media_id?: string;
  };

  const sendMessage = async (text: string) => {
    const rawTrimmed = text.trim();
    if (!rawTrimmed) return;

    // Snapshot do "respondendo a" no momento do envio para evitar race condition
    // caso o usuário troque a citação enquanto a requisição está em voo.
    const replySnapshot = replyingTo;
    const replyExternalId = replySnapshot
      ? (((replySnapshot as unknown as { externalId?: string | null }).externalId ?? null) ||
          ((replySnapshot.sourceMetadata as { external_id?: string } | undefined)?.external_id ?? null))
      : null;

    // Fallback: se a mensagem citada não tiver external_id (não existe no WhatsApp
    // como mensagem citável), enviamos pelo fluxo normal prefixando o texto com
    // uma citação simples. Não chamamos send-reply nesse caso.
    const buildQuotedPreview = (m: Message): string => {
      const t = (m.text ?? "").trim();
      if (t) return t.length > 160 ? `${t.slice(0, 160)}…` : t;
      const sub = (m.sourceSubtype ?? "").toLowerCase();
      if (sub === "image") return "📷 Foto";
      if (sub === "video") return "🎥 Vídeo";
      if (sub === "audio") return "🎤 Áudio";
      if (sub === "document") return "📎 Documento";
      if (sub === "sticker") return "🌟 Sticker";
      if (sub === "location") return "📍 Localização";
      return "[mensagem]";
    };

    const trimmed =
      replySnapshot && !replyExternalId
        ? `Respondendo:\n\n"${buildQuotedPreview(replySnapshot)}"\n\n${rawTrimmed}`
        : rawTrimmed;

    const sendKey = `${conversationId}\n${trimmed}`;
    if (pendingTextSendsRef.current.has(sendKey)) return;
    pendingTextSendsRef.current.add(sendKey);
    const finishSend = () => pendingTextSendsRef.current.delete(sendKey);
    const msg: Message = {
      id: `local-${Date.now()}`,
      conversationId,
      role: "agent",
      text: trimmed,
      at: new Date().toISOString(),
    };
    setLocalMessages((prev: Message[]) => [...prev, msg]);
    setInput("");
    setSendError(null);
    if (replySnapshot && !replyExternalId) setReplyingTo(null);

    const isWhatsApp = lead?.channel === "whatsapp";
    if (profile?.company_id) {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        if (token) {
          if (isWhatsApp && replySnapshot && replyExternalId) {

            // Feature 3 — Reply V1: endpoint dedicado, NÃO altera send-message.
            const res = await fetch("/api/whatsapp/send-reply", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                conversationId,
                text: trimmed,
                replyToMessageId: replySnapshot.id,
              }),
            });
            if (res.ok) {
              const saved = (await res.json().catch(() => null)) as SendTextResult | null;
              if (saved?.id) {
                setLocalMessages((prev: Message[]) => prev.filter((m) => m.id !== msg.id));
                await refetchConversationMessages(conversationId);
              }
              setReplyingTo(null);
              finishSend();
              return;
            }
            let errMsg = `HTTP ${res.status}`;
            try {
              const j = (await res.json()) as { error?: string };
              if (j.error) errMsg = j.error;
              console.error("[chat send-reply] falhou", j);
            } catch { /* ignore */ }
            setLocalMessages((prev: Message[]) => prev.filter((m) => m.id !== msg.id));
            setSendError(errMsg);
            toast.error("Falha ao responder no WhatsApp", { description: errMsg });
            finishSend();
            return;
          }
          if (isWhatsApp) {
            // WhatsApp Cloud API — mesma rota usada pelo "Enviar teste"
            const res = await fetch("/api/whatsapp/send", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ conversationId, text: trimmed }),
            });
            if (res.ok) {
              const saved = (await res.json().catch(() => null)) as SendTextResult | null;
              if (saved?.id) {
                setLocalMessages((prev: Message[]) => prev.filter((m) => m.id !== msg.id));
                await refetchConversationMessages(conversationId);
              }
              finishSend();
              return;
            }
            // Falhou: remove a bolha otimista e mostra o erro real da Meta
            let errMsg = `HTTP ${res.status}`;
            try {
              const j = (await res.json()) as { error?: string; metaError?: unknown };
              if (j.error) errMsg = j.error;
              console.error("[chat send] WhatsApp falhou", j);
            } catch {
              /* ignore */
            }
            setLocalMessages((prev: Message[]) => prev.filter((m) => m.id !== msg.id));
            setSendError(errMsg);
            toast.error("Falha ao enviar WhatsApp", { description: errMsg });
            finishSend();
            return;
          } else {
            // Meta (Instagram / Facebook / Messenger / Comentário) → meta-send edge function
            const providerType =
              origin === "instagram_comment"
                ? "instagram_comment"
                : origin === "instagram_direct"
                  ? "instagram_direct"
                  : origin;
            const subtype =
              origin === "instagram_comment" ||
              origin === "facebook_comment" ||
              origin === "comment"
                ? "comment"
                : "dm";
            const { data, error } = await supabase.functions.invoke("meta-send", {
              body: {
                conversationId,
                leadId: lead.id,
                text: trimmed,
                subtype,
                origin,
                provider_type: providerType,
              },
            });
            const ok = !error && (data as { ok?: boolean } | null)?.ok === true;
            if (ok) {
              const saved = data as SendTextResult | null;
              if (saved?.id) {
                setLocalMessages((prev: Message[]) => prev.filter((m) => m.id !== msg.id));
                await refetchConversationMessages(conversationId);
              }
              finishSend();
              return;
            }
            const details = await readFunctionError(error, data);
            console.error("[chat send] Meta falhou", {
              origin,
              providerType,
              subtype,
              error,
              data,
              full: details.full,
            });
            setLocalMessages((prev: Message[]) => prev.filter((m) => m.id !== msg.id));
            setSendError(details.message);
            const label =
              origin === "instagram_direct" || origin === "instagram_comment"
                ? "Instagram"
                : origin === "messenger"
                  ? "Messenger"
                  : "Meta";
            toast.error(`Falha ao enviar ${label}`, { description: details.message });
            finishSend();
            return;
          }
        }
      } catch (e) {
        console.error("[chat send] erro", e);
        setLocalMessages((prev: Message[]) => prev.filter((m) => m.id !== msg.id));
        setSendError(e instanceof Error ? e.message : "Erro de rede");
        toast.error("Falha ao enviar mensagem", {
          description: e instanceof Error ? e.message : "Erro de rede",
        });
        finishSend();
        return;
      }
    }

    void appendMessage(msg, profile?.company_id);
    finishSend();
  };

  const markAiSent = async (logId: string, sentText: string, originalText: string) => {
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) return;
      await fetch("/api/ai/mark-sent", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          logId,
          sentText,
          wasEdited: sentText.trim() !== originalText.trim(),
        }),
      });
    } catch (e) {
      console.warn("[AI_MARK_SENT_CLIENT]", e);
    }
  };

  const sendSuggestion = () => {
    if (!ai?.suggestedReply) return;
    const text = ai.suggestedReply;
    const logId = ai.logId;
    sendMessage(text);
    if (logId) void markAiSent(logId, text, text);
    setAi(null);
  };

  const generateAI = async () => {
    setAiLoading(true);
    setAiError(null);
    setAi(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sessão expirada. Faça login novamente.");
      const res = await fetch("/api/ai/suggest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          leadName: lead.name,
          channel: lead.channel,
          product: lead.product,
          tags: lead.tags,
          conversationId,
          leadId: lead.id,
          messages: messages.map((m) => messageForAi(m)),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Erro ${res.status}`);
      }
      const data = (await res.json()) as AISuggestion;
      setAi(data);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Falha ao gerar sugestão");
    } finally {
      setAiLoading(false);
    }
  };

  const handleConfirmClose = (value: number) => {
    setClosedInfo({ value, at: new Date().toISOString() });
    setCloseOpen(false);
    if (lead) {
      void markLeadWon(lead.id, value);
      recordAudit({
        action: "mark_lead_won",
        entity: "lead",
        entityId: lead.id,
        after: { value },
      });
    }
    setLocalMessages((prev: Message[]) => [
      ...prev,
      {
        id: `sys-${Date.now()}`,
        conversationId,
        role: "system",
        text: `✅ Venda fechada — ${formatBRL(value)}`,
        at: new Date().toISOString(),
      },
    ]);
  };

  const confirmLost = (reason: string, notes?: string) => {
    if (!lead) return;
    void markLeadLost(lead.id, reason);
    recordAudit({
      action: "mark_lead_lost",
      entity: "lead",
      entityId: lead.id,
      after: { reason, notes: notes ?? null },
    });
    setLostOpen(false);
    setClosedInfo({ value: 0, at: new Date().toISOString() });
    const detail = notes ? ` — ${reason} (${notes})` : ` — ${reason}`;
    setLocalMessages((prev: Message[]) => [
      ...prev,
      {
        id: `sys-${Date.now()}`,
        conversationId,
        role: "system",
        text: `❌ Lead marcado como perdido${detail}`,
        at: new Date().toISOString(),
      },
    ]);
    toast.success("Lead marcado como perdido");
  };

  const confirmNextAction = async (payload: {
    label: string;
    dueAt: string;
    notes?: string;
  }) => {
    if (!lead) return;
    try {
      await updateLeadNextAction(lead.id, { label: payload.label, dueAt: payload.dueAt });
      recordAudit({
        action: "create_next_action",
        entity: "lead",
        entityId: lead.id,
        after: payload,
      });
      setLocalMessages((prev: Message[]) => [
        ...prev,
        {
          id: `sys-${Date.now()}`,
          conversationId,
          role: "system",
          text: `🎯 Próxima ação: ${payload.label} — ${new Date(payload.dueAt).toLocaleString("pt-BR")}`,
          at: new Date().toISOString(),
        },
      ]);
      setNextActionOpen(false);
      toast.success("Próxima ação criada");
    } catch (e) {
      console.error(e);
      toast.error("Erro ao salvar próxima ação");
    }
  };

  const confirmVisit = async (payload: {
    date: string;
    time: string;
    address: string;
    appointmentType: "visita_tecnica" | "loja" | "retorno_comercial" | "instalacao";
    confirmed: boolean;
    notes: string;
  }) => {
    if (!lead || !authProfile?.company_id) return;
    const scheduledAt = new Date(`${payload.date}T${payload.time}:00`).toISOString();
    const typeLabel: Record<string, string> = {
      visita_tecnica: "Visita técnica",
      loja: "Cliente na loja",
      retorno_comercial: "Retorno comercial",
      instalacao: "Instalação",
    };
    try {
      const { data, error } = await supabase
        .from("visits")
        .insert({
          company_id: authProfile.company_id,
          title: `${typeLabel[payload.appointmentType]} — ${lead.name}`,
          appointment_type: payload.appointmentType,
          address: payload.appointmentType === "loja" ? null : payload.address || null,
          scheduled_at: scheduledAt,
          status: payload.confirmed ? "confirmada" : "agendada",
          notes: payload.notes || null,
          customer_name: lead.name,
          customer_phone: lead.phone ?? null,
          product: lead.product ?? null,
          lead_id: lead.id,
        })
        .select("id")
        .single();
      if (error) throw error;
      recordAudit({
        action: "schedule_visit",
        entity: "visit",
        entityId: data?.id ?? null,
        after: { leadId: lead.id, scheduledAt, type: payload.appointmentType },
      });
      // Sincroniza também como próxima ação do lead
      await updateLeadNextAction(lead.id, {
        label: typeLabel[payload.appointmentType],
        dueAt: scheduledAt,
      });
      setLocalMessages((prev: Message[]) => [
        ...prev,
        {
          id: `sys-${Date.now()}`,
          conversationId,
          role: "system",
          text: `📅 ${typeLabel[payload.appointmentType]} agendada — ${new Date(scheduledAt).toLocaleString("pt-BR")}`,
          at: new Date().toISOString(),
        },
      ]);
      setVisitOpen(false);
      toast.success("Visita agendada");
    } catch (e) {
      console.error(e);
      toast.error("Erro ao agendar visita");
    }
  };


  const sendPendingQuote = () => {
    if (!pendingQuote) return;
    sendMessage(pendingQuote.message);
    markQuoteSent(pendingQuote.id);
    setLocalMessages((prev: Message[]) => [
      ...prev,
      {
        id: `sys-${Date.now()}`,
        conversationId,
        role: "system",
        text: `📄 Orçamento enviado — ${pendingQuote.productName} • ${formatBRL(pendingQuote.finalValue)}`,
        at: new Date().toISOString(),
      },
    ]);
    setPendingQuote(null);
  };

  const openNewQuote = async () => {
    if (!lead) return;
    setQuoteSuggesting(true);
    let suggestedProductId: string | undefined;
    let suggestionReason: string | undefined;
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sessão expirada");
      const res = await fetch("/api/ai/suggest-product", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          leadName: lead.name,
          product: lead.product,
          messages: messages.map((m) => messageForAi(m)),
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { productId: string; reason: string };
        suggestedProductId = data.productId;
        suggestionReason = data.reason;
      }
    } catch {
      // segue sem sugestão — usuário escolhe manualmente
    } finally {
      setQuoteSuggesting(false);
    }
    navigate({
      to: "/orcamentos",
      search: {
        new: "1",
        leadId: lead.id,
        conversationId,
        ...(suggestedProductId ? { suggestedProductId } : {}),
        ...(suggestionReason ? { suggestionReason } : {}),
      },
    });
  };

  const lastMessageAge = timeAgo(messages[messages.length - 1]?.at ?? conversation.lastMessageAt);

  return (
    <div className="flex-1 flex min-w-0 min-h-0 h-full max-w-full overflow-hidden">
      {/* Conversation column */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 max-w-full border-r border-border overflow-hidden">
        <header className="h-14 md:h-14 px-2 md:px-4 border-b border-border flex items-center gap-2 md:gap-3 shrink-0">

          <button
            onClick={() => navigate({ to: "/inbox" })}
            className="md:hidden h-11 w-11 inline-flex items-center justify-center rounded-md hover:bg-accent shrink-0"
            aria-label="Voltar"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 md:gap-2 flex-wrap">
              <span className="font-semibold truncate text-sm md:text-base">{lead.name}</span>
              <OriginBadge origin={origin} />
              {origin !== "whatsapp" && <ChannelBadge channel={lead.channel} />}
              {closedInfo ? (
                <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-[var(--status-won)]/15 text-[var(--status-won)]">
                  <CheckCircle2 className="h-3 w-3" /> Fechado
                </span>
              ) : (
                <StatusBadge status={lead.status} />
              )}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5 truncate">
              <Clock className="h-3 w-3 shrink-0" />
              <span className="truncate">Há {lastMessageAge}</span>
              {conversation.slaBreached && conversation.awaitingReply && !closedInfo && (
                <span className="text-[var(--status-urgent)] font-semibold ml-1 shrink-0">
                  • SLA
                </span>
              )}
            </div>
          </div>
          {isAdmin && !closedInfo && (
            <button
              type="button"
              onClick={handleManualFollowup}
              disabled={manualRunning}
              title="Executa o motor de follow-up agora, ignorando os tempos configurados"
              className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded-md border border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 text-xs font-semibold shrink-0 disabled:opacity-50"
            >
              {manualRunning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Zap className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">Executar Follow-up Agora</span>
            </button>
          )}
          {!closedInfo && (
            <>
              <button
                onClick={() => setCloseOpen(true)}
                className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-[var(--status-won)] text-white hover:opacity-90 text-xs font-semibold shrink-0"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Fechar venda
              </button>
              <button
                onClick={() => setCloseOpen(true)}
                className="sm:hidden h-11 w-11 inline-flex items-center justify-center rounded-md bg-[var(--status-won)] text-white shrink-0"
                aria-label="Fechar venda"
              >
                <CheckCircle2 className="h-5 w-5" />
              </button>
            </>
          )}
        </header>

        {/* Manual follow-up result modal */}
        {(manualResult || manualError) && (
          <div
            className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
            onClick={() => {
              setManualResult(null);
              setManualError(null);
            }}
          >
            <div
              className="bg-background border border-border rounded-lg shadow-xl max-w-md w-full p-5 space-y-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">Execução manual de Follow-up</h3>
                <button
                  type="button"
                  onClick={() => {
                    setManualResult(null);
                    setManualError(null);
                  }}
                  className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent"
                  aria-label="Fechar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {manualError ? (
                <div className="text-sm text-destructive">{manualError}</div>
              ) : manualResult ? (
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Elegibilidade:</span>
                    {manualResult.eligible ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Elegível
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold">
                        <XCircle className="h-3.5 w-3.5" /> Não elegível
                      </span>
                    )}
                  </div>
                  {manualResult.blockedReason && (
                    <div>
                      <span className="text-muted-foreground">Motivo do bloqueio: </span>
                      <span className="font-medium">{manualResult.blockedReason}</span>
                    </div>
                  )}
                  {manualResult.rule && (
                    <div>
                      <span className="text-muted-foreground">Regra: </span>
                      <span className="font-mono text-xs">{manualResult.rule}</span>
                    </div>
                  )}
                  {manualResult.generatedMessage && (
                    <div>
                      <div className="text-muted-foreground mb-1">Mensagem gerada:</div>
                      <div className="rounded border border-border bg-muted/40 p-2 text-xs whitespace-pre-wrap">
                        {manualResult.generatedMessage}
                      </div>
                    </div>
                  )}
                  {manualResult.sendStatus && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Status WhatsApp:</span>
                      {manualResult.sendStatus === "sent" && (
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Enviado
                          {manualResult.via ? ` (${manualResult.via})` : ""}
                        </span>
                      )}
                      {manualResult.sendStatus === "failed" && (
                        <span className="inline-flex items-center gap-1 text-destructive font-semibold">
                          <XCircle className="h-3.5 w-3.5" /> Falhou
                        </span>
                      )}
                      {manualResult.sendStatus === "blocked" && (
                        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold">
                          <XCircle className="h-3.5 w-3.5" /> Bloqueado
                        </span>
                      )}
                    </div>
                  )}
                  {manualResult.sendError && (
                    <div className="text-xs text-destructive">{manualResult.sendError}</div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        )}




        {/* AI status banners */}
        {aiState?.ai_status === "aguardando_humano" && (
          <div className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2.5 flex items-center gap-2">
            <span className="text-sm font-bold text-amber-700 dark:text-amber-400">
              ⚠️ Atendimento humano necessário
            </span>
            {aiHandoffReason && (
              <span className="text-xs text-muted-foreground">Motivo: {aiHandoffReason}</span>
            )}
            <button
              onClick={handleTakeover}
              disabled={takingOver}
              className="ml-auto inline-flex items-center gap-1.5 h-7 px-3 rounded-md bg-amber-600 text-white hover:bg-amber-700 text-xs font-semibold disabled:opacity-50"
            >
              {takingOver ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Assumir atendimento
            </button>
          </div>
        )}
        {aiState?.ai_status === "pre_atendido_ia" && (
          <div className="border-b border-sky-500/40 bg-sky-500/10 px-4 py-2 flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-sky-600" />
            <span className="text-xs font-semibold text-sky-700 dark:text-sky-400">
              🤖 Pré-atendido pela IA
            </span>
            <button
              onClick={handleTakeover}
              disabled={takingOver}
              className="ml-auto inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-sky-500/40 text-sky-700 hover:bg-sky-500/10 text-[11px] font-semibold disabled:opacity-50"
            >
              Assumir
            </button>
          </div>
        )}


        {/* Hot-stale alert banner */}
        {isHotStale && (
          <div className="border-b border-[var(--status-urgent)]/40 bg-[var(--status-urgent)]/10 px-4 py-2.5 flex items-center gap-2 animate-pulse">
            <Flame className="h-4 w-4 text-[var(--status-urgent)]" />
            <span className="text-sm font-bold text-[var(--status-urgent)] tracking-wide">
              🔥 CLIENTE QUENTE PARADO
            </span>
            <span className="text-xs text-muted-foreground">
              Aguardando resposta há {lastMessageAge}. Responda agora para não perder a venda.
            </span>
          </div>
        )}

        {/* Comment-origin context banner */}
        {isComment && (
          <div className="border-b border-[var(--channel-instagram)]/40 bg-[var(--channel-instagram)]/10 px-4 py-2.5 flex items-start gap-2">
            <MessageSquare className="h-4 w-4 text-[var(--channel-instagram)] mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0 text-xs">
              <div className="font-semibold text-[var(--channel-instagram)] uppercase tracking-wide">
                Comentário em{" "}
                {origin === "instagram_comment" ? "post do Instagram" : "publicação do Facebook"}
              </div>
              {lastIncoming?.text && (
                <div className="mt-1 text-foreground/80 italic line-clamp-2">
                  "{lastIncoming.text}"
                </div>
              )}
              {(commentMeta.post_id || commentMeta.media_id) && (
                <div className="mt-1 text-muted-foreground">
                  Post:{" "}
                  <span className="font-mono">{commentMeta.post_id ?? commentMeta.media_id}</span>
                  {commentMeta.media_id && origin === "instagram_comment" && (
                    <>
                      {" · "}
                      <a
                        href={`https://www.instagram.com/p/${commentMeta.media_id}/`}
                        target="_blank"
                        rel="noreferrer"
                        className="underline hover:text-foreground"
                      >
                        abrir
                      </a>
                    </>
                  )}
                </div>
              )}
              <div className="mt-1 text-muted-foreground">
                Você está respondendo ao <strong>comentário</strong> publicamente — não é uma
                mensagem privada.
              </div>
            </div>
          </div>
        )}

        {closedInfo && (
          <div className="border-b border-[var(--status-won)]/40 bg-[var(--status-won)]/10 px-4 py-2.5 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-[var(--status-won)]" />
            <span className="text-sm font-semibold text-[var(--status-won)]">
              Venda fechada — {formatBRL(closedInfo.value)}
            </span>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-hidden relative">
          {newSinceCount > 0 && !atBottom && (
            <button
              type="button"
              onClick={scrollToBottomManual}
              className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 rounded-full bg-primary text-primary-foreground text-xs font-semibold px-3.5 py-1.5 shadow-lg hover:bg-primary/90 transition-colors"
              aria-label="Ir para o final"
            >
              {newSinceCount === 1 ? "1 nova mensagem" : `${newSinceCount} novas mensagens`} · Ir para o final ↓
            </button>
          )}
          <MessagesContext.Provider value={messages}>
            <ReplyComposeContext.Provider value={replyComposeValue}>
            <VirtuosoScrollContext.Provider value={{ ref: virtuosoRef, items: visibleMessages }}>
              {threadLoad.status === "error" && visibleMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
                  <p className="text-sm text-muted-foreground">
                    Não foi possível carregar as mensagens desta conversa.
                  </p>
                  {threadLoad.error && (
                    <p className="text-xs text-muted-foreground/70 max-w-md break-words">
                      {threadLoad.error}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={retryLoadThread}
                    className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-secondary transition-colors"
                  >
                    Tentar novamente
                  </button>
                </div>
              ) : threadLoad.status === "loading" ? (
                // HOTFIX regressão "só última mensagem": aguardamos o
                // loadConversationRecent concluir ANTES de montar o Virtuoso.
                // Caso contrário, o Virtuoso mounta com o único preview vindo
                // de `latest_messages_per_conversation` e não recupera o
                // histórico mesmo depois de os 99 restantes chegarem ao índice.
                <div className="h-full flex items-center justify-center">
                  <span className="text-xs text-muted-foreground animate-pulse">
                    Carregando mensagens…
                  </span>
                </div>
              ) : visibleMessages.length === 0 ? (
                <div className="h-full" />
              ) : (

              <Virtuoso
                key={conversationId}
                ref={virtuosoRef}
                data={visibleMessages}
                computeItemKey={(_idx, m) => m.id}
                initialTopMostItemIndex={visibleMessages.length - 1}
                followOutput={handleVirtuosoFollowOutput}
                atBottomStateChange={setAtBottom}
                atBottomThreshold={160}
                startReached={loadOlder}
                itemsRendered={handleVirtuosoItemsRendered}
                rangeChanged={handleVirtuosoRangeChanged}
                totalListHeightChanged={handleVirtuosoTotalListHeightChanged}
                increaseViewportBy={{ top: 600, bottom: 200 }}
                overscan={{ main: 600, reverse: 600 }}
                className="h-full px-3 md:px-4"
                style={{ overflowAnchor: "none" }}
                components={{
                  Scroller: TracedVirtuosoScroller,
                  Item: TracedVirtuosoItem,
                  Header: () =>
                    !hasMoreOlder && visibleMessages.length > 0 ? (
                      <div className="flex justify-center py-3">
                        <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide">
                          Início da conversa
                        </span>
                      </div>
                    ) : (
                      <div className="h-2" />
                    ),
                  Footer: () => <div className="h-3 md:h-4" />,
                }}
                itemContent={(_idx, m) => {
                  if (m.role === "system") {
                    return (
                      <div className="flex justify-center py-1.5 min-w-0 max-w-full">
                        <span className="text-[11px] text-muted-foreground bg-secondary rounded-full px-3 py-1 break-words [overflow-wrap:anywhere]">
                          {m.text}
                        </span>
                      </div>
                    );
                  }
                  return (
                    <div className="py-1.5 min-w-0 max-w-full w-full overflow-hidden">
                      <MessageBubble m={m} canManage={!closedInfo} />
                    </div>
                  );
                }}
              />
              )}

            </VirtuosoScrollContext.Provider>
            </ReplyComposeContext.Provider>
          </MessagesContext.Provider>

        </div>




        {/* Pending quote panel — appears above the composer when a quote was just created */}
        {pendingQuote && !closedInfo && (
          <div className="border-t border-[var(--status-won)]/40 bg-[var(--status-won)]/10 p-3 shrink-0 max-h-[40vh] overflow-y-auto">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="h-4 w-4 text-[var(--status-won)]" />
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--status-won)]">
                Orçamento pronto para envio
              </span>
              <span className="ml-auto text-xs font-bold">
                {formatBRL(pendingQuote.finalValue)}
                {pendingQuote.installments > 1 && (
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    • {pendingQuote.installments}x
                  </span>
                )}
              </span>
              <button
                onClick={() => setPendingQuote(null)}
                className="p-1 rounded hover:bg-accent"
                title="Descartar"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="rounded-md bg-card border border-border p-3 text-sm whitespace-pre-wrap leading-relaxed mb-2">
              {pendingQuote.message}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={sendPendingQuote}
                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--status-won)] text-white px-3 py-1.5 text-xs font-semibold hover:opacity-90"
              >
                <Send className="h-3.5 w-3.5" /> Enviar na conversa
              </button>
              <button
                onClick={() => {
                  setInput(pendingQuote.message);
                  setPendingQuote(null);
                }}
                className="text-xs rounded-md bg-secondary px-3 py-1.5 hover:bg-accent"
              >
                Editar antes
              </button>
            </div>
          </div>
        )}

        {sendError && (
          <div className="border-t border-[var(--status-urgent)]/40 bg-[var(--status-urgent)]/10 px-3 py-2 text-xs text-[var(--status-urgent)]">
            <div className="flex items-start gap-2">
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="min-w-0">
                <div className="font-semibold">Falha ao enviar pela Meta</div>
                <div className="mt-0.5 break-words font-mono text-[11px]">{sendError}</div>
              </div>
              <button
                type="button"
                onClick={() => setSendError(null)}
                className="ml-auto rounded p-1 hover:bg-accent"
                title="Fechar erro"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* AI suggestion panel — appears right above the composer */}
        {(ai || aiLoading || aiError) && (
          <div className="border-t border-primary/30 bg-primary/5 p-3 shrink-0 max-h-[40vh] overflow-y-auto">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold uppercase tracking-wide text-primary">
                Sugestão da IA
              </span>
              {(ai || aiError) && (
                <button
                  onClick={() => {
                    setAi(null);
                    setAiError(null);
                  }}
                  className="ml-auto p-1 rounded hover:bg-accent"
                  title="Descartar"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {aiLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Analisando conversa e gerando resposta…
              </div>
            )}
            {aiError && <p className="text-sm text-[var(--status-urgent)]">{aiError}</p>}
            {ai && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded bg-secondary px-1.5 py-0.5">
                    Classificação: <strong className="capitalize">{ai.classification}</strong>
                  </span>
                  <span className="rounded bg-secondary px-1.5 py-0.5">Intenção: {ai.intent}</span>
                  {ai.objection && (
                    <span className="rounded bg-[var(--status-warm)]/20 text-[var(--status-warm)] px-1.5 py-0.5">
                      Objeção: {ai.objection}
                    </span>
                  )}
                  <span className="rounded bg-secondary px-1.5 py-0.5">
                    Próxima ação: {ai.nextAction}
                  </span>
                </div>
                {ai.lowConfidence && (
                  <div className="rounded-md border border-[var(--status-urgent)]/40 bg-[var(--status-urgent)]/10 px-2 py-1.5 text-xs text-[var(--status-urgent)]">
                    {ai.fallbackMessage ?? "✋ Atendimento humano recomendado: a IA não tem dados suficientes."}
                  </div>
                )}
                <div className="rounded-md bg-card border border-border p-3 text-sm whitespace-pre-wrap">
                  {ai.suggestedReply}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={sendSuggestion}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-semibold hover:opacity-90"
                  >
                    <Send className="h-3.5 w-3.5" /> Enviar
                  </button>
                  <button
                    onClick={() => {
                      setInput(ai.suggestedReply);
                      setAi(null);
                    }}
                    className="text-xs rounded-md bg-secondary px-3 py-1.5 hover:bg-accent"
                  >
                    Editar antes
                  </button>
                  <button
                    onClick={generateAI}
                    className="text-xs rounded-md bg-secondary px-3 py-1.5 hover:bg-accent inline-flex items-center gap-1"
                  >
                    <Sparkles className="h-3 w-3" /> Gerar outra
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* WhatsApp 24h window status (visual support only — não altera webhook/templates/follow-up) */}
        {!closedInfo && (
          <WhatsappWindowAlert
            conversation={conversation}
            lead={lead}
            messages={messages}
            onSendNow={() => composerRef.current?.focus()}
            onOpenTemplates={() => setTemplatesModalOpen(true)}
          />
        )}
        <MetaTemplatesModal
          open={templatesModalOpen}
          conversationId={conversationId}
          onClose={() => setTemplatesModalOpen(false)}
        />


        {/* Composer */}
        <div
          className="border-t border-border px-2 md:px-3 pt-2 md:pt-3 shrink-0 bg-background max-w-full overflow-x-hidden"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
        >

          {replyingTo && (
            <div className="mb-2 flex items-stretch gap-2 rounded-md border-l-4 border-primary bg-muted/60 px-2.5 py-2 max-w-full min-w-0">
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-semibold text-primary uppercase tracking-wide">
                  Respondendo a {replyingTo.role === "agent" ? "Você" : (lead?.name ?? "Cliente")}
                </div>
                <div className="text-xs text-foreground/90 truncate mt-0.5">
                  {(() => {
                    const t = (replyingTo.text ?? "").trim();
                    if (t) return t.slice(0, 120);
                    const sub = (replyingTo.sourceSubtype ?? "").toLowerCase();
                    if (sub === "image") return "📷 Foto";
                    if (sub === "video") return "🎥 Vídeo";
                    if (sub === "audio") return "🎤 Áudio";
                    if (sub === "document") return "📎 Documento";
                    if (sub === "sticker") return "🌟 Sticker";
                    if (sub === "location") return "📍 Localização";
                    return "[mensagem]";
                  })()}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReplyingTo(null)}
                className="self-start h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground shrink-0"
                aria-label="Cancelar resposta"
                title="Cancelar resposta"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <div className="flex items-end gap-1.5 md:gap-2 min-w-0 max-w-full">
            {!audioActive && (
              <button
                onClick={generateAI}
                disabled={aiLoading || !!closedInfo}
                className="h-11 md:h-9 px-2.5 md:px-3 inline-flex items-center gap-1.5 rounded-md bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 text-xs font-semibold disabled:opacity-50 shrink-0"
                title="Responder com IA"
                aria-label="Responder com IA"
              >
                {aiLoading ? (
                  <Loader2 className="h-4 w-4 md:h-3.5 md:w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 md:h-3.5 md:w-3.5" />
                )}
                <span className="hidden md:inline">Responder com IA</span>
              </button>
            )}
            {!audioActive && (
              <textarea
                ref={composerRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={!!closedInfo}
                spellCheck
                autoCapitalize="sentences"
                autoCorrect="on"
                autoComplete="on"
                enterKeyHint="send"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage(input);
                  }
                }}
                placeholder={
                  closedInfo
                    ? "Venda fechada."
                    : isComment
                      ? "Resposta ao comentário…"
                      : "Mensagem…"
                }
                rows={1}
                className="flex-1 min-w-0 resize-none rounded-2xl md:rounded-md bg-input px-4 md:px-3 py-2.5 md:py-2 text-base md:text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 max-h-40 min-h-[44px] md:min-h-[3.5rem]"
              />
            )}
            {!audioActive && (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    disabled={!!closedInfo}
                    className="h-11 w-11 md:h-9 md:w-9 inline-flex items-center justify-center rounded-full md:rounded-md bg-muted hover:bg-accent text-foreground disabled:opacity-40 shrink-0"
                    aria-label="Inserir emoji"
                    title="Inserir emoji"
                  >
                    <Smile className="h-5 w-5 md:h-4 md:w-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  side="top"
                  className="p-0 w-auto border-0 bg-transparent shadow-none"
                  onOpenAutoFocus={(e) => e.preventDefault()}
                >
                  <EmojiPicker
                    theme={EmojiTheme.AUTO}
                    emojiStyle={EmojiStyle.NATIVE}
                    lazyLoadEmojis
                    width={320}
                    height={380}
                    searchPlaceHolder="Buscar emoji…"
                    onEmojiClick={(data) => {
                      const el = composerRef.current;
                      const emoji = data.emoji;
                      if (el) {
                        const start = el.selectionStart ?? input.length;
                        const end = el.selectionEnd ?? input.length;
                        const next = input.slice(0, start) + emoji + input.slice(end);
                        setInput(next);
                        requestAnimationFrame(() => {
                          el.focus();
                          const pos = start + emoji.length;
                          try { el.setSelectionRange(pos, pos); } catch { /* noop */ }
                        });
                      } else {
                        setInput((prev) => prev + emoji);
                      }
                    }}
                  />
                </PopoverContent>
              </Popover>
            )}
            {!audioActive && (
              <MediaSendPanel
                conversationId={conversationId}
                channel={lead?.channel}
                disabled={!!closedInfo}
                companyId={profile?.company_id ?? null}
                leadId={lead?.id ?? null}
                onSent={() => { /* realtime entrega a nova mensagem */ }}
                onSendText={(t) => sendMessage(t)}
                onInsertText={(t) => {
                  setInput((prev) => (prev ? `${prev}\n${t}` : t));
                  requestAnimationFrame(() => composerRef.current?.focus());
                }}

              />
            )}
            {!audioActive && (
              <QuickRepliesButton
                companyId={profile?.company_id ?? null}
                disabled={!!closedInfo}
                onPick={(text) => {
                  setInput((prev) => (prev && prev.trim() ? `${prev}\n${text}` : text));
                  requestAnimationFrame(() => composerRef.current?.focus());
                }}
              />
            )}

            {lead?.channel === "whatsapp" && (
              <AudioRecorder
                conversationId={conversationId}
                disabled={!!closedInfo}
                onSent={() => { /* realtime entrega o áudio enviado */ }}
                onStateChange={setAudioState}
              />
            )}
            {!audioActive && (
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || !!closedInfo}
                className="h-11 w-11 md:h-9 md:w-auto md:px-3 inline-flex items-center justify-center gap-1.5 rounded-full md:rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 text-sm font-medium shrink-0"
                aria-label={isComment ? "Responder comentário" : "Enviar"}
              >
                <Send className="h-5 w-5 md:h-3.5 md:w-3.5" />
                <span className="hidden md:inline">{isComment ? "Responder" : "Enviar"}</span>
              </button>
            )}
          </div>
        </div>

      </div>


      {/* Side panel */}
      <aside className="hidden lg:flex w-80 shrink-0 flex-col bg-card/40 overflow-y-auto min-h-0">

        <CoachPanel conversationId={conversation.id} onInsertSuggestion={(t: string) => setInput(t)} />


        {/* Lead header */}
        <div className="p-4 border-b border-border">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Lead</div>
          <div className="text-base font-semibold">{lead.name}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{lead.phone ?? lead.handle}</div>
        </div>

        {/* HERO: Produto / Valor / Temperatura — destaque máximo */}
        <div className="p-4 border-b border-border bg-gradient-to-br from-primary/5 to-transparent">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Produto</div>
          <div className="text-sm font-semibold text-foreground mb-3 break-words">
            {lead.product ?? <span className="text-muted-foreground font-normal">Sem produto definido</span>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
                {closedInfo ? "Venda" : "Estimado"}
              </div>
              <div className="text-lg font-bold tabular-nums text-foreground">
                {closedInfo
                  ? formatBRL(closedInfo.value)
                  : lead.estimatedValue
                    ? formatBRL(lead.estimatedValue)
                    : "—"}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Temperatura</div>
              {conversation.leadTemperature ? (
                <TempBadge temp={conversation.leadTemperature} score={conversation.leadScore} />
              ) : (
                <span className="text-xs text-muted-foreground">Sem dados</span>
              )}
            </div>
          </div>
        </div>

        {/* CTA principal — ação comercial mais importante */}
        {!closedInfo && (() => {
          const ready = conversation.leadReadyToClose;
          const hasQuote = !!pendingQuote;
          const noAction = !lead.nextAction;
          let primary: { icon: typeof Target; label: string; onClick?: () => void; variant?: "won" | "default" } = {
            icon: Target,
            label: "Definir próxima ação",
            onClick: () => setNextActionOpen(true),
            variant: "default",
          };
          if (ready) primary = { icon: CheckCircle2, label: "Fechar venda", onClick: () => setCloseOpen(true), variant: "won" };
          else if (hasQuote) primary = { icon: FileText, label: "Enviar orçamento", onClick: sendPendingQuote, variant: "default" };
          else if (noAction || !lead.product) primary = { icon: FileText, label: "Criar orçamento", onClick: openNewQuote, variant: "default" };
          const Icon = primary.icon;
          return (
            <div className="p-4 border-b border-border">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Ação recomendada</div>
              <button
                onClick={primary.onClick}
                disabled={primary.variant === "won" ? !!closedInfo : false}
                className={cn(
                  "w-full inline-flex items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-semibold shadow-sm transition",
                  primary.variant === "won"
                    ? "bg-[var(--status-won)] text-[var(--status-won-foreground)] hover:opacity-90"
                    : "bg-primary text-primary-foreground hover:opacity-90",
                )}
              >
                <Icon className="h-4 w-4" />
                {primary.label}
              </button>
            </div>
          );
        })()}

        {/* Próxima ação — alerta destacado se não definida */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground mb-2">
            <Target className="h-3 w-3" /> Próxima ação
          </div>
          {lead.nextAction ? (
            <div className="rounded-md border border-border bg-card/60 px-3 py-2">
              <div className="text-sm font-medium">{lead.nextAction.label}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {new Date(lead.nextAction.dueAt).toLocaleString("pt-BR")}
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-[var(--status-urgent)]/40 bg-[var(--status-urgent)]/10 px-3 py-2.5 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-[var(--status-urgent)] shrink-0 mt-0.5 animate-pulse" />
              <div className="flex-1">
                <div className="text-sm font-semibold text-[var(--status-urgent)]">Sem próxima ação</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Defina o próximo passo para não perder o lead.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Resumo IA — apenas com dados já existentes */}
        {(() => {
          const interesse = conversation.detectedInterest;
          const objecao = (conversation.detectedObjections ?? [])[0];
          const ultimoOrc = pendingQuote
            ? `${pendingQuote.productName} • ${formatBRL(pendingQuote.finalValue)}`
            : null;
          const proximaOp = conversation.leadReadyToClose
            ? "Pronto para fechar"
            : conversation.leadTemperature === "quente"
              ? "Avançar para fechamento"
              : conversation.leadTemperature === "morno"
                ? "Aquecer com follow-up"
                : null;
          return (
            <div className="p-4 border-b border-border">
              <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground mb-2">
                <Sparkles className="h-3 w-3 text-primary" /> Resumo IA
              </div>
              <div className="space-y-2 text-xs">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Interesse principal</div>
                  <div className="text-foreground">{interesse ?? <span className="text-muted-foreground">Ainda não identificado</span>}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Último orçamento</div>
                  <div className="text-foreground">{ultimoOrc ?? <span className="text-muted-foreground">Nenhum orçamento ainda</span>}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Objeção detectada</div>
                  <div className={cn(objecao ? "text-amber-500 font-medium" : "")}>
                    {objecao ?? <span className="text-muted-foreground font-normal">Nenhuma no momento</span>}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Próxima oportunidade</div>
                  <div className="text-foreground">{proximaOp ?? <span className="text-muted-foreground">Continuar qualificando</span>}</div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Detalhes secundários */}
        <div className="p-4 border-b border-border space-y-2 text-xs">
          <Row label="Atribuído a" value={lead.assignedTo ?? "Ninguém"} />
          <Row label="Origem" value={<ChannelBadge channel={lead.channel} />} />
        </div>

        <QualificationPanel conv={conversation} />
        <AITimeline conversationId={conversationId} />

        {/* Tags */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground mb-2">
            <Tag className="h-3 w-3" /> Tags
          </div>
          <div className="flex flex-wrap gap-1">
            {lead.tags.length === 0 && (
              <span className="text-xs text-muted-foreground">Nenhuma</span>
            )}
            {lead.tags.map((t: string) => (
              <span key={t} className="rounded bg-secondary px-1.5 py-0.5 text-[11px]">
                #{t}
              </span>
            ))}
          </div>
        </div>

        {/* Ações secundárias */}
        <div className="p-4 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Mais ações</div>
          <ActionButton
            icon={quoteSuggesting ? Loader2 : FileText}
            onClick={openNewQuote}
            disabled={!!closedInfo || quoteSuggesting}
          >
            {quoteSuggesting ? "Sugerindo produto…" : "Criar orçamento"}
          </ActionButton>
          <ActionButton
            icon={Calendar}
            onClick={() => setVisitOpen(true)}
            disabled={!!closedInfo}
          >
            Agendar visita
          </ActionButton>
          <ActionButton
            icon={Target}
            onClick={() => setNextActionOpen(true)}
            disabled={!!closedInfo}
          >
            Definir próxima ação
          </ActionButton>
          <ActionButton
            icon={CheckCircle2}
            variant="won"
            onClick={() => setCloseOpen(true)}
            disabled={!!closedInfo}
          >
            Fechar venda
          </ActionButton>
          <ActionButton
            icon={XCircle}
            variant="lost"
            onClick={() => setLostOpen(true)}
            disabled={!!closedInfo || !isAdmin}
            title={!isAdmin ? "Apenas administradores podem marcar como perdido" : undefined}
          >
            Marcar como perdido
          </ActionButton>
        </div>
      </aside>


      {closeOpen && (
        <CloseSaleModal
          defaultValue={lead.estimatedValue}
          leadName={lead.name}
          onCancel={() => setCloseOpen(false)}
          onConfirm={handleConfirmClose}
        />
      )}

      {lostOpen && (
        <MarkLostModal
          leadName={lead.name}
          onCancel={() => setLostOpen(false)}
          onConfirm={confirmLost}
        />
      )}

      {nextActionOpen && (
        <NextActionModal
          leadName={lead.name}
          onCancel={() => setNextActionOpen(false)}
          onConfirm={confirmNextAction}
        />
      )}

      {visitOpen && (
        <ScheduleVisitModal
          leadName={lead.name}
          onCancel={() => setVisitOpen(false)}
          onConfirm={confirmVisit}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm text-right">{value}</span>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  children,
  variant = "default",
  onClick,
  disabled,
  title,
}: {
  icon: typeof FileText;
  children: React.ReactNode;
  variant?: "default" | "won" | "lost";
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "w-full inline-flex items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
        variant === "won" && "text-[var(--status-won)]",
        variant === "lost" && "text-[var(--status-lost)]",
      )}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}

function CloseSaleModal({
  defaultValue,
  leadName,
  onCancel,
  onConfirm,
}: {
  defaultValue?: number;
  leadName: string;
  onCancel: () => void;
  onConfirm: (value: number) => void;
}) {
  const [raw, setRaw] = useState<string>(defaultValue ? String(defaultValue) : "");
  const value = Number(raw.replace(/[^\d]/g, ""));
  const valid = value > 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-[var(--status-won)]" />
          <h2 className="text-sm font-semibold">Fechar venda — {leadName}</h2>
          <button onClick={onCancel} className="ml-auto p-1 rounded hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <label className="block">
            <span className="text-xs text-muted-foreground">Valor da venda (R$)</span>
            <div className="mt-1 flex items-center gap-2 rounded-md bg-input px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <input
                autoFocus
                inputMode="numeric"
                value={raw}
                onChange={(e) => setRaw(e.target.value.replace(/[^\d]/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && valid) onConfirm(value);
                }}
                placeholder="Ex: 28500"
                className="flex-1 bg-transparent outline-none text-sm"
              />
            </div>
            {valid && (
              <span className="text-[11px] text-muted-foreground mt-1 block">
                {formatBRL(value)}
              </span>
            )}
          </label>
        </div>
        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="text-xs rounded-md bg-secondary px-3 py-2 hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            disabled={!valid}
            onClick={() => onConfirm(value)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-[var(--status-won)] text-white px-3 py-2 hover:opacity-90 disabled:opacity-40"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Confirmar venda
          </button>
        </div>
      </div>
    </div>
  )
}

function MarkLostModal({
  leadName,
  onCancel,
  onConfirm,
}: {
  leadName: string;
  onCancel: () => void;
  onConfirm: (reason: string, notes?: string) => void;
}) {
  const settings = useSyncExternalStore(subscribeSettings, getSettings, getSettings);
  const reasons = settings.lossReasons;
  // Não pré-seleciona — força a vendedora a escolher um motivo conscientemente.
  const [selected, setSelected] = useState<string>("");
  const [custom, setCustom] = useState("");
  const [notes, setNotes] = useState("");
  const useCustom = selected === "__custom__";
  const finalReason = useCustom ? custom.trim() : selected;
  const valid = !!finalReason;

  return (
    <div
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border flex items-center gap-2">
          <XCircle className="h-4 w-4 text-[var(--status-lost)]" />
          <h2 className="text-sm font-semibold">Marcar como perdido — {leadName}</h2>
          <button onClick={onCancel} className="ml-auto p-1 rounded hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Selecione um motivo <span className="font-semibold text-foreground">(obrigatório)</span>{" "}
            para entrar nos relatórios automaticamente.
          </p>
          <div className="space-y-1.5">
            {reasons.map((r) => (
              <label
                key={r}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors",
                  selected === r
                    ? "border-[var(--status-lost)] bg-[var(--status-lost)]/10"
                    : "border-border hover:bg-accent",
                )}
              >
                <input
                  type="radio"
                  name="loss-reason"
                  value={r}
                  checked={selected === r}
                  onChange={() => setSelected(r)}
                  className="accent-[var(--status-lost)]"
                />
                <span className="flex-1">{r}</span>
              </label>
            ))}
            <label
              className={cn(
                "flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors",
                useCustom
                  ? "border-[var(--status-lost)] bg-[var(--status-lost)]/10"
                  : "border-border hover:bg-accent",
              )}
            >
              <input
                type="radio"
                name="loss-reason"
                value="__custom__"
                checked={useCustom}
                onChange={() => setSelected("__custom__")}
                className="accent-[var(--status-lost)]"
              />
              <span className="flex-1">Outro…</span>
            </label>
            {useCustom && (
              <input
                autoFocus
                type="text"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && valid) onConfirm(finalReason, notes.trim() || undefined);
                }}
                placeholder="Descreva o motivo"
                className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            )}
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Observações (opcional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Detalhes adicionais"
              className="mt-1 w-full text-sm rounded-md border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Você pode gerenciar a lista em{" "}
            <span className="font-semibold">Configurações → Motivos de perda</span>.
          </p>
        </div>
        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="text-xs rounded-md bg-secondary px-3 py-2 hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            disabled={!valid}
            onClick={() => onConfirm(finalReason, notes.trim() || undefined)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-[var(--status-lost)] text-white px-3 py-2 hover:opacity-90 disabled:opacity-40"
          >
            <XCircle className="h-3.5 w-3.5" /> Confirmar perda
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// NextActionModal — cria "próxima ação" para o lead.
// ============================================================================
const NEXT_ACTION_TYPES: { value: string; label: string }[] = [
  { value: "Ligação", label: "Ligação" },
  { value: "WhatsApp", label: "WhatsApp" },
  { value: "E-mail", label: "E-mail" },
  { value: "Enviar orçamento", label: "Enviar orçamento" },
  { value: "Agendar visita", label: "Agendar visita" },
  { value: "Retorno", label: "Retorno" },
  { value: "Outro", label: "Outro" },
];

function NextActionModal({
  leadName,
  onCancel,
  onConfirm,
}: {
  leadName: string;
  onCancel: () => void;
  onConfirm: (payload: { label: string; dueAt: string; notes?: string }) => void | Promise<void>;
}) {
  const { profile } = useAuth();
  const now = new Date();
  const defaultDate = now.toISOString().slice(0, 10);
  const defaultTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes() + 30).padStart(2, "0")}`.slice(0, 5);

  const [type, setType] = useState<string>("Ligação");
  const [customLabel, setCustomLabel] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState(defaultTime);
  const [responsible, setResponsible] = useState(profile?.display_name ?? "");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const isOther = type === "Outro";
  const finalLabel = isOther ? customLabel.trim() : type;
  const valid = !!finalLabel && !!date && !!time;

  async function handleSave() {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const dueAt = new Date(`${date}T${time}:00`).toISOString();
      const composedLabel = responsible.trim()
        ? `${finalLabel} · ${responsible.trim()}`
        : finalLabel;
      await onConfirm({ label: composedLabel, dueAt, notes: notes.trim() || undefined });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Definir próxima ação — {leadName}</h2>
          <button onClick={onCancel} className="ml-auto p-1 rounded hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Tipo *</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="mt-1 w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {NEXT_ACTION_TYPES.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          {isOther && (
            <div>
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Descreva *</label>
              <input
                autoFocus
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="Ex.: Enviar catálogo em PDF"
                className="mt-1 w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Data *</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Hora *</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="mt-1 w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Responsável</label>
            <input
              value={responsible}
              onChange={(e) => setResponsible(e.target.value)}
              placeholder="Nome do responsável"
              className="mt-1 w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Observações</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Detalhes adicionais"
              className="mt-1 w-full text-sm rounded-md border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="text-xs rounded-md bg-secondary px-3 py-2 hover:bg-accent"
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            disabled={!valid || saving}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground px-3 py-2 hover:opacity-90 disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Target className="h-3.5 w-3.5" />}
            Salvar próxima ação
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// ScheduleVisitModal — cria uma visita vinculada ao lead.
// ============================================================================
const VISIT_TYPE_OPTIONS: { value: "visita_tecnica" | "loja" | "retorno_comercial" | "instalacao"; label: string }[] = [
  { value: "visita_tecnica", label: "Residência" },
  { value: "loja", label: "Loja" },
  { value: "instalacao", label: "Empresa" },
  { value: "retorno_comercial", label: "Terreno" },
];

function ScheduleVisitModal({
  leadName,
  onCancel,
  onConfirm,
}: {
  leadName: string;
  onCancel: () => void;
  onConfirm: (payload: {
    date: string;
    time: string;
    address: string;
    appointmentType: "visita_tecnica" | "loja" | "retorno_comercial" | "instalacao";
    confirmed: boolean;
    notes: string;
  }) => void | Promise<void>;
}) {
  const now = new Date();
  const [date, setDate] = useState(now.toISOString().slice(0, 10));
  const [time, setTime] = useState("09:00");
  const [address, setAddress] = useState("");
  const [appointmentType, setAppointmentType] =
    useState<"visita_tecnica" | "loja" | "retorno_comercial" | "instalacao">("visita_tecnica");
  const [confirmed, setConfirmed] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const needsAddress = appointmentType !== "loja";
  const valid = !!date && !!time && (!needsAddress || !!address.trim());

  async function handleSave() {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await onConfirm({ date, time, address: address.trim(), appointmentType, confirmed, notes: notes.trim() });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border flex items-center gap-2">
          <Calendar className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Agendar visita — {leadName}</h2>
          <button onClick={onCancel} className="ml-auto p-1 rounded hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Data *</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Hora *</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="mt-1 w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Tipo *</label>
            <select
              value={appointmentType}
              onChange={(e) => setAppointmentType(e.target.value as typeof appointmentType)}
              className="mt-1 w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {VISIT_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Endereço {needsAddress ? "*" : "(opcional)"}
            </label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={!needsAddress}
              placeholder={needsAddress ? "Rua, número, bairro" : "Atendimento na loja"}
              className="mt-1 w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="accent-primary"
            />
            Cliente confirmou a visita
          </label>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Observações</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Instruções ao vendedor, referências do local, etc."
              className="mt-1 w-full text-sm rounded-md border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="text-xs rounded-md bg-secondary px-3 py-2 hover:bg-accent"
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            disabled={!valid || saving}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground px-3 py-2 hover:opacity-90 disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Calendar className="h-3.5 w-3.5" />}
            Agendar visita
          </button>
        </div>
      </div>
    </div>
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { timeAgo, formatBRL, type Message } from "@/data/mock";
import {
  getConversationById,
  getLeadById,
  getMessagesFor,
  appendMessage,
  markLeadLost,
  markLeadWon,
  refetchConversationMessages,
  subscribeRepo,
  editMessage,
  deleteMessage,
} from "@/data/leadRepo";
import { useAuth } from "@/auth/AuthContext";
import { ChannelBadge, StatusBadge } from "@/components/Badges";
import { OriginBadge, getConversationOrigin } from "./inbox.index";
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
} from "lucide-react";
import { listProducts, subscribeProducts, type Product } from "@/data/products";
import { listQuickReplies, type QuickReply } from "@/data/quickReplies";
import { getSignedImageUrl, getSignedWaMediaUrl } from "@/lib/storage";
import { SmartImage } from "@/components/SmartImage";
import { getQuote, markQuoteSent, type Quote } from "@/data/quotes";
import { getSettings, subscribeSettings } from "@/data/settings";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { QualificationPanel } from "@/components/QualificationBadges";
import { AITimeline } from "@/components/AITimeline";

export const Route = createFileRoute("/inbox/$conversationId")({
  component: ConversationPage,
  validateSearch: (search: Record<string, unknown>): { quote?: string } => {
    if (typeof search.quote === "string") return { quote: search.quote };
    return {};
  },
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
}): string | null {
  const { path, url } = opts;
  const [resolved, setResolved] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (path) {
        const r = await getSignedWaMediaUrl(path);
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
  }, [path, url]);
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
}: {
  path?: string | null;
  url?: string | null;
  filename?: string | null;
}) {
  const [error, setError] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const display = useResolvedMediaSrc({ path, url });
  if (error) {
    return <span className="text-xs italic opacity-70">Imagem indisponível</span>;
  }
  if (!display) {
    return <div className="h-32 w-48 rounded-md bg-muted animate-pulse" />;
  }
  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setLightbox(true)}
        className="block focus:outline-none focus:ring-2 focus:ring-ring rounded-md"
      >
        <img
          src={display}
          alt={filename ?? "Imagem"}
          onError={() => setError(true)}
          className="rounded-md max-w-full md:max-w-[240px] w-auto h-auto max-h-[50vh] md:max-h-none object-contain cursor-zoom-in"
          loading="lazy"
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
}: {
  path?: string | null;
  url?: string | null;
  filename?: string | null;
}) {
  const display = useResolvedMediaSrc({ path, url });
  if (!display) {
    return <div className="h-40 w-64 rounded-md bg-muted animate-pulse" />;
  }
  return (
    <div className="space-y-1">
      <video
        src={display}
        controls
        className="rounded-md max-w-full md:max-w-[280px] max-h-[50vh] bg-black"
        preload="metadata"
      />
      <DownloadButton href={display} filename={filename} />
    </div>
  );
}

function AudioPreview({
  path,
  mime,
  filename,
}: {
  path?: string | null;
  mime?: string | null;
  filename?: string | null;
}) {
  const display = useResolvedMediaSrc({ path });
  if (!display) {
    return <div className="h-12 w-64 rounded-md bg-muted animate-pulse" />;
  }
  return (
    <div className="space-y-1">
      <audio src={display} controls preload="metadata" className="max-w-full md:w-[280px]">
        {mime ? <source src={display} type={mime} /> : null}
      </audio>
      <DownloadButton href={display} filename={filename ?? "audio"} />
    </div>
  );
}

function DocumentPreview({
  path,
  filename,
  mime,
  size,
}: {
  path?: string | null;
  filename?: string | null;
  mime?: string | null;
  size?: number | null;
}) {
  const display = useResolvedMediaSrc({ path });
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
}: {
  path?: string | null;
  filename?: string | null;
}) {
  const display = useResolvedMediaSrc({ path });
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
    if (kind) return { path, url, kind, mime, filename, size };
  }

  IMAGE_URL_RE.lastIndex = 0;
  const match = IMAGE_URL_RE.exec(m.text ?? "");
  if (match) return { url: match[1], kind: "image", mime, filename, size };
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
  const thumb = useResolvedMediaSrc({ path: reply.media_path ?? undefined });
  const isImage = kind === "image" || kind === "sticker";
  const isAudio = kind === "audio";
  const label =
    reply.preview ??
    (isImage ? "📷 Foto" : isAudio ? "🎤 Mensagem de voz" : "[mensagem]");

  function scrollToOriginal() {
    if (!reply.message_id) return;
    const el = document.getElementById(`msg-${reply.message_id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary/60", "transition");
      setTimeout(() => el.classList.remove("ring-2", "ring-primary/60"), 1400);
    }
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

function MessageContent({ message }: { message: Message }) {
  const info = getMediaInfo(message);
  const reply = getReplyTo(message);
  const replyNode = reply ? <ReplyPreview reply={reply} /> : null;

  if (info) {
    const trimmed = (message.text ?? "").trim();
    const showCaption =
      trimmed.length > 0 && !/^\[/.test(trimmed) && !/^https?:\/\//.test(trimmed);
    const caption = showCaption ? <div>{trimmed}</div> : null;

    switch (info.kind) {
      case "image":
        return (
          <div className="space-y-1">
            {replyNode}
            <ImagePreview path={info.path} url={info.url} filename={info.filename} />
            {caption}
          </div>
        );
      case "video":
        return (
          <div className="space-y-1">
            {replyNode}
            <VideoPreview path={info.path} url={info.url} filename={info.filename} />
            {caption}
          </div>
        );
      case "audio":
        return (
          <div className="space-y-1">
            {replyNode}
            <AudioPreview path={info.path} mime={info.mime} filename={info.filename} />
            {caption}
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
            />
            {caption}
          </div>
        );
      case "sticker":
        return (
          <div className="space-y-1">
            {replyNode}
            <StickerPreview path={info.path} filename={info.filename} />
          </div>
        );
    }
  }

  const text = message.text ?? "";
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

function MessageBubble({
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
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tplMeta = m.sourceMetadata as
    | { template_name?: string; category?: string }
    | undefined;
  const isTemplate = m.role === "agent" && !!tplMeta?.template_name;
  const isAgent = m.role === "agent";
  const isDeleted = !!m.deletedAt;
  const externalId = (m.sourceMetadata as { external_id?: string } | undefined)
    ?.external_id;
  const mediaInfo = getMediaInfo(m);
  const hasText = !!m.text && m.text.trim().length > 0;

  function startLongPress() {
    if (!canManage || !isAgent || isDeleted || editing) return;
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
        "group flex flex-col max-w-[90%] md:max-w-[75%] relative",
        isAgent ? "ml-auto items-end" : "items-start",
      )}
    >
      <div className="flex items-end gap-1">
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
            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="fixed left-1/2 -translate-x-1/2 bottom-6 md:absolute md:left-auto md:right-0 md:bottom-8 md:translate-x-0 z-50 min-w-[200px] rounded-md border border-border bg-popover shadow-lg p-1 text-sm animate-in fade-in zoom-in-95">
                  {mediaInfo?.url && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        window.open(mediaInfo.url!, "_blank", "noopener,noreferrer");
                      }}
                      className="w-full text-left px-2.5 py-1.5 rounded hover:bg-accent inline-flex items-center gap-2"
                    >
                      <Eye className="h-3.5 w-3.5" /> Visualizar
                    </button>
                  )}
                  {mediaInfo?.url && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        void downloadMedia(mediaInfo.url!);
                      }}
                      className="w-full text-left px-2.5 py-1.5 rounded hover:bg-accent inline-flex items-center gap-2"
                    >
                      <Download className="h-3.5 w-3.5" /> Baixar
                    </button>
                  )}
                  {!mediaInfo && hasText && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        setDraft(m.text);
                        setEditing(true);
                      }}
                      className="w-full text-left px-2.5 py-1.5 rounded hover:bg-accent inline-flex items-center gap-2"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Editar mensagem
                    </button>
                  )}
                  {hasText && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        void copyText();
                      }}
                      className="w-full text-left px-2.5 py-1.5 rounded hover:bg-accent inline-flex items-center gap-2"
                    >
                      <Copy className="h-3.5 w-3.5" /> Copiar texto
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmDelete("me");
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded hover:bg-accent inline-flex items-center gap-2"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {mediaInfo ? "Ocultar para mim" : "Apagar para mim"}
                  </button>
                  {!externalId && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        setConfirmDelete("everyone");
                      }}
                      className="w-full text-left px-2.5 py-1.5 rounded hover:bg-accent inline-flex items-center gap-2 text-[var(--status-urgent)]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {mediaInfo ? "Excluir mídia" : "Excluir mensagem"}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <div
          onTouchStart={startLongPress}
          onTouchEnd={cancelLongPress}
          onTouchMove={cancelLongPress}
          onTouchCancel={cancelLongPress}
          onContextMenu={(e) => {
            if (canManage && isAgent && !isDeleted && !editing) {
              e.preventDefault();
              setMenuOpen(true);
            }
          }}
          className={cn(
            "rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words select-none md:select-text transition-transform active:scale-[0.99]",
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
            <MessageContent message={m} />
          )}
        </div>
      </div>

      {isTemplate && !isDeleted && (
        <span className="text-[10px] mt-1 px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary">
          Enviado via template Utility
          {tplMeta?.template_name ? ` · ${tplMeta.template_name}` : ""}
        </span>
      )}
      <span className="text-[10px] text-muted-foreground mt-1 px-1">
        {timeAgo(m.at)}
        {m.editedAt && !isDeleted ? " · editada" : ""}
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
  const [pending, setPending] = useState<PendingMedia | null>(null);
  const [caption, setCaption] = useState("");
  const [sending, setSending] = useState(false);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const vidInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const isWhats = channel === "whatsapp";

  // Quick replies (respostas rápidas configuráveis)
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [activeReply, setActiveReply] = useState<QuickReply | null>(null);
  const [replyText, setReplyText] = useState("");

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    listQuickReplies(companyId, { activeOnly: true })
      .then((rows) => {
        if (cancelled) return;
        setQuickReplies(rows);
        if (rows.length === 0) {
          console.log("QUICK_REPLIES_EMPTY", { company_id: companyId });
        } else {
          console.log("QUICK_REPLIES_LOADED", {
            company_id: companyId,
            count: rows.length,
            ids: rows.map((r) => r.id),
          });
        }
      })
      .catch((e) => console.error("[quick_replies load]", e));
    return () => {
      cancelled = true;
    };
  }, [companyId, menuOpen]);

  // Fecha menu ao clicar fora
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
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

  const selectFromLibrary = (url: string) => {
    setLibraryOpen(false);
    setPending({ kind: "image", path: url, previewUrl: url });
    setCaption("");
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
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          disabled={disabled}
          className="h-9 w-9 inline-flex items-center justify-center rounded-md bg-muted hover:bg-muted/80 text-foreground disabled:opacity-40 shrink-0"
          title="Anexar mídia"
          aria-label="Anexar mídia"
        >
          <Plus className="h-4 w-4" />
        </button>
        {menuOpen && (
          <div className="absolute bottom-full mb-2 right-0 w-52 rounded-md border border-border bg-popover shadow-lg z-30 overflow-hidden">
            <button
              type="button"
              onClick={() => pickFile("image")}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left"
            >
              <ImageIcon className="h-4 w-4 text-primary" /> Foto
            </button>
            <button
              type="button"
              onClick={() => pickFile("video")}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left"
            >
              <VideoIcon className="h-4 w-4 text-primary" /> Vídeo
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setLibraryOpen(true);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left border-t border-border"
            >
              <LibraryIcon className="h-4 w-4 text-primary" /> Biblioteca de Produtos
            </button>
            {quickReplies.length > 0 && (
              <div className="border-t border-border max-h-64 overflow-y-auto">
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold bg-muted/40">
                  Respostas rápidas
                </div>
                {quickReplies.map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => {
                      console.log("QUICK_REPLY_CLICKED", { id: q.id, name: q.name });
                      setMenuOpen(false);
                      onInsertText(q.content);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left"
                    title={q.category ?? undefined}
                  >
                    <span className="text-base w-5 text-center">{q.icon || "💬"}</span>
                    <span className="truncate">{q.name}</span>
                  </button>
                ))}

              </div>
            )}
          </div>
        )}
      </div>

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
                Edite o texto antes de enviar se quiser.
              </p>
            </div>
            <div className="p-4 border-t border-border flex items-center justify-end gap-2">
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
                onClick={() => {
                  const t = replyText.trim();
                  if (!t) {
                    toast.error("Mensagem vazia");
                    return;
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
    </>
  );
}

function ProductsLibraryModal({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (path: string) => void;
}) {
  const [, force] = useState(0);
  useEffect(() => subscribeProducts(() => force((n) => n + 1)), []);
  const [query, setQuery] = useState("");
  const all = listProducts();
  const filtered = useMemo<Product[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.category ?? "").toLowerCase().includes(q),
    );
  }, [all, query]);
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

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-lg border border-border max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border flex items-center justify-between gap-3">
          <div className="font-semibold text-sm flex items-center gap-2">
            <LibraryIcon className="h-4 w-4" /> Biblioteca de Produtos
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar produto ou categoria…"
            className="flex-1 max-w-xs rounded-md bg-input px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <button onClick={onClose} className="p-1 hover:bg-muted rounded">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-4 space-y-6">
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
              <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
                {items.flatMap((p) =>
                  (p.images ?? []).map((img, i) => (
                    <button
                      key={`${p.id}-${i}`}
                      onClick={() => onPick(img)}
                      className="group relative rounded-md overflow-hidden border border-border hover:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
                      title={p.name}
                    >
                      <SmartImage
                        src={img}
                        alt={p.name}
                        aspectRatio="1/1"
                        wrapperClassName="w-full"
                      />
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1.5">
                        <div className="text-[10px] text-white truncate">{p.name}</div>
                      </div>
                    </button>
                  )),
                )}
              </div>
            </div>
          ))}
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
  const [, rerenderRepo] = useState(0);
  // Re-renderiza quando o repo mudar (mensagens novas, status atualizado, etc.).
  useEffect(() => subscribeRepo(() => rerenderRepo((v) => v + 1)), []);
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
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const pendingTextSendsRef = useRef<Set<string>>(new Set());

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const initialScrollConversationRef = useRef<string | null>(null);

  // Carrega ai_status da conversa + realtime + último motivo de handoff
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    const loadStatus = async () => {
      const { data } = await supabase
        .from("conversations")
        .select("ai_status, ai_handling")
        .eq("id", conversationId)
        .maybeSingle();
      if (!cancelled && data) setAiState({ ai_status: data.ai_status, ai_handling: data.ai_handling });
    };
    const loadReason = async () => {
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
    };
    void loadStatus();
    void loadReason();

    const ch = supabase
      .channel(`conv-ai-${conversationId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversations", filter: `id=eq.${conversationId}` },
        (payload) => {
          const row = payload.new as { ai_status: string | null; ai_handling: boolean };
          setAiState({ ai_status: row.ai_status, ai_handling: row.ai_handling });
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(ch);
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

  // Ao abrir/trocar de conversa, começa na mensagem mais recente.
  useEffect(() => {
    if (initialScrollConversationRef.current === conversationId) return;
    const el = scrollRef.current;
    if (!el || messages.length === 0) return;
    const frame = window.requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
      initialScrollConversationRef.current = conversationId;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [conversationId, messages.length]);

  // Auto-scroll só quando o usuário já está perto do final — assim mensagens novas
  // chegando via Realtime não interrompem quem está lendo o histórico.
  const lastMessageId = messages[messages.length - 1]?.id;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom < 160;
    if (nearBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [lastMessageId, ai, pendingQuote]);

  // Fallback: se o Realtime do leadRepo falhar por algum motivo, faz um refetch
  // leve da conversa aberta a cada 25s. Para ao desmontar.
  useEffect(() => {
    if (!conversationId) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refetchConversationMessages(conversationId);
    }, 25_000);
    return () => window.clearInterval(id);
  }, [conversationId]);


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
    const trimmed = text.trim();
    if (!trimmed) return;
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

    const isWhatsApp = lead?.channel === "whatsapp";
    if (profile?.company_id) {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        if (token) {
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
    if (lead) void markLeadWon(lead.id, value);
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

  const confirmLost = (reason: string) => {
    if (!lead) return;
    void markLeadLost(lead.id, reason);
    setLostOpen(false);
    setClosedInfo({ value: 0, at: new Date().toISOString() });
    setLocalMessages((prev: Message[]) => [
      ...prev,
      {
        id: `sys-${Date.now()}`,
        conversationId,
        role: "system",
        text: `❌ Lead marcado como perdido — ${reason}`,
        at: new Date().toISOString(),
      },
    ]);
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
        <header className="h-12 md:h-14 px-3 md:px-4 border-b border-border flex items-center gap-2 md:gap-3 shrink-0">

          <button
            onClick={() => navigate({ to: "/inbox" })}
            className="md:hidden p-1.5 rounded-md hover:bg-accent shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
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
          {!closedInfo && (
            <button
              onClick={() => setCloseOpen(true)}
              className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-[var(--status-won)] text-white hover:opacity-90 text-xs font-semibold shrink-0"
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Fechar venda
            </button>
          )}
        </header>

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

        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scroll-smooth p-3 md:p-4 pb-4 md:pb-6 space-y-3 overscroll-contain">
          {messages.map((m) => {
            if (m.role === "system") {
              return (
                <div key={m.id} className="flex justify-center">
                  <span className="text-[11px] text-muted-foreground bg-secondary rounded-full px-3 py-1">
                    {m.text}
                  </span>
                </div>
              );
            }
            // "Apagar para mim" esconde no UI; "Apagar da conversa" mostra placeholder.
            if (m.deletedAt && m.deletedFor === "me") return null;
            return (
              <MessageBubble
                key={m.id}
                m={m}
                canManage={!closedInfo}
              />
            );
          })}
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

        {/* Composer */}
        <div
          className="border-t border-border p-2 md:p-3 shrink-0 bg-background"
          style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        >

          <div className="flex items-end gap-1.5 md:gap-2">
            <button
              onClick={generateAI}
              disabled={aiLoading || !!closedInfo}
              className="h-9 px-2 md:px-3 inline-flex items-center gap-1.5 rounded-md bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 text-xs font-semibold disabled:opacity-50 shrink-0"
              title="Responder com IA"
              aria-label="Responder com IA"
            >
              {aiLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              <span className="hidden md:inline">Responder com IA</span>
            </button>
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
                    : "Mensagem… (Enter envia · Shift+Enter quebra linha)"
              }
              rows={1}
              className="flex-1 min-w-0 resize-none rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 max-h-40 md:min-h-[3.5rem]"
            />
            <MediaSendPanel
              conversationId={conversationId}
              channel={lead?.channel}
              disabled={!!closedInfo}
              companyId={profile?.company_id ?? null}
              leadId={lead?.id ?? null}
              onSent={() => void refetchConversationMessages(conversationId)}
              onSendText={(t) => sendMessage(t)}
              onInsertText={(t) => {
                setInput((prev) => (prev ? `${prev}\n${t}` : t));
                requestAnimationFrame(() => composerRef.current?.focus());
              }}

            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || !!closedInfo}
              className="h-9 px-2.5 md:px-3 inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 text-sm font-medium shrink-0"
              aria-label={isComment ? "Responder comentário" : "Enviar"}
            >
              <Send className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{isComment ? "Responder" : "Enviar"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Side panel */}
      <aside className="hidden lg:flex w-80 shrink-0 flex-col bg-card/40 overflow-y-auto min-h-0">

        <div className="p-4 border-b border-border">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Lead</div>
          <div className="text-base font-semibold">{lead.name}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{lead.phone ?? lead.handle}</div>
        </div>

        <div className="p-4 border-b border-border space-y-3 text-sm">
          <Row label="Produto" value={lead.product ?? "—"} />
          <Row
            label={closedInfo ? "Valor da venda" : "Valor estimado"}
            value={
              closedInfo
                ? formatBRL(closedInfo.value)
                : lead.estimatedValue
                  ? formatBRL(lead.estimatedValue)
                  : "—"
            }
          />
          <Row label="Atribuído a" value={lead.assignedTo ?? "Ninguém"} />
          <Row label="Origem" value={<ChannelBadge channel={lead.channel} />} />
        </div>

        <QualificationPanel conv={conversation} />
        <AITimeline conversationId={conversationId} />



        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground mb-2">
            <Target className="h-3 w-3" /> Próxima ação
          </div>
          {lead.nextAction ? (
            <div>
              <div className="text-sm font-medium">{lead.nextAction.label}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {new Date(lead.nextAction.dueAt).toLocaleString("pt-BR")}
              </div>
            </div>
          ) : (
            <div className="rounded-md bg-[var(--status-warm)]/10 text-[var(--status-warm)] text-xs px-2 py-1.5">
              ⚠ Sem próxima ação definida
            </div>
          )}
        </div>

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

        <div className="p-4 space-y-1.5">
          <ActionButton
            icon={quoteSuggesting ? Loader2 : FileText}
            onClick={openNewQuote}
            disabled={!!closedInfo || quoteSuggesting}
          >
            {quoteSuggesting ? "Sugerindo produto…" : "Criar orçamento"}
          </ActionButton>
          <ActionButton icon={Calendar}>Agendar visita</ActionButton>
          <ActionButton icon={Target}>Definir próxima ação</ActionButton>
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
            disabled={!!closedInfo}
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
}: {
  icon: typeof FileText;
  children: React.ReactNode;
  variant?: "default" | "won" | "lost";
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
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
  );
}

function MarkLostModal({
  leadName,
  onCancel,
  onConfirm,
}: {
  leadName: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const settings = useSyncExternalStore(subscribeSettings, getSettings, getSettings);
  const reasons = settings.lossReasons;
  // Não pré-seleciona — força a vendedora a escolher um motivo conscientemente.
  const [selected, setSelected] = useState<string>("");
  const [custom, setCustom] = useState("");
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
                  if (e.key === "Enter" && valid) onConfirm(finalReason);
                }}
                placeholder="Descreva o motivo"
                className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            )}
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
            onClick={() => onConfirm(finalReason)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-[var(--status-lost)] text-white px-3 py-2 hover:opacity-90 disabled:opacity-40"
          >
            <XCircle className="h-3.5 w-3.5" /> Confirmar perda
          </button>
        </div>
      </div>
    </div>
  );
}

import { Link, useNavigate, createLazyFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { runFollowupNowForConversation, type ManualFollowupResult } from "@/lib/manual-followup.functions";
import { Zap } from "lucide-react";
import { getUnsupportedPlaceholder } from "@/lib/inbox/unsupported-placeholder";
import {
  initialConversationOpenState,
  reduceConversationOpen,
  shouldMountVirtuoso,
  shouldRevealVirtuoso,
  type ConversationOpenEvent,
  type ConversationOpenState,
} from "@/lib/inbox/conversation-open-machine";
import {
  snapshotArray,
  diffArraySnapshot,
  logAiStateAttempt,
  logAtBottom,
  aiStateEqual,
  type ArrayDiagSnapshot,
  type AiStateShape,
} from "@/lib/inbox/diag-cascade";
import { ChatSkeleton } from "@/components/inbox/ChatSkeleton";
import { createContext, forwardRef, memo, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type ComponentPropsWithoutRef } from "react";
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
import { ConversationDetailsSheet } from "@/components/inbox/ConversationDetailsSheet";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import {
  clearDraft,
  consumeComposerFocus,
  readDraft,
  saveDraft,
} from "@/lib/inbox/mobile-session";

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
  PanelRight,

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


import type { LibraryPick } from "@/lib/inbox/types";

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

import {
  MessagesContext,
  VirtuosoScrollContext,
  ReplyComposeContext,
} from "@/lib/inbox/contexts";
import {
  INBOX_SCROLL_TRACE_SELECTOR,
  TracedVirtuosoItem,
  TracedVirtuosoScroller,
  inferInboxScrollReason,
  markInboxScrollIntent,
  markInboxUserInput,
  getInboxScrollTraceScroller,
  setInboxBottomLockCancelHandler,
  startInboxScrollTrace,
  stopInboxScrollTrace,
  traceInboxScroll,
  type InboxScrollVirtualSnapshot,
} from "@/lib/inbox/scroll-trace";



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

import { MessageBubble, messageForAi } from "@/components/inbox/message/MessageBubble";

// ============================================================================
// MediaSendPanel — botão "+" do composer (foto / vídeo / biblioteca de produtos)
// ============================================================================
import { QuickRepliesButton, MediaSendPanel } from "@/components/inbox/composer/ComposerWidgets";
// mutação acidental por consumidores.
const EMPTY_MESSAGES: Message[] = Object.freeze([]) as unknown as Message[];

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
  // DIAG cascade — contador de render + snapshots para diff ref/conteúdo.
  const renderIdRef = useRef(0);
  renderIdRef.current += 1;
  const prevRepoSnapRef = useRef<ArrayDiagSnapshot<Message> | null>(null);
  const prevVisibleSnapRef = useRef<ArrayDiagSnapshot<Message> | null>(null);
  const conversation = getConversationById(conversationId);
  const lead = conversation ? getLeadById(conversation.leadId) : undefined;
  const repoMessages = conversation ? getMessagesFor(conversationId) : EMPTY_MESSAGES;

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
        .map((m) => `${m.conversationId}\n${m.text.trim()}\n${m.at.slice(0, 19)}`),
    );
    const extras = localMessages.filter(
      (m) =>
        !ids.has(m.id) &&
        !(
          m.role === "agent" &&
          confirmedTextKeys.has(`${m.conversationId}\n${m.text.trim()}\n${m.at.slice(0, 19)}`)
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

  // DIAG cascade — diff de identidade vs conteúdo por render.
  // Guardada por `import.meta.env.DEV` dentro de `diag-cascade.ts` — não
  // ativa em produção.
  {
    const rid = renderIdRef.current;
    const nextRepoSnap = snapshotArray(repoMessages);
    diffArraySnapshot("repoMessages", rid, prevRepoSnapRef.current, nextRepoSnap);
    prevRepoSnapRef.current = nextRepoSnap;
    const nextVisibleSnap = snapshotArray(visibleMessages);
    diffArraySnapshot("visibleMessages", rid, prevVisibleSnapRef.current, nextVisibleSnap);
    prevVisibleSnapRef.current = nextVisibleSnap;
  }


  // Limpa otimistas que já foram absorvidos pelo repo (evita memória crescendo).
  useEffect(() => {
    if (localMessages.length === 0) return;
    const ids = new Set(repoMessages.map((m) => m.id));
    const confirmedTextKeys = new Set(
      repoMessages
        .filter((m) => m.role === "agent")
        .map((m) => `${m.conversationId}\n${m.text.trim()}\n${m.at.slice(0, 19)}`),
    );
    const shouldRemove = (m: Message) =>
      ids.has(m.id) ||
      (m.role === "agent" &&
        confirmedTextKeys.has(`${m.conversationId}\n${m.text.trim()}\n${m.at.slice(0, 19)}`));
    if (localMessages.some(shouldRemove)) {
      setLocalMessages((prev) => prev.filter((m) => !shouldRemove(m)));
    }
  }, [repoMessages, localMessages]);
  // Rascunho: inicializa a partir do que ficou salvo para ESTA conversa, de
  // modo que voltar para a lista, abrir o Coach ou consultar o lead nunca
  // descarte o que o vendedor já digitou.
  const [input, setInput] = useState(() => readDraft(conversationId));
  // Nível 3 da navegação mobile: Coach + lead + ações em sheet de tela cheia.
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Altura do teclado virtual (0 no desktop e com teclado fechado).
  const keyboardInset = useKeyboardInset();

  // Troca de conversa: carrega o rascunho correspondente e fecha o painel.
  useEffect(() => {
    setInput(readDraft(conversationId));
    setDetailsOpen(false);
  }, [conversationId]);

  // SPRINT 6 · FASE 6.2 — "Usar no campo" do Recovery AI Assistant: o texto já
  // chegou pelo rascunho; aqui apenas devolvemos o foco ao composer. Nunca
  // envia nada.
  useEffect(() => {
    if (!consumeComposerFocus(conversationId)) return;
    const t = requestAnimationFrame(() => {
      const el = composerRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
    return () => cancelAnimationFrame(t);
  }, [conversationId]);


  // Persiste o rascunho enquanto o usuário digita (debounce curto para não
  // gravar a cada tecla).
  useEffect(() => {
    const t = setTimeout(() => saveDraft(conversationId, input), 250);
    return () => clearTimeout(t);
  }, [conversationId, input]);


  const [audioState, setAudioState] = useState<"idle" | "recording" | "locked" | "processing" | "sending">("idle");
  const audioActive = audioState === "locked" || audioState === "processing" || audioState === "sending";
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // Botão que abre o sheet de detalhes (mobile) e alvo padrão do retorno de foco.
  const detailsTriggerRef = useRef<HTMLButtonElement>(null);
  // Marca que o fechamento veio de "usar sugestão" — nesse caso o foco vai
  // para o composer, não de volta para o gatilho.
  const focusComposerOnCloseRef = useRef(false);
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
  // Última janela observada para deduplicar probes redundantes do Virtuoso
  // (hotfix React #185). Resetado a cada troca de conversationId.
  const lastProbeWindowRef = useRef<{
    firstItemIndex: number | null;
    lastItemIndex: number | null;
    totalItems: number;
  } | null>(null);
  const visibleRangeRef = useRef<{
    rangeStartIndex: number | null;
    rangeEndIndex: number | null;
  }>({ rangeStartIndex: null, rangeEndIndex: null });
  const readScrollVirtualSnapshot = useCallback((): InboxScrollVirtualSnapshot => {
    const totalItems = latestVisibleMessagesLengthRef.current;
    const domRenderedItems =
      getInboxScrollTraceScroller()?.querySelectorAll(INBOX_SCROLL_TRACE_SELECTOR).length ??
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
      const scroller = getInboxScrollTraceScroller();
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
      s.lastHeight = getInboxScrollTraceScroller()?.scrollHeight ?? null;
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
      const scroller = getInboxScrollTraceScroller();
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
    logAtBottom(renderIdRef.current, v);
    atBottomRef.current = v;
    // Guarda referencial: chamadas com o mesmo valor não devem forçar
    // re-render. A atualização funcional garante bail-out do React quando
    // `prev === v`.
    _setAtBottom((prev) => (prev === v ? prev : v));
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
    lastProbeWindowRef.current = null;
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
  const aiStatePrevDiagRef = useRef<AiStateShape>(null);
  useEffect(() => {
    if (!conversation) return;
    const next: AiStateShape = {
      ai_status: conversation.aiStatus ?? null,
      ai_handling: conversation.aiHandling ?? false,
    };
    logAiStateAttempt(
      renderIdRef.current,
      "effect[conversation]",
      aiStatePrevDiagRef.current,
      next,
      "useEffect@line3518",
    );
    aiStatePrevDiagRef.current = next;
    setAiState((prev) => (aiStateEqual(prev, next) ? prev : next));
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
      const nextAi: AiStateShape = { ai_status: "assumido_humano", ai_handling: false };
      logAiStateAttempt(renderIdRef.current, "handleTakeover", aiStatePrevDiagRef.current, nextAi, "handleTakeover");
      aiStatePrevDiagRef.current = nextAi;
      setAiState((prev) => (aiStateEqual(prev, nextAi) ? prev : nextAi));
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

  // ---- Máquina de estados determinística de abertura (F2) --------------
  // Elimina o tremor: enquanto a máquina não estiver em `visible`, o
  // Virtuoso é renderizado com `visibility: hidden` sobre o skeleton, e
  // qualquer recalibração acontece invisível ao usuário.
  const [openState, dispatchOpen] = useReducer(
    reduceConversationOpen,
    undefined,
    initialConversationOpenState,
  );
  const openStateRef = useRef<ConversationOpenState>(openState);
  useEffect(() => {
    openStateRef.current = openState;
  }, [openState]);

  const dispatchLayoutProbe = useCallback((heightChanged: boolean) => {
    const s = openStateRef.current;
    if (s.name !== "preparing") return;
    const scroller = getInboxScrollTraceScroller();
    const distanceToEnd = scroller
      ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
      : 0;
    const ev: ConversationOpenEvent = {
      type: "layout_probe",
      cid: s.cid,
      totalItems: latestVisibleMessagesLengthRef.current,
      lastRenderedIndex: renderedWindowRef.current.lastItemIndex ?? -1,
      distanceToEnd,
      heightChanged,
    };
    dispatchOpen(ev);
  }, []);

  // Abertura por troca de conversa. Cache íntegro (>=2 msgs) entra direto
  // em `preparing`; preview isolado (1 msg) mantém em `loading`.
  useEffect(() => {
    if (!conversationId) return;
    dispatchOpen({
      type: "open",
      cid: conversationId,
      cachedTotal: latestVisibleMessagesLengthRef.current,
    });
    return () => dispatchOpen({ type: "close" });
  }, [conversationId]);

  // Reflete o resultado do carregamento inicial.
  useEffect(() => {
    if (threadLoad.status === "ready") {
      dispatchOpen({
        type: "load_ok",
        cid: conversationId,
        totalItems: latestVisibleMessagesLengthRef.current,
      });
    } else if (threadLoad.status === "error") {
      dispatchOpen({
        type: "load_error",
        cid: conversationId,
        message: threadLoad.error ?? "Falha ao carregar",
      });
    }
  }, [threadLoad, conversationId]);

  // Novas mensagens (bootstrap tardio, realtime durante loading/preparing).
  useEffect(() => {
    dispatchOpen({
      type: "messages_changed",
      cid: conversationId,
      totalItems: visibleMessages.length,
    });
  }, [visibleMessages.length, conversationId]);

  // Revelação atômica: ready → visible em 1 rAF, sem animação.
  useEffect(() => {
    if (openState.name !== "ready") return;
    const raf = requestAnimationFrame(() => {
      dispatchOpen({ type: "reveal", cid: openState.cid });
    });
    return () => cancelAnimationFrame(raf);
  }, [openState]);


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
        // F4 — bottom-lock e correção silenciosa 800ms REMOVIDOS. A
        // máquina de estados (openState) só revela o Virtuoso após a
        // calibração — não precisamos mais empilhar reancoragens.

      });
      cancelableR2Ref.current = r2;
    });
    return () => {
      cancelAnimationFrame(r1);
      if (cancelableR2Ref.current) cancelAnimationFrame(cancelableR2Ref.current);
    };
  }, [threadLoad.status, conversationId, visibleMessages.length]);

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
    const firstItemIndex = indexes.length ? Math.min(...indexes) : null;
    const lastItemIndex = indexes.length ? Math.max(...indexes) : null;
    renderedWindowRef.current = {
      renderedItems: items.length,
      firstItemIndex,
      lastItemIndex,
    };
    traceInboxScroll("OUTRO", "ITEMS_RENDERED", {
      indexes,
      itemIds: items
        .map((item) => item.data?.id)
        .filter((id): id is string => typeof id === "string"),
    });
    reanchorIfLocked("items_rendered");
    // Deduplicação defensiva: quando o Virtuoso re-emite `itemsRendered`
    // com a mesma janela (mesmo primeiro/último índice e mesmo total de
    // itens) NÃO despachamos uma nova probe. Isso complementa a
    // idempotência do reducer e é o corte final do loop do React #185.
    const totalItems = latestVisibleMessagesLengthRef.current;
    const prev = lastProbeWindowRef.current;
    if (
      prev !== null &&
      prev.firstItemIndex === firstItemIndex &&
      prev.lastItemIndex === lastItemIndex &&
      prev.totalItems === totalItems
    ) {
      return;
    }
    lastProbeWindowRef.current = { firstItemIndex, lastItemIndex, totalItems };
    dispatchLayoutProbe(false);
  }, [reanchorIfLocked, dispatchLayoutProbe]);

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
    dispatchLayoutProbe(false);
  }, [reanchorIfLocked, dispatchLayoutProbe]);

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
    dispatchLayoutProbe(true);
  }, [reanchorIfLocked, dispatchLayoutProbe]);

  const handleVirtuosoFollowOutput = useCallback((isAtBottom: boolean) => {
    // F4 — followOutput só age depois de `visible`. Durante preparing/ready,
    // não deixamos o Virtuoso "seguir" mensagens que ainda estão sendo
    // absorvidas do bootstrap.
    const revealed = openStateRef.current.name === "visible";
    const decision = revealed && isAtBottom ? "auto" : false;
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
    // O rascunho já cumpriu seu papel: some junto com o texto enviado.
    clearDraft(conversationId);

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

  // Fase 5.2 — o conteúdo do painel (Coach IA, dados do lead, ações) é
  // definido uma única vez e montado em dois lugares: no <aside> fixo do
  // desktop e, no mobile, dentro de um sheet de tela cheia. Uma única fonte
  // evita que as duas superfícies divirjam com o tempo.
  const sidePanelContent = (
    <>

        <CoachPanel
          conversationId={conversation.id}
          onInsertSuggestion={(t: string) => {
            setInput(t);
            // No mobile o Coach vive dentro do sheet: aceitar a sugestão
            // precisa devolver o vendedor ao composer imediatamente.
            focusComposerOnCloseRef.current = true;
            setDetailsOpen(false);
          }}


          messages={visibleMessages.map((m) => ({
            id: m.id,
            role: m.role,
            text: m.text,
            at: m.at,
            sourceSubtype: m.sourceSubtype,
          }))}
          composerHasDraft={input.trim().length > 0}
        />


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
    </>
  );

  return (
    <div className="flex-1 flex min-w-0 min-h-0 h-full max-w-full overflow-hidden">
      {/* Conversation column */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 max-w-full border-r border-border overflow-hidden">
        {/*
          Cabeçalho (nível 2 da navegação mobile). Regra da fase: no telefone
          só ficam soltas as ações primárias — voltar, fechar venda e abrir os
          detalhes. Tudo o mais (Coach, dados do lead, ações administrativas)
          vive dentro do sheet de detalhes.
        */}
        <header className="h-14 md:h-14 px-2 md:px-4 border-b border-border flex items-center gap-2 md:gap-3 shrink-0">

          <button
            onClick={() => navigate({ to: "/inbox" })}
            className="lg:hidden h-11 w-11 inline-flex items-center justify-center rounded-md hover:bg-accent shrink-0"
            aria-label="Voltar para a caixa de atendimento"
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
              className="hidden lg:inline-flex items-center gap-1.5 h-9 px-2.5 rounded-md border border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 text-xs font-semibold shrink-0 disabled:opacity-50"
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
          {/* Nível 3: Coach IA, dados do lead e ações. Só no mobile/tablet —
              no desktop o mesmo conteúdo já está no painel fixo à direita. */}
          <button
            type="button"
            ref={detailsTriggerRef}
            onClick={() => setDetailsOpen(true)}

            data-testid="open-conversation-details"
            className="lg:hidden h-11 w-11 inline-flex items-center justify-center rounded-md border border-border hover:bg-accent shrink-0"
            aria-label="Abrir detalhes do lead e Coach IA"
          >
            <PanelRight className="h-5 w-5" />
          </button>
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
              ) : !shouldMountVirtuoso(openState) ? (
                // F2/F8 — enquanto a máquina está em loading (aguardando
                // loadConversationRecent), mostramos skeleton estável. O
                // Virtuoso ainda NÃO monta: garante que ele nunca calibra
                // com um preview isolado como se fosse histórico completo.
                <ChatSkeleton />
              ) : visibleMessages.length === 0 ? (
                <div className="h-full" />
              ) : (
              <div className="relative h-full">
                {/* F3 — Skeleton permanece por cima enquanto o Virtuoso
                    calibra invisível. `visibility: hidden` preserva
                    medições (diferente de display:none). */}
                {!shouldRevealVirtuoso(openState) && (
                  <div className="absolute inset-0 z-10 pointer-events-none">
                    <ChatSkeleton />
                  </div>
                )}
                <div
                  className="h-full"
                  style={{
                    visibility: shouldRevealVirtuoso(openState)
                      ? "visible"
                      : "hidden",
                  }}
                >
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
                </div>
              </div>
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


        {/*
          Composer. No mobile ele é a barra fixa inferior da tela (o
          MobileBottomNav é escondido nesta rota), então precisa subir junto
          com o teclado virtual: `keyboardInset` vem do visualViewport e é
          somado à safe-area para o campo nunca ficar coberto no iOS.
        */}
        <div
          className="border-t border-border px-2 md:px-3 pt-2 md:pt-3 shrink-0 bg-background max-w-full overflow-x-hidden"
          style={{
            paddingBottom:
              keyboardInset > 0
                ? `${keyboardInset + 12}px`
                : "calc(env(safe-area-inset-bottom, 0px) + 12px)",
          }}
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

          {/*
            Mobile: duas linhas (texto em cima, ações embaixo) via flex-wrap +
            `basis-full` no textarea. Em 320px a linha única espremia o campo
            de texto em ~90px, tornando impossível revisar o que se escreve.
            Desktop (md+) volta a ser uma única linha, sem quebra.
          */}
          <div className="flex flex-wrap md:flex-nowrap items-end gap-1.5 md:gap-2 min-w-0 max-w-full">

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
                className="order-first md:order-none basis-full md:basis-auto flex-1 min-w-0 resize-none rounded-2xl md:rounded-md bg-input px-4 md:px-3 py-2.5 md:py-2 text-base md:text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 max-h-40 min-h-[44px] md:min-h-[3.5rem]"
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
                className="ml-auto md:ml-0 h-11 w-11 md:h-9 md:w-auto md:px-3 inline-flex items-center justify-center gap-1.5 rounded-full md:rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 text-sm font-medium shrink-0"
                aria-label={isComment ? "Responder comentário" : "Enviar"}
              >
                <Send className="h-5 w-5 md:h-3.5 md:w-3.5" />
                <span className="hidden md:inline">{isComment ? "Responder" : "Enviar"}</span>
              </button>
            )}
          </div>
        </div>

      </div>


      {/* Side panel — desktop.
          O conteúdo é montado em UM lugar por vez: quando o sheet mobile está
          aberto, o `<aside>` fica vazio. Sem isso, `sidePanelContent` existiria
          duas vezes na árvore (o aside é apenas `display:none` no mobile, não
          desmontado), duplicando queries e derrubando a rota com
          "cannot add postgres_changes callbacks after subscribe()" — dois
          componentes tentando o mesmo tópico Realtime. */}
      <aside className="hidden lg:flex w-80 shrink-0 flex-col bg-card/40 overflow-y-auto min-h-0">
        {detailsOpen ? null : sidePanelContent}
      </aside>


      {/* Nível 3 mobile/tablet — mesmo conteúdo em sheet de tela cheia. */}
      <ConversationDetailsSheet
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        title={lead.name}
        onCloseFocus={() => {
          // Gatilho é um botão controlado, não um SheetTrigger: sem isto o
          // Radix devolveria o foco ao <body> e o vendedor precisaria de um
          // toque extra para voltar a digitar.
          //
          // O foco precisa ser SÍNCRONO aqui. Com `requestAnimationFrame` o
          // teardown do FocusScope do Radix rodava depois do nosso `focus()`
          // e o blur final deixava o `document.body` como `activeElement`.
          // Mantemos um reforço em `queueMicrotask` apenas para o caso de o
          // alvo ainda estar sendo remontado (o `<aside>` volta a renderizar
          // `sidePanelContent` no mesmo commit em que `detailsOpen` vira false).
          const wantsComposer = focusComposerOnCloseRef.current;
          focusComposerOnCloseRef.current = false;
          const pick = () => (wantsComposer ? composerRef.current : detailsTriggerRef.current);
          const target = pick();
          if (!target) return false;
          target.focus({ preventScroll: true });
          queueMicrotask(() => {
            if (document.activeElement === document.body) {
              pick()?.focus({ preventScroll: true });
            }
          });
          return true;
        }}

      >

        {isAdmin && !closedInfo ? (
          <div className="px-3 pt-3">
            {/* Ação administrativa que sai do cabeçalho no mobile. */}
            <button
              type="button"
              onClick={handleManualFollowup}
              disabled={manualRunning}
              className="w-full inline-flex items-center justify-center gap-1.5 h-11 px-3 rounded-md border border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 text-sm font-semibold disabled:opacity-50"
            >
              {manualRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              Executar Follow-up Agora
            </button>
          </div>
        ) : null}
        {sidePanelContent}
      </ConversationDetailsSheet>



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

import { Row, ActionButton, CloseSaleModal, MarkLostModal, NextActionModal, ScheduleVisitModal } from "@/components/inbox/modals/ConversationModals";
